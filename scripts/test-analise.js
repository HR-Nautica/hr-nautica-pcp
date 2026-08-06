import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';

const storage = new Map();
const catalogo = [
  { nome: 'HÉLICE TESTE 10 X 10', sku: 'HR TESTE 001', codigoBruto: 'BR 01', modeloBucha: 'BUCHA TESTE' },
  { nome: 'HÉLICE SEM LINHA NA PLANILHA', sku: 'HR TESTE 002', codigoBruto: 'BR 02', modeloBucha: 'BUCHA 02' },
];

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
  XLSX,
  RemoteStorage: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
  },
  safeGetJSON: (_key, fallback) => fallback,
  DB: {
    getModelos: () => catalogo,
    getPecas: () => [],
    getOps: () => [],
  },
  window: {},
  document: {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
  },
  showToast: () => {},
  debounce: (fn) => fn,
});

const source = `${fs.readFileSync('public/js/analise.js', 'utf8')}\n` +
  'globalThis.__processAnaliseExcel = processAnaliseExcel; globalThis.__ANALISE_STATE = ANALISE_STATE;';
vm.runInContext(source, context, { filename: 'analise.js' });

const rows = Array.from({ length: 7 }, () => Array(14).fill(''));
rows[5][0] = 'Produto';
rows[5][1] = 'Código (SKU)';
rows[5][2] = 'Código Bruto';
rows[5][7] = 'Saídas';
rows[5][8] = 'Físico';
rows[5][13] = 'Média Mensal';
rows[6][0] = 'NOME DIFERENTE NA PLANILHA';
rows[6][1] = 'HR TESTE 001';
rows[6][2] = 'BR PLANILHA';
rows[6][7] = 3;
rows[6][8] = 12;
rows[6][13] = 4;

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '3-Cobertura');
const input = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

assert.equal(context.__processAnaliseExcel(input), true);
const data = context.__ANALISE_STATE.coberturaData;
assert.equal(data.length, 2, 'a análise deve manter todos os itens do catálogo');

const mapped = data.find(item => item.sku === 'HR TESTE 001');
assert.equal(mapped.produto, catalogo[0].nome, 'a identificação deve vir do catálogo');
assert.equal(mapped.saidasPrevistas, 3, 'Saídas deve vir da coluna H');
assert.equal(mapped.estoqueFisico, 12, 'Físico deve vir da coluna I');
assert.equal(mapped.entradasPrevistas, null, 'Entradas deve permanecer N/A');
assert.equal(mapped.estoqueVirtual, 9, 'Virtual deve ser Físico + 0 - Saídas');
assert.equal(mapped.mediaMensal, 4, 'Média mensal deve vir da coluna N');
assert.equal(mapped.coberturaVirtual, 3, 'Cobertura deve ser Físico / Média mensal');

const withoutSpreadsheetRow = data.find(item => item.sku === 'HR TESTE 002');
assert.equal(withoutSpreadsheetRow.estoqueFisico, 0);
assert.equal(withoutSpreadsheetRow.entradasPrevistas, null);
assert.equal(withoutSpreadsheetRow.saidasPrevistas, 0);

console.log('QA análise: catálogo mestre, colunas H/I/N, Entradas N/A, Virtual e Cobertura validados.');
