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
  fetch: async (_url, options = {}) => ({
    ok: true,
    status: 201,
    json: async () => ({ ok: true, count: JSON.parse(options.body || '{"rows":[]}').rows.length })
  }),
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
  'globalThis.__processAnaliseExcel = processAnaliseExcel; globalThis.__ANALISE_STATE = ANALISE_STATE; globalThis.__calculateProductionPriority = calculateProductionPriority;';
vm.runInContext(source, context, { filename: 'analise.js' });

const rows = Array.from({ length: 2 }, () => Array(16).fill(''));
rows[0][0] = 'Produto';
rows[0][1] = 'Código (SKU)';
rows[0][2] = 'Cód. no Fornecedor Padrão';
rows[0][7] = 'Saídas previstas';
rows[0][8] = 'Estoque físico';
rows[0][13] = 'Média mensal';
rows[1][0] = 'NOME DIFERENTE NA PLANILHA';
rows[1][1] = 'HR TESTE 001';
rows[1][2] = 'BR PLANILHA';
rows[1][7] = 3;
rows[1][8] = 12;
rows[1][13] = 4;

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
const input = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

const syncResult = await context.__processAnaliseExcel(input);
assert.equal(syncResult.count, 1, 'a linha importada deve ser enviada para a tabela temporária');
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

assert.equal(
  context.__calculateProductionPriority({ estoqueFisico: 3, saidasPrevistas: 5, mediaMensal: 4 }),
  -1,
  'Físico menor que Saídas deve receber prioridade máxima',
);
assert.equal(
  context.__calculateProductionPriority({ estoqueFisico: 10, saidasPrevistas: 2, mediaMensal: 1.5 }),
  5,
  'Média mensal menor que 2 deve receber prioridade 5',
);
assert.equal(
  context.__calculateProductionPriority({ estoqueFisico: 10, saidasPrevistas: 3, mediaMensal: 3 }),
  7 / 3,
  'os demais itens devem usar (Físico - Saídas) / Média mensal',
);

console.log('QA análise: colunas H/I/N, Virtual, Cobertura e regras de Prioridade validadas.');
