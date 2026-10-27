import assert from "node:assert/strict";
import test from "node:test";

import { deleteStatePostgres, upsertStatePostgres } from "../../server/database.js";

class AtomicStateClient {
  constructor(entries = []) {
    this.state = new Map(entries.map(([key, value, version]) => [key, { value, version }]));
    this.revision = 0;
    this.audit = [];
  }

  async query(statement, params = []) {
    const sql = statement.replace(/\s+/g, " ").trim();
    if (sql.startsWith("INSERT INTO app_state") && sql.includes("ON CONFLICT")) {
      const [key, value] = params;
      if (this.state.has(key)) return { rowCount: 0, rows: [] };
      this.state.set(key, { value, version: 1 });
      return { rowCount: 1, rows: [{ version: 1 }] };
    }
    if (sql.startsWith("UPDATE app_state") && sql.includes("AND version = $4")) {
      const [value, , key, expected] = params;
      const current = this.state.get(key);
      if (!current || current.version !== expected) return { rowCount: 0, rows: [] };
      current.value = value;
      current.version += 1;
      return { rowCount: 1, rows: [{ version: current.version }] };
    }
    if (sql.startsWith("DELETE FROM app_state") && sql.includes("version = $2")) {
      const [key, expected] = params;
      const current = this.state.get(key);
      if (!current || current.version !== expected) return { rowCount: 0, rows: [] };
      this.state.delete(key);
      return { rowCount: 1, rows: [{ version: current.version }] };
    }
    if (sql === "SELECT version FROM app_state WHERE key = $1") {
      const current = this.state.get(params[0]);
      return { rowCount: current ? 1 : 0, rows: current ? [{ version: current.version }] : [] };
    }
    if (sql.startsWith("UPDATE app_revision") && sql.includes("RETURNING revision")) {
      this.revision += 1;
      return { rowCount: 1, rows: [{ revision: this.revision }] };
    }
    if (sql === "SELECT revision FROM app_revision WHERE singleton = $1") {
      return { rowCount: 1, rows: [{ revision: this.revision }] };
    }
    if (sql.startsWith("INSERT INTO audit_log")) {
      this.audit.push({ key: params[0], action: params[1], version: params[2], actor: params[3] });
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`SQL inesperado no teste: ${sql}`);
  }
}

function assertConflict(result, currentVersion) {
  assert.equal(result.status, "rejected");
  assert.equal(result.reason.status, 409);
  assert.equal(result.reason.currentVersion, currentVersion);
}

test("duas atualizacoes simultaneas em chave generica permitida confirmam somente uma", async () => {
  const client = new AtomicStateClient([["hrn_pedidos", "[]", 1]]);
  const results = await Promise.allSettled([
    upsertStatePostgres(client, "hrn_pedidos", [{ id: "A" }], 1, "alice"),
    upsertStatePostgres(client, "hrn_pedidos", [{ id: "B" }], 1, "bob")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assertConflict(results.find(result => result.status === "rejected"), 2);
  assert.equal(client.state.get("hrn_pedidos").version, 2);
  assert.equal(client.revision, 1);
  assert.equal(client.audit.length, 1);
});

test("snapshots diferentes em chave generica permitida nao sobrescrevem o confirmado", async () => {
  const client = new AtomicStateClient([["hrn_manutencoes", "[]", 4]]);
  await upsertStatePostgres(client, "hrn_manutencoes", [{ id: "novo" }], 4, "alice");
  await assert.rejects(
    upsertStatePostgres(client, "hrn_manutencoes", [{ id: "obsoleto" }], 4, "bob"),
    error => error.status === 409 && error.currentVersion === 5
  );
  assert.match(client.state.get("hrn_manutencoes").value, /novo/);
  assert.doesNotMatch(client.state.get("hrn_manutencoes").value, /obsoleto/);
  assert.equal(client.revision, 1);
  assert.equal(client.audit.length, 1);
});

test("insercao concorrente de chave inexistente aceita somente um criador", async () => {
  const client = new AtomicStateClient();
  const results = await Promise.allSettled([
    upsertStatePostgres(client, "hrn_pedidos", [{ id: "A" }], 0, "alice"),
    upsertStatePostgres(client, "hrn_pedidos", [{ id: "B" }], 0, "bob")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assertConflict(results.find(result => result.status === "rejected"), 1);
  assert.equal(client.revision, 1);
  assert.equal(client.audit.length, 1);
});

test("exclusao concorrente confirma uma vez e nao duplica revisao ou auditoria", async () => {
  const client = new AtomicStateClient([["hrn_prod_comp_entradas", "[]", 3]]);
  const results = await Promise.allSettled([
    deleteStatePostgres(client, "hrn_prod_comp_entradas", 3, "alice"),
    deleteStatePostgres(client, "hrn_prod_comp_entradas", 3, "bob")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assertConflict(results.find(result => result.status === "rejected"), 0);
  assert.equal(client.state.has("hrn_atividades"), false);
  assert.equal(client.revision, 1);
  assert.deepEqual(client.audit.map(item => item.action), ["DELETE"]);
});

test("excluir chave inexistente na versao zero e idempotente", async () => {
  const client = new AtomicStateClient();
  assert.deepEqual(await deleteStatePostgres(client, "hrn_prod_comp_entradas", 0, "alice"), { revision: 0 });
  assert.equal(client.revision, 0);
  assert.equal(client.audit.length, 0);
});
