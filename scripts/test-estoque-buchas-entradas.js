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

console.log('Testing Estoque Buchas por Usinagem, Retrabalho, Vulcanização e Estoque Pronto...');

// 1. Inicialização Zerada do Catálogo
DB.ensureBuchasAtualizadas();
DB.ensureBuchasEntradasSeed();

const saldosIniciais = DB.getBuchasSaldosConsolidados();
assert.equal(saldosIniciais.length, 15, 'Deve listar 15 modelos de buchas');

const bh001Inicial = saldosIniciais.find(s => s.sku === 'HR BH 001');
assert.ok(bh001Inicial, 'HR BH 001 deve estar presente no quadro de saldos');
assert.equal(bh001Inicial.qtdUsinagem, 0, 'Sem entradas manuais, Usinagem deve iniciar em 0 un');
assert.equal(bh001Inicial.qtdRetrabalho, 0, 'Sem entradas manuais, Retrabalho deve iniciar em 0 un');
assert.equal(bh001Inicial.qtdVulcanizacao, 0, 'Sem entradas manuais, Vulcanização deve iniciar em 0 un');
assert.equal(bh001Inicial.qtdAcabada, 0, 'Sem entradas manuais, Estoque Pronto deve iniciar em 0 un');
assert.equal(bh001Inicial.saldoTotal, 0, 'Saldo Total deve iniciar em 0 un');

// 2. Adicionar Entrada Real de 150 peças na etapa Usinagem
const novaEntrada = DB.addBuchaEntrada({
  sku: 'HR BH 001',
  quantidade: 150,
  etapaInicial: 'Usinagem',
  origemObs: 'Lote bruto usinado'
});
assert.ok(novaEntrada.codigoEntrada.startsWith('ENT-BCH-'), 'Código da entrada deve ter formato ENT-BCH-xxxxxx');

const saldosPosEntrada = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEntrada.qtdUsinagem, 150, 'Usinagem deve registrar exatamente 150 un');
assert.equal(saldosPosEntrada.saldoTotal, 150, 'Saldo Total deve ser exatamente 150 un');

// 3. Mover 50 peças de Usinagem para Retrabalho
const movidaRetrabalho = DB.moverBuchaEntrada(novaEntrada.id, 50, 'Retrabalho', 'split');
assert.equal(movidaRetrabalho.etapaAtual, 'Retrabalho', 'Etapa deve mudar para Retrabalho');

const saldosPosRetrabalho = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosRetrabalho.qtdUsinagem, 100, 'Usinagem restante deve ser 100 un');
assert.equal(saldosPosRetrabalho.qtdRetrabalho, 50, 'Retrabalho deve ser 50 un');
assert.equal(saldosPosRetrabalho.saldoTotal, 150, 'Saldo Total deve permanecer 150 un');

// 4. Mover as 50 peças de Retrabalho para Vulcanização
DB.moverBuchaEntrada(novaEntrada.id, 50, 'Vulcanizacao');
const saldosPosVulcanizacao = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosVulcanizacao.qtdUsinagem, 100, 'Usinagem permanece 100 un');
assert.equal(saldosPosVulcanizacao.qtdRetrabalho, 0, 'Retrabalho passa a 0 un');
assert.equal(saldosPosVulcanizacao.qtdVulcanizacao, 50, 'Vulcanização passa a 50 un');
assert.equal(saldosPosVulcanizacao.saldoTotal, 150, 'Saldo Total permanece 150 un');

// 5. Mover as 50 peças de Vulcanização para Estoque Pronto
DB.moverBuchaEntrada(novaEntrada.id, 50, 'Estoque Final');
const saldosPosEstoque = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosEstoque.qtdAcabada, 50, 'Estoque Pronto passa a 50 un');
assert.equal(saldosPosEstoque.saldoTotal, 150, 'Saldo Total permanece 150 un (100 usinagem + 50 prontas)');

// 6. Registrar Saída (Baixa) de 20 peças
const saida = DB.addBuchaSaida({
  sku: 'HR BH 001',
  quantidade: 20,
  destinoObs: 'Baixa para montagem hélice OPH-000001'
});
assert.ok(saida.codigoSaida.startsWith('SAI-BCH-'), 'Código de saída deve ser SAI-BCH-xxxxxx');

const saldosPosSaida = DB.getBuchasSaldosConsolidados().find(s => s.sku === 'HR BH 001');
assert.equal(saldosPosSaida.qtdAcabada, 30, 'Estoque Pronto reduz de 50 para 30 un');
assert.equal(saldosPosSaida.saldoTotal, 130, 'Saldo Total reduz para 100 + 30 = 130 un');

console.log('[OK] Todos os testes do Estoque Buchas por Usinagem e 3 Abas passaram com 100% de precisão!');
