import path from "node:path";
import pg from "pg";
import { MigrationError, inspectMigrations } from "../scripts/db/migration-runner.js";
import { config } from "./config.js";
import { buildPostgresConnectionOptions, validateSslMode } from "./postgres-config.js";

const { Client } = pg;

function strictError(message, code) {
  return Object.assign(new Error(message), { code });
}

export function validateStrictConfiguration(currentConfig = config) {
  if (!currentConfig.database.strictMode) return;
  if (!currentConfig.database.databaseUrl) {
    throw strictError("DATABASE_URL é obrigatória quando DATABASE_STRICT_MODE=true.", "DATABASE_CONFIG_MISSING");
  }
  buildPostgresConnectionOptions(currentConfig.database.databaseUrl, currentConfig.database);
  validateSslMode(currentConfig.database.sslMode);
  if (!currentConfig.host || !Number.isInteger(currentConfig.port) || currentConfig.port < 1 || currentConfig.port > 65535) {
    throw strictError("HOST ou PORT inválido para inicialização da API.", "SERVER_CONFIG_INVALID");
  }
}

export async function validateStrictDatabase({
  currentConfig = config,
  migrationsDirectory = path.resolve("database", "migrations"),
  clientFactory
} = {}) {
  validateStrictConfiguration(currentConfig);
  if (!currentConfig.database.strictMode) return { strict: false };

  const options = buildPostgresConnectionOptions(currentConfig.database.databaseUrl, currentConfig.database);
  const client = clientFactory ? clientFactory(options) : new Client(options);
  try {
    await client.connect();
    const version = await client.query("SHOW server_version_num");
    if (Math.floor(Number(version.rows[0]?.server_version_num) / 10000) !== 17) {
      throw strictError("O modo estrito exige PostgreSQL 17.", "DATABASE_VERSION_UNSUPPORTED");
    }
    const control = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    if (!control.rows[0]?.table_name) {
      throw strictError("Histórico de migrations ausente.", "MIGRATION_HISTORY_MISSING");
    }
    const report = await inspectMigrations({ client, directory: migrationsDirectory });
    if (!report.valid) {
      throw strictError("Histórico de migrations inválido.", "MIGRATION_HISTORY_INVALID");
    }
    const baseline = report.recorded.find((item) => item.version === 1n);
    if (!baseline || baseline.status !== "applied") {
      throw strictError("Baseline V001 não está aplicada.", "BASELINE_NOT_APPLIED");
    }
    return {
      strict: true,
      postgresMajor: 17,
      migrations: report.recorded.length,
      pending: report.pending.map((item) => Number(item.version))
    };
  } catch (error) {
    if (error.code && [
      "DATABASE_VERSION_UNSUPPORTED", "MIGRATION_HISTORY_MISSING", "MIGRATION_HISTORY_INVALID",
      "BASELINE_NOT_APPLIED"
    ].includes(error.code)) throw error;
    if (error instanceof MigrationError) {
      throw strictError("Não foi possível validar o histórico local de migrations.", "MIGRATION_HISTORY_INVALID");
    }
    throw strictError("Não foi possível validar o PostgreSQL configurado.", "DATABASE_CONNECTION_FAILED");
  } finally {
    await client.end().catch(() => {});
  }
}
