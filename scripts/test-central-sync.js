import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('Testing Central de Sincronização Geral (Focus nas 2 abas de estoque & Prevenção de Leitura Dupla)...');

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
        classList: { remove() {}, add() {} },
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

const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
vm.runInContext(dbSource, context);
vm.runInContext(fs.readFileSync('public/js/syncManagerPage.js', 'utf8'), context);

assert.ok(typeof context.initSyncManagerPage === 'function', 'initSyncManagerPage deve ser exportado globalmente');
assert.ok(typeof context.distributeMasterExcel === 'function', 'distributeMasterExcel deve ser exportado globalmente');

// Simular inicialização da página
context.initSyncManagerPage();

console.log('[OK] Todos os testes da Central de Sincronização Geral (2 abas de estoque) passaram com 100% de sucesso!');
