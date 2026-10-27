import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/estoque-buchas.js", import.meta.url), "utf8");
const snapshot = (version = 1) => ({ ok: true, origin: "ERP_INTERNAL_TRANSACTIONS", revision: version, versions: { hrn_buchas: 1, hrn_buchas_entradas: version, hrn_buchas_saidas: version }, catalog: [{ sku: "BH 1", descricao: "Bucha" }], entries: [], outputs: [], items: [{ sku: "BH 1", descricao: "Bucha", usinagem: 0, retrabalho: 0, vulcanizacao: 0, estoqueFinal: 0, total: 0 }], inconsistencies: [] });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

function harness(fetchImpl) {
  const elements = new Map(); const toasts = []; const writes = [];
  for (const [id, value] of [["entrada-bucha-sku", "BH 1"], ["entrada-bucha-qty", "2"], ["entrada-bucha-etapa", "Usinagem"], ["entrada-bucha-obs", "teste"], ["btn-save-nova-entrada-bucha", "Confirmar"], ["trans-bucha-qty-move", "2"], ["trans-bucha-action-restante", "manter"], ["trans-bucha-proxima-etapa-select", "Retrabalho"], ["btn-save-transicao-bucha", "Transicionar"], ["saida-bucha-sku", "BH 1"], ["saida-bucha-qty", "1"], ["saida-bucha-obs", "teste"], ["btn-save-saida-bucha", "Baixar"]]) {
    elements.set(id, { value, textContent: value, disabled: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} });
  }
  const context = {
    window: { __HRN_TEST__: true, PCP_CURRENT_USER: "alice", crypto: { randomUUID: () => "stable" } },
    document: { getElementById: id => elements.get(id) || null, addEventListener() {} },
    DB: { KEYS: { buchas: "hrn_buchas", buchasEntradas: "hrn_buchas_entradas", buchasSaidas: "hrn_buchas_saidas" } },
    RemoteStorage: { applyServerState(key, value, version) { writes.push({ key, value, version }); } },
    fetch: fetchImpl, showToast(message, type) { toasts.push({ message, type }); }, Intl, JSON, Map, Set, Date, Promise, Error, URL, encodeURIComponent, Headers,
    console: { warn() {}, error() {} }
  };
  vm.runInNewContext(source, context, { filename: "estoque-buchas.js" });
  return { ui: context.window.__BuchasUiTest, elements, toasts, writes };
}

test("entrada de Bucha confirma no servidor antes do sucesso e nao usa escrita generica", async () => {
  const calls = [];
  const { ui, toasts, writes } = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return response(201, { ok: true });
    return response(200, snapshot(calls.length));
  });
  await ui.refreshEstoqueBuchas();
  await ui.saveNovaEntradaBucha();
  const post = calls.find(call => call.options.method === "POST");
  assert.equal(post.url, "/api/buchas/entries");
  assert.equal(JSON.parse(post.options.body).data.eventKey, "BUCHA-ENTRY-stable");
  assert.equal(toasts.at(-1).type, "success");
  assert.equal(writes.every(write => ["hrn_buchas", "hrn_buchas_entradas", "hrn_buchas_saidas"].includes(write.key)), true);
});

test("falha e conflito nao exibem sucesso; nova tentativa mantem o mesmo eventKey", async () => {
  let mode = "network"; const requests = []; const { ui, toasts } = harness(async (url, options = {}) => {
    if (options.method !== "POST") return response(200, snapshot());
    requests.push(JSON.parse(options.body));
    if (mode === "network") throw new Error("offline");
    if (mode === "conflict") return response(409, { error: "Conflito" });
    return response(201, { ok: true });
  });
  await ui.refreshEstoqueBuchas(); await ui.saveNovaEntradaBucha();
  assert.equal(toasts.some(toast => toast.type === "success"), false);
  mode = "conflict"; await ui.saveNovaEntradaBucha();
  assert.equal(toasts.some(toast => toast.type === "success"), false);
  assert.equal(requests[0].data.eventKey, requests[1].data.eventKey);
});

test("transicao e saida usam somente as rotas oficiais", async () => {
  const calls = []; const { ui } = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return response(201, { ok: true });
    return response(200, snapshot(2));
  });
  await ui.refreshEstoqueBuchas();
  ui.state.snapshot.entries = [{ id: "ent-1", codigoEntrada: "ENT-1", sku: "BH 1", descricao: "Bucha", quantidade: 2, etapaAtual: "Usinagem", status: "Em Andamento" }];
  ui.state.selectedEntradaId = "ent-1";
  await ui.saveTransicaoLoteBucha();
  await ui.saveSaidaBucha();
  assert.equal(calls.some(call => call.url === "/api/buchas/entries/ent-1/transition" && call.options.method === "POST"), true);
  assert.equal(calls.some(call => call.url === "/api/buchas/outputs" && call.options.method === "POST"), true);
});
