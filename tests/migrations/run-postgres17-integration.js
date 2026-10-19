import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

const suffix = crypto.randomBytes(6).toString("hex");
const network = `hrn-migration-test-${suffix}`;
const databaseContainer = `hrn-postgres17-test-${suffix}`;
const repository = path.resolve(".");
const password = `test-${crypto.randomBytes(16).toString("hex")}`;
const fingerprintMode = process.argv.includes("--fingerprint");
const baselineMode = process.argv.includes("--baseline");
const strictApiMode = process.argv.includes("--strict-api");

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: options.capture ? "pipe" : "inherit" });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Comando Docker de teste falhou (${args[0]}).`);
  }
  return result;
}

function cleanup() {
  docker(["rm", "--force", databaseContainer], { allowFailure: true, capture: true });
  docker(["network", "rm", network], { allowFailure: true, capture: true });
}

try {
  docker(["network", "create", network]);
  docker([
    "run", "--detach", "--name", databaseContainer, "--network", network,
    "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", "POSTGRES_USER=migration_test",
    "--env", "POSTGRES_DB=migration_test",
    "--health-cmd", "pg_isready -U migration_test -d migration_test",
    "--health-interval", "1s", "--health-timeout", "3s", "--health-retries", "30",
    "postgres:17-bookworm"
  ]);

  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = docker(["inspect", "--format", "{{.State.Health.Status}}", databaseContainer], { capture: true, allowFailure: true });
    if (result.stdout?.trim() === "healthy") { healthy = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error("PostgreSQL 17 descartável não ficou saudável.");

  const result = docker([
    "run", "--rm", "--network", network,
    "--mount", `type=bind,source=${repository},target=/source,readonly`,
    "--workdir", "/work",
    "--env", `MIGRATIONS_TEST_DATABASE_URL=postgresql://migration_test:${password}@${databaseContainer}:5432/migration_test`,
    "node:22-bookworm-slim",
    "sh", "-lc", fingerprintMode
      ? "cp /source/package.json /source/package-lock.json . && mkdir -p scripts/db tests/migrations database/migrations && cp /source/scripts/db/*.js scripts/db/ && cp /source/tests/migrations/print-baseline-fingerprint.js tests/migrations/ && cp /source/database/migrations/V001__baseline.sql database/migrations/ && npm ci --ignore-scripts --no-audit --no-fund && node tests/migrations/print-baseline-fingerprint.js"
      : baselineMode
        ? "cp /source/package.json /source/package-lock.json . && mkdir -p scripts/db tests/migrations database/migrations database && cp /source/scripts/db/*.js scripts/db/ && cp /source/tests/migrations/baseline-postgres17.integration.test.js tests/migrations/ && cp /source/database/migrations/*.sql database/migrations/ && cp /source/database/baseline-structure.json database/ && npm ci --ignore-scripts --no-audit --no-fund && node --test tests/migrations/baseline-postgres17.integration.test.js"
        : strictApiMode
          ? "cp /source/package.json /source/package-lock.json . && mkdir -p scripts/db server/routes tests/server database/migrations && cp /source/scripts/db/*.js scripts/db/ && cp /source/server/*.js server/ && cp /source/server/routes/*.js server/routes/ && cp /source/tests/server/*.test.js tests/server/ && cp /source/database/migrations/*.sql database/migrations/ && npm ci --ignore-scripts --no-audit --no-fund && DATABASE_STRICT_MODE=true DATABASE_URL=\"$MIGRATIONS_TEST_DATABASE_URL\" DATABASE_SSL_MODE=disable AUDIT_CLEANUP_ENABLED=true SUPABASE_URL=https://fallback.invalid SUPABASE_SERVICE_ROLE_KEY=fake node --test tests/server/*.test.js"
          : "cp /source/package.json /source/package-lock.json . && mkdir -p scripts/db tests/migrations && cp /source/scripts/db/*.js scripts/db/ && cp /source/tests/migrations/postgres17.integration.test.js tests/migrations/ && npm ci --ignore-scripts --no-audit --no-fund && node --test tests/migrations/postgres17.integration.test.js"
  ], { allowFailure: true });
  if (result.status !== 0) process.exitCode = result.status || 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
