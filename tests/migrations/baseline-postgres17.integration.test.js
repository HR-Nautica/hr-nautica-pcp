import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";

import { adoptBaseline, BASELINE_CONFIRMATION } from "../../scripts/db/baseline-manager.js";
import { acquireMigrationLock, loadMigrations, migrate, releaseMigrationLock } from "../../scripts/db/migration-runner.js";
import { compareStructure, inspectPublicSchema } from "../../scripts/db/schema-inspector.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString || !/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) {
  throw new Error("A suíte de baseline recusou uma URL não descartável.");
}

const { Client } = pg;
const directory = path.resolve("database", "migrations");
const manifestFile = path.resolve("database", "baseline-structure.json");
const baselineSql = await fs.readFile(path.join(directory, "V001__baseline.sql"), "utf8");
const expected = JSON.parse(await fs.readFile(manifestFile, "utf8"));
let admin;

async function connect() {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function resetPublic() {
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; COMMENT ON SCHEMA public IS 'standard public schema';");
}

async function adoption(client, overrides = {}) {
  return adoptBaseline({
    client, directory, manifestFile, operator: "baseline.integration",
    confirmation: BASELINE_CONFIRMATION, ...overrides
  });
}

before(async () => { admin = await connect(); });
beforeEach(resetPublic);
after(async () => { await admin.end(); });

test("banco vazio recebe V001 e V002 pelo runner", async () => {
  const runner = await connect();
  const result = await migrate({ client: runner, directory, operator: "empty.integration" });
  assert.deepEqual(result.applied.map((item) => item.filename), ["V001__baseline.sql", "V002__authentication.sql"]);
  const history = await runner.query("SELECT version, checksum_sha256, status FROM public.schema_migrations ORDER BY version");
  const [baseline, authentication] = await loadMigrations(directory);
  assert.equal(history.rows[0].version, "1");
  assert.equal(history.rows[0].checksum_sha256, baseline.checksum);
  assert.equal(history.rows[0].status, "applied");
  assert.equal(history.rows[1].version, "2");
  assert.equal(history.rows[1].checksum_sha256, authentication.checksum);
  assert.equal(history.rows[1].status, "applied");
  for (const table of ["app_revision", "app_schema", "app_state", "audit_log", "helice_production_orders", "temp_analise_producao", "users", "auth_users", "auth_sessions"]) {
    assert.equal(Number((await runner.query(`SELECT count(*) AS count FROM public.${table}`)).rows[0].count), 0);
  }
  await runner.end();
});

test("adoção idêntica registra somente V001 e preserva dados", async () => {
  await admin.query(baselineSql);
  await admin.query("INSERT INTO public.users (id, email, name) VALUES (42, 'preservar@teste.local', 'Preservar')");
  const adopter = await connect();

  const dryRun = await adoption(adopter, { dryRun: true, confirmation: undefined, operator: undefined });
  assert.equal(dryRun.adopted, false);
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
  await assert.rejects(() => adoption(adopter, { confirmation: undefined }), { code: "BASELINE_CONFIRMATION_REQUIRED" });
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);

  const result = await adoption(adopter);
  assert.equal(result.adopted, true);
  const row = await admin.query("SELECT id, email, name FROM public.users");
  assert.deepEqual(row.rows, [{ id: "42", email: "preservar@teste.local", name: "Preservar" }]);
  const history = await admin.query("SELECT version, description, checksum_sha256, installed_by, status FROM public.schema_migrations");
  const [baseline] = await loadMigrations(directory);
  assert.deepEqual(history.rows.map(({ checksum_sha256, ...item }) => item), [{
    version: "1", description: "baseline", installed_by: "baseline.integration", status: "applied"
  }]);
  assert.equal(history.rows[0].checksum_sha256, baseline.checksum);
  await assert.rejects(() => adoption(adopter), { code: "BASELINE_HISTORY_NOT_EMPTY" });
  await adopter.end();
});

test("rejeita coluna, índice e tabela extra divergentes sem escrever histórico", async (t) => {
  const scenarios = [
    ["tipo de coluna", "ALTER TABLE public.users ALTER COLUMN name TYPE character varying(50)"],
    ["índice ausente", "DROP INDEX public.idx_audit_log_state_key"],
    ["tabela extra", "CREATE TABLE public.extra_table (id integer)"]
  ];
  for (const [name, divergenceSql] of scenarios) {
    await t.test(name, async () => {
      await resetPublic();
      await admin.query(baselineSql);
      await admin.query(divergenceSql);
      const adopter = await connect();
      await assert.rejects(() => adoption(adopter, { dryRun: true }), { code: "BASELINE_STRUCTURE_MISMATCH" });
      assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
      await adopter.end();
    });
  }
});

test("adoção usa o mesmo advisory lock do runner", async () => {
  await admin.query(baselineSql);
  const holder = await connect();
  const contender = await connect();
  await acquireMigrationLock(holder);
  await assert.rejects(() => adoption(contender), { code: "MIGRATION_LOCK_UNAVAILABLE" });
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
  await releaseMigrationLock(holder);
  await holder.end();
  await contender.end();
});

test("falha ao registrar baseline reverte integralmente a tabela de controle", async () => {
  await admin.query(baselineSql);
  await admin.query("INSERT INTO public.users (id, email) VALUES (7, 'rollback@teste.local')");
  const realClient = await connect();
  const failingClient = {
    query(query, params) {
      const text = typeof query === "string" ? query : query.text;
      if (text.includes("INSERT INTO public.schema_migrations")) {
        throw new Error("falha sintética sem credenciais");
      }
      return realClient.query(query, params);
    }
  };
  await assert.rejects(() => adoption(failingClient), { code: "BASELINE_ADOPTION_FAILED" });
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.users WHERE id = 7")).rows[0].count, 1);
  await realClient.end();
});
