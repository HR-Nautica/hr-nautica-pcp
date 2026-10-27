import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';

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
  RemoteStorage,
});

const catalogSource = `${fs.readFileSync('public/js/catalogo_data.js', 'utf8')}\n` +
  'globalThis.__CATALOGO_DATA__ = CATALOGO_DATA; globalThis.__CATALOGO_VERSION__ = CATALOGO_VERSION;';
const dbSource = `${fs.readFileSync('public/js/db.js', 'utf8')}\nglobalThis.__DB__ = DB;`;
vm.runInContext(catalogSource, context, { filename: 'catalogo_data.js' });
vm.runInContext(dbSource, context, { filename: 'db.js' });

const DB = context.__DB__;
const catalogData = context.__CATALOGO_DATA__;

const workbook = XLSX.read(fs.readFileSync('public/Novas Planilhas/Catalogo_Atualizado.xlsx'), { type: 'buffer' });
const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets.Matriz, {
  header: 1,
  defval: '',
  raw: false,
  range: 'B1:U87',
});
assert.equal(sourceRows.length - 1, catalogData.length, 'todas as linhas B:U devem ser geradas');
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.sku)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[1]).trim())),
  'a ordem e os SKUs devem corresponder exatamente à planilha',
);
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.modeloBucha)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[15]).trim())),
  'a descrição da bucha deve corresponder exatamente à coluna Q',
);
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.skuTinyTuboAl)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[5]).trim())),
  'o SKU do tubo deve corresponder exatamente à coluna G',
);
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.skuCaixa)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[17]).trim())),
  'o SKU da caixa deve corresponder exatamente à coluna S',
);
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.origin_uid)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[18]).trim().toLowerCase())),
  'o Origin UID deve corresponder exatamente à coluna T da fonte',
);
assert.equal(
  new Set(Array.from(catalogData, (record) => record.origin_uid)).size,
  catalogData.length,
  'o catálogo-fonte deve conter Origin UIDs únicos',
);
assert.equal(
  JSON.stringify(Array.from(catalogData, (record) => record.skuBucha)),
  JSON.stringify(sourceRows.slice(1).map((row) => String(row[19]).trim())),
  'o SKU da bucha deve corresponder exatamente à coluna U da fonte',
);

assert.equal(DB.ensureCatalogoAtualizado(), true, 'a primeira carga deve instalar o catálogo');
assert.equal(DB.getModelos().length, 86, 'o catálogo deve conter as 86 linhas de B:U');

const skus = DB.getModelos().map((modelo) => modelo.sku.toLocaleUpperCase('pt-BR'));
assert.equal(new Set(skus).size, skus.length, 'os SKUs devem ser únicos');

const first = DB.getModelos()[0];
assert.ok(first.nome && first.codigoBruto && first.anel && first.bucha, 'campos técnicos essenciais devem estar preenchidos');
assert.equal(first.skuBucha, 'HR BH 002', 'o SKU da bucha deve ter sido preenchido pelo VLOOKUP de Buchas.xlsx');
assert.equal(first.tuboAnel, first.diametroTuboAnel, 'o alias de compatibilidade do tubo deve ser preservado');
assert.equal(first.caixa, first.descricaoCaixa, 'o alias de compatibilidade da caixa deve ser preservado');

DB.updateModelo(first.id, { ...first, cor: 'AZUL' });
assert.equal(DB.getModelos().find((modelo) => modelo.id === first.id).cor, 'AZUL');
assert.equal(DB.ensureCatalogoAtualizado(), false, 'a mesma versão não pode sobrescrever edições posteriores');
assert.equal(DB.getModelos().find((modelo) => modelo.id === first.id).cor, 'AZUL');

assert.throws(
  () => DB.addModelo({ nome: 'Duplicada', sku: first.sku, codigoBruto: 'TESTE' }),
  /já pertence/,
  'não deve aceitar SKU duplicado',
);

const added = DB.addModelo({
  nome: 'HÉLICE QA 10 X 12',
  sku: 'HR QA 001',
  codigoBruto: 'QA 01',
  anel: '2 x 20',
  bucha: '1 x 50',
});
assert.equal(DB.getModelos().length, 87);
assert.equal(added.diametroTuboAnel, '');
assert.equal(added.atualizadoEm.length > 0, true);
const deleted = DB.deleteModelo(added.id);
assert.equal(deleted.sku, 'HR QA 001', 'a exclusão deve retornar a hélice removida');
assert.equal(DB.getModelos().length, 86, 'a exclusão deve remover apenas a hélice selecionada');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const appSource = fs.readFileSync('public/js/app.js', 'utf8');
const cssSource = fs.readFileSync('public/css/style.css', 'utf8');
assert.equal((indexHtml.match(/<!DOCTYPE html>/gi) || []).length, 1, 'o HTML deve ter apenas um documento raiz');
assert.equal((indexHtml.match(/\/js\/catalogo_data\.js/g) || []).length, 1, 'o catálogo deve ser carregado uma vez');
assert.equal(indexHtml.includes('/js/matriz_data.js'), false, 'a matriz antiga não deve ser carregada');
const documentIds = [...indexHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateDocumentIds = documentIds.filter((id, index) => documentIds.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicateDocumentIds)], [], 'o HTML não deve conter IDs duplicados');

const formIds = [
  'modelo-nome', 'modelo-sku', 'modelo-codigo-bruto', 'modelo-diametro-tubo-anel',
  'modelo-descricao-tubo', 'modelo-sku-tubo', 'modelo-comprimento-anel', 'modelo-anel',
  'modelo-diametro-latao', 'modelo-descricao-latao', 'modelo-sku-latao',
  'modelo-comprimento-bucha', 'modelo-bucha', 'modelo-cor', 'modelo-altura-buchas',
  'modelo-modelo-bucha', 'modelo-sku-bucha', 'modelo-descricao-caixa', 'modelo-sku-caixa',
];
formIds.forEach((id) => {
  assert.equal((indexHtml.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1, `${id} deve existir uma vez`);
  assert.equal(appSource.includes(`'${id}'`), true, `${id} deve estar conectado ao formulário`);
});
assert.equal(cssSource.includes('.catalogo-table'), true, 'a tabela deve ter estilos próprios');
assert.equal(cssSource.includes('.modal--catalogo'), true, 'o formulário técnico deve ter layout próprio');
['catalogo-filter-marca', 'catalogo-filter-bruto', 'catalogo-filter-bucha', 'catalogo-filter-cor', 'catalogo-limpar-filtros'].forEach((id) => {
  assert.equal((indexHtml.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1, `${id} deve existir uma vez`);
  assert.equal(appSource.includes(`'${id}'`), true, `${id} deve estar conectado aos filtros`);
});
assert.equal(appSource.includes('const buchaDescricao = modelo.modeloBucha'), true, 'a bucha exibida deve vir da coluna Q');
assert.equal(appSource.includes("modelo.skuTinyTuboAl || '—'"), true, 'o SKU do tubo exibido deve vir da coluna G');
assert.equal(appSource.includes("modelo.skuCaixa || '—'"), true, 'o SKU da caixa exibido deve vir da coluna S');
assert.equal((indexHtml.match(/class="catalogo-sort-btn"/g) || []).length, 7, 'cada coluna de dados deve permitir ordenação');
assert.equal(appSource.includes('function deleteModelo(id)'), true, 'o catálogo deve disponibilizar a exclusão de hélices');
assert.equal(appSource.includes("window.deleteModelo = deleteModelo"), true, 'a exclusão deve estar conectada aos botões do catálogo');
assert.equal(appSource.includes('As OPs e os lotes existentes serão preservados'), true, 'a confirmação deve explicar a preservação do histórico');
assert.equal(appSource.includes("bucha: $('catalogo-filter-bucha').value"), true, 'a descrição da bucha deve ser filtrável');
assert.equal(cssSource.includes('overflow-x: hidden'), true, 'o catálogo não deve exibir rolagem horizontal');
assert.equal(cssSource.includes('min-width: 1120px'), false, 'a tabela não deve forçar largura de desktop');
assert.equal(cssSource.includes('table-layout: fixed'), true, 'a tabela deve respeitar a largura disponível');

console.log('QA catálogo: planilha B:S, coluna Q para bucha, filtros, responsividade, edição, inclusão e unicidade validadas.');
