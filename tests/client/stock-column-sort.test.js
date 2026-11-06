import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(readFileSync('public/js/catalog-query.js','utf8'),context);
const query=context.CatalogQuery;
test('colunas numéricas ordenam números, negativos e deixam ausentes no final',()=>{
 for(const field of ['incoming_quantity','expected_outgoing_quantity','physical_quantity','stock_one_quantity','virtual_quantity','period_outgoing_quantity','monthly_average']){
 const items=[null,10,2,-3].map((value,id)=>({id:String(id),primary_sku:String(id),[field]:value}));
 assert.deepEqual(Array.from(query.select(items,{sort:field}),i=>i[field]),[-3,2,10,null]);
 assert.deepEqual(Array.from(query.select(items,{sort:field+'_desc'}),i=>i[field]),[10,2,-3,null]);
 }
});
test('ordenação textual preserva filtros e não modifica a lista original',()=>{
 const items=[{id:'1',primary_sku:'B',description:'Zebra',family:'x'},{id:'2',primary_sku:'A',description:'Abelha',family:'x'},{id:'3',primary_sku:'C',description:'Cobra',family:'y'}];
 assert.deepEqual(Array.from(query.select(items,{sort:'description',family:'x'}),i=>i.primary_sku),['A','B']);
 assert.deepEqual(Array.from(query.select(items,{sort:'description_desc',family:'x'}),i=>i.primary_sku),['B','A']);
 assert.equal(items[0].primary_sku,'B');
});
