import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";

import { closeDatabase, initializeDatabase } from "../../server/database.js";
import { config } from "../../server/config.js";
import { validateStrictConfiguration, validateStrictDatabase } from "../../server/strict-database.js";
import { loadMigrations, migrate } from "../../scripts/db/migration-runner.js";
import { fingerprintSnapshot, inspectPublicSchema } from "../../scripts/db/schema-inspector.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString || !/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) {
  throw new Error("A suíte estrita recusou uma URL não descartável.");
}

const { Client } = pg;
const migrationsDirectory = path.resolve("database", "migrations");
let admin;

async function connect(url = connectionString) {
  const client = new Client({ connectionString: url, ssl: false });
  await client.connect();
  return client;
}

async function resetPublic() {
  await closeDatabase();
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; COMMENT ON SCHEMA public IS 'standard public schema';");
}

async function applyBaseline() {
  const client = await connect();
  await migrate({ client, directory: migrationsDirectory, operator: "strict.integration" });
  await client.end();
}

before(async () => {
  admin = await connect();
  assert.equal(config.database.strictMode, true);
  assert.equal(config.database.databaseUrl, connectionString);
  assert.equal(config.database.sslMode, "disable");
});
beforeEach(resetPublic);
after(async () => { await closeDatabase(); await admin.end(); });

test("modo estrito exige especificamente DATABASE_URL e não aceita fallback", () => {
  const invalid = {
    ...config,
    database: { ...config.database, strictMode: true, databaseUrl: "", connectionString: "postgresql://fallback/fallback" },
    supabase: { url: "https://fallback.invalid", serviceRoleKey: "fake", anonKey: "fake" }
  };
  assert.throws(() => validateStrictConfiguration(invalid), { code: "DATABASE_CONFIG_MISSING" });
});

test("falha de conexão é clara e não devolve a URL", async () => {
  const unavailable = {
    ...config,
    database: { ...config.database, databaseUrl: "postgresql://user:secret@127.0.0.1:1/missing" }
  };
  await assert.rejects(
    () => validateStrictDatabase({ currentConfig: unavailable, migrationsDirectory }),
    (error) => error.code === "DATABASE_CONNECTION_FAILED" && !error.message.includes("secret")
  );
});

test("recusa banco sem histórico", async () => {
  await assert.rejects(() => validateStrictDatabase({ migrationsDirectory }), { code: "MIGRATION_HISTORY_MISSING" });
});

test("aceita histórico íntegro e totalmente aplicado", async () => {
  await applyBaseline();
  const result = await validateStrictDatabase({ migrationsDirectory });
  assert.deepEqual(result, { strict: true, postgresMajor: 17, migrations: 5, pending: [] });
});

test("reporta migration pendente sem escrever no banco", async () => {
  const appliedDirectory = await mkdtemp(path.join(os.tmpdir(), "hrn-strict-applied-"));
  try {
    await copyFile(path.join(migrationsDirectory, "V001__baseline.sql"), path.join(appliedDirectory, "V001__baseline.sql"));
    await copyFile(path.join(migrationsDirectory, "V002__authentication.sql"), path.join(appliedDirectory, "V002__authentication.sql"));
    const client = await connect();
    await migrate({ client, directory: appliedDirectory, operator: "strict.integration" });
    await client.end();
    const result = await validateStrictDatabase({ migrationsDirectory });
    assert.deepEqual(result.pending, [3, 4, 5]);
    assert.equal((await admin.query("SELECT to_regclass('public.master_items') AS name")).rows[0].name, null);
  } finally {
    await rm(appliedDirectory, { recursive: true, force: true });
  }
});

test("recusa checksum divergente e status inválido", async () => {
  await applyBaseline();
  await admin.query("UPDATE public.schema_migrations SET checksum_sha256 = repeat('0', 64) WHERE version = 1");
  await assert.rejects(() => validateStrictDatabase({ migrationsDirectory }), { code: "MIGRATION_HISTORY_INVALID" });
  const [baseline] = await loadMigrations(migrationsDirectory);
  await admin.query("UPDATE public.schema_migrations SET checksum_sha256 = $1, status = 'failed' WHERE version = 1", [baseline.checksum]);
  await assert.rejects(() => validateStrictDatabase({ migrationsDirectory }), { code: "MIGRATION_HISTORY_INVALID" });
});

test("inicialização estrita é somente leitura e não limpa auditoria", async () => {
  await applyBaseline();
  await admin.query(`INSERT INTO public.audit_log
    (state_key, action, version, payload, actor, created_at)
    VALUES ('sentinela', 'DELETE', 1, NULL, 'teste', NOW() - INTERVAL '10 years')`);
  const before = fingerprintSnapshot(await inspectPublicSchema(admin));
  await initializeDatabase();
  const after = fingerprintSnapshot(await inspectPublicSchema(admin));
  assert.deepEqual(after, before);
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.audit_log WHERE state_key = 'sentinela'")).rows[0].count, 1);
});

test("modo não estrito preserva a inicialização PostgreSQL legada", async () => {
  const script = `
    const db = await import('./server/database.js');
    await db.initializeDatabase();
    await db.closeDatabase();
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      DATABASE_STRICT_MODE: "false",
      DATABASE_URL: connectionString,
      DATABASE_SSL_MODE: "disable",
      AUDIT_CLEANUP_ENABLED: "false"
    }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM public.app_revision WHERE singleton = 'main'")).rows[0].count, 1);
  assert.ok((await admin.query("SELECT to_regclass('public.helice_production_orders') AS name")).rows[0].name);
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name, null);
});
