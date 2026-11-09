import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import path from "node:path";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase } from "../../server/database.js";
import { createProduct, updateProduct } from "../../server/product-catalog.js";
import { exportStockInventory, importStockInventory } from '../../server/stock-inventory.js';
import { executeHeliceOrder } from '../../server/helice-order-execution.js';
import { addRoutingStep, saveStep } from '../../server/product-catalog.js';

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

import {getHeliceAnalysis,getHeliceStructure,saveCoverageParameters,previewHeliceOrder,openHeliceOrder,listHeliceOrders} from '../../server/helice-analysis.js';
import {addBomLine} from '../../server/product-catalog.js';

async function orderFixture(){
  const product=await createProduct({sku:'HE',description:'Hélice teste',itemType:'Hélice usinada',family:'helices',unit:'UN',tinyImportFields:['physical_quantity','expected_outgoing_quantity','monthly_average']},'test');
  const raw=await createProduct({sku:'BR',description:'Bruto teste',itemType:'Hélice bruta',family:'brutos',unit:'UN'},'test');
  const bushing=await createProduct({sku:'BU',description:'Bucha teste',itemType:'Bucha',family:'buchas',unit:'UN'},'test');
  await addBomLine(product.id,{childProductId:raw.id,quantity:2,unit:'UN'},'test');
  await addBomLine(product.id,{childProductId:bushing.id,quantity:1,unit:'UN'},'test');
  await admin.query('UPDATE public.product_stock_balances SET physical_quantity=10 WHERE product_id=$1',[raw.id]);
  await admin.query('UPDATE public.product_stock_balances SET physical_quantity=25 WHERE product_id=$1',[bushing.id]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,null,null,null,'Saídas previstas','Estoque físico','Média mensal'],['Hélice','HE',null,null,null,null,null,16,6,5]]),'Tiny');
  await syncTinyStock(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{actor:'test',fileName:'tiny.xlsx',requestId:'1'.repeat(32)});
  return {product,raw,bushing};
}
test('apontamento divide o lote, controla previsão e mantém estoque físico', async () => {
  const { product, raw } = await orderFixture();
  for (const [index, name] of ['Usinagem', 'Inspeção'].entries()) {
    const step = await saveStep({ code: 'HU-' + index, name }, 'teste');
    await addRoutingStep(product.id, { productionStepId: step.id, sequence: index + 1 }, 'teste');
  }
  const stock = async id => (await admin.query(
    'SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1', [id]
  )).rows[0].physical_quantity;
  const incoming = async () => (await getHeliceAnalysis()).items.find(item => item.id === product.id).incoming_quantity;
  const preview = await previewHeliceOrder(product.id, 5);
  const { order } = await openHeliceOrder(product.id, {
    quantity: 5, requestId: '2'.repeat(32), expectedPlan: preview.planToken
  }, 'teste');
  const split = { action: 'report', requestId: '3'.repeat(32), version: 1, approved: 2, scrap: 1, waiting: 2, location: 'Bancada A' };
  await assert.rejects(executeHeliceOrder(order.id, { ...split, approved: 1 }, 'teste'), /Distribua/);
  const [first, second] = await Promise.all([
    executeHeliceOrder(order.id, split, 'teste'),
    executeHeliceOrder(order.id, split, 'teste')
  ]);
  const applied = first.child ? first : second;
  const { child } = applied;
  assert.equal((first.child ? second : first).idempotent, true);
  assert.equal(child.number, order.number + '.1');
  assert.equal(child.parent_id, order.id);
  assert.equal(child.status, 'waiting');
  assert.equal(applied.order.current_stage.name, 'Inspeção');
  assert.equal(await incoming(), 2);
  await assert.rejects(executeHeliceOrder(order.id, { ...split, requestId: '4'.repeat(32) }, 'teste'), { code: 'ORDER_STALE' });
  const { order: released } = await executeHeliceOrder(child.id, { action: 'release', requestId: '5'.repeat(32), version: 1 }, 'teste');
  assert.equal(released.current_stage.name, 'Usinagem');
  assert.equal(await incoming(), 4);
  const report = { action: 'report', version: 2, approved: 2, scrap: 0, waiting: 0 };
  const { order: finished } = await executeHeliceOrder(order.id, { ...report, requestId: '6'.repeat(32) }, 'teste');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.finished_quantity, 2);
  assert.equal(await incoming(), 2);
  assert.equal(Number(await stock(product.id)), 6);
  assert.equal(Number(await stock(raw.id)), 0);
  assert.equal((await listHeliceOrders()).length, 2);
  assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.audit_log WHERE action='SPLIT_OP'")).rows[0].total, 1);
});
test('inventário confirma ajustes em lote, preserva Tiny e rejeita saldo concorrente', async () => {
  const { product, raw, bushing } = await orderFixture();
  const original = await exportStockInventory();
  const count = values => {
    const workbook = XLSX.read(original, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    rows.forEach(([sku], index) => {
      if (Object.hasOwn(values, sku)) XLSX.utils.sheet_add_aoa(sheet, [[values[sku]]], { origin: 'F' + (index + 1) });
    });
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const options = { actor: 'operador', fileName: 'contagem.xlsx' };
  const file = count({ BR: 0, HE: 8.25 });
  const preview = await importStockInventory(file, { ...options, preview: true });
  assert.equal(preview.changes.length, 2);
  const apply = { ...options, expectedPlan: preview.planChecksum };
  await importStockInventory(file, apply);
  await importStockInventory(file, apply);
  const stock = async id => (await admin.query('SELECT * FROM public.product_stock_balances WHERE product_id=$1', [id])).rows[0];
  assert.equal(Number((await stock(raw.id)).physical_quantity), 0);
  assert.equal(Number((await stock(product.id)).physical_quantity), 8.25);
  assert.equal((await stock(product.id)).stock_authority, 'tiny_import');
  const stale = count({ BR: 4, BU: 17 });
  const stalePreview = await importStockInventory(stale, { ...options, preview: true });
  assert.equal(stalePreview.issues.length, 1);
  await assert.rejects(importStockInventory(stale, { ...options, expectedPlan: stalePreview.planChecksum }), { status: 409 });
  assert.equal(Number((await stock(bushing.id)).physical_quantity), 25);
  assert.equal((await admin.query("SELECT count(*) FROM public.product_catalog_imports WHERE source_schema='stock_inventory_v1'")).rows[0].count, '1');
});
test('nova OP consome apenas bruto uma vez e atualiza produção prevista sem creditar hélice',async()=>{
  const {product,raw,bushing}=await orderFixture(),preview=await previewHeliceOrder(product.id,3);
  await admin.query("INSERT INTO public.helice_production_orders(source_key,source_file,source_sheet,source_row,description,sku,quantity) VALUES('old','old.xlsx','Old',1,'Antiga','HE',999)");
  assert.equal(preview.canOpen,true);assert.equal(Number(preview.raws[0].required),6);
  assert.equal((await listHeliceOrders()).length,0);
  const input={quantity:3,requestId:'a'.repeat(32),expectedPlan:preview.planToken};
  const opened=await openHeliceOrder(product.id,input,'operador');assert.equal(opened.order.number,'OPH-000001');
  const again=await openHeliceOrder(product.id,input,'operador');assert.equal(again.idempotent,true);assert.equal(again.order.id,opened.order.id);
  const stocks=(await admin.query('SELECT product_id,physical_quantity::float quantity FROM public.product_stock_balances')).rows;
  assert.equal(stocks.find(row=>row.product_id===raw.id).quantity,4);assert.equal(stocks.find(row=>row.product_id===bushing.id).quantity,25);assert.equal(stocks.find(row=>row.product_id===product.id).quantity,6);
  const analysis=(await getHeliceAnalysis()).items[0];assert.equal(analysis.incoming_quantity,3);assert.equal(analysis.virtual_quantity,-7);assert.equal(analysis.open_orders.length,1);
  const structure=await getHeliceStructure(product.id);assert.equal(structure.product.open_orders[0].id,opened.order.id);
  assert.equal(Number(structure.bomTree.find(node=>node.item.id===raw.id).item.physical_quantity),4);
  assert.equal((await admin.query("SELECT count(*)::int total FROM public.audit_log WHERE action='OPEN_OP'")).rows[0].total,1);
  await syncTinyStock(XLSX.write((()=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,null,null,null,'Saídas previstas','Estoque físico','Média mensal'],['Hélice','HE',null,null,null,null,null,16,6,5]]),'Tiny');return b;})(),{type:'buffer',bookType:'xlsx'}),{actor:'test',fileName:'tiny.xlsx',requestId:'2'.repeat(32)});
  assert.equal((await getHeliceAnalysis()).items[0].incoming_quantity,3);
});
test('falta de bruto, produto inativo e prévia obsoleta bloqueiam OP sem baixa parcial',async()=>{
  const {product,raw}=await orderFixture();
  const shortage=await previewHeliceOrder(product.id,6);assert.equal(shortage.canOpen,false);assert.match(shortage.issues.join(' '),/falta/);
  await assert.rejects(openHeliceOrder(product.id,{quantity:6,requestId:'b'.repeat(32),expectedPlan:shortage.planToken},'test'),error=>error.code==='RAW_STOCK_UNAVAILABLE');
  const preview=await previewHeliceOrder(product.id,3);await admin.query('UPDATE public.product_stock_balances SET physical_quantity=9,version=version+1 WHERE product_id=$1',[raw.id]);
  await assert.rejects(openHeliceOrder(product.id,{quantity:3,requestId:'c'.repeat(32),expectedPlan:preview.planToken},'test'),error=>error.code==='OP_PREVIEW_STALE');
  await admin.query("UPDATE public.master_items SET status='inactive',version=version+1 WHERE id=$1",[product.id]);
  await assert.rejects(previewHeliceOrder(product.id,3),error=>error.code==='PRODUCT_INACTIVE');
  assert.equal((await listHeliceOrders()).length,0);assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[raw.id])).rows[0].physical_quantity),9);
});
test('duas aberturas concorrentes não consomem o mesmo saldo',async()=>{
  const {product,raw}=await orderFixture(),preview=await previewHeliceOrder(product.id,3);
  const results=await Promise.allSettled(['d','e'].map(letter=>openHeliceOrder(product.id,{quantity:3,requestId:letter.repeat(32),expectedPlan:preview.planToken},letter)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((await listHeliceOrders()).length,1);
  assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[raw.id])).rows[0].physical_quantity),4);
});
test('falha na auditoria reverte ordem, contador e baixa de bruto juntos',async()=>{
  const {product,raw}=await orderFixture(),preview=await previewHeliceOrder(product.id,3);
  await admin.query("ALTER TABLE public.audit_log ADD CONSTRAINT reject_new_op CHECK(action<>'OPEN_OP')");
  await assert.rejects(openHeliceOrder(product.id,{quantity:3,requestId:'f'.repeat(32),expectedPlan:preview.planToken},'test'));
  assert.equal((await listHeliceOrders()).length,0);assert.equal(Number((await admin.query('SELECT physical_quantity FROM public.product_stock_balances WHERE product_id=$1',[raw.id])).rows[0].physical_quantity),10);
  assert.equal((await admin.query("SELECT count(*)::int total FROM public.app_state WHERE key='hrn_helice_order_counter_v1'")).rows[0].total,0);
});
test('expansão da hélice lê estoques por ID e preserva a hierarquia real sem criar entradas',async()=>{
  const root=await createProduct({sku:'HE',description:'Hélice',itemType:'Hélice usinada',family:'helices',unit:'UN'},'test');
  const raw=await createProduct({sku:'BR',description:'Bruto',itemType:'Hélice bruta',family:'brutos',unit:'UN'},'test');
  const material=await createProduct({sku:'MAT',description:'Material',itemType:'Componente',family:'componentes',unit:'UN'},'test');
  await addBomLine(root.id,{childProductId:raw.id,quantity:1,unit:'UN'},'test');
  await addBomLine(raw.id,{childProductId:material.id,quantity:2,unit:'UN'},'test');
  await admin.query('UPDATE public.product_stock_balances SET physical_quantity=7 WHERE product_id=$1',[raw.id]);
  const result=await getHeliceStructure(root.id);
  assert.equal(result.product.id,root.id);assert.equal(result.product.physical_quantity,null);
  assert.equal(result.bomTree.length,1);const node=result.bomTree[0];assert.equal(node.item.id,raw.id);
  assert.equal(Number(node.item.physical_quantity),7);assert.equal(node.item.stock_one_quantity,null);
  assert.equal(node.children[0].item.id,material.id);assert.equal(Number(node.children[0].quantity),2);
  assert.equal(node.item.incoming_quantity,null);assert.deepEqual(node.item.open_orders,[]);assert.equal(result.ordersAvailable,true);
  assert.equal((await admin.query('SELECT count(*)::int total FROM public.product_catalog_imports')).rows[0].total,0);
  await assert.rejects(getHeliceStructure(raw.id),error=>error.code==='ANALYSIS_PRODUCT_INVALID');
});
test('análise considera só hélices usinadas ativas e parâmetros persistem com conflito e auditoria',async()=>{
  for(const [sku,itemType,family,status] of [['USINADA','Hélice usinada','helices','active'],['BRUTO','Hélice bruta','brutos','active'],['INATIVA','Hélice usinada','helices','inactive'],['COMP','Componente','componentes','active']])
    await createProduct({sku,itemType,family,status,description:sku,unit:'UN'},'analysis.test');
  const initial=await getHeliceAnalysis();
  assert.deepEqual(initial.items.map(i=>i.primary_sku),['USINADA']);
  assert.equal(initial.version,0);assert.equal(initial.items[0].physical_quantity,null);
  const saved=await saveCoverageParameters({parameters:{targetMonths:4,averageFactor:1,productionMonths:3},version:0},'analysis.test');
  assert.equal(saved.version,1);assert.equal((await getHeliceAnalysis()).parameters.targetMonths,4);
  await assert.rejects(saveCoverageParameters({parameters:{targetMonths:2,averageFactor:1,productionMonths:3},version:0},'other'),e=>e.code==='COVERAGE_VERSION_CONFLICT');
  const audit=await admin.query("SELECT actor,payload FROM public.audit_log WHERE state_key='hrn_helice_coverage_v1'");
  assert.equal(audit.rows.length,1);assert.equal(audit.rows[0].actor,'analysis.test');
  assert.equal(JSON.parse(audit.rows[0].payload).parameters.targetMonths,4);
});

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

test('sincronização pela análise não altera outras famílias e prévia obsoleta não grava',async()=>{
  for(const [sku,itemType,family] of [['USINADA','Hélice usinada','helices'],['BRUTO','Hélice bruta','brutos']])
    await createProduct({sku,itemType,family,description:sku,unit:'UN',tinyImportFields:['physical_quantity']},'analysis.test');
  await admin.query('UPDATE public.product_stock_balances SET physical_quantity=10');
  const file=stockWorkbook([['USINADA',20],['BRUTO',999]]),options={actor:'analysis.test',fileName:'tiny.xlsx',requestId:'b'.repeat(32),scope:'helices'};
  const preview=await syncTinyStock(file,{...options,preview:true});
  assert.equal(preview.updated,1);assert.equal(preview.outOfScope,1);
  await assert.rejects(syncTinyStock(file,{...options,scope:'all',expectedPlan:preview.planChecksum}),e=>e.code==='TINY_PREVIEW_STALE');
  const saved=await syncTinyStock(file,{...options,expectedPlan:preview.planChecksum});
  assert.equal(saved.updated,1);
  const stocks=(await admin.query('SELECT i.primary_sku,s.physical_quantity::float quantity FROM public.master_items i JOIN public.product_stock_balances s ON s.product_id=i.id ORDER BY i.primary_sku')).rows;
  assert.deepEqual(stocks,[{primary_sku:'BRUTO',quantity:10},{primary_sku:'USINADA',quantity:20}]);
  assert.equal((await syncTinyStock(file,{...options,expectedPlan:preview.planChecksum})).idempotent,true);
});
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
function planningWorkbook({physical=10,outgoing=3,incoming=5,virtual=12,period=20,average=2}={}){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,'Un',null,'Entradas previstas','Saídas previstas','Estoque físico','Estoque virtual','Estoque mínimo',null,'Saídas do período','Média mensal'],['Produto','METRICS',null,null,'UN',null,incoming,outgoing,physical,virtual,period*3,null,999,average]]),'Sheet1');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
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
