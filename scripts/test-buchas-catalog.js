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

console.log('Testing Catálogo de Buchas...');

// 1. Inicialização de buchas
const updated = DB.ensureBuchasAtualizadas();
assert.equal(updated, true, 'Catálogo de buchas deve ser atualizado na primeira carga');

const buchas = DB.getBuchas();
assert.equal(buchas.length, 15, 'Deve conter 15 buchas importadas de Buchas.xlsx');

// 2. Verificação de SKU HR BH 001
const bh001 = buchas.find(b => b.sku === 'HR BH 001');
assert.ok(bh001, 'Bucha HR BH 001 deve existir');
assert.equal(bh001.dimensoes, '3/4 x 78', 'Dimensões de HR BH 001 devem bater com a planilha');
assert.equal(bh001.comprimento, 78, 'Comprimento deve ser 78 mm');
assert.equal(bh001.peso, 0.35, 'Peso deve ser 0.35 kg');

// 3. Adicionar Nova Bucha
const nova = DB.addBucha({
  sku: 'HR BH 999',
  descricao: 'BUCHA TESTE UNIDADE',
  dimensoes: '1" x 80',
  comprimento: 80,
  peso: 0.5,
  aplicacao: 'MOTOR TESTE'
});
assert.ok(nova && nova.id, 'Nova bucha deve ter ID gerado');
assert.equal(DB.getBuchas().length, 16, 'Contagem deve subir para 16');

// 4. Bloqueio de SKU duplicado
assert.throws(
  () => DB.addBucha({ sku: 'HR BH 999', descricao: 'OUTRA BUCHA' }),
  /já pertence à bucha/,
  'Deve rejeitar SKU duplicado'
);

// 5. Editar Bucha
const editada = DB.updateBucha(nova.id, {
  sku: 'HR BH 999',
  descricao: 'BUCHA TESTE EDITADA',
  dimensoes: '1" x 85',
  comprimento: 85,
  peso: 0.55,
  aplicacao: 'MOTOR TESTE V2'
});
assert.equal(editada.descricao, 'BUCHA TESTE EDITADA', 'Descrição deve ser atualizada');
assert.equal(editada.comprimento, 85, 'Comprimento deve ser atualizado');

// 6. Excluir Bucha
const deletada = DB.deleteBucha(nova.id);
assert.ok(deletada, 'Bucha deve ser retornada na exclusão');
assert.equal(DB.getBuchas().length, 15, 'Contagem deve retornar a 15');

console.log('[OK] Todos os testes do Catálogo de Buchas passaram com sucesso!');
