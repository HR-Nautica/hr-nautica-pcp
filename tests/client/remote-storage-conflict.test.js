import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/remote-storage.js", import.meta.url), "utf8");

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function harness(fetchImpl) {
  const values = new Map();
  const warning = { textContent: "", style: {}, append() {} };
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = {
    window: {}, localStorage,
    document: {
      getElementById(id) { return id === "central-server-warning" ? warning : null; },
      createElement() { return { addEventListener() {}, disabled: false, textContent: "", type: "" }; }
    },
    fetch: fetchImpl,
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, Date, Map, Set, JSON, Promise, URL, encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: "remote-storage.js" });
  return { storage: context.window.RemoteStorage, localStorage, warning };
}

test("HTTP 409 preserva servidor e alteracao local sem reenvio automatico", async () => {
  const calls = [];
  const { storage } = harness(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (calls.length === 1) return response(409, { currentVersion: 2 });
    return response(200, { modified: true, revision: 8, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 2 } });
  });
  storage.online = true;
  storage.data.set("hrn_ops", [{ id: "base" }]);
  storage.versions.set("hrn_ops", 1);
  storage.setItem("hrn_ops", JSON.stringify([{ id: "local" }]));
  await storage.writeQueues.get("hrn_ops");
  assert.deepEqual(JSON.parse(JSON.stringify(storage.data.get("hrn_ops"))), [{ id: "servidor" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.getConflict("hrn_ops").value)), [{ id: "local" }]);
  assert.equal(storage.pendingWrites.has("hrn_ops"), true);
  assert.deepEqual(calls.map(call => call.method), ["PUT", "GET"]);
});

test("fila nao envia snapshot posterior depois que a chave entra em conflito", async () => {
  const calls = [];
  const { storage } = harness(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (calls.length === 1) return response(409, { currentVersion: 2 });
    return response(200, { modified: true, revision: 9, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 2 } });
  });
  storage.data.set("hrn_ops", []);
  storage.versions.set("hrn_ops", 1);
  storage.setItem("hrn_ops", JSON.stringify([{ id: "antigo" }]));
  storage.setItem("hrn_ops", JSON.stringify([{ id: "mais-recente" }]));
  await storage.writeQueues.get("hrn_ops");
  assert.deepEqual(calls.map(call => call.method), ["PUT", "GET"]);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.getConflict("hrn_ops").value)), [{ id: "mais-recente" }]);
});

test("falha de rede mantem gravacao pendente recuperavel no navegador", async () => {
  const { storage, localStorage, warning } = harness(async () => { throw new Error("rede indisponivel"); });
  storage.data.set("hrn_buchas", []);
  storage.versions.set("hrn_buchas", 1);
  storage.setItem("hrn_buchas", JSON.stringify([{ id: "local" }]));
  await storage.writeQueues.get("hrn_buchas");
  assert.equal(storage.pendingWrites.has("hrn_buchas"), true);
  assert.match(localStorage.getItem("pcp_remote_pending_writes_v1"), /hrn_buchas/);
  assert.match(localStorage.getItem("hrn_buchas"), /local/);
  assert.match(warning.textContent, /nao confirmadas/i);
});

test("nova tentativa consciente confirma a pendencia sem alterar automaticamente antes disso", async () => {
  let online = false;
  const { storage } = harness(async () => {
    if (!online) throw new Error("rede indisponivel");
    return response(200, { ok: true, version: 2, revision: 3 });
  });
  storage.data.set("hrn_pedidos", [{ id: "servidor" }]);
  storage.versions.set("hrn_pedidos", 1);
  storage.setItem("hrn_pedidos", JSON.stringify([{ id: "local" }]));
  await storage.writeQueues.get("hrn_pedidos");
  assert.equal(storage.pendingWrites.has("hrn_pedidos"), true);

  online = true;
  assert.equal(await storage.retryPending("hrn_pedidos"), true);
  assert.equal(storage.pendingWrites.has("hrn_pedidos"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.data.get("hrn_pedidos"))), [{ id: "local" }]);
  assert.equal(storage.versions.get("hrn_pedidos"), 2);
});
