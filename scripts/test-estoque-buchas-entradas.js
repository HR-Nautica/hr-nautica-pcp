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

// 1. Inicialização Zerada do Catálogo
DB.ensureBuchasAtualizadas();
DB.ensureBuchasEntradasSeed();

const saldosIniciais = DB.getBuchasSaldosConsolidados();
assert.equal(saldosIniciais.length, 15, 'Deve listar 15 modelos de buchas');

const bh001Inicial = saldosIniciais.find(s => s.sku === 'HR BH 001');
assert.ok(bh001Inicial, 'HR BH 001 deve estar presente no quadro de saldos');
assert.equal(bh001Inicial.qtdRetrabalho, 0, 'Sem entradas manuais, Retrabalho deve iniciar em 0 un');
assert.equal(bh001Inicial.qtdVulcanizacao, 0, 'Sem entradas manuais, Vulcanização deve iniciar em 0 un');
assert.equal(bh001Inicial.qtdAcabada, 0, 'Sem entradas manuais, Estoque Pronto deve iniciar em 0 un');
assert.equal(bh001Inicial.saldoTotal, 0, 'Saldo Total deve iniciar em 0 un');

// 2. Adicionar Entrada Real de 100 peças em Retrabalho
const novaEntrada = DB.addBuchaEntrada({
  sku: 'HR BH 001',
  quantidade: 100,
  etapaInicial: 'Retrabalho',
  origemObs: 'Ajuste de dimensão interna'
});
assert.ok(novaEntrada.codigoEntrada.startsWith('ENT-BCH-'), 'Código da entrada deve ter formato ENT-BCH-xxxxxx');

const saldosPosEntrada = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEntrada.qtdRetrabalho, 100, 'Retrabalho deve registrar exatamente 100 un');
assert.equal(saldosPosEntrada.saldoTotal, 100, 'Saldo Total deve ser exatamente 100 un');

// 3. Mover 80 peças para Vulcanização
const movida = DB.moverBuchaEntrada(novaEntrada.id, 80, 'Vulcanizacao', 'split');
assert.equal(movida.etapaAtual, 'Vulcanizacao', 'Etapa deve mudar para Vulcanizacao');

const saldosPosMov = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosMov.qtdRetrabalho, 20, 'Retrabalho restante deve ser 20 un');
assert.equal(saldosPosMov.qtdVulcanizacao, 80, 'Vulcanização deve ser 80 un');
assert.equal(saldosPosMov.saldoTotal, 100, 'Saldo Total deve permanecer 100 un');

// 4. Mover as 80 peças para Estoque Pronto (Final)
DB.moverBuchaEntrada(novaEntrada.id, 80, 'Estoque Final');
const saldosPosEstoque = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEstoque.qtdRetrabalho, 20, 'Retrabalho permanece 20 un');
assert.equal(saldosPosEstoque.qtdVulcanizacao, 0, 'Vulcanização passa a 0 un');
assert.equal(saldosPosEstoque.qtdAcabada, 80, 'Estoque Pronto passa a 80 un');
assert.equal(saldosPosEstoque.saldoTotal, 100, 'Saldo Total permanece 100 un');

// 5. Registrar Saída (Baixa) de 15 peças
const saida = DB.addBuchaSaida({
  sku: 'HR BH 001',
  quantidade: 15,
  destinoObs: 'Baixa para montagem hélice OPH-000001'
});
assert.ok(saida.codigoSaida.startsWith('SAI-BCH-'), 'Código de saída deve ser SAI-BCH-xxxxxx');

const saldosPosSaida = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosSaida.qtdAcabada, 65, 'Estoque Pronto reduz de 80 para 65 un');
assert.equal(saldosPosSaida.saldoTotal, 85, 'Saldo Total reduz para 20 + 65 = 85 un');

// 6. Bloqueio de Saída com Saldo Insuficiente
assert.throws(
  () => DB.addBuchaSaida({ sku: 'HR BH 001', quantidade: 500 }),
  /Saldo insuficiente no Estoque Final/,
  'Deve rejeitar saída maior do que o saldo disponível'
);

console.log('[OK] Todos os testes do Estoque Buchas passaram com 100% de precisão matemática!');
