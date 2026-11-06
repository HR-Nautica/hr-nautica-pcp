import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync('public/js/helice-table-view.js','utf8'),c);const view=c.HeliceTableView;
test('alertas distinguem físico, vendido, cobertura e ausência sem alterar dados',()=>{
const base={physical_quantity:10,stock_one_quantity:5,monthly_average:5,coverage_months:1};
assert.equal(view.stockStatus({...base,physical_quantity:0},2).key,'empty');
assert.equal(view.stockStatus({...base,physical_quantity:-1},2).label,'Estoque negativo');
assert.equal(view.stockStatus({...base,stock_one_quantity:-1},2).key,'committed');
assert.equal(view.stockStatus(base,2).key,'low');assert.equal(view.stockStatus(base,1).key,'covered');
assert.equal(view.stockStatus({...base,monthly_average:0,coverage_months:6},2).key,'no-demand');
assert.equal(view.stockStatus({...base,physical_quantity:null},2).key,'unknown');
assert.equal(view.stockStatus({...base,coverage_months:null},2).key,'unknown');assert.equal(base.coverage_months,1);
});
test('colunas preservam identidade e ordem e ignoram chaves desconhecidas',()=>{
const allowed=['general_priority','description','primary_sku','physical_quantity'];
assert.deepEqual(Array.from(view.visibleColumns(allowed,'physical_quantity,unknown')),['general_priority','description','physical_quantity']);
assert.deepEqual(Array.from(view.visibleColumns(allowed,null)),['general_priority','description','physical_quantity']);
});
