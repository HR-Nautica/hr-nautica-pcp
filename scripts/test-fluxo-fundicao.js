import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('Testing Fluxo de Fundição (Catálogo -> Programação -> Rastreio com Entrada no Estoque)...');

const store = new Map();
const RemoteStorage = {
  getItem: (key) => store.get(key) || null,
  setItem: (key, val) => store.set(key, String(val)),
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
  localStorage: RemoteStorage,
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
});

context.window = context;
context.addEventListener = () => {};

const elements = new Map();
context.document = {
  getElementById: (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        classList: { remove() {}, add() {}, contains: () => false },
        style: {},
        dataset: {},
        addEventListener: () => {}
      });
    }
    return elements.get(id);
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

// Carregar dependências
const buchasSource = fs.readFileSync('public/js/buchas_data.js', 'utf8');
const fundicaoDataSource = fs.readFileSync('public/js/fundicao_catalog_data.js', 'utf8');
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
const viniSource = fs.readFileSync('public/js/vini.js', 'utf8');
const analiseSource = fs.readFileSync('public/js/analise.js', 'utf8');
const progSource = fs.readFileSync('public/js/programacao-fundicao.js', 'utf8');
const rastreioSource = fs.readFileSync('public/js/rastreio-fundicao.js', 'utf8');

vm.runInContext(buchasSource, context);
vm.runInContext(fundicaoDataSource, context);
vm.runInContext(dbSource, context);
vm.runInContext(viniSource, context);
vm.runInContext(analiseSource, context);
vm.runInContext(progSource, context);
vm.runInContext(rastreioSource, context);

const DB = context.__DB__;

// 1. Validar Catálogo de Fundição
console.log('1. Testando integridade do Catálogo de Fundição...');
DB.ensureFundicaoCatalogAtualizada();
const catalog = DB.getFundicaoCatalog();
assert.ok(Array.isArray(catalog), 'Catálogo deve ser uma lista de itens');
assert.ok(catalog.length > 0, 'Catálogo deve conter itens cadastrados');

// Adicionar novo produto ao catálogo
const novoProduto = DB.addFundicaoCatalogItem({
  coquilha: 'COQUILHA TESTE 99',
  descricao: 'Peça Bruta Especial Teste',
  peso: 2.150,
  liga: 'Alumínio AlMg5',
  ativo: true
});
assert.ok(novoProduto, 'Item deve ser criado');
assert.equal(novoProduto.coquilha, 'COQUILHA TESTE 99');
assert.equal(novoProduto.peso, 2.150);

// Inativar item
const inativado = DB.toggleFundicaoCatalogItemStatus(novoProduto.id);
assert.equal(inativado.ativo, false, 'Produto deve ser inativado');

// 2. Testar Invariante: Criação de OP NÃO altera estoque físico
console.log('2. Testando invariante: Criação de OP NÃO altera o Estoque Físico...');
const saldoInicial = DB.getRawStock('COQUILHA TESTE 99');

const novaOp = DB.addFundicao({
  coquilha: 'COQUILHA TESTE 99',
  produto: 'COQUILHA TESTE 99',
  numero: 'OP-FND-TEST-01',
  qtyPlanejada: 50,
  qty: 50,
  liga: 'Alumínio AlMg5',
  dataPrevista: '2026-09-10',
  responsavel: 'Operador Teste',
  status: 'Em aberto'
});

assert.ok(novaOp, 'OP deve ser criada com sucesso');
assert.equal(novaOp.status, 'Em aberto', 'Status inicial deve ser "Em aberto"');

const saldoAposCriacao = DB.getRawStock('COQUILHA TESTE 99');
assert.equal(saldoAposCriacao, saldoInicial, 'Estoque físico NÃO deve mudar ao criar OP em aberto');

// 3. Testar Finalização de OP: status -> Fundido e incremento atômico no estoque
console.log('3. Testando finalização de OP no Rastreio e entrada atômica no estoque...');
const resultadoFinalizacao = DB.finalizeFundicao(novaOp.id, {
  quantidadeProduzida: 48,
  dataFinalizacao: '2026-09-09',
  responsavelConclusao: 'Supervisor Teste',
  observacoes: '2 peças descartadas no esmerilhamento'
});

assert.ok(resultadoFinalizacao, 'Resultado de finalização retornado');
assert.equal(resultadoFinalizacao.order.status, 'Fundido', 'Status da OP deve mudar para "Fundido"');
assert.equal(resultadoFinalizacao.order.qtyProduzida, 48, 'Quantidade produzida deve ser 48');
assert.equal(resultadoFinalizacao.order.finalizada, true, 'Flag finalizada deve ser true');

const saldoAposFinalizacao = DB.getRawStock('COQUILHA TESTE 99');
assert.equal(saldoAposFinalizacao, saldoInicial + 48, 'Estoque físico deve receber exatamente as 48 peças produzidas');

// 4. Testar Idempotência: Tentativa de re-finalizar OP já fundida NÃO duplica estoque
console.log('4. Testando guarda de idempotência: OP já finalizada não gera entrada duplicada...');
const reFinalizacao = DB.finalizeFundicao(novaOp.id, {
  quantidadeProduzida: 48,
  dataFinalizacao: '2026-09-09',
  responsavelConclusao: 'Supervisor Teste'
});

assert.equal(reFinalizacao.alreadyFinalized, true, 'Deve identificar que OP já foi finalizada');
const saldoAposReTentativa = DB.getRawStock('COQUILHA TESTE 99');
assert.equal(saldoAposReTentativa, saldoInicial + 48, 'Estoque não pode ter sido duplicado em nova chamada');

// 5. Testar Rastreio de Fundição (KPIs e UI)
console.log('5. Testando funções de renderização e controle de Rastreio...');
assert.ok(typeof context.initRastreioFundicao === 'function', 'initRastreioFundicao deve existir');
assert.ok(typeof context.renderRastreioFundicao === 'function', 'renderRastreioFundicao deve existir');
assert.ok(typeof context.openModalFinalizarOp === 'function', 'openModalFinalizarOp deve existir');
assert.ok(typeof context.closeModalFinalizarOp === 'function', 'closeModalFinalizarOp deve existir');

// 6. Testar Regra de Segurança: Não permite excluir OP já finalizada
console.log('6. Testando regra de segurança contra exclusão de OP finalizada...');
assert.throws(() => {
  DB.deleteFundicao(novaOp.id);
}, /Não é possível excluir uma OP de Fundição que já foi finalizada/);

DB.deleteFundicaoCatalogItem(novoProduto.id);

console.log('✅ [OK] Todos os testes do fluxo de Fundição (Catálogo, Programação e Rastreio com Entrada de Estoque) passaram com 100% de sucesso!');
