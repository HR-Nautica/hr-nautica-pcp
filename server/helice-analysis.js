import { transaction, withConnection } from './database.js';
import { CatalogError, getProduct, requireActiveProduct } from './product-catalog.js';
import { createHash } from 'node:crypto';
import { HELICE_ORDER_PREFIX, readHeliceOrders, recordHeliceOrder } from './helice-order-store.js';
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
    return { ...settings, ordersAvailable: true, items: rankHeliceCoverage(items.map(item => calculateHeliceCoverage(item, settings.parameters))) };
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
    const products = (await client.query(`SELECT i.id,i.primary_sku,i.description,i.item_type,i.status,i.unit,s.physical_quantity,s.stock_authority,s.source_position_at
      FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id WHERE i.id=ANY($1::uuid[])`, [[...ids]])).rows;
    await attachTinyStockMetrics(client, products);
    const routing = (await client.query(`SELECT r.product_id,r.sequence,p.code,p.name FROM public.product_routing_steps r
      JOIN public.production_steps p ON p.id=r.production_step_id WHERE r.product_id=ANY($1::uuid[]) ORDER BY r.product_id,r.sequence`, [[...ids]])).rows;
    const byId = new Map(products.map(product => [product.id, { ...product, orders_available: true,
      routing: routing.filter(step => step.product_id === product.id) }]));
    const enrich = nodes => nodes.map(node => ({ ...node, item: byId.get(node.child_product_id), children: enrich(node.children) }));
    return { product: byId.get(detail.product.id), bomTree: enrich(detail.bomTree), ordersAvailable: true };
  });
}

function orderQuantity(value){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>1e9)throw new CatalogError('Informe uma quantidade inteira de peças entre 1 e 1 bilhão.');
  return value;
}
async function loadOrderPlan(client,productId,quantity){
  await requireActiveProduct(client,productId);
  const product=(await client.query('SELECT * FROM public.master_items WHERE id=$1',[productId])).rows[0];
  if(product.item_type!=='Hélice usinada')throw new CatalogError('Somente hélices usinadas podem abrir esta OP.');
  await attachTinyStockMetrics(client,[product]);
  const settings=await readSettings(client),analysis=calculateHeliceCoverage(product,settings.parameters);
  const raws=(await client.query(`SELECT child.id,child.primary_sku,child.unit,child.status,
    bool_and(b.link_status='active' AND b.quantity>0 AND b.unit=child.unit) AS valid_bom,
    SUM(b.quantity)*$2::numeric AS required,s.physical_quantity AS available,s.physical_quantity>=SUM(b.quantity)*$2::numeric AS sufficient,
    GREATEST(SUM(b.quantity)*$2::numeric-s.physical_quantity,0) AS shortfall,s.version AS stock_version,s.stock_authority,
    child.source_metadata,child.tiny_import_enabled
    FROM public.product_bom_lines b JOIN public.master_items child ON child.id=b.child_product_id
    LEFT JOIN public.product_stock_balances s ON s.product_id=child.id
    WHERE b.parent_product_id=$1 AND child.item_type='Hélice bruta'
    GROUP BY child.id,s.physical_quantity,s.version,s.stock_authority ORDER BY child.id`,[productId,quantity])).rows;
  const issues=[];
  if(!raws.length)issues.push('Nenhum bruto vinculado diretamente na BOM. Cadastre o bruto antes de abrir a OP.');
  for(const raw of raws){
    if(raw.status!=='active')issues.push(`${raw.primary_sku}: bruto inativo.`);
    if(!raw.valid_bom||raw.required==null)issues.push(`${raw.primary_sku}: quantidade, unidade ou vínculo da BOM pendente/inválido.`);
    const fields=raw.source_metadata?.tinyImportFields;
    if(raw.stock_authority!=='erp'||(Array.isArray(fields)?fields.includes('physical_quantity'):raw.tiny_import_enabled))issues.push(`${raw.primary_sku}: físico controlado por Tiny. Configure o bruto para controle interno antes de consumir.`);
    if(raw.available==null)issues.push(`${raw.primary_sku}: estoque físico não informado.`);
    else if(raw.required!=null&&!raw.sufficient)issues.push(`${raw.primary_sku}: necessário ${raw.required} ${raw.unit}; saldo ${raw.available} ${raw.unit}; falta ${raw.shortfall} ${raw.unit}.`);
  }
  const token=createHash('sha256').update(JSON.stringify({productVersion:product.version,settingsVersion:settings.version,quantity,physical:product.physical_quantity,sold:product.expected_outgoing_quantity,average:product.monthly_average,production:product.incoming_quantity,raws})).digest('hex');
  return {product,raws,issues,canOpen:!issues.length,planToken:token,suggestedQuantity:analysis.suggested_op};
}
export async function previewHeliceOrder(productId,quantity){
  orderQuantity(quantity);return withConnection(client=>loadOrderPlan(client,productId,quantity));
}
export async function openHeliceOrder(productId,input,actor){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(productId)))throw new CatalogError('Produto inválido.');
  productId=productId.toLowerCase();
  const quantity=orderQuantity(input?.quantity),requestId=String(input?.requestId||'');
  if(!/^[a-f0-9]{32}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(String(input?.expectedPlan||'')))throw new CatalogError('Confira a disponibilidade do bruto antes de confirmar.');
  if(typeof actor!=='string'||!actor.trim()||actor.length>100)throw new CatalogError('Usuário inválido.');
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('helice-orders-v1'))");
    const previous=(await client.query('SELECT value FROM public.app_state WHERE key=$1',[HELICE_ORDER_PREFIX+requestId])).rows[0];
    if(previous){const order=JSON.parse(previous.value);if(order.product_id!==productId||order.quantity!==quantity||order.created_by!==actor)throw new CatalogError('Identificador de abertura já usado com outros dados.','OP_REQUEST_CONFLICT',409);return {order,idempotent:true};}
    await client.query('LOCK TABLE public.master_items IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE public.product_bom_lines IN SHARE MODE');
    await client.query('LOCK TABLE public.product_routing_steps IN SHARE MODE');
    // Ordem estável de bloqueios evita consumo concorrente do mesmo saldo.
    await client.query(`SELECT s.product_id FROM public.product_stock_balances s WHERE s.product_id IN
      (SELECT child_product_id FROM public.product_bom_lines WHERE parent_product_id=$1) ORDER BY s.product_id FOR UPDATE`,[productId]);
    const plan=await loadOrderPlan(client,productId,quantity);
    if(plan.planToken!==input.expectedPlan)throw new CatalogError('Os saldos, a BOM ou os parâmetros mudaram. Confira novamente antes de abrir.','OP_PREVIEW_STALE',409);
    if(!plan.canOpen)throw new CatalogError(plan.issues.join(' '),'RAW_STOCK_UNAVAILABLE',409);
    const consumption=[];
    for(const raw of plan.raws){
      const changed=await client.query(`UPDATE public.product_stock_balances SET physical_quantity=physical_quantity-$2::numeric,
        version=version+1,updated_at=clock_timestamp(),source_position_at=clock_timestamp(),updated_by=$3 WHERE product_id=$1 AND version=$4 AND stock_authority='erp' AND physical_quantity>=$2::numeric RETURNING physical_quantity,version`,[raw.id,raw.required,actor,raw.stock_version]);
      if(!changed.rowCount)throw new CatalogError('O saldo do bruto mudou. Confira novamente.','RAW_STOCK_CONFLICT',409);
      consumption.push({product_id:raw.id,sku:raw.primary_sku,quantity:raw.required,unit:raw.unit,previous:raw.available,current:changed.rows[0].physical_quantity,previous_version:raw.stock_version,current_version:changed.rows[0].version});
    }
    const routing=(await client.query(`SELECT r.id,r.sequence,r.instructions,p.code,p.name FROM public.product_routing_steps r JOIN public.production_steps p ON p.id=r.production_step_id WHERE r.product_id=$1 ORDER BY r.sequence`,[productId])).rows;
    const order=await recordHeliceOrder(client,{requestId,product:plan.product,quantity,routing,consumption,suggestedQuantity:plan.suggestedQuantity},actor);
    return {order,idempotent:false};
  });
}
export async function listHeliceOrders(){return withConnection(client=>readHeliceOrders(client));}
