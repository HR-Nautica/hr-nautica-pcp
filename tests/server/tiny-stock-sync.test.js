import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import {parseTinyStock} from '../../server/tiny-stock-sync.js';
function workbook(rows,headers=['Produto','Código (SKU)',null,null,null,null,null,null,'Estoque físico']){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,...rows]),'Sheet1');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const row=(sku,value)=>['Produto',sku,null,null,null,null,null,null,value];
test('Tiny usa físico da coluna I e preserva negativos e zero',()=>{assert.deepEqual(parseTinyStock(workbook([row('A',-2),row('B',0)])),[{sku:'A',quantity:-2},{sku:'B',quantity:0}]);});
test('Tiny rejeita duplicados, saldo vazio e layout diferente antes de escrever',()=>{assert.throws(()=>parseTinyStock(workbook([row('A',1),row('a',2)])));assert.throws(()=>parseTinyStock(workbook([row('A',null)])));assert.throws(()=>parseTinyStock(workbook([row('A',2)],['Código','Produto'])));});
