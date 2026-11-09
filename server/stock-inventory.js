import XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { transaction, withConnection } from './database.js';
import { CatalogError } from './product-catalog.js';

const schema = 'stock_inventory_v1';
const headers = ['SKU', 'Produto', 'Unidade', 'Status', 'Estoque físico atual', 'Contagem', 'Referência'];
const reference = item => [item.id, item.version, item.stock_version ?? 0].join(':');
const digest = value => createHash('sha256').update(value).digest('hex');
const stockSelect = `SELECT i.id,i.primary_sku,i.primary_sku_normalized,i.description,i.unit,i.status,i.version,
  s.physical_quantity,s.version AS stock_version FROM public.master_items i
  LEFT JOIN public.product_stock_balances s ON s.product_id=i.id`;

export function inventoryWorkbook(items) {
  const rows = items.map(item => [
    item.primary_sku, item.description, item.unit, item.status === 'active' ? 'Ativo' : 'Inativo',
    item.physical_quantity == null ? null : Number(item.physical_quantity), null, reference(item)
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = [23, 58, 12, 12, 23, 16, 52].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Inventário');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export async function exportStockInventory() {
  return withConnection(async client => inventoryWorkbook((await client.query(
    stockSelect + ' ORDER BY i.primary_sku_normalized,i.id'
  )).rows));
}

export function parseStockInventory(buffer) {
  let sheets;
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 20002 });
    sheets = workbook.SheetNames.map(name => workbook.Sheets[name]);
  } catch {
    throw new CatalogError('Não foi possível ler a planilha de inventário.');
  }
  const candidates = sheets.filter(sheet => headers.every((header, index) => sheet[XLSX.utils.encode_cell({ r: 0, c: index })]?.v === header));
  if (candidates.length !== 1) throw new CatalogError('Use a planilha exportada pelo Estoque Geral e mantenha os cabeçalhos.');
  const [sheet] = candidates;
  const lastRow = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']).e.r;
  if (lastRow > 20000) {
    throw new CatalogError('A planilha deve ter até 20 mil itens.');
  }
  const range = { s: { r: 0, c: 0 }, e: { r: lastRow, c: headers.length - 1 } };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, range });
  const counts = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (!index) continue;
    const countCell = sheet['F' + (index + 1)];
    if (!countCell?.f && (row[5] == null || row[5] === '')) continue;
    const sku = String(row[0] ?? '').trim().replace(/[a-z]/g, letter => letter.toUpperCase());
    const quantity = row[5];
    if (!sku || seen.has(sku)) throw new CatalogError(`Linha ${index + 1}: SKU ausente ou repetido.`);
    if (countCell?.f || typeof quantity !== 'number' || !Number.isFinite(quantity) ||
        quantity < 0 || quantity >= 1e12 || Number(quantity.toFixed(8)) !== quantity) {
      throw new CatalogError(`Linha ${index + 1}: informe uma contagem numérica, sem fórmula, com até 8 casas decimais.`);
    }
    seen.add(sku);
    counts.push({ sku, quantity, reference: String(row[6] ?? '') });
  }
  if (!counts.length) throw new CatalogError('Preencha pelo menos uma célula na coluna Contagem.');
  return counts;
}

export async function importStockInventory(buffer, { actor, fileName, preview, expectedPlan }) {
  const counts = parseStockInventory(buffer);
  const fileChecksum = digest(buffer);
  return transaction(async client => {
    if (!preview) {
      // Ordem compatível com Tiny e abertura de OP, que bloqueiam o cadastro antes dos saldos.
      await client.query('LOCK TABLE public.master_items IN SHARE ROW EXCLUSIVE MODE');
      const saved = (await client.query(
        'SELECT result FROM public.product_catalog_imports WHERE checksum=$1 AND source_schema=$2 AND imported_by=$3',
        [expectedPlan, schema, actor]
      )).rows[0];
      if (saved) {
        if (saved.result.fileChecksum !== fileChecksum) throw new CatalogError('A planilha difere da versão confirmada.');
        return saved.result;
      }
      await client.query(`SELECT s.product_id FROM public.product_stock_balances s JOIN public.master_items i ON i.id=s.product_id
        WHERE i.primary_sku_normalized=ANY($1::text[]) ORDER BY s.product_id FOR UPDATE OF s`, [counts.map(item => item.sku)]);
    }
    const items = (await client.query(stockSelect + ' WHERE i.primary_sku_normalized=ANY($1::text[])',
      [counts.map(item => item.sku)])).rows;
    const bySku = new Map(items.map(item => [item.primary_sku_normalized, item]));
    const changes = [];
    const issues = [];
    for (const count of counts) {
      const item = bySku.get(count.sku);
      if (!item || item.status !== 'active' || reference(item) !== count.reference) {
        const reason = !item ? 'SKU não encontrado' : item.status !== 'active' ? 'Produto inativo' : 'Cadastro ou saldo mudou desde a exportação';
        issues.push({ sku: count.sku, reason });
        continue;
      }
      const previous = item.physical_quantity;
      if (previous != null && Number(previous) === count.quantity) continue;
      changes.push({ productId: item.id, sku: item.primary_sku, description: item.description,
        previous, current: count.quantity, reference: count.reference });
    }
    const planChecksum = digest(JSON.stringify([schema, actor, fileChecksum, changes]));
    const result = { changes, issues, unchanged: counts.length - changes.length - issues.length, planChecksum, fileChecksum };
    if (preview) return result;
    if (issues.length || !changes.length || planChecksum !== expectedPlan) {
      throw new CatalogError('O inventário não pode ser aplicado. Confira os saldos e analise a planilha novamente.', 'INVENTORY_PREVIEW_STALE', 409);
    }
    for (const change of changes) {
      await client.query(`INSERT INTO public.product_stock_balances(product_id,physical_quantity,source_position_at,updated_by)
        VALUES($1,$2,clock_timestamp(),$3) ON CONFLICT(product_id) DO UPDATE SET
        physical_quantity=EXCLUDED.physical_quantity,source_position_at=EXCLUDED.source_position_at,
        version=product_stock_balances.version+1,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,
      [change.productId, change.current, actor]);
    }
    await client.query(`INSERT INTO public.product_catalog_imports
      (checksum,source_name,source_schema,status,item_count,bom_line_count,active_bom_line_count,pending_bom_line_count,imported_by,result)
      VALUES($1,$2,$3,'completed',$4,0,0,0,$5,$6::jsonb)`,
    [planChecksum, String(fileName || '').trim().slice(0, 300) || 'inventario.xlsx', schema, changes.length, actor, JSON.stringify(result)]);
    return result;
  });
}
