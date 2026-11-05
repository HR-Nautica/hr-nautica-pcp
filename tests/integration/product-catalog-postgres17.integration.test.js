import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import path from "node:path";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase } from "../../server/database.js";
import { createProduct, updateProduct } from "../../server/product-catalog.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATIONS_TEST_DATABASE_URL obrigatoria.");
const { Client } = pg;
const directory = path.resolve("database", "migrations");
let admin;
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
async function reset() {
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const client = await connect();
  await migrate({ client, directory, operator: "product-catalog.test" });
  await client.end();
}

before(async () => { admin = await connect(); });
beforeEach(reset);
after(async () => { await closeDatabase(); await admin.end(); });

test("editar campos do produto sem trocar SKU nao exige historico, e trocar SKU registra historico", async () => {
  const initial = await createProduct({
    sku: "SKU-INICIAL", family: "componentes", description: "Componente",
    unit: "UN", itemType: "Componente", tinyImportEnabled: false
  }, "operador");

  const edited = await updateProduct(initial.id, {
    sku: initial.primary_sku, family: initial.family, description: initial.description,
    unit: initial.unit, itemType: initial.item_type, basicCharacteristics: {},
    tinyImportEnabled: true, status: initial.status, version: initial.version
  }, "operador");
  assert.equal(edited.tiny_import_enabled, true);
  assert.equal(edited.version, 2);
  assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.master_item_sku_history WHERE item_id=$1", [initial.id])).rows[0].total, 0);

  const renamed = await updateProduct(initial.id, {
    sku: "SKU-RENOMEADO", family: edited.family, description: edited.description,
    unit: edited.unit, itemType: edited.item_type, basicCharacteristics: {},
    tinyImportEnabled: true, status: edited.status, version: edited.version
  }, "operador");
  assert.equal(renamed.primary_sku, "SKU-RENOMEADO");
  assert.equal(renamed.version, 3);
  const history = (await admin.query("SELECT old_primary_sku,new_primary_sku,old_version,new_version,actor FROM public.master_item_sku_history WHERE item_id=$1", [initial.id])).rows[0];
  assert.deepEqual(history, { old_primary_sku: "SKU-INICIAL", new_primary_sku: "SKU-RENOMEADO", old_version: 2, new_version: 3, actor: "operador" });
});
import XLSX from 'xlsx';
import { syncTinyStock, parseTinyStock } from '../../server/tiny-stock-sync.js';
function stockWorkbook(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,null,null,null,null,'Estoque físico'],...rows.map(([sku,quantity])=>['Produto',sku,null,null,null,null,null,null,quantity])]),'Sheet1');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
test('Tiny substitui apenas saldo autorizado ativo e registra snapshot atomicamente',async()=>{
 const products=[];
 for(const [sku,tiny,status] of [['ATIVO',true,'active'],['PROTEGIDO',false,'active'],['INATIVO',true,'inactive']]) products.push(await createProduct({sku,description:sku,family:'componentes',itemType:'Componente',unit:'UN',tinyImportEnabled:tiny,status},'tiny.test'));
 await admin.query('UPDATE public.product_stock_balances SET physical_quantity=10');
 const buffer=stockWorkbook([['ATIVO',-3],['PROTEGIDO',999],['INATIVO',999],['AUSENTE',1]]);
 const options={actor:'tiny.test',fileName:'stock.xlsx',requestId:'a'.repeat(32)};
 const result=await syncTinyStock(buffer,options);
 assert.equal(result.updated,1);assert.equal(result.disabled,1);assert.equal(result.inactive,1);assert.deepEqual(result.unknown,['AUSENTE']);
 const balances=(await admin.query('SELECT product_id,physical_quantity::float AS quantity,stock_authority FROM public.product_stock_balances')).rows;
 assert.equal(balances.find(x=>x.product_id===products[0].id).quantity,-3);
 assert.equal(balances.find(x=>x.product_id===products[1].id).quantity,10);
 assert.equal(balances.find(x=>x.product_id===products[2].id).quantity,10);
 assert.equal((await syncTinyStock(buffer,options)).idempotent,true);
 await syncTinyStock(stockWorkbook([['ATIVO',0]]),{...options,requestId:'b'.repeat(32)});
 assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[products[0].id])).rows[0].physical_quantity),0);
 await assert.rejects(syncTinyStock(stockWorkbook([['ATIVO',25],['INVALIDO','oops']]),{...options,requestId:'c'.repeat(32)}));
 assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[products[0].id])).rows[0].physical_quantity),0);
 assert.throws(()=>parseTinyStock(stockWorkbook([['ATIVO',1],['ativo',2]])));
});
test('prévia Tiny não grava e confirmação rejeita alterações de saldo posteriores',async()=>{
 const product=await createProduct({sku:'PREVIEW',description:'Prévia',family:'componentes',itemType:'Componente',unit:'UN',tinyImportEnabled:true},'tiny.test');
 const buffer=stockWorkbook([['PREVIEW',15],['NOVO-SKU',1]]);const options={actor:'tiny.test',fileName:'preview.xlsx',requestId:'d'.repeat(32)};
 const preview=await syncTinyStock(buffer,{...options,preview:true});
 assert.equal(preview.preview,true);assert.equal(preview.updated,1);assert.equal(preview.changes[0].description,'Prévia');
 assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.product_catalog_imports')).rows[0].count,0);
 assert.equal((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[product.id])).rows[0].physical_quantity,null);
 await admin.query('UPDATE public.product_stock_balances SET physical_quantity=7,version=version+1 WHERE product_id=$1',[product.id]);
 await assert.rejects(syncTinyStock(buffer,{...options,expectedPlan:preview.planChecksum}),error=>error.code==='TINY_PREVIEW_STALE');
 assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[product.id])).rows[0].physical_quantity),7);
 const refreshed=await syncTinyStock(buffer,{...options,preview:true});
 const saved=await syncTinyStock(buffer,{...options,expectedPlan:refreshed.planChecksum});assert.equal(saved.updated,1);
 assert.equal((await syncTinyStock(buffer,{...options,expectedPlan:refreshed.planChecksum})).idempotent,true);
});
import {getLastTinyStockUpdate} from '../../server/tiny-stock-sync.js';
test('histórico Tiny usa usuário e data persistidos e ignora prévias e importações sem atualização',async()=>{
 assert.equal(await getLastTinyStockUpdate(),null);
 await createProduct({sku:'HISTORY',description:'Histórico',family:'componentes',itemType:'Componente',unit:'UN',tinyImportEnabled:true},'lucas');
 const buffer=stockWorkbook([['HISTORY',2]]);const options={actor:'lucas',fileName:'historico.xlsx',requestId:'e'.repeat(32)};
 await syncTinyStock(buffer,{...options,preview:true});assert.equal(await getLastTinyStockUpdate(),null);
 const result=await syncTinyStock(buffer,options);const history=await getLastTinyStockUpdate();
 assert.equal(history.username,'lucas');assert.equal(history.fileName,'historico.xlsx');assert.equal(history.count,1);assert.equal(new Date(history.updatedAt).toISOString(),new Date(result.lastUpdate.updatedAt).toISOString());
 await syncTinyStock(stockWorkbook([['NAO-CADASTRADO',1]]),{...options,actor:'outro',requestId:'f'.repeat(32)});
 assert.equal((await getLastTinyStockUpdate()).username,'lucas');
});
import {listProducts,listStock} from '../../server/product-catalog.js';
function planningWorkbook({physical=10,outgoing=3,incoming=5,virtual=12,period=20,average=2}={}){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,'Un',null,'Entradas previstas','Saídas previstas','Estoque físico','Estoque virtual',null,null,'Saídas do período','Média mensal'],['Produto','METRICS',null,null,'UN',null,incoming,outgoing,physical,virtual,null,null,period,average]]),'Sheet1');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
test('planejamento usa só o último snapshot confirmado por produto e não soma importações',async()=>{
 await createProduct({sku:'METRICS',description:'Métricas',family:'componentes',itemType:'Componente',unit:'UN',tinyImportEnabled:true},'tiny.test');
 const options={actor:'tiny.test',fileName:'metrics.xlsx',requestId:'1'.repeat(32)};
 const first=planningWorkbook();await syncTinyStock(first,options);
 let item=(await listProducts({query:'METRICS'})).items[0];
 assert.equal((await listStock({query:'METRICS'}))[0].expected_outgoing_quantity,3);assert.equal(item.incoming_quantity,null);assert.equal(item.expected_outgoing_quantity,3);assert.equal(item.virtual_quantity,7);assert.equal(item.period_outgoing_quantity,20);assert.equal(item.monthly_average,2);
 await syncTinyStock(planningWorkbook({physical:4,outgoing:8,average:0}),{...options,requestId:'2'.repeat(32)});
 item=(await listProducts({query:'METRICS'})).items[0];assert.equal(Number(item.physical_quantity),4);assert.equal(item.expected_outgoing_quantity,8);assert.equal(item.monthly_average,0);assert.equal(item.virtual_quantity,-4);assert.equal(item.incoming_quantity,null);
 await syncTinyStock(planningWorkbook({outgoing:100}),{...options,requestId:'3'.repeat(32),preview:true});
 assert.equal((await listProducts({query:'METRICS'})).items[0].expected_outgoing_quantity,8);
 await syncTinyStock(stockWorkbook([['METRICS',7]]),{...options,requestId:'4'.repeat(32)});
 item=(await listProducts({query:'METRICS'})).items[0];assert.equal(item.expected_outgoing_quantity,null);assert.equal(Number(item.physical_quantity),7);
 await assert.rejects(syncTinyStock(planningWorkbook({outgoing:'inválido'}),{...options,requestId:'5'.repeat(32)}));
 assert.equal(Number((await listProducts({query:'METRICS'})).items[0].physical_quantity),7);
});
test('permissões Tiny por coluna preservam físico ERP e métricas desmarcadas',async()=>{
 let product=await createProduct({sku:'METRICS',description:'Seleção Tiny',family:'componentes',itemType:'Componente',unit:'UN',tinyImportFields:['expected_outgoing_quantity']},'tiny.test');
 assert.deepEqual(product.source_metadata.tinyImportFields,['expected_outgoing_quantity']);
 await admin.query('UPDATE public.product_stock_balances SET physical_quantity=7 WHERE product_id=$1',[product.id]);
 const options={actor:'tiny.test',fileName:'selecao.xlsx',requestId:'6'.repeat(32)};
 const preview=await syncTinyStock(planningWorkbook({physical:100,outgoing:8}),{...options,preview:true});
 assert.equal(Number(preview.changes[0].current),7);assert.deepEqual(preview.changes[0].fields,['expected_outgoing_quantity']);
 await syncTinyStock(planningWorkbook({physical:100,outgoing:8}),{...options,expectedPlan:preview.planChecksum});
 let item=(await listProducts({query:'METRICS'})).items[0];assert.equal(Number(item.physical_quantity),7);assert.equal(item.stock_authority,'erp');assert.equal(item.expected_outgoing_quantity,8);assert.equal(item.incoming_quantity,null);
 product=await updateProduct(product.id,{sku:product.primary_sku,description:product.description,family:product.family,itemType:product.item_type,unit:product.unit,status:'active',version:product.version,tinyImportFields:['physical_quantity']},'tiny.test');
 await syncTinyStock(planningWorkbook({physical:12,outgoing:33}),{...options,requestId:'7'.repeat(32)});
 item=(await listProducts({query:'METRICS'})).items[0];assert.equal(Number(item.physical_quantity),12);assert.equal(item.expected_outgoing_quantity,8);assert.equal(item.stock_authority,'tiny_import');
 product=await updateProduct(product.id,{sku:product.primary_sku,description:product.description,family:product.family,itemType:product.item_type,unit:product.unit,status:'active',version:product.version,tinyImportFields:[]},'tiny.test');
 const skipped=await syncTinyStock(planningWorkbook({physical:99}),{...options,requestId:'8'.repeat(32)});assert.equal(skipped.disabled,1);assert.equal(skipped.updated,0);
 item=(await listProducts({query:'METRICS'})).items[0];assert.equal(Number(item.physical_quantity),12);assert.equal(item.expected_outgoing_quantity,8);assert.deepEqual(item.source_metadata.tinyImportFields,[]);
 await assert.rejects(createProduct({sku:'INVALID',description:'Inválido',family:'componentes',itemType:'Componente',tinyImportFields:['stock_one_quantity']},'tiny.test'));
});
