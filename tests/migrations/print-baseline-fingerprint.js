import path from "node:path";
import pg from "pg";
import { migrate } from "../../scripts/db/migration-runner.js";
import { fingerprintSnapshot, inspectPublicSchema } from "../../scripts/db/schema-inspector.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString || !/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) {
  throw new Error("URL descartável de teste inválida.");
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await migrate({ client, directory: path.resolve("database", "migrations"), operator: "fingerprint.test" });
  const snapshot = await inspectPublicSchema(client);
  console.log(`BASELINE_FINGERPRINT=${JSON.stringify(fingerprintSnapshot(snapshot))}`);
} finally {
  await client.end().catch(() => {});
}
