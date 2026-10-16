import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";

import { inspectMigrations, migrate, sanitizeError } from "../../scripts/db/migration-runner.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATIONS_TEST_DATABASE_URL é obrigatória para a suíte real.");
if (!/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) {
  throw new Error("A suíte recusou uma URL que não pertence ao PostgreSQL descartável esperado.");
}

const { Client } = pg;
let admin;
let directory;

async function client() {
  const instance = new Client({ connectionString });
  await instance.connect();
  return instance;
}

async function migration(name, sql) {
  await writeFile(path.join(directory, name), sql, "utf8");
}

async function reset() {
  await admin.query("DROP TABLE IF EXISTS public.runner_probe, public.rollback_probe, public.schema_migrations CASCADE");
  await rm(directory, { recursive: true, force: true });
  directory = await mkdtemp(path.join(os.tmpdir(), "hrn-pg17-migrations-"));
}

before(async () => {
  admin = await client();
  directory = await mkdtemp(path.join(os.tmpdir(), "hrn-pg17-migrations-"));
  const version = await admin.query("SHOW server_version");
  assert.match(version.rows[0].server_version, /^17\./);
});

beforeEach(reset);

after(async () => {
  await rm(directory, { recursive: true, force: true });
  await admin.end();
});

test("cria controle, aplica uma vez e mantém lock e SQL na mesma sessão", async () => {
  await migration("V0001__probe_de_sessao.sql", `
    CREATE TABLE public.runner_probe (backend_pid integer, lock_held boolean);
    INSERT INTO public.runner_probe
    SELECT pg_backend_pid(), EXISTS (
      SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
    );
  `);
  const runner = await client();
  const pid = Number((await runner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const first = await migrate({ client: runner, directory, operator: "integration.test" });
  const second = await migrate({ client: runner, directory, operator: "integration.test" });
  assert.equal(first.applied.length, 1);
  assert.equal(second.applied.length, 0);

  const control = await admin.query("SELECT version, description, checksum_sha256, installed_at, installed_by, status FROM public.schema_migrations");
  assert.equal(control.rows.length, 1);
  assert.equal(control.rows[0].version, "1");
  assert.equal(control.rows[0].description, "probe_de_sessao");
  assert.equal(control.rows[0].checksum_sha256, first.applied[0].checksum);
  assert.ok(control.rows[0].installed_at instanceof Date);
  assert.equal(control.rows[0].installed_by, "integration.test");
  assert.equal(control.rows[0].status, "applied");
  const probe = await admin.query("SELECT * FROM public.runner_probe");
  assert.equal(probe.rows[0].backend_pid, pid);
  assert.equal(probe.rows[0].lock_held, true);
  await runner.end();
});

test("rollback registra failed e bloqueia retomada automática", async () => {
  await migration("V0001__falha.sql", "CREATE TABLE public.rollback_probe (id integer); INSERT INTO tabela_inexistente VALUES (1);");
  const runner = await client();
  await assert.rejects(() => migrate({ client: runner, directory, operator: "integration.test" }), { code: "MIGRATION_EXECUTION_FAILED" });
  assert.equal((await admin.query("SELECT to_regclass('public.rollback_probe') AS name")).rows[0].name, null);
  assert.equal((await admin.query("SELECT status FROM public.schema_migrations WHERE version = 1")).rows[0].status, "failed");
  await assert.rejects(() => migrate({ client: runner, directory, operator: "integration.test" }), { code: "UNRESOLVED_MIGRATION" });
  await runner.end();
});

test("duas execuções concorrentes são serializadas pelo advisory lock", async () => {
  await migration("V0001__lenta.sql", "SELECT pg_sleep(2); CREATE TABLE public.runner_probe (id integer);");
  const firstClient = await client();
  const secondClient = await client();
  const first = migrate({ client: firstClient, directory, operator: "first" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await assert.rejects(() => migrate({ client: secondClient, directory, operator: "second" }), { code: "MIGRATION_LOCK_UNAVAILABLE" });
  await first;
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.schema_migrations")).rows[0].count, 1);
  await firstClient.end();
  await secondClient.end();
});

test("detecta checksum alterado e migration aplicada removida", async () => {
  const filename = "V0001__imutavel.sql";
  await migration(filename, "SELECT 1;");
  const runner = await client();
  await migrate({ client: runner, directory, operator: "integration.test" });
  await migration(filename, "SELECT 2;");
  let report = await inspectMigrations({ client: runner, directory });
  assert.equal(report.valid, false);
  assert.ok(report.problems.some((item) => item.code === "MIGRATION_CHECKSUM_MISMATCH"));
  await unlink(path.join(directory, filename));
  report = await inspectMigrations({ client: runner, directory });
  assert.ok(report.problems.some((item) => item.code === "APPLIED_MIGRATION_MISSING"));
  await runner.end();
});

test("dry-run, status e validate não escrevem no banco", async () => {
  await migration("V0001__somente_plano.sql", "CREATE TABLE public.runner_probe (id integer);");
  const runner = await client();
  const dryRun = await migrate({ client: runner, directory, dryRun: true });
  assert.equal(dryRun.pending.length, 1);
  const status = await inspectMigrations({ client: runner, directory });
  const validate = await inspectMigrations({ client: runner, directory });
  assert.equal(status.valid, true);
  assert.equal(validate.valid, true);
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
  assert.equal((await admin.query("SELECT to_regclass('public.runner_probe') AS name")).rows[0].name, null);
  await runner.end();
});

test("bloqueia migration não transacional sem criar controle", async () => {
  await migration("V0001__concorrente.sql", "-- migration:non-transactional\nCREATE INDEX CONCURRENTLY idx_x ON public.runner_probe (id);");
  const runner = await client();
  await assert.rejects(() => migrate({ client: runner, directory, operator: "integration.test" }), { code: "NON_TRANSACTIONAL_MIGRATION_BLOCKED" });
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
  await runner.end();
});

test("interrupção reverte DDL e deixa estado running bloqueado, sem vazar credencial", async () => {
  await migration("V0001__interrompida.sql", "CREATE TABLE public.rollback_probe (id integer); SELECT pg_sleep(30);");
  const runner = await client();
  const connectionErrors = [];
  runner.on("error", (error) => connectionErrors.push(error));
  const pid = Number((await runner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const running = migrate({ client: runner, directory, operator: "integration.test" });
  let observedRunning = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const exists = (await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name;
    if (exists) {
      const row = await admin.query("SELECT status FROM public.schema_migrations WHERE version = 1");
      if (row.rows[0]?.status === "running") { observedRunning = true; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(observedRunning, true, "o estado running deve ser persistido antes do SQL");
  await admin.query("SELECT pg_terminate_backend($1)", [pid]);
  await assert.rejects(running, (error) => {
    const safe = sanitizeError(new Error(`${error.message} ${connectionString}`));
    const password = new URL(connectionString).password;
    return error.code === "MIGRATION_EXECUTION_FAILED" && !safe.includes(password) && !safe.includes(connectionString);
  });
  const password = new URL(connectionString).password;
  assert.ok(connectionErrors.every((error) => !sanitizeError(new Error(`${error.message} ${connectionString}`)).includes(password)));
  assert.equal((await admin.query("SELECT to_regclass('public.rollback_probe') AS name")).rows[0].name, null);
  assert.equal((await admin.query("SELECT status FROM public.schema_migrations WHERE version = 1")).rows[0].status, "running");
  const verifier = await client();
  await assert.rejects(() => migrate({ client: verifier, directory, operator: "retry" }), { code: "UNRESOLVED_MIGRATION" });
  await verifier.end();
  await runner.end().catch(() => {});
});
