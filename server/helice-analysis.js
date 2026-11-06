import { transaction, withConnection } from './database.js';
import { CatalogError, getProduct } from './product-catalog.js';
import { attachTinyStockMetrics } from './tiny-stock-metrics.js';
import { COVERAGE_DEFAULTS, calculateHeliceCoverage, rankHeliceCoverage } from './helice-coverage.js';

const SETTINGS_KEY = 'hrn_helice_coverage_v1';
export function validateCoverageParameters(input) {
  const result = {};
  for (const key of Object.keys(COVERAGE_DEFAULTS)) {
    const value = input?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > (key === 'averageFactor' ? 100 : 120))
      throw new CatalogError('Parâmetros inválidos. Meses: maior que zero até 120; fator da média: maior que zero até 100.');
    result[key] = value;
  }
  return result;
}

async function readSettings(client) {
  const row = (await client.query('SELECT value,version,updated_at FROM public.app_state WHERE key=$1', [SETTINGS_KEY])).rows[0];
  if (!row) return { parameters: { ...COVERAGE_DEFAULTS }, version: 0, updatedAt: null, updatedBy: null };
  const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return { parameters: validateCoverageParameters(value.parameters), version: Number(row.version), updatedAt: row.updated_at, updatedBy: value.updatedBy };
}

export async function saveCoverageParameters(input, actor) {
  const parameters = validateCoverageParameters(input?.parameters), expected = input?.version;
  if (!Number.isInteger(expected) || expected < 0) throw new CatalogError('Versão dos parâmetros inválida.');
  return transaction(async client => {
    const value = JSON.stringify({ parameters, updatedBy: actor });
    const changed = expected === 0
      ? await client.query('INSERT INTO public.app_state(key,value,version,updated_at) VALUES($1,$2,1,clock_timestamp()) ON CONFLICT(key) DO NOTHING RETURNING version', [SETTINGS_KEY, value])
      : await client.query('UPDATE public.app_state SET value=$2,version=version+1,updated_at=clock_timestamp() WHERE key=$1 AND version=$3 RETURNING version', [SETTINGS_KEY, value, expected]);
    if (!changed.rowCount) throw new CatalogError('Os parâmetros foram alterados por outro usuário. Recarregue a análise antes de salvar.', 'COVERAGE_VERSION_CONFLICT', 409);
    await client.query('INSERT INTO public.audit_log(state_key,action,version,payload,actor,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())', [SETTINGS_KEY, 'UPSERT', changed.rows[0].version, value, actor]);
    return readSettings(client);
  });
}

export async function getHeliceAnalysis() {
  return withConnection(async client => {
    const settings = await readSettings(client);
    // Tipo cadastrado define a família da análise; não inferir pelo prefixo do SKU.
    const items = (await client.query(`SELECT i.*,s.physical_quantity,s.stock_authority,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',child.id,'sku',child.primary_sku) ORDER BY child.primary_sku)
        FROM public.product_bom_lines b JOIN public.master_items child ON child.id=b.child_product_id
        WHERE b.parent_product_id=i.id AND child.item_type='Hélice bruta'),'[]'::jsonb) AS raw_products
      FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id
      WHERE i.status='active' AND i.item_type='Hélice usinada' ORDER BY i.primary_sku_normalized,i.id`)).rows;
    await attachTinyStockMetrics(client, items);
    return { ...settings, ordersAvailable: false, items: rankHeliceCoverage(items.map(item => calculateHeliceCoverage({ ...item, open_orders: [] }, settings.parameters))) };
  });
}

export async function getHeliceStructure(productId) {
  const detail = await getProduct(productId);
  if (detail.product.item_type !== 'Hélice usinada' || detail.product.status !== 'active')
    throw new CatalogError('A análise exige uma hélice usinada ativa.', 'ANALYSIS_PRODUCT_INVALID', 404);
  const ids = new Set([detail.product.id]);
  const collect = nodes => { for (const node of nodes) { ids.add(node.child_product_id); collect(node.children); } };
  collect(detail.bomTree);
  return withConnection(async client => {
    const products = (await client.query(`SELECT i.id,i.primary_sku,i.description,i.item_type,i.status,i.unit,s.physical_quantity,s.stock_authority
      FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id WHERE i.id=ANY($1::uuid[])`, [[...ids]])).rows;
    await attachTinyStockMetrics(client, products);
    const routing = (await client.query(`SELECT r.product_id,r.sequence,p.code,p.name FROM public.product_routing_steps r
      JOIN public.production_steps p ON p.id=r.production_step_id WHERE r.product_id=ANY($1::uuid[]) ORDER BY r.product_id,r.sequence`, [[...ids]])).rows;
    const byId = new Map(products.map(product => [product.id, { ...product, open_orders: [], orders_available: false,
      routing: routing.filter(step => step.product_id === product.id) }]));
    const enrich = nodes => nodes.map(node => ({ ...node, item: byId.get(node.child_product_id), children: enrich(node.children) }));
    return { product: byId.get(detail.product.id), bomTree: enrich(detail.bomTree), ordersAvailable: false };
  });
}
