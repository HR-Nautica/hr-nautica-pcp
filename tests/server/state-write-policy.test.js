import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createStateRouter } from "../../server/routes/state.js";
import { assertGenericStateWriteAllowed, genericStateWriteDecision } from "../../server/state-write-policy.js";

async function withStateServer(run) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use("/api/state", createStateRouter({
    async getStateSnapshot() { calls.push("get"); return { modified: true, revision: 7, data: {}, versions: {} }; },
    async upsertState(...args) { calls.push(["put", ...args]); return { version: 4, revision: 8 }; },
    async deleteState(...args) { calls.push(["delete", ...args]); return { revision: 8 }; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { server.close(); await once(server, "close"); }
}

test("deny-by-default covers protected keys, variants and both write methods before storage", async () => {
  await withStateServer(async (base, calls) => {
    for (const [method, key] of [["PUT", "hrn_ops"], ["DELETE", "hrn_ops"], ["PUT", "hrn_materiais"], ["DELETE", "hrn_materiais"], ["PUT", "hrn_movimentos"], ["DELETE", "hrn_movimentos"], ["PUT", "hrn_fundicoes"], ["DELETE", "hrn_fundicoes"], ["PUT", "hrn_buchas_ops"], ["DELETE", "hrn_buchas_ops"], ["PUT", "hrn_buchas_entradas"], ["DELETE", "hrn_buchas_entradas"], ["PUT", "hrn_buchas_saidas"], ["DELETE", "hrn_buchas_saidas"], ["PUT", "hrn_pecas"], ["DELETE", "hrn_pecas"], ["PUT", "hrn_config"], ["DELETE", "hrn_config"], ["PUT", "hrn_tracking_reconcile_events"], ["DELETE", "hrn_tracking_reconcile_events"], ["PUT", "hrn_seeded_itens_producao_v2"], ["DELETE", "hrn_seeded_itens_producao_v1"], ["PUT", "hrn_movimentos_backup"], ["DELETE", "hrn_buchas_entradas"]]) {
      const response = await fetch(`${base}/api/state/${key}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify({ value: [], expectedVersion: 0 })
      });
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.code, "GENERIC_STATE_WRITE_FORBIDDEN");
    }
    assert.deepEqual(calls, []);
  });
});

test("explicitly allowed catalog, administration and planning writes preserve version arguments", async () => {
  await withStateServer(async (base, calls) => {
    for (const key of ["hrn_modelos", "hrn_pedidos", "hrn_manutencoes", "hrn_atividades", "hrn_buchas", "hrn_fundicao_catalog", "hrn_coquilhas_catalog", "hrn_coquilhas_pesos", "hrn_vini_inativados"]) {
      const put = await fetch(`${base}/api/state/${key}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: [key], expectedVersion: 3 })
      });
      assert.equal(put.status, 200, key);
    }
    const del = await fetch(`${base}/api/state/hrn_prod_comp_entradas`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 4 })
    });
    assert.equal(del.status, 200);
    assert.deepEqual(calls[0].slice(0, 4), ["put", "hrn_modelos", ["hrn_modelos"], 3]);
    assert.deepEqual(calls.at(-1).slice(0, 3), ["delete", "hrn_prod_comp_entradas", 4]);
  });
});

test("policy guard is also enforced below HTTP", () => {
  assert.equal(genericStateWriteDecision("hrn_ops", "PUT").specificApi, "/api/production-ops");
  assert.equal(genericStateWriteDecision("hrn_pecas", "PUT").specificApi, "/api/production-tracking/reconcile");
  assert.equal(genericStateWriteDecision("hrn_materiais", "PUT").specificApi, "/api/inventory/materials");
  assert.throws(() => assertGenericStateWriteAllowed("hrn_ops", "PUT"), { code: "GENERIC_STATE_WRITE_FORBIDDEN", status: 403 });
  assert.doesNotThrow(() => assertGenericStateWriteAllowed("hrn_vini_necessidades", "PUT"));
});

test("generic endpoint preserves reads and validation contract", async () => {
  await withStateServer(async (base, calls) => {
    const get = await fetch(`${base}/api/state/`);
    assert.equal(get.status, 200);
    const invalid = await fetch(`${base}/api/state/not_hrn`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(invalid.status, 400);
    const forbiddenDelete = await fetch(`${base}/api/state/hrn_vini_necessidades`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(forbiddenDelete.status, 403);
    assert.deepEqual(calls, ["get"]);
  });
});
