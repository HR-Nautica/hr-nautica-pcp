import path from "node:path";
import process from "node:process";
import { adoptBaseline, BASELINE_CONFIRMATION } from "./baseline-manager.js";
import { inspectMigrations, migrate, sanitizeError } from "./migration-runner.js";

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const allowedCommands = new Set(["migrate", "status", "validate", "baseline"]);
const confirmationArgument = process.argv.find((argument) => argument.startsWith("--confirm="));
const confirmation = confirmationArgument?.slice("--confirm=".length);

function printReport(report) {
  const recorded = new Map(report.recorded.map((item) => [item.version.toString(), item]));
  if (!report.local.length && !report.recorded.length) console.log("Nenhuma migration encontrada.");
  for (const migration of report.local) {
    const item = recorded.get(migration.version.toString());
    const state = item?.status || "pending";
    const mode = migration.transactional ? "transactional" : "non-transactional (blocked)";
    console.log(`${migration.filename}: ${state}, ${mode}`);
  }
  for (const problem of report.problems) console.error(`ERRO: ${problem.message}`);
}

if (!allowedCommands.has(command)) {
  console.error("Uso: node scripts/db/migrations-cli.js <migrate|status|validate|baseline> [--dry-run] [--confirm=TOKEN]");
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL é obrigatória para o runner de migrations.");
  process.exitCode = 2;
} else {
  const { default: pg } = await import("pg");
  const { Client } = pg;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const directory = path.resolve("database", "migrations");
  try {
    await client.connect();
    if (command === "baseline") {
      const result = await adoptBaseline({
        client,
        directory,
        manifestFile: path.resolve("database", "baseline-structure.json"),
        operator: process.env.MIGRATION_OPERATOR,
        confirmation,
        dryRun
      });
      console.log(`Estrutura equivalente ao baseline (${result.structure.actualSha256}).`);
      console.log(dryRun
        ? `Dry-run concluído; nenhuma escrita realizada. Para adotar, use --confirm=${BASELINE_CONFIRMATION}.`
        : "Baseline V001 registrado sem executar seu SQL.");
    } else if (command === "migrate") {
      const report = await migrate({
        client,
        directory,
        operator: process.env.MIGRATION_OPERATOR,
        dryRun
      });
      printReport(report);
      console.log(dryRun ? `Dry-run: ${report.pending.length} migration(s) pendente(s).` : `${report.applied.length} migration(s) aplicada(s).`);
    } else {
      const report = await inspectMigrations({ client, directory });
      printReport(report);
      if (!report.valid) process.exitCode = 1;
      else console.log(command === "validate" ? "Histórico de migrations válido." : `${report.pending.length} migration(s) pendente(s).`);
    }
  } catch (error) {
    console.error(`Falha no runner: ${sanitizeError(error)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
