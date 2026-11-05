// Imported planning values remain part of the immutable Tiny snapshot audit.
// Each product reads only its latest committed snapshot, never a sum of imports.
export const TINY_STOCK_METRICS=[
 ['incoming_quantity','Entradas previstas'],
 ['expected_outgoing_quantity','Saídas previstas'],
 ['virtual_quantity','Estoque virtual'],
 ['period_outgoing_quantity','Saídas do período'],
 ['monthly_average','Média mensal']
];
export async function attachTinyStockMetrics(client,items){
 const ids=items.map(item=>item.id);
 if(!ids.length)return items;
 // Read physical stock and the latest planning snapshot in the same statement.
 const snapshots=(await client.query(`WITH latest AS (SELECT DISTINCT ON (line->>'productId') line->>'productId' AS product_id,line->'metrics' AS metrics FROM public.product_catalog_imports imports CROSS JOIN LATERAL jsonb_array_elements(imports.result->'changes') AS line WHERE imports.source_schema='tiny_stock_v1' AND imports.status='completed' AND line->>'productId'=ANY($1::text[]) ORDER BY line->>'productId',imports.imported_at DESC,imports.id DESC) SELECT stocks.product_id,stocks.physical_quantity,stocks.stock_authority,latest.metrics FROM public.product_stock_balances stocks LEFT JOIN latest ON latest.product_id=stocks.product_id::text WHERE stocks.product_id=ANY($1::uuid[])`,[ids])).rows;
 const byId=new Map(snapshots.map(row=>[row.product_id,row]));
 for(const item of items){const snapshot=byId.get(item.id);if(snapshot){item.physical_quantity=snapshot.physical_quantity;item.stock_authority=snapshot.stock_authority;}const metrics=snapshot?.metrics;for(const [key]of TINY_STOCK_METRICS)item[key]=metrics?.[key]??null;}
 return items;
}
