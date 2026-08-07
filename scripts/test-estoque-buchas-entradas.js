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

console.log('Testing Estoque Buchas por Entradas, Transições e Saídas...');

// 1. Inicialização
DB.ensureBuchasAtualizadas();
const seeded = DB.ensureBuchasEntradasSeed();
assert.equal(seeded, true, 'Seed de entradas deve executar na primeira carga');

// 2. Saldos Consolidados do Catálogo
const saldos = DB.getBuchasSaldosConsolidados();
assert.equal(saldos.length, 15, 'Deve ter saldos consolidados para as 15 buchas do catálogo');

const bh001 = saldos.find(s => s.sku === 'HR BH 001');
assert.ok(bh001, 'HR BH 001 deve estar presente no quadro de saldos');
assert.equal(bh001.qtdRetrabalho, 120, 'Retrabalho inicial de HR BH 001 deve ser 120 un');
assert.equal(bh001.qtdVulcanizacao, 80, 'Vulcanização inicial de HR BH 001 deve ser 80 un');
assert.equal(bh001.qtdAcabada, 220, 'Estoque Final acabado de HR BH 001 deve ser 250 - 30 = 220 un');
assert.equal(bh001.saldoTotal, 420, 'Saldo Total de HR BH 001 deve ser 120 + 80 + 220 = 420 un');

// 3. Adicionar Nova Entrada de Lote em Retrabalho
const novaEntrada = DB.addBuchaEntrada({
  sku: 'HR BH 001',
  quantidade: 50,
  etapaInicial: 'Retrabalho',
  origemObs: 'Teste lote manual'
});
assert.ok(novaEntrada.codigoEntrada.startsWith('ENT-BCH-'), 'Código da entrada deve ter formato ENT-BCH-xxxxxx');

const saldosPosEntrada = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEntrada.qtdRetrabalho, 170, 'Retrabalho deve subir de 120 para 170 un');
assert.equal(saldosPosEntrada.saldoTotal, 470, 'Saldo Total deve subir de 420 para 470 un');

// 4. Mover Lote de Retrabalho para Vulcanização
const movida = DB.moverBuchaEntrada(novaEntrada.id, 50, 'Vulcanizacao');
assert.equal(movida.etapaAtual, 'Vulcanizacao', 'Etapa deve mudar para Vulcanizacao');

const saldosPosMov = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosMov.qtdRetrabalho, 120, 'Retrabalho volta para 120 un');
assert.equal(saldosPosMov.qtdVulcanizacao, 130, 'Vulcanização sobe de 80 para 130 un');

// 5. Mover para Estoque Final
DB.moverBuchaEntrada(novaEntrada.id, 50, 'Estoque Final');
const saldosPosEstoque = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEstoque.qtdAcabada, 270, 'Estoque Acabado sobe de 220 para 270 un');

// 6. Registrar Saída (Baixa de Estoque)
const saida = DB.addBuchaSaida({
  sku: 'HR BH 001',
  quantidade: 20,
  destinoObs: 'Baixa para montagem teste'
});
assert.ok(saida.codigoSaida.startsWith('SAI-BCH-'), 'Código de saída deve ser SAI-BCH-xxxxxx');

const saldosPosSaida = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosSaida.qtdAcabada, 250, 'Estoque Acabado reduz de 270 para 250 un');

// 7. Bloqueio de Saída com Saldo Insuficiente
assert.throws(
  () => DB.addBuchaSaida({ sku: 'HR BH 001', quantidade: 9999 }),
  /Saldo insuficiente no Estoque Final/,
  'Deve rejeitar saída maior do que o saldo acabado disponível'
);

console.log('[OK] Todos os testes de Estoque Buchas por Entradas e Saídas passaram com sucesso!');
