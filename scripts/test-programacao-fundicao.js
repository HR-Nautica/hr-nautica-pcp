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
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
});

context.window = context;
context.addEventListener = () => {};

// Mock do DOM para renderização
const elements = new Map();
context.document = {
  getElementById: (id) => {
    if (!elements.has(id)) {
      elements.set(id, { id, value: '', textContent: '', innerHTML: '', classList: { remove() {}, add() {} }, style: {}, dataset: {}, addEventListener: () => {} });
    }
    return elements.get(id);
  },
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => []
};

const buchasSource = fs.readFileSync('public/js/buchas_data.js', 'utf8');
const fundicaoDataSource = fs.readFileSync('public/js/fundicao_catalog_data.js', 'utf8');
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
const viniSource = fs.readFileSync('public/js/vini.js', 'utf8');
const analiseSource = fs.readFileSync('public/js/analise.js', 'utf8');

vm.runInContext(buchasSource, context, { filename: 'buchas_data.js' });
vm.runInContext(fundicaoDataSource, context, { filename: 'fundicao_catalog_data.js' });
vm.runInContext(dbSource, context, { filename: 'db.js' });
vm.runInContext(viniSource, context, { filename: 'vini.js' });
vm.runInContext(analiseSource, context, { filename: 'analise.js' });

const DB = context.__DB__;

console.log('Testing Programação de Fundição (Ranking por Criticidade)...');

DB.ensureFundicaoCatalogAtualizada();

const programacaoScript = fs.readFileSync('public/js/programacao-fundicao.js', 'utf8');
vm.runInContext(programacaoScript, context, { filename: 'programacao-fundicao.js' });

// 1. Atribuição de peso para COQUILHA 02
DB.saveCoquilhaPeso('COQUILHA 02', 1.450);

// 2. Verificar obtenção do ranking
const ranking = context.getProgramacaoData();
assert.ok(Array.isArray(ranking), 'Programação deve retornar uma lista de coquilhas');
assert.ok(ranking.length > 0, 'Deve conter coquilhas agrupadas');

const coq2 = ranking.find(r => r.coquilha === 'COQUILHA 02');
assert.ok(coq2, 'COQUILHA 02 deve estar no ranking de programação');
assert.equal(coq2.pesoUnitario, 1.450, 'Peso da COQUILHA 02 deve ser 1.450 kg');

// 3. Simular adição de modelo e sugestão de OP na Análise de Produção para o modelo HR HY 012 (da COQUILHA 02)
DB.addModelo({
  nome: 'HÉLICE YAMAHA 15 HP 9 1/4 X 11',
  sku: 'HR HY 012',
  codigoBruto: 'COQUILHA 02'
});

context.ANALISE_STATE.productionSuggestions['HR HY 012'] = 100;

const rankingComNecessidade = context.getProgramacaoData();
const coq2ComNec = rankingComNecessidade.find(r => r.coquilha === 'COQUILHA 02');
assert.equal(coq2ComNec.prodNecTotal, 100, 'Se a hélice precisa de 100 usinadas, a coquilha deve indicar 100 brutas');
assert.equal(coq2ComNec.totLiga, 145.0, 'Total de liga a fundir para 100 un a 1.45kg deve ser 145 kg');

// 4. Executar renderização do HTML
context.renderProgramacaoFundicao();
const tbody = elements.get('pf-ranking-body');
assert.ok(tbody.innerHTML.includes('COQUILHA 02'), 'Tabela de Ranking deve renderizar COQUILHA 02');
assert.ok(tbody.innerHTML.includes('pf-rank-badge'), 'Tabela deve conter badge de ranking');

console.log('[OK] Todos os testes da Programação de Fundição por Criticidade passaram com 100% de sucesso!');
