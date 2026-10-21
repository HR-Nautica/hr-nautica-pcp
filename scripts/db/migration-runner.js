import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MIGRATION_FILE_PATTERN = /^V(\d{3,})__([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
export const MIGRATION_LOCK_KEY = 483856174201n;

export const CONTROL_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    installed_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'applied', 'failed'))
  )
`;

export class MigrationError extends Error {
  constructor(message, code = "MIGRATION_ERROR") {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isNonTransactional(content) {
  const firstMeaningfulLine = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim() !== "");
  return firstMeaningfulLine?.trim().toLowerCase() === "-- migration:non-transactional";
}

export async function loadMigrations(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new MigrationError(`Não foi possível ler o diretório de migrations: ${error.code || "erro"}.`, "MIGRATION_DIRECTORY_ERROR");
  }

  const migrations = [];
  const invalid = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "README.md") continue;
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match) {
      if (entry.name.toLowerCase().endsWith(".sql")) invalid.push(entry.name);
      continue;
    }
    if (BigInt(match[1]) === 0n) {
      invalid.push(entry.name);
      continue;
    }
    const content = await fs.readFile(path.join(directory, entry.name));
    migrations.push({
      version: BigInt(match[1]),
      versionText: match[1],
      description: match[2],
      filename: entry.name,
      checksum: checksum(content),
      transactional: !isNonTransactional(content.toString("utf8")),
      sql: content.toString("utf8")
    });
  }

  if (invalid.length) {
    throw new MigrationError(`Nomes de migration inválidos: ${invalid.sort().join(", ")}.`, "INVALID_MIGRATION_NAME");
  }

  migrations.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : a.filename.localeCompare(b.filename)));
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new MigrationError(`Versão de migration duplicada: ${migrations[index].versionText}.`, "DUPLICATE_MIGRATION_VERSION");
    }
  }
  return migrations;
}

async function controlTableExists(client) {
  const result = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
  return Boolean(result.rows[0]?.table_name);
}

async function readApplied(client) {
  if (!(await controlTableExists(client))) return [];
  const result = await client.query(`
    SELECT version, description, checksum_sha256, installed_at, installed_by, status
    FROM public.schema_migrations
    ORDER BY version
  `);
  return result.rows.map((row) => ({ ...row, version: BigInt(row.version) }));
}

export function compareMigrations(local, recorded) {
  const localByVersion = new Map(local.map((migration) => [migration.version.toString(), migration]));
  const recordedByVersion = new Map(recorded.map((migration) => [migration.version.toString(), migration]));
  const problems = [];

  for (const item of recorded) {
    const migration = localByVersion.get(item.version.toString());
    if (!migration) {
      problems.push({ code: "APPLIED_MIGRATION_MISSING", version: item.version, message: `Migration aplicada V${item.version} não existe no repositório.` });
      continue;
    }
    if (migration.checksum !== item.checksum_sha256) {
      problems.push({ code: "MIGRATION_CHECKSUM_MISMATCH", version: item.version, message: `Checksum divergente para ${migration.filename}.` });
    }
    if (migration.description !== item.description) {
      problems.push({ code: "MIGRATION_DESCRIPTION_MISMATCH", version: item.version, message: `Descrição divergente para ${migration.filename}.` });
    }
    if (item.status !== "applied") {
      problems.push({ code: "UNRESOLVED_MIGRATION", version: item.version, message: `Migration V${item.version} está com status ${item.status}.` });
    }
  }

  const pending = local.filter((migration) => !recordedByVersion.has(migration.version.toString()));
  return { valid: problems.length === 0, problems, pending };
}

function assertValid(comparison) {
  if (!comparison.valid) {
    throw new MigrationError(comparison.problems.map((problem) => problem.message).join(" "), comparison.problems[0].code);
  }
}

export async function inspectMigrations({ client, directory }) {
  const local = await loadMigrations(directory);
  const recorded = await readApplied(client);
  const comparison = compareMigrations(local, recorded);
  return { local, recorded, ...comparison };
}

export async function acquireMigrationLock(client) {
  const result = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [MIGRATION_LOCK_KEY.toString()]);
  if (!result.rows[0]?.acquired) {
    throw new MigrationError("Outra execução de migrations já possui o lock consultivo.", "MIGRATION_LOCK_UNAVAILABLE");
  }
}

export async function releaseMigrationLock(client) {
  await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY.toString()]);
}

async function applyTransactional(client, migration, operator) {
  await client.query(
    `INSERT INTO public.schema_migrations
       (version, description, checksum_sha256, installed_by, status)
     VALUES ($1, $2, $3, $4, 'running')`,
    [migration.version.toString(), migration.description, migration.checksum, operator]
  );
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      `UPDATE public.schema_migrations
       SET status = 'applied', installed_at = clock_timestamp()
       WHERE version = $1 AND status = 'running'`,
      [migration.version.toString()]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* mantém o erro original */ }
    try {
      await client.query(
        "UPDATE public.schema_migrations SET status = 'failed' WHERE version = $1 AND status = 'running'",
        [migration.version.toString()]
      );
    } catch { /* conexão interrompida: 'running' bloqueia retomada automática */ }
    throw new MigrationError(`Falha ao aplicar ${migration.filename}; a transação foi revertida.`, "MIGRATION_EXECUTION_FAILED");
  }
}

export async function migrate({ client, directory, operator, dryRun = false }) {
  if (dryRun) {
    const initial = await inspectMigrations({ client, directory });
    assertValid(initial);
    const blocked = initial.pending.find((migration) => !migration.transactional);
    if (blocked) {
      throw new MigrationError(`A migration não transacional ${blocked.filename} não pode ser aplicada por esta versão do runner.`, "NON_TRANSACTIONAL_MIGRATION_BLOCKED");
    }
    return { ...initial, applied: [], dryRun: true };
  }
  if (!operator?.trim()) throw new MigrationError("O operador da migration é obrigatório.", "MIGRATION_OPERATOR_REQUIRED");

  await acquireMigrationLock(client);
  const applied = [];
  try {
    let lockedState = await inspectMigrations({ client, directory });
    assertValid(lockedState);
    const blocked = lockedState.pending.find((migration) => !migration.transactional);
    if (blocked) {
      throw new MigrationError(`A migration não transacional ${blocked.filename} não pode ser aplicada por esta versão do runner.`, "NON_TRANSACTIONAL_MIGRATION_BLOCKED");
    }
    await client.query(CONTROL_TABLE_SQL);
    lockedState = await inspectMigrations({ client, directory });
    assertValid(lockedState);
    for (const migration of lockedState.pending) {
      await applyTransactional(client, migration, operator.trim());
      applied.push(migration);
    }
    return { ...lockedState, applied, dryRun: false };
  } finally {
    try { await releaseMigrationLock(client); } catch { /* a sessão também libera o lock ao encerrar */ }
  }
}

export function sanitizeError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REMOVIDA]")
    .replace(/(password|senha)\s*[=:]\s*[^\s,;]+/gi, "$1=[REMOVIDO]");
}
