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

context.window = context;

const buchasSource = fs.readFileSync('public/js/buchas_data.js', 'utf8');
const fundicaoDataSource = fs.readFileSync('public/js/fundicao_catalog_data.js', 'utf8');
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;

vm.runInContext(buchasSource, context, { filename: 'buchas_data.js' });
vm.runInContext(fundicaoDataSource, context, { filename: 'fundicao_catalog_data.js' });
vm.runInContext(dbSource, context, { filename: 'db.js' });

const DB = context.__DB__;

console.log('Testing Catálogo de Fundição (Coquilhas & Aplicações)...');

// 1. Verificar carga dos dados iniciais da planilha
DB.ensureFundicaoCatalogAtualizada();
const catalog = DB.getFundicaoCatalog();
assert.equal(catalog.length, 74, 'Deve conter 74 itens importados de Novas Planilhas / Fundição.xlsx');

const coquilhas = DB.getCoquilhasCatalog();
assert.equal(coquilhas.length, 44, 'Deve conter 44 coquilhas brutas registradas');

// 2. Verificar item específico da Coquilha 02
const itemHy012 = catalog.find(c => c.sku === 'HR HY 012');
assert.ok(itemHy012, 'SKU HR HY 012 deve estar no catálogo');
assert.equal(itemHy012.coquilha, 'COQUILHA 02');
assert.equal(itemHy012.descricao, 'HÉLICE YAMAHA 15 HP 9 1/4 X 11');

// 3. Adicionar novo item no catálogo
const novoItem = DB.addFundicaoCatalogItem({
  coquilha: 'COQUILHA 99',
  sku: 'HR TESTE 001',
  descricao: 'HÉLICE TESTE FUNDIÇÃO 15 HP',
  peso: 0
});
assert.ok(novoItem.id.startsWith('fnd_'), 'ID do novo item deve iniciar com fnd_');
assert.equal(novoItem.peso, 0, 'Peso padrão deve ser 0');

const catalogPosAdd = DB.getFundicaoCatalog();
assert.equal(catalogPosAdd.length, 75, 'Catálogo deve ter 75 itens após adição');

// 4. Editar o item
const itemEditado = DB.updateFundicaoCatalogItem(novoItem.id, {
  descricao: 'HÉLICE TESTE EDITADA',
  peso: 1.250
});
assert.equal(itemEditado.descricao, 'HÉLICE TESTE EDITADA', 'Descrição deve ter sido alterada');
assert.equal(itemEditado.peso, 1.250, 'Peso deve ter sido atualizado para 1.25');

// 5. Excluir o item
const excluiu = DB.deleteFundicaoCatalogItem(novoItem.id);
assert.equal(excluiu, true, 'Exclusão deve retornar true');

const catalogPosDel = DB.getFundicaoCatalog();
assert.equal(catalogPosDel.length, 74, 'Catálogo deve voltar a 74 itens após exclusão');

// 6. Testar renderização do HTML agrupado por Coquilha
const elements = new Map();
context.document = {
  getElementById: (id) => {
    if (!elements.has(id)) {
      elements.set(id, { id, value: '', textContent: '', innerHTML: '', classList: { remove() {}, add() {} }, dataset: {} });
    }
    return elements.get(id);
  },
  addEventListener: () => {}
};

const catalogoScript = fs.readFileSync('public/js/catalogo-fundicao.js', 'utf8');
vm.runInContext(catalogoScript, context, { filename: 'catalogo-fundicao.js' });

context.renderCatalogoFundicao();
const tbody = elements.get('cf-grid');
assert.ok(tbody.innerHTML.includes('COQUILHA 02'), 'Deve conter a linha de cabeçalho da COQUILHA 02');
assert.ok(tbody.innerHTML.includes('coquilha-group-header'), 'Deve conter a classe de grupo coquilha-group-header');

// 7. Expandir Coquilha 02 e validar exibição das sub-linhas
context.toggleCoquilhaExpand('COQUILHA 02');
assert.ok(tbody.innerHTML.includes('HR HY 012'), 'Após expandir, o modelo HR HY 012 deve ser renderizado');

// 8. Testar atribuição de peso para a Coquilha 02
DB.saveCoquilhaPeso('COQUILHA 02', 1.850);
assert.equal(DB.getCoquilhaPeso('COQUILHA 02'), 1.850, 'Peso da COQUILHA 02 deve ser 1.85 kg');

context.renderCatalogoFundicao();
assert.ok(tbody.innerHTML.includes('1,850 kg'), 'Renderização deve exibir o peso 1,850 kg na COQUILHA 02');

console.log('[OK] Todos os testes do Catálogo de Fundição vinculados com Catálogo de Hélices e Peso de Coquilha passaram com 100% de sucesso!');
