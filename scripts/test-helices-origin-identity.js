import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

function createDb() {
  const store = new Map();
  const RemoteStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, value),
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
    Uint8Array,
    crypto: crypto.webcrypto,
    RemoteStorage,
  });
  const catalogSource = `${fs.readFileSync('public/js/catalogo_data.js', 'utf8')}\n`
    + 'globalThis.__CATALOGO_DATA__ = CATALOGO_DATA;';
  const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
  vm.runInContext(catalogSource, context, { filename: 'catalogo_data.js' });
  vm.runInContext(dbSource, context, { filename: 'db.js' });
  return { DB: context.__DB__, store, catalog: context.__CATALOGO_DATA__ };
}

const { DB, store, catalog } = createDb();
const originUidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

assert.equal(catalog.length, 86, 'a fonte efetiva do seed deve conter 86 hélices');
assert.ok(catalog.every((record) => originUidPattern.test(record.origin_uid)), 'cada registro-fonte deve conter UUID válido');
assert.equal(new Set(catalog.map((record) => record.origin_uid)).size, catalog.length, 'cada Origin UID da fonte deve ser único');

assert.equal(DB.ensureCatalogoAtualizado(), true, 'o primeiro seed deve carregar o catálogo-base');
const firstSeed = DB.getModelos();
assert.ok(firstSeed.every((record) => originUidPattern.test(record.origin_uid)), 'o seed deve preservar os UIDs da fonte');
const firstSeedOriginUids = firstSeed.map((record) => record.origin_uid);
const firstOperationalIds = firstSeed.map((record) => record.id);

store.delete('hrn_modelos');
assert.equal(DB.ensureCatalogoAtualizado(), true, 'o seed deve reconstruir catálogo vazio');
const rebuiltSeed = DB.getModelos();
assert.deepEqual(rebuiltSeed.map((record) => record.origin_uid), firstSeedOriginUids, 'a reconstrução deve conservar a identidade de origem');
assert.ok(rebuiltSeed.some((record, index) => record.id !== firstOperationalIds[index]), 'a prova de reconstrução não pode depender do ID operacional anterior');

const manual = DB.addModelo({
  nome: 'HÉLICE QA ORIGIN 10 X 10',
  sku: 'HR QA ORIGIN 001',
  codigoBruto: 'QA ORIGIN 01',
  anel: '2 x 20',
  bucha: '1 x 50',
});
assert.ok(originUidPattern.test(manual.origin_uid), 'novo cadastro manual deve receber UUID válido');
const changedSku = DB.updateModelo(manual.id, { ...manual, sku: 'HR QA ORIGIN 002', cor: 'AZUL' });
assert.equal(changedSku.origin_uid, manual.origin_uid, 'edição e mudança de SKU devem preservar Origin UID');
assert.equal(DB.getModelos().find((record) => record.id === manual.id).origin_uid, manual.origin_uid, 'salvamento e recarga no armazenamento devem preservar Origin UID');
assert.throws(
  () => DB.updateModelo(manual.id, { ...changedSku, origin_uid: crypto.randomUUID() }),
  /imutável/,
  'uma edição não pode substituir Origin UID',
);

const importedUid = crypto.randomUUID();
const imported = DB.addModelo({
  nome: 'HÉLICE QA IMPORTADA 10 X 11',
  sku: 'HR QA IMPORT 001',
  codigoBruto: 'QA IMPORT 01',
  origin_uid: importedUid,
});
assert.equal(imported.origin_uid, importedUid, 'importação com UID válido deve preservá-lo');
assert.throws(
  () => DB.addModelo({ nome: 'HÉLICE QA DUPLICADA', sku: 'HR QA IMPORT 002', codigoBruto: 'QA IMPORT 02', origin_uid: importedUid }),
  /duplicado/,
  'UUID duplicado deve ser rejeitado sem persistência',
);
assert.equal(DB.getModelos().filter((record) => record.origin_uid === importedUid).length, 1, 'a colisão não pode alterar o catálogo');

const legacy = { id: 'legado-sem-origin-uid', nome: 'HÉLICE LEGADA', sku: 'HR LEGADO 001', codigoBruto: 'LEGADO' };
DB.saveModelos([legacy]);
assert.equal(DB.getModelos()[0].origin_uid, undefined, 'registro legado sem UID deve continuar legível sem backfill');
const legacyUpdated = DB.updateModelo(legacy.id, { ...legacy, cor: 'VERDE' });
assert.equal(legacyUpdated.origin_uid, undefined, 'edição de legado não pode atribuir UID automaticamente');

const beforeDuplicateImport = DB.getModelos();
assert.throws(
  () => DB.saveModelos([
    { ...legacy, origin_uid: importedUid },
    { ...legacy, id: 'legado-duplicado', sku: 'HR LEGADO 002', origin_uid: importedUid },
  ]),
  /duplicado/,
  'importação com UUID duplicado deve ser sinalizada',
);
assert.deepEqual(DB.getModelos(), beforeDuplicateImport, 'falha de importação não pode causar perda de dados');

console.log('QA identidade de origem de hélices: seed, reconstrução, edição, importação, legado e colisões validados.');
