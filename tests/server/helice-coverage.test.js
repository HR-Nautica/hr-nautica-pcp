import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHeliceCoverage, rankHeliceCoverage } from '../../server/helice-coverage.js';
import { validateCoverageParameters } from '../../server/helice-analysis.js';
import { productInTinyScope } from '../../server/tiny-stock-scope.js';

test('cobertura reproduz a planilha e separa os dois horizontes', () => {
  const item = { physical_quantity: 25, expected_outgoing_quantity: 5, incoming_quantity: 10, monthly_average: 12 };
  const result = calculateHeliceCoverage(item);
  assert.equal(result.stock_one_quantity, 20);
  assert.equal(result.virtual_quantity, 30);
  assert.equal(result.prio2, 1.6);
  assert.equal(result.coverage_months, 2.5);
  assert.equal(result.suggested_op, 10);
  assert.equal(result.target_stock_quantity, 4);
  const future = calculateHeliceCoverage(item, { targetMonths: 4, productionMonths: 3, averageFactor: 1 });
  assert.equal(future.target_stock_quantity, 28);
  assert.equal(future.suggested_op, 10);
  assert.equal(item.virtual_quantity, undefined);
});

test('sem produção considera zero, sem fonte não fabrica saldos; preserva exceções Excel', () => {
  assert.equal(calculateHeliceCoverage({physical_quantity: 0, expected_outgoing_quantity: 5, monthly_average: 2}).prio2, -1);
  const zero = calculateHeliceCoverage({physical_quantity: 3, expected_outgoing_quantity: 0, monthly_average: 0});
  assert.equal(zero.coverage_months, 6); assert.equal(zero.prio2, 5);
  const missing = calculateHeliceCoverage({physical_quantity: null, expected_outgoing_quantity: 3, monthly_average: 10});
  for (const key of ['stock_one_quantity','virtual_quantity','prio2','suggested_op','target_stock_quantity']) assert.equal(missing[key], null);
  assert.equal(calculateHeliceCoverage({physical_quantity: 10, expected_outgoing_quantity: 0, monthly_average: 2, description: 'HÉLICE max.'}).prio2, 0);
});

test('prioridade automática é crescente, estável nos empates e desconhecidos ao final', () => {
  const items = [{id:'b',primary_sku:'B',prio2:2},{id:'x',primary_sku:'X',prio2:null},{id:'a',primary_sku:'A',prio2:2},{id:'c',primary_sku:'C',prio2:-1}];
  assert.deepEqual(rankHeliceCoverage(items).map(i=>[i.primary_sku,i.general_priority]), [['C',1],['A',2],['B',3],['X',null]]);
  assert.equal(items[0].primary_sku, 'B');
});

test('parâmetros inválidos são rejeitados e escopo usa tipo cadastrado, não SKU', () => {
  for (const value of [0,-1,NaN,Infinity,'2',null]) assert.throws(()=>validateCoverageParameters({targetMonths:value,averageFactor:1,productionMonths:3}));
  assert.equal(productInTinyScope({item_type:'Componente',family:'componentes',primary_sku:'HR HY 001'},'helices'),false);
  assert.equal(productInTinyScope({item_type:'Hélice usinada'},'helices'),true);
  assert.equal(productInTinyScope({item_type:'Hélice bruta',family:'helices'},'helices'),false);
});
