import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import express from "express";
import http from "node:http";
import test from "node:test";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase, withConnection } from "../../server/database.js";
import { startServer, stopServer } from "../../server/index.js";
import masterItemsRouter from "../../server/routes/master-items.js";

const url = process.env.DATABASE_URL;
if (!/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(url || "")) throw new Error("Banco descartavel esperado nao configurado.");
await withConnection((client) => migrate({ client, directory: new URL("../../database/migrations", import.meta.url).pathname, operator: "master-item-http.integration" }));
execFileSync("node", ["scripts/auth/bootstrap-admin.js"], { stdio: "inherit", env: { ...process.env, INITIAL_ADMIN_USERNAME: process.env.MASTER_ITEM_TEST_USER, INITIAL_ADMIN_PASSWORD: process.env.MASTER_ITEM_TEST_PASSWORD } });
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "", csrf = "";
const headers = (extra = {}) => ({ "content-type": "application/json", "x-hrn-proxy-secret": process.env.PROXY_SHARED_SECRET, cookie, "x-csrf-token": csrf, ...extra });
async function payload(response) { return response.json().catch(() => ({})); }
async function login() {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: headers(), body: JSON.stringify({ username: process.env.MASTER_ITEM_TEST_USER, password: process.env.MASTER_ITEM_TEST_PASSWORD }) });
  const body = await payload(response); assert.equal(response.status, 200); cookie = response.headers.get("set-cookie").split(";", 1)[0]; csrf = body.csrfToken;
  const changed = await fetch(`${base}/api/auth/change-password`, { method: "POST", headers: headers(), body: JSON.stringify({ currentPassword: process.env.MASTER_ITEM_TEST_PASSWORD, newPassword: "Master-Changed-456" }) });
  const changedBody = await payload(changed); assert.equal(changed.status, 200); cookie = changed.headers.get("set-cookie").split(";", 1)[0]; csrf = changedBody.csrfToken;
}
async function api(path, method = "GET", body, extra) { const response = await fetch(`${base}/api/master-items${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) }); return [response, await payload(response)]; }

test("Item Mestre HTTP autenticado: criar, ler, listar, CAS, SKU e aliases", async () => {
  let [missing] = await api("/", "POST", { data: {}, eventKey: "missing" }); assert.equal(missing.status, 401);
  await login();
  let [csrfFailure] = await api("/", "POST", { data: {}, eventKey: "csrf" }, { "x-csrf-token": "invalido" }); assert.equal(csrfFailure.status, 403);
  let [createdResponse, created] = await api("/", "POST", { data: { primarySku: "00123", family: "helices", description: "Helice zero", unit: "un" }, eventKey: "evt-create" });
  assert.equal(createdResponse.status, 201); assert.equal(created.item.primary_sku, "00123"); const id = created.item.id;
  let [repeatedResponse, repeated] = await api("/", "POST", { data: { primarySku: "00123", family: "helices", description: "Helice zero", unit: "un" }, eventKey: "evt-create" }); assert.equal(repeatedResponse.status, 200); assert.equal(repeated.item.id, id);
  let [divergent] = await api("/", "POST", { data: { primarySku: "00123", family: "helices", description: "Divergente", unit: "un" }, eventKey: "evt-create" }); assert.equal(divergent.status, 409);
  let [one, found] = await api(`/${id}`); assert.equal(one.status, 200); assert.equal(found.item.primary_sku_normalized, "00123");
  let [list, listed] = await api("/?query=00123&family=helices&status=active&page=1&limit=10"); assert.equal(list.status, 200); assert.equal(listed.total, 1);
  let [updatedResponse, updated] = await api(`/${id}`, "PATCH", { data: { primarySku: "00124" }, expectedVersion: 1, eventKey: "evt-update" }); assert.equal(updatedResponse.status, 200); assert.equal(updated.item.version, 2);
  const history = await withConnection((client) => client.query("SELECT old_primary_sku,new_primary_sku,old_version,new_version FROM public.master_item_sku_history WHERE item_id=$1", [id]));
  assert.deepEqual(history.rows[0], { old_primary_sku: "00123", new_primary_sku: "00124", old_version: 1, new_version: 2 });
  let [stale] = await api(`/${id}`, "PATCH", { data: { description: "stale" }, expectedVersion: 1, eventKey: "evt-stale" }); assert.equal(stale.status, 409);
  let [secondResponse, second] = await api("/", "POST", { data: { primarySku: "OUTRO", family: "helices", description: "Outro", unit: "un" }, eventKey: "evt-second" }); assert.equal(secondResponse.status, 201);
  let [duplicate] = await api(`/${second.item.id}`, "PATCH", { data: { primarySku: "00124" }, expectedVersion: 1, eventKey: "evt-duplicate" }); assert.equal(duplicate.status, 409);
  let [aliasResponse, alias] = await api(`/${id}/aliases`, "POST", { data: { namespace: "tiny", originalCode: "  ab-01  " }, eventKey: "evt-alias" }); assert.equal(aliasResponse.status, 201); assert.equal(alias.alias.normalized_code, "AB-01");
  let [collision] = await api(`/${second.item.id}/aliases`, "POST", { data: { namespace: "tiny", originalCode: "AB-01" }, eventKey: "evt-collision" }); assert.equal(collision.status, 409);
  let [resolvedResponse, resolved] = await api("/resolve?namespace=tiny&code=ab-01"); assert.equal(resolvedResponse.status, 200); assert.equal(resolved.item.id, id);
  let [aliasesResponse, aliases] = await api(`/${id}/aliases`); assert.equal(aliasesResponse.status, 200); assert.equal(aliases.aliases.length, 1);
  const beforeReads = await withConnection((client) => client.query("SELECT version FROM public.master_items WHERE id=$1", [id]));
  const beforeAudit = await withConnection((client) => client.query("SELECT count(*)::int n FROM public.audit_log"));
  await api(`/${id}`); await api("/?query=00124&status=active&page=1&limit=10"); await api(`/${id}/aliases`); await api("/resolve?namespace=tiny&code=AB-01");
  assert.deepEqual((await withConnection((client) => client.query("SELECT version FROM public.master_items WHERE id=$1", [id]))).rows, beforeReads.rows);
  assert.equal((await withConnection((client) => client.query("SELECT count(*)::int n FROM public.audit_log"))).rows[0].n, beforeAudit.rows[0].n);
});

test("concorrencia HTTP reutiliza evento e nao toca agregados legados", async () => {
  const body = { data: { primarySku: "CONCORRENTE", family: "buchas", description: "Bucha", unit: "un" }, eventKey: "evt-concurrente" };
  const results = await Promise.all([api("/", "POST", body), api("/", "POST", body)]);
  assert.equal(results.filter(([response]) => [200, 201].includes(response.status)).length, 2); assert.equal(results[0][1].item.id, results[1][1].item.id);
  assert.equal((await withConnection((client) => client.query("SELECT count(*)::int n FROM public.app_state"))).rows[0].n, 0);
  assert.equal((await withConnection((client) => client.query("SELECT count(*)::int n FROM public.helice_production_orders"))).rows[0].n, 0);
});

test("router bloqueia papel nao autorizado sem alterar permissoes persistidas", async (t) => {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { username: "viewer", role: "viewer" }; next(); }); app.use("/api/master-items", masterItemsRouter);
  const isolated = http.createServer(app); await new Promise((resolve) => isolated.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => isolated.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${isolated.address().port}/api/master-items`); assert.equal(response.status, 403); assert.equal((await payload(response)).code, "MASTER_ITEM_FORBIDDEN");
  const otherApp = express(); otherApp.use(express.json()); otherApp.use((req, _res, next) => { req.auth = { username: "other-admin", role: "admin" }; next(); }); otherApp.use("/api/master-items", masterItemsRouter);
  const other = http.createServer(otherApp); await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => other.close(resolve)));
  const forbidden = await fetch(`http://127.0.0.1:${other.address().port}/api/master-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { primarySku: "00123", family: "helices", description: "Helice zero", unit: "un" }, eventKey: "evt-create" }) });
  assert.equal(forbidden.status, 403); assert.equal((await payload(forbidden)).code, "MASTER_ITEM_EVENT_FORBIDDEN");
});

test.after(async () => { await stopServer(server); await closeDatabase(); });
