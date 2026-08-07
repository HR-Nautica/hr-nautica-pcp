import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const versions = new Map();

const RemoteStorage = {
  data: store,
  versions: versions,
  getItem: (key) => store.has(key) ? store.get(key) : null,
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

const catalogSource = `${fs.readFileSync('public/js/catalogo_data.js', 'utf8')}\n` +
  'globalThis.__CATALOGO_DATA__ = CATALOGO_DATA; globalThis.__CATALOGO_VERSION__ = CATALOGO_VERSION;';
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
vm.runInContext(catalogSource, context, { filename: 'catalogo_data.js' });
vm.runInContext(dbSource, context, { filename: 'db.js' });

const DB = context.__DB__;

// Initial setup
DB.ensureCatalogoAtualizado();

console.log('Testing CRUD operations on DB...');

// 1. Test Add & Delete Material
const mat = DB.addMaterial({ nome: 'Item Teste CRUD', categoria: 'Insumo', unidade: 'un', saldo: 10, minimo: 5 });
assert.ok(mat && mat.id, 'Material add deve retornar objeto com ID');
assert.equal(DB.getMateriais().some(m => m.id === mat.id), true, 'Material adicionado deve estar no DB');

DB.deleteMaterial(mat.id);
assert.equal(DB.getMateriais().some(m => m.id === mat.id), false, 'Material deletado não deve estar no DB');
console.log('[OK] Material Add & Delete verified.');

// 2. Test Add & Delete Modelo
const countBefore = DB.getModelos().length;
const modelo = DB.addModelo({ nome: 'HÉLICE TESTE CRUD 10 X 10', sku: 'HR TEST 999', codigoBruto: 'TEST 999' });
assert.equal(DB.getModelos().length, countBefore + 1, 'Modelo count deve aumentar em 1');

DB.deleteModelo(modelo.id);
assert.equal(DB.getModelos().length, countBefore, 'Modelo count deve retornar ao anterior após exclusão');
console.log('[OK] Modelo Add & Delete verified.');

// 3. Test Add & Delete Fundicao
const fund = DB.addFundicao({ modelo: 'HÉLICE YAMAHA 25 HP', lote: 'L001', quantidade: 5, dataProgramada: '2026-08-10' });
assert.ok(fund && fund.id, 'Fundicao add deve ter ID');
assert.equal(DB.getFundicoes().some(f => f.id === fund.id), true, 'Fundicao adicionada deve estar no DB');

DB.deleteFundicao(fund.id);
assert.equal(DB.getFundicoes().some(f => f.id === fund.id), false, 'Fundicao deletada não deve estar no DB');
console.log('[OK] Fundicao Add & Delete verified.');

// 4. Test Add & Delete Peca
const peca = DB.addPeca({ numero: 'P001', modelo: 'HÉLICE YAMAHA 25 HP', lote: 'L001' });
assert.ok(peca && peca.id, 'Peca add deve ter ID');
assert.equal(DB.getPecas().some(p => p.id === peca.id), true, 'Peca adicionada deve estar no DB');

DB.deletePeca(peca.id);
assert.equal(DB.getPecas().some(p => p.id === peca.id), false, 'Peca deletada não deve estar no DB');
console.log('[OK] Peca Add & Delete verified.');

console.log('All local DB CRUD assertions passed!');
