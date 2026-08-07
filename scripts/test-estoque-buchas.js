import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const versions = new Map();

const RemoteStorage = {
  data: store,
  versions: versions,
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  },
  removeItem: (key) => store.delete(key),
};

const context = vm.createContext({
  console,
  Date,
  Math,
  Map,
  Set,
  JSON,
  String,
  Array,
  Object,
  RemoteStorage,
});

const buchasDataSource = fs.readFileSync('public/js/buchas_data.js', 'utf8');
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;

vm.runInContext(buchasDataSource, context, { filename: 'buchas_data.js' });
vm.runInContext(dbSource, context, { filename: 'db.js' });

const DB = context.__DB__;

console.log('Testing Estoque & Rastreio de Buchas...');

// 1. Carga inicial e Seed
DB.ensureBuchasAtualizadas();
const seeded = DB.ensureBuchasOpsSeed();
assert.equal(seeded, true, 'Seed de OPs de bucha deve rodar na primeira execução');

const initialOps = DB.getBuchasOps();
assert.equal(initialOps.length, 5, 'Deve carregar 5 OPs de bucha iniciais');

// 2. Criar Nova OP de Bucha
const novaOp = DB.addBuchaOp({
  sku: 'HR BH 001',
  quantity: 300,
  priority: 'Alta',
  obs: 'Lote emergencial teste'
});
assert.ok(novaOp && novaOp.id, 'Nova OP deve ser criada com ID');
assert.equal(novaOp.currentStage, 'op01', 'Nova OP deve iniciar na etapa Retrabalho (op01)');
assert.equal(novaOp.quantity, 300, 'Quantidade inicial deve ser 300');

// 3. Avançar 200 peças para Vulcanização (op02) com Desmembramento de 100 peças em Sub-OP (.1)
const avançada = DB.advanceBuchaOp(novaOp.id, 200, 'op02', 'split');
assert.equal(avançada.currentStage, 'op02', 'OP original avançou para op02 (Vulcanização)');
assert.equal(avançada.quantity, 200, 'OP original agora possui 200 peças');

const allOps = DB.getBuchasOps();
const subOp = allOps.find(o => o.opNumber === `${novaOp.opNumber}.1`);
assert.ok(subOp, 'Sub-OP desmembrada deve ter sido criada (.1)');
assert.equal(subOp.quantity, 100, 'Sub-OP deve reter as 100 peças na etapa op01');

// 4. Avançar as 200 peças para Estoque Final (op03)
const finalizada = DB.advanceBuchaOp(novaOp.id, 200, 'op03');
assert.equal(finalizada.currentStage, 'op03', 'OP deve avançar para Estoque Final');
assert.equal(finalizada.status, 'finalizada', 'Status da OP deve mudar para finalizada ao chegar em op03');

// 5. Excluir OP
const deleted = DB.deleteBuchaOp(novaOp.id);
assert.ok(deleted, 'Exclusão deve retornar a OP desativada');
assert.equal(DB.getBuchasOps().some(o => o.id === novaOp.id), false, 'OP excluída não deve mais estar na lista');

console.log('[OK] Todos os testes de Estoque & Rastreio de Buchas passaram com sucesso!');
