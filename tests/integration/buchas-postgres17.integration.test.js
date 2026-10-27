import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase, importState, withConnection } from "../../server/database.js";
import { startServer, stopServer } from "../../server/index.js";

const url = process.env.DATABASE_URL;
if (!/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(url || "")) throw new Error("Banco descartavel esperado nao configurado.");
await withConnection(client => migrate({ client, directory: new URL("../../database/migrations", import.meta.url).pathname, operator: "buchas.integration" }));
await importState([["hrn_buchas", [{ id: "bch-test", sku: "BH TESTE 001", descricao: "Bucha de integracao" }]]], "buchas.integration");
execFileSync("node", ["scripts/auth/bootstrap-admin.js"], { stdio: "inherit", env: { ...process.env, INITIAL_ADMIN_USERNAME: process.env.INVENTORY_TEST_USER, INITIAL_ADMIN_PASSWORD: process.env.INVENTORY_TEST_PASSWORD } });
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "", csrf = "";
const headers = () => ({ "content-type": "application/json", "x-hrn-proxy-secret": process.env.PROXY_SHARED_SECRET, cookie, "x-csrf-token": csrf });
async function login() {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: headers(), body: JSON.stringify({ username: process.env.INVENTORY_TEST_USER, password: process.env.INVENTORY_TEST_PASSWORD }) });
  const body = await response.json(); assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie").split(";")[0]; csrf = body.csrfToken;
  const changed = await fetch(`${base}/api/auth/change-password`, { method: "POST", headers: headers(), body: JSON.stringify({ currentPassword: process.env.INVENTORY_TEST_PASSWORD, newPassword: "Buchas-Changed-456" }) });
  const changedBody = await changed.json(); assert.equal(changed.status, 200);
  cookie = changed.headers.get("set-cookie").split(";")[0]; csrf = changedBody.csrfToken;
}
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}/api/buchas${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  return [response, await response.json()];
}
async function state(key) {
  const result = await withConnection(client => client.query("SELECT value, version FROM app_state WHERE key = $1", [key]));
  return result.rows[0] ? { value: JSON.parse(result.rows[0].value), version: Number(result.rows[0].version) } : { value: [], version: 0 };
}
async function createEntry(quantity, eventKey) {
  const catalog = await state("hrn_buchas"); const entries = await state("hrn_buchas_entradas");
  const [response, body] = await api("/entries", "POST", { data: { sku: "BH TESTE 001", quantidade: quantity, etapaInicial: "Usinagem", eventKey }, expectedVersions: { hrn_buchas: catalog.version, hrn_buchas_entradas: entries.version } });
  assert.equal(response.status, 201); return body.entry;
}
async function transition(id, quantity, stage, eventKey, expectedVersion) {
  return api(`/entries/${id}/transition`, "POST", { data: { quantidade: quantity, proximaEtapa: stage, acaoSaldoRestante: "manter", eventKey }, expectedVersions: { hrn_buchas_entradas: expectedVersion } });
}
async function createFinished(quantity, eventKey) {
  const entry = await createEntry(quantity, `${eventKey}-entry`);
  const entries = await state("hrn_buchas_entradas");
  const [response] = await transition(entry.id, quantity, "Estoque Final", `${eventKey}-final`, entries.version);
  assert.equal(response.status, 201); return entry;
}
async function output(quantity, eventKey, expectedVersions) {
  const versions = expectedVersions || { hrn_buchas: (await state("hrn_buchas")).version, hrn_buchas_entradas: (await state("hrn_buchas_entradas")).version, hrn_buchas_saidas: (await state("hrn_buchas_saidas")).version };
  return api("/outputs", "POST", { data: { sku: "BH TESTE 001", quantidade: quantity, destinoObs: "Destino de teste", eventKey }, expectedVersions: versions });
}

test("buchas stock and entries use PostgreSQL transactions through HTTP", async () => {
  await login();
  const before = await state("hrn_buchas_entradas");
  const [read, stock] = await api("/stock");
  assert.equal(read.status, 200); assert.equal(stock.origin, "ERP_INTERNAL_TRANSACTIONS");
  assert.equal(stock.items.find(item => item.sku === "BH TESTE 001").total, 0);
  assert.deepEqual(await state("hrn_buchas_entradas"), before);

  const firstPayload = { data: { sku: "bh teste 001", quantidade: 5, etapaInicial: "Usinagem", origemObs: "Lote teste", eventKey: "bucha-entry-1" }, expectedVersions: { hrn_buchas: 1, hrn_buchas_entradas: 0 } };
  const [created, createdBody] = await api("/entries", "POST", firstPayload);
  assert.equal(created.status, 201); assert.equal(createdBody.entry.quantidade, 5); assert.equal(createdBody.entry.etapaAtual, "Usinagem");
  const persisted = await state("hrn_buchas_entradas"); assert.equal(persisted.value.filter(item => item.eventKey === "bucha-entry-1").length, 1);
  assert.equal(persisted.value[0].historico[0].usuario, process.env.INVENTORY_TEST_USER);

  const [invalid] = await api("/entries", "POST", { data: { sku: "BH TESTE 001", quantidade: 1.5, etapaInicial: "Usinagem", eventKey: "bad-quantity" }, expectedVersions: createdBody.versions });
  assert.equal(invalid.status, 400);
  const [unknown] = await api("/entries", "POST", { data: { sku: "NAO EXISTE", quantidade: 1, etapaInicial: "Usinagem", eventKey: "unknown-sku" }, expectedVersions: createdBody.versions });
  assert.equal(unknown.status, 400);
  assert.equal((await state("hrn_buchas_entradas")).value.length, 1);

  const [repeat, repeatBody] = await api("/entries", "POST", firstPayload);
  assert.equal(repeat.status, 201); assert.equal(repeatBody.duplicate, true);
  assert.equal((await state("hrn_buchas_entradas")).value.filter(item => item.eventKey === "bucha-entry-1").length, 1);
  const [divergent] = await api("/entries", "POST", { data: { ...firstPayload.data, quantidade: 6 }, expectedVersions: firstPayload.expectedVersions });
  assert.equal(divergent.status, 400);
});

test("buchas concurrent entries preserve a single consistent aggregate", async () => {
  const catalog = await state("hrn_buchas"); const entries = await state("hrn_buchas_entradas");
  const request = eventKey => api("/entries", "POST", { data: { sku: "BH TESTE 001", quantidade: 2, etapaInicial: "Vulcanizacao", eventKey }, expectedVersions: { hrn_buchas: catalog.version, hrn_buchas_entradas: entries.version } });
  const results = await Promise.all([request("bucha-concurrent-a"), request("bucha-concurrent-b")]);
  assert.equal(results.filter(([response]) => response.status === 201).length, 1);
  assert.equal(results.filter(([response]) => response.status === 409).length, 1);
  const persisted = await state("hrn_buchas_entradas");
  assert.equal(persisted.value.filter(item => /^bucha-concurrent-/.test(item.eventKey)).length, 1);
  const [read, stock] = await api("/stock"); assert.equal(read.status, 200);
  assert.equal(stock.items.find(item => item.sku === "BH TESTE 001").total, 7);
});

test("buchas transitions preserve partial lots, history and idempotency", async () => {
  const full = await createEntry(10, "transition-full-source");
  let entries = await state("hrn_buchas_entradas");
  let [response, body] = await transition(full.id, 10, "Retrabalho", "transition-full", entries.version);
  assert.equal(response.status, 201); assert.equal(body.entry.etapaAtual, "Retrabalho"); assert.equal(body.entry.quantidade, 10);
  entries = await state("hrn_buchas_entradas");
  [response, body] = await transition(full.id, 10, "Estoque Final", "transition-full-final", entries.version);
  assert.equal(response.status, 201); assert.equal(body.entry.status, "Concluido");
  const [, finalStock] = await api("/stock"); assert.equal(finalStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal, 10);

  const partial = await createEntry(10, "transition-partial-source");
  entries = await state("hrn_buchas_entradas");
  [response, body] = await transition(partial.id, 4, "Retrabalho", "transition-partial", entries.version);
  assert.equal(response.status, 201); assert.equal(body.entry.quantidade, 4);
  let persisted = await state("hrn_buchas_entradas");
  let remainder = persisted.value.find(item => item.parentEntryId === partial.id);
  assert.equal(remainder.quantidade, 6); assert.equal(remainder.etapaAtual, "Usinagem");
  assert.equal(persisted.value.filter(item => item.id === partial.id || item.loteOrigemId === partial.id).reduce((sum, item) => sum + item.quantidade, 0), 10);

  entries = await state("hrn_buchas_entradas");
  [response] = await transition(remainder.id, 2, "Retrabalho", "transition-partial-second", entries.version);
  assert.equal(response.status, 201);
  persisted = await state("hrn_buchas_entradas");
  const secondRemainder = persisted.value.find(item => item.parentEntryId === remainder.id);
  assert.equal(secondRemainder.quantidade, 4); assert.notEqual(secondRemainder.codigoEntrada, remainder.codigoEntrada);
  assert.equal(persisted.value.filter(item => item.id === partial.id || item.loteOrigemId === partial.id).reduce((sum, item) => sum + item.quantidade, 0), 10);

  entries = await state("hrn_buchas_entradas");
  const repeatPayload = { data: { quantidade: 4, proximaEtapa: "Vulcanizacao", acaoSaldoRestante: "manter", eventKey: "transition-repeat" }, expectedVersions: { hrn_buchas_entradas: entries.version } };
  [response] = await api(`/entries/${secondRemainder.id}/transition`, "POST", repeatPayload); assert.equal(response.status, 201);
  const afterFirst = await state("hrn_buchas_entradas");
  const [repeat, repeatBody] = await api(`/entries/${secondRemainder.id}/transition`, "POST", repeatPayload);
  assert.equal(repeat.status, 201); assert.equal(repeatBody.duplicate, true); assert.deepEqual(await state("hrn_buchas_entradas"), afterFirst);
  const [divergent] = await api(`/entries/${secondRemainder.id}/transition`, "POST", { data: { ...repeatPayload.data, quantidade: 3 }, expectedVersions: repeatPayload.expectedVersions }); assert.equal(divergent.status, 400);
  const audit = await withConnection(client => client.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'BCH_ENTRY_MOVE'"));
  assert.ok(audit.rows[0].count >= 4);
  assert.ok((await state("hrn_buchas_entradas")).value.find(item => item.id === partial.id).historico.length >= 2);
});

test("buchas transitions reject invalid input, serialize concurrency and rollback PostgreSQL", async () => {
  const source = await createEntry(5, "transition-invalid-source");
  let entries = await state("hrn_buchas_entradas");
  for (const [quantity, stage, eventKey] of [[6, "Retrabalho", "too-many"], [0, "Retrabalho", "zero"], [-1, "Retrabalho", "negative"], [1, "Invalida", "bad-stage"]]) {
    const [response] = await transition(source.id, quantity, stage, eventKey, entries.version); assert.equal(response.status, 400);
  }
  const concurrentVersion = (await state("hrn_buchas_entradas")).version;
  const concurrent = await Promise.all([transition(source.id, 3, "Retrabalho", "transition-concurrent-a", concurrentVersion), transition(source.id, 3, "Retrabalho", "transition-concurrent-b", concurrentVersion)]);
  assert.equal(concurrent.filter(([response]) => response.status === 201).length, 1); assert.equal(concurrent.filter(([response]) => response.status === 409).length, 1);
  const postConcurrent = await state("hrn_buchas_entradas");
  assert.equal(postConcurrent.value.filter(item => item.id === source.id || item.loteOrigemId === source.id).reduce((sum, item) => sum + item.quantidade, 0), 5);

  const rollbackSource = await createEntry(3, "transition-rollback-source");
  const before = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key = 'hrn_buchas_entradas'"));
  const beforeRevision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision"));
  const beforeAudit = await withConnection(client => client.query("SELECT count(*)::int AS count FROM audit_log"));
  await withConnection(client => client.query("CREATE FUNCTION buchas_transition_rollback_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'BCH_ENTRY_MOVE' THEN RAISE EXCEPTION 'buchas transition rollback test'; END IF; RETURN NEW; END; $$; CREATE TRIGGER buchas_transition_rollback_test_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION buchas_transition_rollback_test();"));
  try {
    const [response] = await transition(rollbackSource.id, 3, "Retrabalho", "transition-rollback-fail", (await state("hrn_buchas_entradas")).version); assert.equal(response.status, 500);
  } finally {
    await withConnection(client => client.query("DROP TRIGGER IF EXISTS buchas_transition_rollback_test_trigger ON audit_log; DROP FUNCTION IF EXISTS buchas_transition_rollback_test();"));
  }
  const after = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key = 'hrn_buchas_entradas'"));
  const afterRevision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision"));
  const afterAudit = await withConnection(client => client.query("SELECT count(*)::int AS count FROM audit_log"));
  assert.deepEqual(after.rows, before.rows); assert.deepEqual(afterRevision.rows, beforeRevision.rows); assert.deepEqual(afterAudit.rows, beforeAudit.rows);
  const [recovered] = await transition(rollbackSource.id, 3, "Retrabalho", "transition-rollback-ok", (await state("hrn_buchas_entradas")).version); assert.equal(recovered.status, 201);
});

test("buchas outputs are transactional, idempotent and preserve final lots", async () => {
  await createFinished(12, "output-source");
  const beforeEntries = await state("hrn_buchas_entradas");
  const [, beforeStock] = await api("/stock");
  const beforeAvailable = beforeStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal;
  const versions = { hrn_buchas: (await state("hrn_buchas")).version, hrn_buchas_entradas: beforeEntries.version, hrn_buchas_saidas: (await state("hrn_buchas_saidas")).version };
  const payload = { data: { sku: "BH TESTE 001", quantidade: 3, destinoObs: "Destino de teste", eventKey: "output-valid" }, expectedVersions: versions };
  let [response, body] = await api("/outputs", "POST", payload);
  assert.equal(response.status, 201); assert.equal(body.output.quantidade, 3); assert.equal(body.output.historico[0].usuario, process.env.INVENTORY_TEST_USER);
  const afterOutput = await state("hrn_buchas_saidas"); assert.equal(afterOutput.value.filter(item => item.eventKey === "output-valid").length, 1);
  assert.deepEqual(await state("hrn_buchas_entradas"), beforeEntries);
  const [, afterStock] = await api("/stock"); assert.equal(afterStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal, beforeAvailable - 3);

  const [repeat, repeated] = await api("/outputs", "POST", payload); assert.equal(repeat.status, 201); assert.equal(repeated.duplicate, true);
  assert.equal((await state("hrn_buchas_saidas")).value.filter(item => item.eventKey === "output-valid").length, 1);
  const [divergent] = await api("/outputs", "POST", { data: { ...payload.data, quantidade: 2 }, expectedVersions: versions }); assert.equal(divergent.status, 400);
  for (const quantity of [0, -1, 1.5]) { const [invalid] = await output(quantity, `output-invalid-${quantity}`); assert.equal(invalid.status, 400); }
  const [unknown] = await api("/outputs", "POST", { data: { sku: "NAO EXISTE", quantidade: 1, eventKey: "output-unknown" }, expectedVersions: { hrn_buchas: (await state("hrn_buchas")).version, hrn_buchas_entradas: (await state("hrn_buchas_entradas")).version, hrn_buchas_saidas: (await state("hrn_buchas_saidas")).version } }); assert.equal(unknown.status, 400);
  const [, availableStock] = await api("/stock"); const available = availableStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal;
  const [insufficient] = await output(available + 1, "output-insufficient"); assert.equal(insufficient.status, 409);

  const stale = { hrn_buchas: (await state("hrn_buchas")).version, hrn_buchas_entradas: (await state("hrn_buchas_entradas")).version, hrn_buchas_saidas: (await state("hrn_buchas_saidas")).version };
  [response] = await output(1, "output-version-bump", stale); assert.equal(response.status, 201);
  const [staleResponse] = await output(1, "output-stale", stale); assert.equal(staleResponse.status, 409);
  const [, concurrentStock] = await api("/stock"); const concurrentQuantity = concurrentStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal;
  const concurrentVersions = { hrn_buchas: (await state("hrn_buchas")).version, hrn_buchas_entradas: (await state("hrn_buchas_entradas")).version, hrn_buchas_saidas: (await state("hrn_buchas_saidas")).version };
  const concurrent = await Promise.all([output(concurrentQuantity, "output-concurrent-a", concurrentVersions), output(concurrentQuantity, "output-concurrent-b", concurrentVersions)]);
  assert.equal(concurrent.filter(([item]) => item.status === 201).length, 1); assert.equal(concurrent.filter(([item]) => item.status === 409).length, 1);
  const [, zeroStock] = await api("/stock"); assert.equal(zeroStock.items.find(item => item.sku === "BH TESTE 001").estoqueFinal, 0);
});

test("buchas output rolls back PostgreSQL state after an intermediate write failure", async () => {
  await createFinished(2, "output-rollback-source");
  const before = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_buchas_entradas', 'hrn_buchas_saidas') ORDER BY key"));
  const revision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision"));
  const audit = await withConnection(client => client.query("SELECT count(*)::int AS count FROM audit_log"));
  await withConnection(client => client.query("CREATE FUNCTION buchas_output_rollback_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'BCH_OUT_CREATE' THEN RAISE EXCEPTION 'buchas output rollback test'; END IF; RETURN NEW; END; $$; CREATE TRIGGER buchas_output_rollback_test_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION buchas_output_rollback_test();"));
  try {
    const [response] = await output(1, "output-rollback-fail"); assert.equal(response.status, 500);
  } finally {
    await withConnection(client => client.query("DROP TRIGGER IF EXISTS buchas_output_rollback_test_trigger ON audit_log; DROP FUNCTION IF EXISTS buchas_output_rollback_test();"));
  }
  const after = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_buchas_entradas', 'hrn_buchas_saidas') ORDER BY key"));
  const afterRevision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision"));
  const afterAudit = await withConnection(client => client.query("SELECT count(*)::int AS count FROM audit_log"));
  assert.deepEqual(after.rows, before.rows); assert.deepEqual(afterRevision.rows, revision.rows); assert.deepEqual(afterAudit.rows, audit.rows);
  const [recovered] = await output(1, "output-rollback-ok"); assert.equal(recovered.status, 201);
});

test("buchas reconciles legacy records without rewriting history", async () => {
  const legacyCatalog = [{ id: "legacy-ok", sku: "BH LEG", descricao: "Legada" }, { id: "legacy-dup", sku: "BH DUP", descricao: "Duplicada" }, { id: "legacy-over", sku: "BH OVER", descricao: "Com deficit" }, { id: "legacy-bad", sku: "BH BAD", descricao: "Etapa ruim" }];
  const legacyEntries = [
    { id: "ent-final", codigoEntrada: "ENT-BCH-000010", sku: "BH LEG", descricao: "Legada", quantidade: 10, etapaAtual: "Usinagem", status: "Concluido", dataCriacao: "2025-01-01T00:00:00.000Z", historico: [{ data: "2025-01-01", acao: "formato antigo" }] },
    { id: "ent-ret", codigoEntrada: "ENT-BCH-000011", sku: "BH LEG", quantidade: 3, etapaAtual: "Retrabalho", status: "Em Andamento" },
    { id: "ent-vul", codigoEntrada: "ENT-BCH-000012", sku: "BH LEG", quantidade: 2, etapaAtual: "Vulcanizacao", status: "Em Andamento" },
    { id: "ent-dup-a", codigoEntrada: "ENT-DUP", sku: "BH DUP", quantidade: 1, etapaAtual: "Usinagem", status: "Em Andamento" },
    { id: "ent-dup-b", codigoEntrada: "ENT-DUP", sku: "BH DUP", quantidade: 1, etapaAtual: "Retrabalho", status: "Em Andamento" },
    { id: "ent-over", codigoEntrada: "ENT-BCH-000013", sku: "BH OVER", quantidade: 2, etapaAtual: "Estoque Final", status: "Concluido" },
    { id: "ent-bad", codigoEntrada: "ENT-BCH-000014", sku: "BH BAD", quantidade: 1, etapaAtual: "Etapa Antiga", status: "Em Andamento" },
    { id: "ent-missing", codigoEntrada: "ENT-BCH-000015", sku: "BH AUSENTE", quantidade: 1, etapaAtual: "Usinagem", status: "Em Andamento" }
  ];
  const legacyOutputs = [{ id: "out-legacy", codigoSaida: "SAI-BCH-000010", sku: "BH LEG", quantidade: 4, dataSaida: "2025-01-02T00:00:00.000Z" }, { id: "out-over", codigoSaida: "SAI-BCH-000011", sku: "BH OVER", quantidade: 3 }];
  const legacyOps = [{ id: "op-known-link", entradaId: "ent-ret", sku: "BH OUTRO", quantity: 4 }];
  await importState([["hrn_buchas", legacyCatalog], ["hrn_buchas_entradas", legacyEntries], ["hrn_buchas_saidas", legacyOutputs], ["hrn_buchas_ops", legacyOps]], "buchas.legacy.fixture");
  const before = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_buchas','hrn_buchas_entradas','hrn_buchas_saidas','hrn_buchas_ops') ORDER BY key"));
  const [response, stock] = await api("/stock"); assert.equal(response.status, 200);
  const legacy = stock.items.find(item => item.sku === "BH LEG");
  assert.deepEqual({ usinagem: legacy.usinagem, retrabalho: legacy.retrabalho, vulcanizacao: legacy.vulcanizacao, estoqueFinal: legacy.estoqueFinal, total: legacy.total }, { usinagem: 0, retrabalho: 3, vulcanizacao: 2, estoqueFinal: 6, total: 11 });
  for (const code of ["BUCHA_FINISHED_NEGATIVE", "BUCHA_OUTPUT_EXCEEDS_FINISHED", "BUCHA_SKU_NOT_IN_CATALOG", "BUCHA_ENTRY_STAGE_UNKNOWN", "BUCHA_ENTRY_CODE_DUPLICATE", "BUCHA_OP_ENTRY_DIVERGENCE"]) assert.equal(stock.inconsistencies.some(issue => issue.code === code && issue.severity === "error"), true);
  assert.equal(stock.entries.find(entry => entry.id === "ent-final").historico[0].acao, "formato antigo");
  const after = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_buchas','hrn_buchas_entradas','hrn_buchas_saidas','hrn_buchas_ops') ORDER BY key"));
  assert.deepEqual(after.rows, before.rows);
});

test.after(async () => { await stopServer(server); await closeDatabase(); });
