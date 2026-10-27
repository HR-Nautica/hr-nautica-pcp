import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import XLSX from "xlsx";

const source = await readFile(new URL("../../public/js/analise.js", import.meta.url), "utf8");
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

function workbook({ stableId = "LOTE-77" } = {}) {
  const coverage = XLSX.utils.aoa_to_sheet([["Produto", "Código (SKU)", "", "", "", "", "", "Saídas", "Físico", "", "", "", "", "Média"], ["Hélice", "SKU-77", "", "", "", "", "", 0, 2, "", "", "", "", 1]]);
  const tracking = XLSX.utils.aoa_to_sheet([["Lote", "Descrição", "Código (SKU)", "Quantidade", "Localização", "Bruto"], [stableId, "Hélice", "SKU-77", 2, "Usinagem", "BR-77"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, coverage, "3-Cobertura");
  XLSX.utils.book_append_sheet(wb, tracking, "Rastreio");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function harness(fetchImpl) {
  const writes = []; let reloads = 0;
  const context = vm.createContext({
    console: { error() {}, warn() {} }, Date, Math, Map, Set, JSON, String, Array, Object, Promise, Error, XLSX,
    RemoteStorage: { getItem() { return null; }, serverVersion() { return 1; }, applyServerState(...args) { writes.push(args); }, async load() { reloads += 1; } },
    DB: { getModelos() { return []; }, addOp() { throw new Error("legacy addOp must not run"); }, saveOps() { throw new Error("legacy saveOps must not run"); }, savePecas() { throw new Error("legacy savePecas must not run"); } },
    safeGetJSON(_key, fallback) { return fallback; }, fetch: fetchImpl, showToast() {}, debounce(fn) { return fn; },
    window: { addEventListener() {}, PCP_CURRENT_USER: "tester", crypto: { randomUUID: () => "event-77" } },
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }
  });
  vm.runInContext(`${source}\nglobalThis.__process = processAnaliseExcel;`, context, { filename: "analise.js" });
  return { process: context.__process, writes, reloads: () => reloads };
}

test("rastreio usa API oficial com sourceId estável e nunca DB legado", async () => {
  const calls = [];
  const { process, writes } = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/analysis-temp") return response(201, { ok: true, count: 1 });
    return response(201, { ok: true, operations: [], pieces: [], versions: { hrn_ops: 2, hrn_pecas: 2, hrn_tracking_reconcile_events: 1 }, revision: 5 });
  });
  const result = await process(workbook());
  const request = calls.find(call => call.url === "/api/production-tracking/reconcile");
  assert.equal(result.tracking.status, "confirmed");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).data.records[0].sourceId, "LOTE-77");
  assert.equal(writes.length, 2);
});

test("falha de rastreio é parcial, reutiliza eventKey e conflito recarrega versões", async () => {
  const requests = []; let attempt = 0;
  const { process, reloads } = harness(async (url, options = {}) => {
    if (url === "/api/analysis-temp") return response(201, { ok: true, count: 1 });
    requests.push(JSON.parse(options.body)); attempt += 1;
    return response(attempt === 1 ? 409 : 500, { error: "falha de teste" });
  });
  const first = await process(workbook()); const second = await process(workbook());
  assert.equal(first.coverage.status, "confirmed");
  assert.equal(first.tracking.status, "failed");
  assert.equal(reloads(), 1);
  assert.equal(requests[0].data.eventKey, requests[1].data.eventKey);
});

test("rastreio sem identificador estável não usa índice de linha e não chama API", async () => {
  const calls = []; const { process } = harness(async (url, options = {}) => { calls.push({ url, options }); return response(201, { ok: true, count: 1 }); });
  const result = await process(workbook({ stableId: "" }));
  assert.equal(result.coverage.status, "confirmed");
  assert.equal(result.tracking.status, "failed");
  assert.equal(calls.some(call => call.url === "/api/production-tracking/reconcile"), false);
});
