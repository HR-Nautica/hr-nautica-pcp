import fs from "node:fs/promises";
import {
  CONTROL_TABLE_SQL,
  MigrationError,
  acquireMigrationLock,
  inspectMigrations,
  releaseMigrationLock
} from "./migration-runner.js";
import { compareStructure, inspectPublicSchema } from "./schema-inspector.js";

export const BASELINE_CONFIRMATION = "ADOPT_BASELINE_V001";

async function loadExpectation(file) {
  const raw = await fs.readFile(file, "utf8");
  const expected = JSON.parse(raw);
  if (expected.postgresMajor !== 17 || !expected.sha256 || !expected.sections) {
    throw new MigrationError("Manifesto estrutural do baseline inválido.", "BASELINE_MANIFEST_INVALID");
  }
  return expected;
}

function baselineFrom(report) {
  const baseline = report.local.find((migration) => migration.version === 1n);
  if (!baseline || baseline.filename !== "V001__baseline.sql" || baseline.description !== "baseline") {
    throw new MigrationError("V001__baseline.sql não foi encontrada ou possui nome inválido.", "BASELINE_MIGRATION_MISSING");
  }
  if (!baseline.transactional) {
    throw new MigrationError("V001 deve ser transacional.", "BASELINE_NOT_TRANSACTIONAL");
  }
  if (report.recorded.length) {
    throw new MigrationError("O banco já possui histórico de migrations; adoção de baseline recusada.", "BASELINE_HISTORY_NOT_EMPTY");
  }
  if (!report.valid) {
    throw new MigrationError(report.problems.map((problem) => problem.message).join(" "), report.problems[0].code);
  }
  return baseline;
}

async function inspectCandidate({ client, directory, manifestFile }) {
  const server = await client.query("SHOW server_version_num");
  const serverVersion = Number(server.rows[0].server_version_num);
  if (!Number.isInteger(serverVersion) || Math.floor(serverVersion / 10000) !== 17) {
    throw new MigrationError("A adoção do baseline exige PostgreSQL 17.", "BASELINE_POSTGRES_VERSION_MISMATCH");
  }
  const report = await inspectMigrations({ client, directory });
  const baseline = baselineFrom(report);
  const expected = await loadExpectation(manifestFile);
  const snapshot = await inspectPublicSchema(client);
  const structure = compareStructure(snapshot, expected);
  if (!structure.equivalent) {
    const sections = [...structure.differingSections, ...structure.unexpectedSections].join(", ");
    throw new MigrationError(`Estrutura divergente do baseline${sections ? ` nas seções: ${sections}` : ""}.`, "BASELINE_STRUCTURE_MISMATCH");
  }
  return { report, baseline, structure };
}

export async function adoptBaseline({
  client,
  directory,
  manifestFile,
  operator,
  confirmation,
  dryRun = false
}) {
  if (dryRun) {
    const candidate = await inspectCandidate({ client, directory, manifestFile });
    return { ...candidate, adopted: false, dryRun: true };
  }
  if (!operator?.trim()) {
    throw new MigrationError("O operador do baseline é obrigatório.", "MIGRATION_OPERATOR_REQUIRED");
  }
  if (confirmation !== BASELINE_CONFIRMATION) {
    throw new MigrationError(`Confirmação explícita obrigatória: ${BASELINE_CONFIRMATION}.`, "BASELINE_CONFIRMATION_REQUIRED");
  }

  await acquireMigrationLock(client);
  try {
    const candidate = await inspectCandidate({ client, directory, manifestFile });
    await client.query("BEGIN");
    try {
      await client.query(CONTROL_TABLE_SQL);
      await client.query(
        `INSERT INTO public.schema_migrations
           (version, description, checksum_sha256, installed_by, status)
         VALUES ($1, $2, $3, $4, 'applied')`,
        [candidate.baseline.version.toString(), candidate.baseline.description, candidate.baseline.checksum, operator.trim()]
      );
      await client.query("COMMIT");
    } catch {
      try { await client.query("ROLLBACK"); } catch { /* mantém falha segura */ }
      throw new MigrationError("Falha ao registrar o baseline; a transação foi revertida.", "BASELINE_ADOPTION_FAILED");
    }
    return { ...candidate, adopted: true, dryRun: false };
  } finally {
    try { await releaseMigrationLock(client); } catch { /* a sessão libera ao encerrar */ }
  }
}
