import { createHash } from "node:crypto";

const QUERIES = {
  tables: `
    SELECT c.relname AS table_name, c.relkind, c.relpersistence,
           am.amname AS access_method, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname <> 'schema_migrations'
    ORDER BY c.relname
  `,
  columns: `
    SELECT c.relname AS table_name, a.attnum AS ordinal_position, a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid, true) AS column_default,
           a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
           CASE WHEN a.attcollation <> t.typcollation
                THEN quote_ident(cn.nspname) || '.' || quote_ident(coll.collname)
                ELSE NULL END AS collation
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid = coll.collnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname <> 'schema_migrations' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `,
  sequences: `
    SELECT c.relname AS sequence_name,
           pg_catalog.format_type(s.seqtypid, NULL) AS data_type,
           s.seqstart::text AS start_value, s.seqincrement::text AS increment_by,
           s.seqmin::text AS min_value, s.seqmax::text AS max_value,
           s.seqcache::text AS cache_size, s.seqcycle AS cycle,
           CASE WHEN owned_table.oid IS NULL THEN NULL
                ELSE owned_table.relname || '.' || owned_column.attname END AS owned_by
    FROM pg_catalog.pg_sequence s
    JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_depend dep ON dep.objid = c.oid AND dep.classid = 'pg_class'::regclass
      AND dep.refclassid = 'pg_class'::regclass AND dep.deptype = 'a'
    LEFT JOIN pg_catalog.pg_class owned_table ON owned_table.oid = dep.refobjid
    LEFT JOIN pg_catalog.pg_attribute owned_column ON owned_column.attrelid = dep.refobjid
      AND owned_column.attnum = dep.refobjsubid
    WHERE n.nspname = 'public'
    ORDER BY c.relname
  `,
  constraints: `
    SELECT table_class.relname AS table_name, con.conname AS constraint_name,
           con.contype AS constraint_type,
           pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
           con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
           con.convalidated AS validated
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class table_class ON table_class.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
    WHERE n.nspname = 'public' AND table_class.relname <> 'schema_migrations'
    ORDER BY table_class.relname, con.conname
  `,
  indexes: `
    SELECT table_class.relname AS table_name, index_class.relname AS index_name,
           idx.indisunique AS is_unique, idx.indisprimary AS is_primary,
           idx.indisvalid AS is_valid,
           pg_catalog.pg_get_indexdef(index_class.oid, 0, true) AS definition
    FROM pg_catalog.pg_index idx
    JOIN pg_catalog.pg_class table_class ON table_class.oid = idx.indrelid
    JOIN pg_catalog.pg_class index_class ON index_class.oid = idx.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
    WHERE n.nspname = 'public' AND table_class.relname <> 'schema_migrations'
    ORDER BY table_class.relname, index_class.relname
  `,
  views: `
    SELECT c.relname AS view_name, c.relkind,
           pg_catalog.pg_get_viewdef(c.oid, true) AS definition
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname
  `,
  functions: `
    SELECT p.proname AS function_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
           pg_catalog.pg_get_function_result(p.oid) AS result_type,
           p.prokind, p.provolatile, p.prosecdef,
           pg_catalog.pg_get_functiondef(p.oid) AS definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
  `,
  triggers: `
    SELECT table_class.relname AS table_name, trigger.tgname AS trigger_name,
           pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition,
           trigger.tgenabled
    FROM pg_catalog.pg_trigger trigger
    JOIN pg_catalog.pg_class table_class ON table_class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
    WHERE n.nspname = 'public' AND NOT trigger.tgisinternal
    ORDER BY table_class.relname, trigger.tgname
  `,
  policies: `
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    ORDER BY tablename, policyname
  `
};

function normalizeValue(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return value;
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : normalizeValue(value)])
  ));
}

export function canonicalJson(value) {
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export async function inspectPublicSchema(client) {
  const snapshot = {};
  for (const [section, query] of Object.entries(QUERIES)) {
    const result = await client.query(query);
    snapshot[section] = normalizeRows(result.rows);
  }
  return snapshot;
}

export function fingerprintSnapshot(snapshot) {
  return {
    sha256: sha256(snapshot),
    sections: Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, sha256(rows)]))
  };
}

export function compareStructure(snapshot, expected) {
  const actual = fingerprintSnapshot(snapshot);
  const differingSections = Object.keys(expected.sections).filter((name) => actual.sections[name] !== expected.sections[name]);
  const unexpectedSections = Object.keys(actual.sections).filter((name) => !(name in expected.sections));
  return {
    equivalent: actual.sha256 === expected.sha256 && differingSections.length === 0 && unexpectedSections.length === 0,
    expectedSha256: expected.sha256,
    actualSha256: actual.sha256,
    differingSections,
    unexpectedSections
  };
}
