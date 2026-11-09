import { randomUUID } from 'node:crypto';
import { calculateStockPlanning } from './stock-planning.js';

// Registros versionados no PostgreSQL existente. Esta chave não admite escrita pela API genérica.
export const HELICE_ORDER_PREFIX = 'hrn_helice_order_v1:';
export async function readHeliceOrders(client, productIds = null) {
  const result = await client.query(`SELECT value FROM public.app_state WHERE key LIKE 'hrn_helice_order_v1:%'
    ${productIds ? "AND value::jsonb->>'product_id'=ANY($1::text[])" : ''} ORDER BY key`, productIds ? [productIds] : []);
  return result.rows.map(row => typeof row.value === 'string' ? JSON.parse(row.value) : row.value)
    .sort((a,b)=>(b.completed_stage_count||0)-(a.completed_stage_count||0)||a.number.localeCompare(b.number));
}
export async function attachHeliceOrders(client, items) {
  if(!items.length)return items;
  const orders=await readHeliceOrders(client,items.map(item=>item.id));
  for(const item of items){
    item.open_orders = orders.filter(order => order.product_id === item.id && ['open', 'waiting'].includes(order.status));
    const running = item.open_orders.filter(order => order.status === 'open');
    const pending = running.reduce((sum, order) => sum + order.remaining_quantity, 0);
    calculateStockPlanning(item, pending);
    item.incoming_quantity = running.length ? pending : null;
  }
  return items;
}
export async function recordHeliceOrder(client, {requestId,product,quantity,routing,consumption,suggestedQuantity},actor){
  const counterKey='hrn_helice_order_counter_v1';
  const counter=(await client.query('SELECT value FROM public.app_state WHERE key=$1 FOR UPDATE',[counterKey])).rows[0];
  const number=Number(counter?JSON.parse(counter.value):0)+1;
  await client.query('INSERT INTO public.app_state(key,value,version,updated_at) VALUES($1,$2,1,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_state.version+1,updated_at=clock_timestamp()',[counterKey,JSON.stringify(number)]);
  const order={id:randomUUID(),number:'OPH-'+String(number).padStart(6,'0'),product_id:product.id,sku:product.primary_sku,description:product.description,unit:product.unit,quantity,remaining_quantity:quantity,status:'open',completed_stage_count:0,current_stage:null,routing,consumption,suggested_quantity:suggestedQuantity,created_by:actor,created_at:new Date().toISOString(),version:1,request_id:requestId};
  const key=HELICE_ORDER_PREFIX+requestId,payload=JSON.stringify(order);
  await client.query('INSERT INTO public.app_state(key,value,version,updated_at) VALUES($1,$2,1,clock_timestamp())',[key,payload]);
  await client.query("INSERT INTO public.audit_log(state_key,action,version,payload,actor,created_at) VALUES($1,'OPEN_OP',1,$2,$3,clock_timestamp())",[key,payload,actor]);
  return order;
}
