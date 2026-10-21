import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/remote-storage.js", import.meta.url), "utf8");

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function harness(fetchImpl, { values = new Map(), username = "alice", confirm = () => false } = {}) {
  const warning = { textContent: "", style: {}, append() {} };
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = {
    window: { PCP_CURRENT_USER: username, confirm }, localStorage,
    document: {
      getElementById(id) { return id === "central-server-warning" ? warning : null; },
      createElement() { return { addEventListener() {}, disabled: false, textContent: "", type: "" }; }
    },
    fetch: fetchImpl,
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, Date, Map, Set, JSON, Promise, URL, encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: "remote-storage.js" });
  context.window.RemoteStorage.currentUser = username;
  return { storage: context.window.RemoteStorage, localStorage, warning, values };
}

test("HTTP 409 preserva servidor e alteracao local sem reenvio automatico", async () => {
  const calls = [];
  const { storage } = harness(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (calls.length === 1) return response(409, { currentVersion: 2 });
    return response(200, { modified: true, revision: 8, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 2 } });
  });
  storage.online = true;
  storage.serverStateLoaded = true;
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
  storage.serverStateLoaded = true;
  storage.versions.set("hrn_ops", 1);
  storage.setItem("hrn_ops", JSON.stringify([{ id: "antigo" }]));
  storage.setItem("hrn_ops", JSON.stringify([{ id: "mais-recente" }]));
  await storage.writeQueues.get("hrn_ops");
  assert.deepEqual(calls.map(call => call.method), ["PUT", "GET"]);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.getConflict("hrn_ops").value)), [{ id: "mais-recente" }]);
});

test("gravacoes locais sequenciais usam a versao confirmada pela predecessora", async () => {
  const requests = [];
  const { storage } = harness(async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const version = requests.length + 1;
    return response(200, { ok: true, version, revision: version });
  });
  storage.serverStateLoaded = true;
  storage.data.set("hrn_ops", [{ id: "base" }]);
  storage.versions.set("hrn_ops", 1);

  storage.setItem("hrn_ops", JSON.stringify([{ id: "primeiro" }]));
  storage.setItem("hrn_ops", JSON.stringify([{ id: "estado-final" }]));
  await storage.writeQueues.get("hrn_ops");

  assert.deepEqual(requests.map(request => request.expectedVersion), [1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].value)), [{ id: "estado-final" }]);
  assert.equal(storage.versions.get("hrn_ops"), 3);
  assert.equal(storage.pendingWrites.has("hrn_ops"), false);
  assert.equal(storage.getConflict("hrn_ops"), null);
});

test("descartar conflito restaura o snapshot confirmado mais recente do servidor", async () => {
  const calls = [];
  const { storage, localStorage } = harness(async (_url, options = {}) => {
    calls.push(options.method || "GET");
    if (calls.length === 1) return response(409, { currentVersion: 2 });
    if (calls.length === 2) return response(200, {
      modified: true, revision: 8, data: { hrn_ops: [{ id: "servidor-conflito" }] }, versions: { hrn_ops: 2 }
    });
    return response(200, {
      modified: true, revision: 9, data: { hrn_ops: [{ id: "servidor-confirmado" }] }, versions: { hrn_ops: 3 }
    });
  });
  storage.serverStateLoaded = true;
  storage.data.set("hrn_ops", [{ id: "base" }]);
  storage.versions.set("hrn_ops", 1);
  storage.setItem("hrn_ops", JSON.stringify([{ id: "local-obsoleto" }]));
  await storage.writeQueues.get("hrn_ops");

  storage.data.set("hrn_ops", [{ id: "local-obsoleto" }]);
  localStorage.setItem("hrn_ops", JSON.stringify([{ id: "local-obsoleto" }]));
  assert.equal(await storage.discardConflict("hrn_ops"), true);

  assert.deepEqual(calls, ["PUT", "GET", "GET"]);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.data.get("hrn_ops"))), [{ id: "servidor-confirmado" }]);
  assert.deepEqual(JSON.parse(localStorage.getItem("hrn_ops")), [{ id: "servidor-confirmado" }]);
  assert.equal(storage.versions.get("hrn_ops"), 3);
  assert.equal(storage.pendingWrites.has("hrn_ops"), false);
  assert.equal(storage.getConflict("hrn_ops"), null);
});

test("falha de rede mantem gravacao pendente recuperavel no navegador", async () => {
  const { storage, localStorage, warning } = harness(async () => { throw new Error("rede indisponivel"); });
  storage.serverStateLoaded = true;
  storage.data.set("hrn_buchas", []);
  storage.versions.set("hrn_buchas", 1);
  storage.setItem("hrn_buchas", JSON.stringify([{ id: "local" }]));
  await storage.writeQueues.get("hrn_buchas");
  assert.equal(storage.pendingWrites.has("hrn_buchas"), true);
  assert.match(localStorage.getItem("pcp_remote_pending_writes_v2:alice"), /hrn_buchas/);
  assert.match(localStorage.getItem("pcp_remote_pending_writes_v2:alice"), /"baseVersion":1/);
  assert.match(localStorage.getItem("hrn_buchas"), /local/);
  assert.match(warning.textContent, /nao confirmadas/i);
});

test("nova tentativa consciente confirma a pendencia sem alterar automaticamente antes disso", async () => {
  let online = false;
  const { storage } = harness(async () => {
    if (!online) throw new Error("rede indisponivel");
    return response(200, { ok: true, version: 2, revision: 3 });
  });
  storage.serverStateLoaded = true;
  storage.data.set("hrn_pedidos", [{ id: "servidor" }]);
  storage.versions.set("hrn_pedidos", 1);
  storage.setItem("hrn_pedidos", JSON.stringify([{ id: "local" }]));
  await storage.writeQueues.get("hrn_pedidos");
  assert.equal(storage.pendingWrites.has("hrn_pedidos"), true);

  online = true;
  assert.equal(await storage.retryPending("hrn_pedidos", { confirmed: true }), true);
  assert.equal(storage.pendingWrites.has("hrn_pedidos"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.data.get("hrn_pedidos"))), [{ id: "local" }]);
  assert.equal(storage.versions.get("hrn_pedidos"), 2);
});

test("offline, alteracao de outro usuario e refresh preservam servidor e versao-base", async () => {
  const sharedValues = new Map();
  const first = harness(async () => { throw new Error("offline"); }, { values: sharedValues, username: "alice" });
  first.storage.serverStateLoaded = true;
  first.storage.data.set("hrn_ops", [{ id: "base" }]);
  first.storage.versions.set("hrn_ops", 1);
  first.storage.setItem("hrn_ops", JSON.stringify([{ id: "alice-offline" }]));
  await first.storage.writeQueues.get("hrn_ops");

  const calls = [];
  const refreshed = harness(async (url, options = {}) => {
    calls.push({ method: options.method || "GET", body: options.body });
    return response(200, {
      modified: true,
      revision: 12,
      data: { hrn_ops: [{ id: "bob-no-servidor" }] },
      versions: { hrn_ops: 2 }
    });
  }, { values: sharedValues, username: "alice" });

  await refreshed.storage.init();
  const pending = refreshed.storage.pendingWrites.get("hrn_ops");
  assert.equal(pending.baseVersion, 1);
  assert.equal(pending.ownerUser, "alice");
  assert.equal(refreshed.storage.getConflict("hrn_ops").reason, "SERVER_VERSION_CHANGED");
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.storage.data.get("hrn_ops"))), [{ id: "bob-no-servidor" }]);
  assert.match(refreshed.warning.textContent, /pode substituir alteracoes de outros funcionarios/i);

  assert.equal(await refreshed.storage.retryPending("hrn_ops"), false);
  assert.deepEqual(calls.map(call => call.method), ["GET"]);
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.storage.data.get("hrn_ops"))), [{ id: "bob-no-servidor" }]);
});

test("versao-base desconhecida falha fechada sem presumir versao atual", async () => {
  const values = new Map([[
    "pcp_remote_pending_writes_v2:alice",
    JSON.stringify([{ key: "hrn_ops", method: "PUT", value: [{ id: "legado" }], ownerUser: "alice", writeId: 7 }])
  ]]);
  const calls = [];
  const { storage } = harness(async (_url, options = {}) => {
    calls.push(options.method || "GET");
    return response(200, { modified: true, revision: 2, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 4 } });
  }, { values, username: "alice" });

  await storage.init();
  assert.equal(storage.pendingWrites.get("hrn_ops").baseVersion, null);
  assert.equal(storage.getConflict("hrn_ops").reason, "BASE_VERSION_UNKNOWN");
  assert.equal(await storage.retryPending("hrn_ops"), false);
  assert.deepEqual(calls, ["GET"]);
});

test("pendencia restaurada na mesma versao avisa que nao ha gravacao em andamento", async () => {
  const values = new Map([[
    "pcp_remote_pending_writes_v2:alice",
    JSON.stringify([{ key: "hrn_ops", method: "PUT", value: [{ id: "local" }], baseVersion: 3, ownerUser: "alice", writeId: 9 }])
  ]]);
  const calls = [];
  const { storage, warning } = harness(async (_url, options = {}) => {
    calls.push(options.method || "GET");
    return response(200, { modified: true, revision: 7, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 3 } });
  }, { values, username: "alice" });

  await storage.init();
  assert.equal(storage.getConflict("hrn_ops"), null);
  assert.match(warning.textContent, /nada esta sendo salvo agora/i);
  assert.doesNotMatch(warning.textContent, /salvando alteracoes/i);
  assert.deepEqual(calls, ["GET"]);
});

test("pendencias ficam isoladas por usuario autenticado no mesmo navegador", async () => {
  const values = new Map([[
    "pcp_remote_pending_writes_v2:alice",
    JSON.stringify([{ key: "hrn_ops", method: "PUT", value: [{ id: "alice" }], baseVersion: 1, ownerUser: "alice", writeId: 2 }])
  ]]);
  const { storage } = harness(async () => response(200, {
    modified: true, revision: 2, data: { hrn_ops: [{ id: "servidor" }] }, versions: { hrn_ops: 1 }
  }), { values, username: "bob" });

  await storage.init();
  assert.equal(storage.pendingWrites.size, 0);
  assert.equal(await storage.retryPending("hrn_ops", { confirmed: true }), false);
});
