import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase, deleteState, importState, upsertState, withConnection } from "../../server/database.js";
import { startServer, stopServer } from "../../server/index.js";

if (!/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(process.env.DATABASE_URL || "")) throw new Error("Banco descartavel esperado nao configurado.");
await withConnection(client => migrate({ client, directory: new URL("../../database/migrations", import.meta.url).pathname, operator: "tracking.integration" }));
await importState([["hrn_ops", [{ id: "manual-op", numero: "OP-9000", modelo: "Manual", qty: 4, cliente: "Cliente real", rawStockConsumed: true, rawCode: "RAW-1" }, { id: "conflict-op", numero: "OP-9001", modelo: "Manual", trackingSourceId: "manual-source" }]], ["hrn_pecas", []], ["hrn_materiais", [{ id: "raw-1", nome: "RAW-1", categoria: "Peca Bruta", rawCode: "RAW-1", saldo: 9 }]], ["hrn_movimentos", [{ id: "physical-history" }]], ["hrn_buchas_entradas", [{ id: "bucha-history", quantidade: 3 }]]], "tracking.fixture");
execFileSync("node", ["scripts/auth/bootstrap-admin.js"], { stdio: "inherit", env: { ...process.env, INITIAL_ADMIN_USERNAME: process.env.INVENTORY_TEST_USER, INITIAL_ADMIN_PASSWORD: process.env.INVENTORY_TEST_PASSWORD } });
const server = await startServer(); const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "", csrf = "";
const headers = () => ({ "content-type": "application/json", "x-hrn-proxy-secret": process.env.PROXY_SHARED_SECRET, cookie, "x-csrf-token": csrf });
async function login() { const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: headers(), body: JSON.stringify({ username: process.env.INVENTORY_TEST_USER, password: process.env.INVENTORY_TEST_PASSWORD }) }); const b = await r.json(); assert.equal(r.status, 200); cookie = r.headers.get("set-cookie").split(";")[0]; csrf = b.csrfToken; const c = await fetch(`${base}/api/auth/change-password`, { method: "POST", headers: headers(), body: JSON.stringify({ currentPassword: process.env.INVENTORY_TEST_PASSWORD, newPassword: "Tracking-Changed-456" }) }); const cb = await c.json(); assert.equal(c.status, 200); cookie = c.headers.get("set-cookie").split(";")[0]; csrf = cb.csrfToken; }
async function state(key) { const result = await withConnection(client => client.query("SELECT value, version FROM app_state WHERE key = $1", [key])); return result.rows[0] ? { value: JSON.parse(result.rows[0].value), version: Number(result.rows[0].version) } : { value: [], version: 0 }; }
async function api(data, expectedVersions) { const r = await fetch(`${base}/api/production-tracking/reconcile`, { method: "POST", headers: headers(), body: JSON.stringify({ data, expectedVersions }) }); return [r, await r.json()]; }
const physical = () => withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_materiais','hrn_movimentos','hrn_buchas_entradas') ORDER BY key"));
const policyState = () => withConnection(async client => ({
  states: (await client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_materiais','hrn_movimentos','hrn_buchas_entradas','hrn_buchas_saidas','hrn_buchas_ops','hrn_ops','hrn_pecas','hrn_fundicoes','hrn_config') ORDER BY key")).rows,
  audit: (await client.query("SELECT id, state_key, action, version, actor FROM audit_log ORDER BY id")).rows,
  revision: (await client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision")).rows
}));
const record = overrides => ({ sourceId: "sheet-lot-1", externalLotId: "LOTE-EXTERNO-1", sku: "SKU-1", modelo: "Modelo 1", codigoBruto: "RAW-1", quantidade: 5, localizacao: "Usinagem", operacao: "04", sourceRef: "A2", importId: "import-1", ...overrides });

test("production tracking reconciles imported lots without physical stock effects", async () => {
  await login(); const beforePhysical = await physical();
  const expected = { hrn_ops: (await state("hrn_ops")).version, hrn_pecas: (await state("hrn_pecas")).version, hrn_tracking_reconcile_events: 0 };
  let [response, body] = await api({ eventKey: "tracking-create", records: [record()] }, expected); assert.equal(response.status, 201); assert.equal(body.created.length, 1);
  let ops = await state("hrn_ops"), pieces = await state("hrn_pecas"); const imported = pieces.value.find(item => item.trackingSourceId === "sheet-lot-1"); assert.equal(imported.origin, "tracking_import"); assert.equal(ops.value.find(item => item.id === imported.opId).rawStockConsumed, undefined); assert.equal(ops.value.find(item => item.id === "manual-op").numero, "OP-9000");
  assert.deepEqual((await physical()).rows, beforePhysical.rows);
  const reimportVersions = { hrn_ops: ops.version, hrn_pecas: pieces.version, hrn_tracking_reconcile_events: (await state("hrn_tracking_reconcile_events")).version };
  [response, body] = await api({ eventKey: "tracking-reimport", records: [record()] }, reimportVersions); assert.equal(response.status, 201); assert.equal(body.unchanged.length, 1); assert.equal((await state("hrn_pecas")).value.filter(item => item.trackingSourceId === "sheet-lot-1").length, 1);
  ops = await state("hrn_ops"); pieces = await state("hrn_pecas"); const updateVersions = { hrn_ops: ops.version, hrn_pecas: pieces.version, hrn_tracking_reconcile_events: (await state("hrn_tracking_reconcile_events")).version };
  [response, body] = await api({ eventKey: "tracking-update", records: [record({ quantidade: 7, operacao: "05", localizacao: "Pintura" })] }, updateVersions); assert.equal(response.status, 201); assert.equal(body.updated.length, 1); const updated = (await state("hrn_pecas")).value.find(item => item.trackingSourceId === "sheet-lot-1"); assert.equal(updated.id, imported.id); assert.equal(updated.qty, 7); assert.ok(updated.historico.length >= 2); assert.deepEqual((await physical()).rows, beforePhysical.rows);
});

test("production tracking rejects ambiguity, preserves CAS/idempotency and rolls back", async () => {
  const before = await state("hrn_pecas"); const ops = await state("hrn_ops"); const events = await state("hrn_tracking_reconcile_events"); const versions = { hrn_ops: ops.version, hrn_pecas: before.version, hrn_tracking_reconcile_events: events.version };
  let [response] = await api({ eventKey: "tracking-missing-id", records: [record({ sourceId: "", externalLotId: "" })] }, versions); assert.equal(response.status, 400); assert.deepEqual(await state("hrn_pecas"), before);
  [response] = await api({ eventKey: "tracking-origin-conflict", records: [record({ sourceId: "manual-source" })] }, versions); assert.equal(response.status, 409);
  [response] = await api({ eventKey: "tracking-stale", records: [record({ sourceId: "stale-new" })] }, { ...versions, hrn_pecas: 0 }); assert.equal(response.status, 409);
  const concurrent = await Promise.all([api({ eventKey: "tracking-parallel", records: [record({ sourceId: "parallel" })] }, versions), api({ eventKey: "tracking-parallel", records: [record({ sourceId: "parallel" })] }, versions)]); assert.equal(concurrent.filter(([r]) => r.status === 201).length, 2); assert.equal((await state("hrn_pecas")).value.filter(item => item.trackingSourceId === "parallel").length, 1);
  const snapshot = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_ops','hrn_pecas','hrn_tracking_reconcile_events') ORDER BY key")); const revision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision")); const beforePhysical = await physical();
  await withConnection(client => client.query("CREATE FUNCTION tracking_rollback_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'TRK_RECONCILE' THEN RAISE EXCEPTION 'tracking rollback test'; END IF; RETURN NEW; END; $$; CREATE TRIGGER tracking_rollback_test_trigger BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION tracking_rollback_test();"));
  try { [response] = await api({ eventKey: "tracking-rollback", records: [record({ sourceId: "rollback" })] }, { hrn_ops: (await state("hrn_ops")).version, hrn_pecas: (await state("hrn_pecas")).version, hrn_tracking_reconcile_events: (await state("hrn_tracking_reconcile_events")).version }); assert.equal(response.status, 500); } finally { await withConnection(client => client.query("DROP TRIGGER IF EXISTS tracking_rollback_test_trigger ON audit_log; DROP FUNCTION IF EXISTS tracking_rollback_test();")); }
  const after = await withConnection(client => client.query("SELECT key, value, version FROM app_state WHERE key IN ('hrn_ops','hrn_pecas','hrn_tracking_reconcile_events') ORDER BY key")); const afterRevision = await withConnection(client => client.query("SELECT COALESCE((SELECT revision FROM app_revision LIMIT 1),0) AS revision")); assert.deepEqual(after.rows, snapshot.rows); assert.deepEqual(afterRevision.rows, revision.rows); assert.deepEqual((await physical()).rows, beforePhysical.rows);
});

test("generic state writes are rejected over HTTP and below the database API without side effects", async () => {
  const before = await policyState();
  for (const key of ["hrn_materiais", "hrn_movimentos", "hrn_buchas_entradas", "hrn_buchas_saidas", "hrn_buchas_ops", "hrn_ops", "hrn_pecas", "hrn_fundicoes", "hrn_config"]) {
    for (const method of ["PUT", "DELETE"]) {
      const response = await fetch(`${base}/api/state/${key}`, { method, headers: headers(), body: JSON.stringify({ value: [], expectedVersion: 0 }) });
      const body = await response.json();
      assert.equal(response.status, 403, `${method} ${key}`);
      assert.equal(body.code, "GENERIC_STATE_WRITE_FORBIDDEN");
    }
  }
  const get = await fetch(`${base}/api/state`, { headers: headers() });
  assert.equal(get.status, 200);
  await assert.rejects(upsertState("hrn_materiais", [], 0, "tracking.integration"), error => error.status === 403 && error.code === "GENERIC_STATE_WRITE_FORBIDDEN");
  await assert.rejects(deleteState("hrn_pecas", 0, "tracking.integration"), error => error.status === 403 && error.code === "GENERIC_STATE_WRITE_FORBIDDEN");
  assert.deepEqual(await policyState(), before);
});
test.after(async () => { await stopServer(server); await closeDatabase(); });
