import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const syncSource = await readFile(new URL('../../public/js/syncManagerPage.js', import.meta.url), 'utf8');

function workbook(sheets) {
  return {
    SheetNames: sheets.map(sheet => sheet.name),
    Sheets: Object.fromEntries(sheets.map(sheet => [sheet.name, sheet.rows]))
  };
}

function harness({ book, processors }) {
  const writes = [];
  const toasts = [];
  const storage = new Map();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = { document };
  const context = {
    window,
    document,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XLSX: {
      read: value => value,
      utils: { sheet_to_json: rows => rows }
    },
    console: { log() {}, warn() {}, error() {} },
    showToast(message, type) { toasts.push({ message, type }); },
    ...processors
  };
  window.showToast = context.showToast;
  window.processExcelWorkbook = context.processExcelWorkbook;
  vm.createContext(context);
  vm.runInContext(syncSource, context, { filename: 'syncManagerPage.js' });
  const file = { name: 'importacao.xlsx', async arrayBuffer() { return book; } };
  return { context, window, file, writes, toasts };
}

function plan(writes, name, { fail = false, result = {} } = {}) {
  return {
    ...result,
    async commit() {
      writes.push(name);
      if (fail) throw new Error(`Falha de rede em ${name}`);
      return result;
    }
  };
}

test('planejamento valido e fabricacao invalida nao iniciam gravacoes', async () => {
  const writes = [];
  const env = harness({
    book: workbook([
      { name: 'Necessidade PCP', rows: [['SKU', 'Saidas Previstas'], ['A', 1]] },
      { name: 'Fabricação', rows: [['Coluna errada'], ['x']] }
    ]),
    processors: {
      async processExcelWorkbook(_data, options) {
        assert.equal(options.prepareOnly, true);
        return plan(writes, 'planejamento', { result: { count: 1 } });
      },
      async processFabriExcel() { throw new Error('Cabecalhos de fabricacao invalidos'); },
      async earv_processSaidasPrevistasExcel() { return plan(writes, 'saidas'); }
    }
  });

  await env.window.distributeViniSaidasExcel(env.file);
  assert.deepEqual(writes, []);
  assert.equal(env.toasts.some(toast => toast.type === 'success'), false);
  assert.equal(env.toasts.at(-1).type, 'error');
});

test('analise valida e estoque de componentes invalido nao iniciam gravacoes', async () => {
  const writes = [];
  const env = harness({
    book: workbook([{ name: '3-Cobertura', rows: [['Produto', 'SKU'], ['Hélice', 'H-1']] }]),
    processors: {
      async processAnaliseExcel(_data, options) {
        assert.equal(options.prepareOnly, true);
        return plan(writes, 'analise', { result: { count: 1 } });
      },
      async earv_processPCPExcel() { throw new Error('Estoque de componentes invalido'); }
    }
  });

  await env.window.distributeMasterExcel(env.file);
  assert.deepEqual(writes, []);
  assert.equal(env.toasts.some(toast => toast.type === 'success'), false);
});

test('todas as abas validas sao confirmadas somente depois da pre-validacao', async () => {
  const writes = [];
  const env = harness({
    book: workbook([
      { name: 'Necessidade PCP', rows: [['SKU', 'Saidas Previstas'], ['A', 1]] },
      { name: 'Fornecedores', rows: [['SKU', 'Fornecedor'], ['A', 'X']] },
      { name: 'Fabricação', rows: [['SKU Kit', 'SKU Componente'], ['KIT', 'A']] }
    ]),
    processors: {
      async processExcelWorkbook() { return plan(writes, 'planejamento', { result: { count: 1 } }); },
      async processFornecedoresExcel() { return plan(writes, 'fornecedores'); },
      async processFabriExcel() { return plan(writes, 'fabricacao'); },
      async earv_processSaidasPrevistasExcel() { return plan(writes, 'saidas'); }
    }
  });

  await env.window.distributeViniSaidasExcel(env.file);
  assert.deepEqual(writes, ['planejamento', 'fornecedores', 'fabricacao', 'saidas']);
  assert.equal(env.toasts.at(-1).type, 'success');
});

test('falha de rede entre gravacoes informa falha sem sucesso falso', async () => {
  const writes = [];
  const env = harness({
    book: workbook([
      { name: 'Necessidade PCP', rows: [['SKU', 'Saidas Previstas'], ['A', 1]] },
      { name: 'Fornecedores', rows: [['SKU', 'Fornecedor'], ['A', 'X']] }
    ]),
    processors: {
      async processExcelWorkbook() { return plan(writes, 'planejamento', { result: { count: 1 } }); },
      async processFornecedoresExcel() { return plan(writes, 'fornecedores', { fail: true }); },
      async earv_processSaidasPrevistasExcel() { return plan(writes, 'saidas'); }
    }
  });

  await env.window.distributeViniSaidasExcel(env.file);
  assert.deepEqual(writes, ['planejamento', 'fornecedores']);
  assert.equal(env.toasts.filter(toast => toast.type === 'success').length, 0);
  assert.match(env.toasts.at(-1).message, /Falha de rede/);
});
