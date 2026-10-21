import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MigrationError,
  compareMigrations,
  inspectMigrations,
  loadMigrations,
  migrate,
  sanitizeError
} from "../../scripts/db/migration-runner.js";
import { compareStructure, fingerprintSnapshot } from "../../scripts/db/schema-inspector.js";

async function withMigrationDirectory(files, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hrn-migrations-test-"));
  try {
    await Promise.all(Object.entries(files).map(([name, content]) => writeFile(path.join(directory, name), content, "utf8")));
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class FakeClient {
  constructor({ tableExists = false, records = [], lockAvailable = true, failOn = null } = {}) {
    this.tableExists = tableExists;
    this.records = records.map((record) => ({ ...record }));
    this.lockAvailable = lockAvailable;
    this.failOn = failOn;
    this.calls = [];
  }

  async query(query, params = []) {
    const text = typeof query === "string" ? query : query.text;
    const normalized = text.replace(/\s+/g, " ").trim();
    this.calls.push({ text: normalized, params });
    if (this.failOn && text.includes(this.failOn)) throw new Error("password=segredo postgresql://admin:segredo@prod/banco");
    if (text.includes("to_regclass")) return { rows: [{ table_name: this.tableExists ? "schema_migrations" : null }] };
    if (text.includes("FROM public.schema_migrations") && text.includes("ORDER BY version")) return { rows: this.records };
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: this.lockAvailable }] };
    if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
    if (text.includes("CREATE TABLE IF NOT EXISTS public.schema_migrations")) {
      this.tableExists = true;
      return { rows: [] };
    }
    if (text.includes("INSERT INTO public.schema_migrations")) {
      this.records.push({
        version: params[0], description: params[1], checksum_sha256: params[2],
        installed_by: params[3], installed_at: null, status: "running"
      });
      return { rows: [] };
    }
    if (text.includes("SET status = 'applied'")) {
      this.records.find((record) => String(record.version) === String(params[0])).status = "applied";
      return { rows: [] };
    }
    if (text.includes("SET status = 'failed'")) {
      this.records.find((record) => String(record.version) === String(params[0])).status = "failed";
      return { rows: [] };
    }
    return { rows: [] };
  }
}

test("carrega migrations em ordem numérica e calcula checksums", async () => {
  await withMigrationDirectory({
    "V0010__decima.sql": "SELECT 10;\n",
    "V0002__segunda.sql": "SELECT 2;\n",
    "README.md": "documentação"
  }, async (directory) => {
    const migrations = await loadMigrations(directory);
    assert.deepEqual(migrations.map((item) => item.filename), ["V0002__segunda.sql", "V0010__decima.sql"]);
    assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
    assert.equal(migrations[0].transactional, true);
  });
});

test("rejeita nome inválido e versão duplicada", async () => {
  await withMigrationDirectory({ "001_invalida.sql": "SELECT 1;" }, async (directory) => {
    await assert.rejects(() => loadMigrations(directory), (error) => error.code === "INVALID_MIGRATION_NAME");
  });
  await withMigrationDirectory({ "V0000__zero.sql": "SELECT 0;" }, async (directory) => {
    await assert.rejects(() => loadMigrations(directory), (error) => error.code === "INVALID_MIGRATION_NAME");
  });
  await withMigrationDirectory({
    "V0001__primeira.sql": "SELECT 1;",
    "V0001__outra.sql": "SELECT 2;"
  }, async (directory) => {
    await assert.rejects(() => loadMigrations(directory), (error) => error.code === "DUPLICATE_MIGRATION_VERSION");
  });
});

test("distingue migration não transacional", async () => {
  await withMigrationDirectory({
    "V0001__indice_concorrente.sql": "\n-- migration:non-transactional\nCREATE INDEX CONCURRENTLY exemplo ON tabela (id);"
  }, async (directory) => {
    const [migration] = await loadMigrations(directory);
    assert.equal(migration.transactional, false);
  });
});

test("detecta migration ausente, alterada e status não resolvido", () => {
  const local = [{ version: 1n, filename: "V0001__inicio.sql", description: "inicio", checksum: "novo" }];
  const result = compareMigrations(local, [
    { version: 1n, description: "nome_antigo", checksum_sha256: "antigo", status: "failed" },
    { version: 2n, checksum_sha256: "x", status: "applied" }
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.problems.map((item) => item.code), [
    "MIGRATION_CHECKSUM_MISMATCH", "MIGRATION_DESCRIPTION_MISMATCH",
    "UNRESOLVED_MIGRATION", "APPLIED_MIGRATION_MISSING"
  ]);
});

test("status em banco sem tabela de controle é somente leitura", async () => {
  await withMigrationDirectory({ "V0001__inicio.sql": "SELECT 1;" }, async (directory) => {
    const client = new FakeClient();
    const report = await inspectMigrations({ client, directory });
    assert.equal(report.pending.length, 1);
    assert.equal(client.tableExists, false);
    assert.equal(client.calls.some((call) => /CREATE|INSERT|UPDATE/.test(call.text)), false);
  });
});

test("dry-run não adquire lock nem altera o banco", async () => {
  await withMigrationDirectory({ "V0001__inicio.sql": "SELECT 1;" }, async (directory) => {
    const client = new FakeClient();
    const result = await migrate({ client, directory, dryRun: true });
    assert.equal(result.pending.length, 1);
    assert.equal(result.applied.length, 0);
    assert.equal(client.calls.some((call) => /pg_try_advisory_lock|CREATE|INSERT|UPDATE|BEGIN/.test(call.text)), false);
  });
});

test("rejeita aplicação quando o lock consultivo não está disponível", async () => {
  await withMigrationDirectory({ "V0001__inicio.sql": "SELECT 1;" }, async (directory) => {
    const client = new FakeClient({ lockAvailable: false });
    await assert.rejects(
      () => migrate({ client, directory, operator: "teste" }),
      (error) => error instanceof MigrationError && error.code === "MIGRATION_LOCK_UNAVAILABLE"
    );
    assert.equal(client.calls.some((call) => call.text.includes("CREATE TABLE")), false);
  });
});

test("aplica migration transacional, registra operador e libera lock", async () => {
  await withMigrationDirectory({ "V0001__inicio.sql": "SELECT 'MIGRATION_OK';" }, async (directory) => {
    const client = new FakeClient();
    const result = await migrate({ client, directory, operator: "qa.runner" });
    assert.equal(result.applied.length, 1);
    assert.equal(client.records[0].status, "applied");
    assert.equal(client.records[0].installed_by, "qa.runner");
    const statements = client.calls.map((call) => call.text);
    assert.ok(statements.includes("BEGIN"));
    assert.ok(statements.includes("COMMIT"));
    assert.ok(statements.at(-1).includes("pg_advisory_unlock"));
  });
});

test("faz rollback, registra falha e não expõe o erro original", async () => {
  await withMigrationDirectory({ "V0001__quebrada.sql": "SELECT 'BROKEN';" }, async (directory) => {
    const client = new FakeClient({ failOn: "BROKEN" });
    await assert.rejects(
      () => migrate({ client, directory, operator: "qa.runner" }),
      (error) => error.code === "MIGRATION_EXECUTION_FAILED" && !error.message.includes("segredo")
    );
    assert.equal(client.records[0].status, "failed");
    assert.ok(client.calls.some((call) => call.text === "ROLLBACK"));
    assert.ok(client.calls.at(-1).text.includes("pg_advisory_unlock"));
  });
});

test("bloqueia migrations não transacionais antes de qualquer mutação", async () => {
  await withMigrationDirectory({
    "V0001__indice.sql": "-- migration:non-transactional\nCREATE INDEX CONCURRENTLY exemplo ON tabela (id);"
  }, async (directory) => {
    const client = new FakeClient();
    await assert.rejects(
      () => migrate({ client, directory, operator: "qa.runner" }),
      (error) => error.code === "NON_TRANSACTIONAL_MIGRATION_BLOCKED"
    );
    assert.equal(client.calls.some((call) => /CREATE TABLE|INSERT INTO|UPDATE public/.test(call.text)), false);
    assert.ok(client.calls.some((call) => call.text.includes("pg_advisory_unlock")));
  });
});

test("sanitiza URLs e senhas em mensagens inesperadas", () => {
  const message = sanitizeError(new Error("connect postgresql://admin:abc@db:5432/app password=abc"));
  assert.equal(message.includes("abc"), false);
  assert.equal(message.includes("admin"), false);
  assert.match(message, /DATABASE_URL_REMOVIDA/);
});

test("aceita o formato V001 do baseline", async () => {
  await withMigrationDirectory({ "V001__baseline.sql": "SELECT 1;" }, async (directory) => {
    const [baseline] = await loadMigrations(directory);
    assert.equal(baseline.version, 1n);
    assert.equal(baseline.description, "baseline");
  });
});

test("fingerprint estrutural é determinístico e localiza seções divergentes", () => {
  const snapshot = { tables: [{ table_name: "users" }], columns: [] };
  const expected = fingerprintSnapshot(snapshot);
  assert.equal(compareStructure(snapshot, expected).equivalent, true);
  const divergent = compareStructure({ tables: [{ table_name: "users" }], columns: [{ column_name: "extra" }] }, expected);
  assert.equal(divergent.equivalent, false);
  assert.deepEqual(divergent.differingSections, ["columns"]);
});
