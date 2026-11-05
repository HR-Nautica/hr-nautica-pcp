import XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { transaction } from './database.js';
import { CatalogError } from './product-catalog.js';
export function parseTinyStock(buffer) {
  let workbook;
  try { workbook=XLSX.read(buffer,{type:'buffer'}); } catch { throw new CatalogError('Planilha inválida.'); }
  const sheets=workbook.SheetNames.map(name=>XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:null}));
  const candidates=sheets.filter(rows=>rows[0]?.[1]==='Código (SKU)'&&rows[0]?.[8]==='Estoque físico');
  if(candidates.length!==1)throw new CatalogError('Formato inválido: esperado SKU na coluna B e Estoque físico na coluna I.');
  const seen=new Set();const items=[];
  for(const [index,row] of candidates[0].entries()){
    if(!index||row.every(value=>value===null||value===''))continue;
    const sku=String(row[1]??'').trim();const quantity=row[8];
    const key=sku.replace(/[a-z]/g,letter=>letter.toUpperCase());
    if(!sku||seen.has(key)||typeof quantity!=='number'||!Number.isFinite(quantity)||Math.abs(quantity)>=1e12)throw new CatalogError(`Linha ${index+1}: SKU ausente/duplicado ou estoque inválido. Nenhum saldo foi alterado.`);
    seen.add(key);items.push({sku,quantity});
  }
  if(!items.length)throw new CatalogError('Planilha sem itens.');
  return items;
}
export async function syncTinyStock(buffer,{actor,fileName,requestId,preview=false,expectedPlan}){
  if(!/^[0-9a-f]{32}$/i.test(String(requestId||'')))throw new CatalogError('Identificador de sincronização inválido.');
  const items=parseTinyStock(buffer);const fileChecksum=createHash('sha256').update(buffer).digest('hex');
  const checksum=createHash('sha256').update(requestId+fileChecksum).digest('hex');
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tiny-stock-sync'))");
    await client.query('LOCK TABLE public.master_items IN SHARE ROW EXCLUSIVE MODE');
    const previous=(await client.query('SELECT result FROM public.product_catalog_imports WHERE checksum=$1',[checksum])).rows[0];
    if(previous)return {...previous.result,idempotent:true};
    const result={updated:0,disabled:0,inactive:0,unknown:[],changes:[],disabledItems:[],inactiveItems:[],checksum,fileChecksum,requestId};
    for(const item of items){
      const products=(await client.query('SELECT id,description,version,tiny_import_enabled,status FROM public.master_items WHERE primary_sku_normalized=public.master_identifier_normalize($1) FOR UPDATE',[item.sku])).rows;
      if(products.length>1)throw new CatalogError(`SKU ambíguo: ${item.sku}.`);
      const product=products[0];
      if(!product){result.unknown.push(item.sku);continue;}
      const detail={sku:item.sku,description:product.description};
      if(product.status!=='active'){result.inactive++;result.inactiveItems.push(detail);continue;}
      if(!product.tiny_import_enabled){result.disabled++;result.disabledItems.push(detail);continue;}
      const old=(await client.query('SELECT physical_quantity,version FROM public.product_stock_balances WHERE product_id=$1 FOR UPDATE',[product.id])).rows[0];
      result.changes.push({productId:product.id,sku:item.sku,description:product.description,productVersion:product.version,stockVersion:old?.version??null,previous:old?.physical_quantity??null,current:item.quantity});result.updated++;
    }
    result.planChecksum=createHash('sha256').update(JSON.stringify(result)).digest('hex');
    if(preview)return {...result,preview:true};
    if(expectedPlan&&expectedPlan!==result.planChecksum)throw new CatalogError('Os cadastros ou saldos mudaram. Analise a planilha novamente antes de confirmar.','TINY_PREVIEW_STALE',409);
    for(const item of result.changes){
      await client.query(`INSERT INTO public.product_stock_balances(product_id,physical_quantity,stock_authority,source_position_at,updated_by) VALUES($1,$2,'tiny_import',clock_timestamp(),$3) ON CONFLICT(product_id) DO UPDATE SET physical_quantity=EXCLUDED.physical_quantity,stock_authority='tiny_import',source_position_at=EXCLUDED.source_position_at,version=product_stock_balances.version+1,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,[item.productId,item.current,actor]);
    }
    await client.query(`INSERT INTO public.product_catalog_imports(checksum,source_name,source_schema,status,item_count,bom_line_count,active_bom_line_count,pending_bom_line_count,imported_by,result) VALUES($1,$2,'tiny_stock_v1','completed',$3,0,0,0,$4,$5::jsonb)`,[checksum,String(fileName||'estoque-tiny.xlsx').slice(0,300),result.updated,actor,JSON.stringify(result)]);
    return result;
  });
}
