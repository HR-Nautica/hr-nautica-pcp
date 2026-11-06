import assert from 'node:assert/strict';import test from 'node:test';import {calculateStockPlanning} from '../../server/stock-planning.js';
test('estoque virtual usa físico menos vendido mais produção do ERP',()=>{const item=calculateStockPlanning({physical_quantity:'10.00000000',expected_outgoing_quantity:4},5);assert.equal(item.stock_one_quantity,6);assert.equal(item.incoming_quantity,5);assert.equal(item.virtual_quantity,11);});
test('ausência não vira zero e saldos negativos são preservados',()=>{assert.equal(calculateStockPlanning({physical_quantity:2,expected_outgoing_quantity:5},0).virtual_quantity,-3);assert.equal(calculateStockPlanning({physical_quantity:null,expected_outgoing_quantity:4},0).virtual_quantity,null);assert.equal(calculateStockPlanning({physical_quantity:10,expected_outgoing_quantity:4}).virtual_quantity,null);});
import XLSX from 'xlsx';import {parseTinyStock} from '../../server/tiny-stock-sync.js';import {tinyImportFields} from '../../server/tiny-import-policy.js';
test('Tiny ignora entradas e virtual, inclusive em permissões legadas',()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,null,null,'Entradas previstas','Saídas previstas','Estoque físico','Estoque virtual'],['Produto','SKU',null,null,null,null,999,4,10,999]]),'Sheet1');
 const row=parseTinyStock(XLSX.write(book,{type:'buffer',bookType:'xlsx'}))[0];assert.equal(row.metrics.incoming_quantity,undefined);assert.equal(row.metrics.virtual_quantity,undefined);assert.equal(row.metrics.expected_outgoing_quantity,4);
 assert.deepEqual(tinyImportFields({tiny_import_enabled:true,source_metadata:{tinyImportFields:['incoming_quantity','virtual_quantity','expected_outgoing_quantity']}}),['expected_outgoing_quantity']);
});
test('máximo histórico usa Estoque mínimo dividido por 3, nunca a posição J ou Saídas do período',()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Produto','Código (SKU)',null,null,null,null,null,null,'Estoque físico','Estoque virtual','Estoque mínimo','Saídas do período'],['Produto','SKU',null,null,null,null,null,null,10,999,90,888]]),'Sheet1');
 const row=parseTinyStock(XLSX.write(book,{type:'buffer',bookType:'xlsx'}))[0];assert.equal(row.metrics.period_outgoing_quantity,30);assert.equal(row.metrics.period_minimum_source,90);assert.equal(row.metrics.period_outgoing_rule,'tiny_minimum_div3');
});
import {attachTinyStockMetrics} from '../../server/tiny-stock-metrics.js';
test('valor antigo de saídas do período não é exibido como máximo histórico',async()=>{
 const items=[{id:'legacy',physical_quantity:10}];const client={query:async()=>({rows:[{product_id:'legacy',physical_quantity:'10',stock_authority:'tiny_import',metrics:{period_outgoing_quantity:888,expected_outgoing_quantity:4,monthly_average:2}}]})};
 await attachTinyStockMetrics(client,items);assert.equal(items[0].period_outgoing_quantity,null);assert.equal(items[0].monthly_average,2);assert.equal(items[0].virtual_quantity,6);
});
