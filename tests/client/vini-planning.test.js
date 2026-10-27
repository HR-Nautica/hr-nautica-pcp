import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as XLSX from "xlsx";

const viniSource = await readFile(new URL("../../public/js/vini.js", import.meta.url), "utf8");
const productionSource = await readFile(new URL("../../public/js/producaoComponentes.js", import.meta.url), "utf8");
const stockSource = await readFile(new URL("../../public/js/estoqueArvore.js", import.meta.url), "utf8");

function workbook(rows, sheetName = "NECESSIDADE PCP (3)") {
  return workbookFromSheets([{ name: sheetName, rows }]);
}

function workbookFromSheets(sheets) {
  const book = XLSX.utils.book_new();
  sheets.forEach(sheet => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name));
  return XLSX.write(book, { type: "array", bookType: "xlsx" });
}

function planningRows(items) {
  return [
    ["SKU", "Produto", "Saidas Previstas", "Estoque Fisico", "Saidas no periodo", "Media Mensal"],
    ...items.map(item => [item.sku, item.produto || item.sku, item.saidas, item.estoque, item.periodo ?? 0, item.media ?? 0])
  ];
}

function harness({ shared = new Map(), failKeys = new Set(), withProduction = false, withStock = false } = {}) {
  const writes = [];
  const toasts = [];
  const pendingWrites = new Map();
  const conflicts = new Map();
  const RemoteStorage = {
    pendingWrites,
    conflicts,
    getItem(key) { return shared.has(key) ? shared.get(key) : null; },
    async setItem(key, value) {
      writes.push(key);
      pendingWrites.set(key, { key, method: "PUT", value: JSON.parse(value) });
      shared.set(key, String(value));
      if (failKeys.has(key)) return false;
      pendingWrites.delete(key);
      return true;
    },
    async removeItem(key) { shared.delete(key); return true; },
    getConflict(key) { return conflicts.get(key) || null; },
    restoreLocalView(key, value, { exists = true } = {}) {
      if (exists) shared.set(key, JSON.stringify(value));
      else shared.delete(key);
    }
  };
  const document = {
    readyState: "complete",
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, click() {} }; },
    addEventListener() {}
  };
  const window = {
    RemoteStorage,
    EARV: { rows: [], familyTree: [], estoqueMap: {}, saidasPeriodoMap: {}, saidasPrevistasMap: {}, estoqueLoaded: false, saidasPrevistasLoaded: false },
    OP: null,
    addEventListener() {},
    dispatchEvent() {}
  };
  const context = {
    window, document, RemoteStorage, XLSX,
    console: { log() {}, warn() {}, error() {} },
    showToast(message, type) { toasts.push({ message, type, writePending: pendingWrites.has("hrn_prod_comp_ops") }); },
    confirm: () => true,
    alert() {}, prompt: () => null,
    localStorage: { getItem: key => RemoteStorage.getItem(key), setItem: (key, value) => shared.set(key, value), removeItem: key => shared.delete(key) },
    setTimeout, clearTimeout, Date, Map, Set, JSON, Promise, Intl,
    Blob: class {}, URL: { createObjectURL() { return "blob:test"; } },
    CustomEvent: class { constructor(name, init) { this.type = name; this.detail = init?.detail; } },
    parseRobustFloat(value) { const parsed = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : NaN; },
    renderViniTable() {}
  };
  window.window = window;
  if (withStock) vm.runInNewContext(stockSource, context, { filename: "estoqueArvore.js" });
  if (withProduction) vm.runInNewContext(productionSource, context, { filename: "producaoComponentes.js" });
  vm.runInNewContext(viniSource, context, { filename: "vini.js" });
  return { context, storage: shared, writes, toasts, vini: window.VINI_STATE, pendingWrites, conflicts };
}

test("importacao inicial e segunda importacao substituem o snapshot, preservam zero e removem SKU ausente", async () => {
  const env = harness();
  await env.context.processExcelWorkbook(workbook(planningRows([
    { sku: "COMP-A", saidas: 5, estoque: 12, periodo: 9, media: 3 },
    { sku: "COMP-B", saidas: 2, estoque: 4, periodo: 3, media: 1 }
  ])));
  assert.deepEqual(Array.from(env.vini.necessidadeData, item => item.sku), ["COMP-A", "COMP-B"]);

  await env.context.processExcelWorkbook(workbook(planningRows([
    { sku: "COMP-A", saidas: 0, estoque: 0, periodo: 0, media: 0 },
    { sku: "COMP-C", saidas: 7, estoque: 3, periodo: 6, media: 2 }
  ])));
  const snapshot = JSON.parse(env.storage.get("hrn_vini_necessidades"));
  assert.deepEqual(snapshot.map(item => item.sku), ["COMP-A", "COMP-C"]);
  assert.equal(snapshot[0].estoqueFisico, 0);
  assert.equal(snapshot[0].saidasPrevistas, 0);
  assert.equal(snapshot.some(item => item.sku === "COMP-B"), false);
});

test("estoque fisico oficial tambem substitui o snapshot e aceita saldo zero", async () => {
  const env = harness({ withStock: true });
  await env.context.earv_processPCPExcel(workbook(planningRows([
    { sku: "COMP-A", saidas: 2, estoque: 10 },
    { sku: "COMP-B", saidas: 1, estoque: 4 }
  ]), "Estoque PCP"));
  await env.context.earv_processPCPExcel(workbook(planningRows([
    { sku: "COMP-A", saidas: 0, estoque: 0 }
  ]), "Estoque PCP"));

  assert.deepEqual(JSON.parse(env.storage.get("hrn_earv_estoque")), { "COMP-A": 0 });
  assert.equal(env.context.window.EARV.estoqueMap["COMP-A"], 0);
  assert.equal(Object.hasOwn(env.context.window.EARV.estoqueMap, "COMP-B"), false);
});

test("planilha invalida nao altera o snapshot anterior", async () => {
  const previous = JSON.stringify([{ sku: "COMP-A", estoqueFisico: 8 }]);
  const env = harness({ shared: new Map([["hrn_vini_necessidades", previous]]) });
  await assert.rejects(
    env.context.processExcelWorkbook(workbook([["Produto", "Quantidade"], ["Sem SKU", 10]], "Arquivo qualquer")),
    /Aba de Necessidade/
  );
  assert.equal(env.storage.get("hrn_vini_necessidades"), previous);
  assert.equal(env.writes.length, 0);
});

test("falha de persistencia nao atualiza o estado nem produz confirmacao de sucesso", async () => {
  const previous = JSON.stringify([{ sku: "COMP-A", estoqueFisico: 8 }]);
  const env = harness({
    shared: new Map([["hrn_vini_necessidades", previous]]),
    failKeys: new Set(["hrn_vini_necessidades"])
  });
  await assert.rejects(
    env.context.processExcelWorkbook(workbook(planningRows([{ sku: "COMP-B", saidas: 1, estoque: 2 }]))),
    /nao confirmou/
  );
  assert.deepEqual(Array.from(env.vini.necessidadeData, item => item.sku), ["COMP-A"]);
  assert.equal(env.toasts.some(toast => toast.type === "success"), false);
});

test("falha ao criar OP restaura a visao confirmada, preserva pendencia e bloqueia duplicidade", async () => {
  const shared = new Map([["hrn_prod_comp_ops", JSON.stringify([])]]);
  const env = harness({ shared, failKeys: new Set(["hrn_prod_comp_ops"]), withProduction: true });

  assert.equal(await env.context.prodComp_createOP("COMP-A", 5, "Componente A"), null);
  assert.deepEqual(JSON.parse(shared.get("hrn_prod_comp_ops")), []);
  assert.equal(env.pendingWrites.get("hrn_prod_comp_ops").value.length, 1);
  assert.equal(env.toasts.some(toast => toast.type === "success"), false);

  const writesBeforeRetry = env.writes.length;
  assert.equal(await env.context.prodComp_createOP("COMP-A", 5, "Componente A"), null);
  assert.equal(env.writes.length, writesBeforeRetry);
  assert.equal(env.toasts.at(-1).type, "warning");
});

test("avanco de etapa so anuncia sucesso depois da confirmacao e restaura em falha", async () => {
  const baseOps = [{
    id: "OPC-ETAPA", sku: "COMP-A", descricao: "A", quantidade: 2,
    status: "Em Produção", itens: [{
      sku: "COMP-A", nivel: "02", parentSku: null,
      operacoes: { op01: { label: "Compras", status: "Pendente" } }
    }]
  }];
  const success = harness({ shared: new Map([["hrn_prod_comp_ops", JSON.stringify(baseOps)]]), withProduction: true });
  assert.equal(await success.context.prodComp_toggleOpStatus("OPC-ETAPA", "COMP-A", "op01"), true);
  const successToast = success.toasts.find(toast => toast.type === "success");
  assert.ok(successToast);
  assert.equal(successToast.writePending, false);

  const failed = harness({
    shared: new Map([["hrn_prod_comp_ops", JSON.stringify(baseOps)]]),
    failKeys: new Set(["hrn_prod_comp_ops"]),
    withProduction: true
  });
  assert.equal(await failed.context.prodComp_toggleOpStatus("OPC-ETAPA", "COMP-A", "op01"), false);
  assert.equal(JSON.parse(failed.storage.get("hrn_prod_comp_ops"))[0].itens[0].operacoes.op01.status, "Pendente");
  assert.equal(failed.pendingWrites.get("hrn_prod_comp_ops").value[0].itens[0].operacoes.op01.status, "OK");
  assert.equal(failed.toasts.some(toast => toast.type === "success"), false);
});

test("falhas ao concluir ou cancelar OP nao promovem o rascunho local", async () => {
  const baseOps = [{
    id: "OPC-FINAL", sku: "COMP-A", descricao: "A", quantidade: 2,
    status: "Em Produção", itens: [{
      sku: "COMP-A", nivel: "02", parentSku: null,
      operacoes: { op01: { label: "Compras", status: "OK" } }
    }]
  }];
  for (const action of ["prodComp_finalizarOP", "prodComp_deleteOP"]) {
    const env = harness({
      shared: new Map([["hrn_prod_comp_ops", JSON.stringify(baseOps)]]),
      failKeys: new Set(["hrn_prod_comp_ops"]),
      withProduction: true
    });
    assert.equal(await env.context[action]("OPC-FINAL"), false);
    const confirmed = JSON.parse(env.storage.get("hrn_prod_comp_ops"))[0];
    assert.equal(confirmed.status, "Em Produção");
    assert.equal(Boolean(confirmed.deleted), false);
    assert.equal(env.pendingWrites.has("hrn_prod_comp_ops"), true);
    assert.equal(env.toasts.some(toast => toast.type === "success"), false);
  }
});

test("OP ativa entra no planejamento e conclusao nao altera estoque fisico", async () => {
  const shared = new Map([
    ["hrn_earv_estoque", JSON.stringify({ "COMP-A": 10 })],
    ["hrn_vini_necessidades", JSON.stringify([{ sku: "COMP-A", produto: "Componente A", estoqueFisico: 10, saidasPrevistas: 4, mediaMensal: 10 }])]
  ]);
  const env = harness({ shared, withProduction: true });
  const op = await env.context.prodComp_createOP("COMP-A", 6, "Componente A");
  assert.ok(op);
  assert.equal(env.context.prodComp_getSaldoVirtualLocal("COMP-A"), 6);
  const planning = env.context.calculateViniPlanning(env.vini.necessidadeData[0]);
  assert.equal(planning.producaoEmAndamento, 6);
  assert.equal(planning.estoqueVirtual, 12);
  assert.equal(planning.necessidadeFabricacao, 14);

  const persistedOps = JSON.parse(shared.get("hrn_prod_comp_ops"));
  const currentOp = persistedOps.find(item => item.id === op.id);
  currentOp.itens.forEach(item => Object.values(item.operacoes).forEach(operation => {
    if (operation.status === "Pendente") operation.status = "OK";
  }));
  shared.set("hrn_prod_comp_ops", JSON.stringify(persistedOps));
  assert.equal(await env.context.prodComp_finalizarOP(op.id), true);
  assert.equal(env.context.prodComp_getSaldoVirtualLocal("COMP-A"), 0);
  assert.deepEqual(JSON.parse(shared.get("hrn_earv_estoque")), { "COMP-A": 10 });
  assert.equal(env.writes.filter(key => key === "hrn_earv_estoque").length, 0);
});

test("nova planilha preserva OPs e outro usuario recarrega o snapshot confirmado", async () => {
  const shared = new Map([["hrn_prod_comp_ops", JSON.stringify([{ id: "OPC-1", sku: "COMP-A", quantidade: 3, status: "Em ProduÃ§Ã£o" }])]]);
  const firstUser = harness({ shared });
  await firstUser.context.processExcelWorkbook(workbook(planningRows([{ sku: "COMP-A", saidas: 2, estoque: 5 }])));
  assert.equal(shared.has("hrn_prod_comp_ops"), true);

  const secondUser = harness({ shared });
  secondUser.context.refreshViniFromStorage();
  assert.deepEqual(Array.from(secondUser.vini.necessidadeData, item => item.sku), ["COMP-A"]);

  await firstUser.context.processExcelWorkbook(workbook(planningRows([{ sku: "COMP-B", saidas: 1, estoque: 9 }])));
  secondUser.context.refreshViniFromStorage();
  assert.deepEqual(Array.from(secondUser.vini.necessidadeData, item => item.sku), ["COMP-B"]);
  assert.equal(JSON.parse(shared.get("hrn_prod_comp_ops"))[0].id, "OPC-1");
});

test("fornecedores aceitam aba preferencial ou Planilha1 pelos cabecalhos", async () => {
  const rows = [["SKU", "Fornecedor Padrão"], ["COMP-A", "Fornecedor X"]];
  for (const sheetName of ["Fornecedores", "Planilha1"]) {
    const env = harness();
    const result = await env.context.processFornecedoresExcel(workbook(rows, sheetName));
    assert.equal(result.sheet, sheetName);
    assert.deepEqual(JSON.parse(env.storage.get("hrn_vini_fornecedores_map")), { "COMP-A": "FORNECEDOR X" });
  }
});

test("fabricacao identifica abas por cabecalhos, prefere nome e preserva todo o mapeamento", async () => {
  const headers = [
    "SKU Kit", "SKU Componente", "Descrição Componente", "Fornecedor Componente",
    "Quantidade Componente", "SKU Material", "Descrição Material", "Fornecedor Material",
    "Qtde Material", "Un"
  ];
  const validRows = [headers, ["KIT-1", "COMP-1", "Componente", "Fornecedor C", 2, "MAT-1", "Material", "Fornecedor M", 3.5, "kg"]];
  for (const sheetName of ["Fabricação", "Planilha1"]) {
    const env = harness();
    await env.context.processFabriExcel(workbook(validRows, sheetName));
    const component = JSON.parse(env.storage.get("hrn_vini_fabri_data"))["KIT-1"][0];
    assert.deepEqual(component, {
      skuComp: "COMP-1", descComp: "Componente", fornComp: "FORNECEDOR C", qtyComp: 2,
      skuMat: "MAT-1", descMat: "Material", fornMat: "FORNECEDOR M", qtyMat: 3.5, unMat: "kg"
    });
  }

  const multiple = harness();
  const result = await multiple.context.processFabriExcel(workbookFromSheets([
    { name: "Resumo", rows: [["Campo", "Valor"], ["Total", 1]] },
    { name: "Planilha1", rows: validRows },
    { name: "Fabricação", rows: [headers, ["KIT-2", "COMP-2", "Outro", "Fornecedor Y", 1, "", "", "", 0, "un"]] }
  ]));
  assert.equal(result.sheets[0], "Fabricação");
  assert.deepEqual(Object.keys(JSON.parse(multiple.storage.get("hrn_vini_fabri_data"))).sort(), ["KIT-1", "KIT-2"]);
});

test("workbooks invalidos, com colunas ausentes ou vazias nao alteram fornecedores e fabricacao", async () => {
  const previousSuppliers = JSON.stringify({ "COMP-OLD": "FORNECEDOR" });
  const previousFabrication = JSON.stringify({ "KIT-OLD": [{ skuComp: "OLD" }] });
  const cases = [
    workbook([["Campo", "Valor"], ["x", "y"]], "Planilha1"),
    workbook([["SKU", "Fornecedor"], ["", ""]], "Planilha1")
  ];
  for (const invalidWorkbook of cases) {
    const supplier = harness({ shared: new Map([["hrn_vini_fornecedores_map", previousSuppliers]]) });
    await assert.rejects(supplier.context.processFornecedoresExcel(invalidWorkbook));
    assert.equal(supplier.storage.get("hrn_vini_fornecedores_map"), previousSuppliers);
  }

  const invalidFabrication = [
    workbook([["SKU Kit", "Descricao"], ["KIT-1", "Sem componente"]], "Fabricação"),
    workbook([["SKU Kit", "SKU Componente"], ["", ""]], "Planilha1")
  ];
  for (const invalidWorkbook of invalidFabrication) {
    const fabrication = harness({ shared: new Map([["hrn_vini_fabri_data", previousFabrication]]) });
    await assert.rejects(fabrication.context.processFabriExcel(invalidWorkbook));
    assert.equal(fabrication.storage.get("hrn_vini_fabri_data"), previousFabrication);
  }
});
