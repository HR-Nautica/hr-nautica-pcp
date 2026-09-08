import pg from "pg";

import { config } from "../server/config.js";

if (!process.argv.includes("--apply")) {
  throw new Error("Compactacao bloqueada. Execute com --apply apos revisar e autorizar a operacao.");
}
if (!config.database.connectionString) {
  throw new Error("DATABASE_URL nao configurada.");
}

const url = new URL(config.database.connectionString);
const client = new pg.Client({
  user: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  host: url.hostname,
  port: url.port ? Number(url.port) : 5432,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: config.database.sslRejectUnauthorized }
});

await client.connect();
try {
  const before = await client.query(`
    SELECT count(*)::bigint AS rows,
           pg_total_relation_size('public.audit_log')::bigint AS bytes
    FROM public.audit_log
  `);
  console.log("Antes:", before.rows[0]);

  await client.query("VACUUM (FULL, ANALYZE) public.audit_log");

  const after = await client.query(`
    SELECT count(*)::bigint AS rows,
           pg_total_relation_size('public.audit_log')::bigint AS bytes
    FROM public.audit_log
  `);
  console.log("Depois:", after.rows[0]);
} finally {
  await client.end();
}
