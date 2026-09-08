import pg from "pg";

import { config } from "../server/config.js";

if (!config.database.connectionString) {
  throw new Error("DATABASE_URL nao configurada; a auditoria requer acesso PostgreSQL somente leitura.");
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

async function queryOrError(label, sql) {
  try {
    const result = await client.query(sql);
    return { label, rows: result.rows };
  } catch (error) {
    return { label, error: error.code || error.message };
  }
}

await client.connect();
try {
  const reports = [];
  reports.push(await queryOrError("tables", `
      SELECT schemaname, relname, n_live_tup,
             pg_total_relation_size(format('%I.%I', schemaname, relname)) AS bytes
      FROM pg_stat_user_tables
      ORDER BY bytes DESC
    `));
  reports.push(await queryOrError("audit_log", `
      SELECT count(*)::bigint AS rows, min(created_at) AS oldest, max(created_at) AS newest,
             coalesce(sum(octet_length(payload)), 0)::bigint AS payload_bytes
      FROM public.audit_log
    `));
  reports.push(await queryOrError("audit_log_top_keys", `
      SELECT state_key, action, count(*)::bigint AS rows,
             coalesce(sum(octet_length(payload)), 0)::bigint AS payload_bytes,
             max(created_at) AS newest
      FROM public.audit_log
      GROUP BY state_key, action
      ORDER BY payload_bytes DESC
      LIMIT 20
    `));
  reports.push(await queryOrError("audit_log_top_row_counts", `
      SELECT state_key, action, count(*)::bigint AS rows,
             count(payload)::bigint AS rows_with_payload,
             coalesce(sum(octet_length(payload)), 0)::bigint AS payload_bytes,
             min(created_at) AS oldest, max(created_at) AS newest
      FROM public.audit_log
      GROUP BY state_key, action
      ORDER BY rows DESC
      LIMIT 20
    `));
  reports.push(await queryOrError("audit_log_age", `
      SELECT count(*) FILTER (WHERE created_at < now() - interval '30 days')::bigint AS older_30d,
             count(*) FILTER (WHERE created_at < now() - interval '60 days')::bigint AS older_60d,
             count(*) FILTER (WHERE created_at < now() - interval '90 days')::bigint AS older_90d
      FROM public.audit_log
    `));
  reports.push(await queryOrError("audit_cleanup_preview", `
      SELECT count(*) FILTER (
               WHERE created_at < now() - interval '30 days'
                  OR (action = 'DELETE' AND version = 1)
             )::bigint AS rows_to_delete,
             count(*) FILTER (
               WHERE created_at >= now() - interval '30 days'
                 AND NOT (action = 'DELETE' AND version = 1)
             )::bigint AS rows_to_keep
      FROM public.audit_log
    `));
  reports.push(await queryOrError("temp_analise_producao", `
      SELECT count(*)::bigint AS rows, count(DISTINCT batch_id)::bigint AS batches,
             min(imported_at) AS oldest, max(imported_at) AS newest
      FROM public.temp_analise_producao
    `));
  reports.push(await queryOrError("app_state", `
      SELECT count(*)::bigint AS rows, coalesce(sum(octet_length(value)), 0)::bigint AS payload_bytes,
             max(octet_length(value)) AS largest_payload
      FROM public.app_state
    `));
  reports.push(await queryOrError("raw_stock_sources", `
      SELECT
        coalesce((SELECT jsonb_array_length(value::jsonb) FROM public.app_state WHERE key = 'hrn_modelos'), 0) AS models,
        coalesce((SELECT count(DISTINCT nullif(btrim(item->>'codigoBruto'), ''))
                  FROM public.app_state state,
                       jsonb_array_elements(state.value::jsonb) item
                  WHERE state.key = 'hrn_modelos'), 0) AS raw_codes,
        coalesce((SELECT jsonb_array_length(value::jsonb) FROM public.app_state WHERE key = 'hrn_ops'), 0) AS manual_ops,
        (SELECT count(*) FROM public.temp_analise_producao WHERE estoque_fisico <> 0) AS temp_nonzero_stock,
        coalesce((SELECT count(*) FROM public.app_state state, jsonb_array_elements(state.value::jsonb) item
                  WHERE state.key = 'hrn_materiais' AND item ? 'rawCode'), 0) AS raw_stock_items,
        coalesce((SELECT count(*) FROM public.app_state state, jsonb_array_elements(state.value::jsonb) item
                  WHERE state.key = 'hrn_materiais' AND item ? 'rawCode' AND (item->>'saldo')::numeric <> 0), 0) AS raw_stock_nonzero,
        coalesce((SELECT count(*) FROM public.app_state state, jsonb_array_elements(state.value::jsonb) item
                  WHERE state.key = 'hrn_movimentos' AND item->>'usuario' = 'QA_RAW_STOCK'), 0) AS qa_movements
    `));
  reports.push(await queryOrError("storage.objects", `
      SELECT bucket_id, count(*)::bigint AS objects,
             coalesce(sum((metadata->>'size')::bigint), 0)::bigint AS bytes,
             min(created_at) AS oldest, max(created_at) AS newest
      FROM storage.objects
      GROUP BY bucket_id
      ORDER BY bytes DESC
    `));

  for (const report of reports) {
    console.log(`\n[${report.label}]`);
    if (report.error) console.log(`indisponivel: ${report.error}`);
    else console.table(report.rows);
  }
} finally {
  await client.end();
}
