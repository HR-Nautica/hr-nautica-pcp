import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB_PATH = path.resolve(__dirname, "../database/local_state.json");

// Force pg to ignore certificate validation when connecting to Supabase poolers.
process.env.PGSSLMODE = "no-verify";

const { Pool } = pg;

let pool;
let initialized = false;

function hasPostgresUrl() {
  return Boolean(config.database.connectionString);
}

function supabaseKey() {
  return config.supabase.serviceRoleKey || config.supabase.anonKey || "";
}

function usesSupabaseRest() {
  return !hasPostgresUrl() && Boolean(config.supabase.url && supabaseKey());
}

function usesLocalFile() {
  return !hasPostgresUrl() && !usesSupabaseRest();
}

function isoNow() {
  return new Date().toISOString();
}

async function readLocalFile() {
  try {
    const raw = await fs.readFile(LOCAL_DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    const initialData = {
      revision: 0,
      updated_at: isoNow(),
      state: {},
      audit_log: []
    };
    await writeLocalFile(initialData);
    return initialData;
  }
}

async function writeLocalFile(data) {
  await fs.mkdir(path.dirname(LOCAL_DB_PATH), { recursive: true });
  await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getPool() {
  if (usesLocalFile()) {
    throw new Error("PostgreSQL pool unavailable in local file mode.");
  }
  if (usesSupabaseRest()) {
    throw new Error("PostgreSQL pool unavailable when using Supabase REST mode.");
  }

  if (!pool) {
    const connectionString = config.database.connectionString;
    try {
      const params = new URL(connectionString);
      pool = new Pool({
        user: params.username ? decodeURIComponent(params.username) : undefined,
        password: params.password ? decodeURIComponent(params.password) : undefined,
        host: params.hostname,
        port: params.port ? Number(params.port) : 5432,
        database: params.pathname ? params.pathname.split("/")[1] : undefined,
        ssl: { rejectUnauthorized: false }
      });
    } catch (err) {
      let cleanedString = connectionString || "";
      cleanedString = cleanedString.replace(/[?&]sslmode=[^&]+/g, "");
      pool = new Pool({
        connectionString: cleanedString,
        ssl: { rejectUnauthorized: false }
      });
    }
  }
  return pool;
}

function firstValue(row, names, fallback = undefined) {
  if (!row) return fallback;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) return row[match];
  }
  return fallback;
}

function parseStoredValue(value) {
  if (value == null || value === "") return null;
  try { return JSON.parse(value); } catch { return value; }
}

function serializeValue(value) {
  return JSON.stringify(value ?? null);
}

async function withConnection(callback) {
  const p = getPool();
  const client = await p.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

function restUrl(table, params = {}) {
  const base = config.supabase.url.replace(/\/+$/, "");
  const url = new URL(`${base}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function restRequest(table, { method = "GET", params = {}, body, prefer } = {}) {
  const key = supabaseKey();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`
  };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(restUrl(table, params), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `Supabase REST error ${response.status}`);
    error.code = "SUPABASE_REST_ERROR";
    error.status = response.status;
    throw error;
  }

  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function initializeSupabaseRest() {
  const rows = await restRequest("app_revision", {
    params: { select: "revision", singleton: "eq.main", limit: 1 }
  });

  if (!Array.isArray(rows)) {
    const error = new Error("Unexpected Supabase response while checking app_revision.");
    error.code = "SUPABASE_REST_ERROR";
    throw error;
  }

  if (!rows.length) {
    await restRequest("app_revision", {
      method: "POST",
      body: [{ singleton: "main", revision: 0, updated_at: isoNow() }],
      prefer: "resolution=ignore-duplicates,return=minimal"
    });
  }
}

async function initializePostgres() {
  await withConnection(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_revision (
        singleton VARCHAR(16) PRIMARY KEY,
        revision INTEGER NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        state_key VARCHAR(100) NOT NULL,
        action VARCHAR(16) NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT,
        actor VARCHAR(100),
        created_at TIMESTAMP NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS temp_analise_producao (
        id BIGSERIAL PRIMARY KEY,
        batch_id UUID NOT NULL,
        source_row INTEGER NOT NULL,
        sku VARCHAR(120),
        produto TEXT,
        codigo_bruto VARCHAR(120),
        saidas_previstas NUMERIC(14, 3) NOT NULL DEFAULT 0,
        estoque_fisico NUMERIC(14, 3) NOT NULL DEFAULT 0,
        media_mensal NUMERIC(14, 3) NOT NULL DEFAULT 0,
        imported_by VARCHAR(100),
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_temp_analise_producao_batch
      ON temp_analise_producao (batch_id, source_row)
    `);

    const revisionRows = await client.query("SELECT revision FROM app_revision WHERE singleton = $1", ["main"]);
    if (!revisionRows.rows.length) {
      await client.query(
        "INSERT INTO app_revision (singleton, revision, updated_at) VALUES ($1, $2, $3)",
        ["main", 0, new Date()]
      );
    }
  });
}

export async function initializeDatabase() {
  if (initialized) return;

  if (usesLocalFile()) {
    await readLocalFile();
  } else if (usesSupabaseRest()) {
    await initializeSupabaseRest();
  } else {
    await initializePostgres();
  }

  initialized = true;
}

export async function transaction(callback) {
  await initializeDatabase();

  if (usesLocalFile()) {
    return await callback(null);
  }

  if (usesSupabaseRest()) {
    const error = new Error("Transactions require DATABASE_URL. Supabase REST mode handles state writes directly.");
    error.code = "REST_TRANSACTION_UNAVAILABLE";
    throw error;
  }

  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealth() {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    return db.updated_at || isoNow();
  }

  if (usesSupabaseRest()) {
    const rows = await restRequest("app_revision", {
      params: { select: "updated_at", singleton: "eq.main", limit: 1 }
    });
    return firstValue(rows?.[0], ["updated_at"], isoNow());
  }

  return withConnection(async (client) => {
    const rows = await client.query("SELECT revision, updated_at FROM app_revision WHERE singleton = $1", ["main"]);
    return firstValue(rows.rows[0], ["updated_at"], new Date());
  });
}

function normalizeAnalysisTempRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Linhas da análise devem ser uma lista.");
  if (rows.length > 10000) throw new RangeError("A importação excede o limite de 10.000 linhas.");

  const numeric = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };

  return rows.map((row, index) => ({
    sourceRow: Math.max(1, Number.parseInt(row.sourceRow, 10) || index + 1),
    sku: String(row.sku || "").trim().slice(0, 120),
    produto: String(row.produto || "").trim(),
    codigoBruto: String(row.codigoBruto || "").trim().slice(0, 120),
    saidasPrevistas: numeric(row.saidasPrevistas),
    estoqueFisico: numeric(row.estoqueFisico),
    mediaMensal: numeric(row.mediaMensal)
  })).filter(row => row.sku || row.produto);
}

function mapAnalysisTempRow(row) {
  return {
    sourceRow: Number(firstValue(row, ["source_row"], 0)),
    sku: String(firstValue(row, ["sku"], "") || ""),
    produto: String(firstValue(row, ["produto"], "") || ""),
    codigoBruto: String(firstValue(row, ["codigo_bruto"], "") || ""),
    saidasPrevistas: Number(firstValue(row, ["saidas_previstas"], 0)),
    estoqueFisico: Number(firstValue(row, ["estoque_fisico"], 0)),
    mediaMensal: Number(firstValue(row, ["media_mensal"], 0)),
    batchId: String(firstValue(row, ["batch_id"], "") || ""),
    importedBy: String(firstValue(row, ["imported_by"], "") || ""),
    importedAt: firstValue(row, ["imported_at"], null)
  };
}

export async function getAnalysisTempRows() {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    return Array.isArray(db.analysis_temp?.rows) ? db.analysis_temp.rows : [];
  }

  if (usesSupabaseRest()) {
    const latest = await restRequest("temp_analise_producao", {
      params: { select: "batch_id", order: "imported_at.desc", limit: 1 }
    });
    const batchId = firstValue(latest?.[0], ["batch_id"], "");
    if (!batchId) return [];
    const rows = await restRequest("temp_analise_producao", {
      params: {
        select: "source_row,sku,produto,codigo_bruto,saidas_previstas,estoque_fisico,media_mensal,batch_id,imported_by,imported_at",
        batch_id: `eq.${batchId}`,
        order: "source_row.asc"
      }
    });
    return (rows || []).map(mapAnalysisTempRow);
  }

  return withConnection(async (client) => {
    const result = await client.query(`
      SELECT source_row, sku, produto, codigo_bruto, saidas_previstas,
             estoque_fisico, media_mensal, batch_id, imported_by, imported_at
      FROM temp_analise_producao
      WHERE batch_id = (
        SELECT batch_id FROM temp_analise_producao ORDER BY imported_at DESC, id DESC LIMIT 1
      )
      ORDER BY source_row, id
    `);
    return result.rows.map(mapAnalysisTempRow);
  });
}

export async function replaceAnalysisTempRows(rows, actor = "") {
  await initializeDatabase();
  const normalized = normalizeAnalysisTempRows(rows);
  if (!normalized.length) throw new RangeError("A importação não possui linhas identificáveis.");

  const batchId = randomUUID();
  const importedAt = isoNow();
  const importedBy = String(actor || "").trim().slice(0, 100);

  if (usesLocalFile()) {
    const db = await readLocalFile();
    db.analysis_temp = {
      batchId,
      importedAt,
      rows: normalized.map(row => ({ ...row, batchId, importedBy, importedAt }))
    };
    db.updated_at = importedAt;
    await writeLocalFile(db);
    return { batchId, count: normalized.length, importedAt };
  }

  const records = normalized.map(row => ({
    batch_id: batchId,
    source_row: row.sourceRow,
    sku: row.sku || null,
    produto: row.produto || null,
    codigo_bruto: row.codigoBruto || null,
    saidas_previstas: row.saidasPrevistas,
    estoque_fisico: row.estoqueFisico,
    media_mensal: row.mediaMensal,
    imported_by: importedBy || null,
    imported_at: importedAt
  }));

  if (usesSupabaseRest()) {
    await restRequest("temp_analise_producao", {
      method: "POST",
      body: records,
      prefer: "return=minimal"
    });
    await restRequest("temp_analise_producao", {
      method: "DELETE",
      params: { batch_id: `neq.${batchId}` },
      prefer: "return=minimal"
    });
    return { batchId, count: normalized.length, importedAt };
  }

  return transaction(async (client) => {
    const columnsPerRow = 10;
    const values = [];
    const placeholders = normalized.map((row, rowIndex) => {
      const offset = rowIndex * columnsPerRow;
      values.push(
        batchId, row.sourceRow, row.sku || null, row.produto || null,
        row.codigoBruto || null, row.saidasPrevistas, row.estoqueFisico,
        row.mediaMensal, importedBy || null, importedAt
      );
      return `(${Array.from({ length: columnsPerRow }, (_, index) => `$${offset + index + 1}`).join(",")})`;
    });

    await client.query(`
      INSERT INTO temp_analise_producao (
        batch_id, source_row, sku, produto, codigo_bruto, saidas_previstas,
        estoque_fisico, media_mensal, imported_by, imported_at
      ) VALUES ${placeholders.join(",")}
    `, values);
    await client.query("DELETE FROM temp_analise_producao WHERE batch_id <> $1", [batchId]);
    return { batchId, count: normalized.length, importedAt };
  });
}

export async function getStateSnapshot(requestedRevision = 0) {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const revision = Number(db.revision || 0);
    if (requestedRevision && requestedRevision === revision) {
      return { modified: false, revision };
    }

    const data = {};
    const versions = {};
    for (const [key, item] of Object.entries(db.state || {})) {
      data[key] = item.value;
      versions[key] = Number(item.version || 0);
    }
    return { modified: true, revision, data, versions };
  }

  if (usesSupabaseRest()) {
    const revisionRows = await restRequest("app_revision", {
      params: { select: "revision", singleton: "eq.main", limit: 1 }
    });
    const revision = Number(firstValue(revisionRows?.[0], ["revision"], 0));
    if (requestedRevision && requestedRevision === revision) {
      return { modified: false, revision };
    }

    const rows = await restRequest("app_state", {
      params: { select: "key,value,version", order: "key.asc" }
    });
    const data = {};
    const versions = {};
    for (const row of rows || []) {
      const key = firstValue(row, ["key"]);
      data[key] = parseStoredValue(firstValue(row, ["value"]));
      versions[key] = Number(firstValue(row, ["version"], 0));
    }
    return { modified: true, revision, data, versions };
  }

  return withConnection(async (client) => {
    const revisionRows = await client.query("SELECT revision FROM app_revision WHERE singleton = $1", ["main"]);
    const revision = Number(firstValue(revisionRows.rows[0], ["revision"], 0));
    if (requestedRevision && requestedRevision === revision) {
      return { modified: false, revision };
    }

    const rows = await client.query("SELECT key, value, version FROM app_state ORDER BY key");
    const data = {};
    const versions = {};
    for (const row of rows.rows) {
      const key = firstValue(row, ["key"]);
      data[key] = parseStoredValue(firstValue(row, ["value"]));
      versions[key] = Number(firstValue(row, ["version"], 0));
    }
    return { modified: true, revision, data, versions };
  });
}

function versionConflict(current) {
  const error = new Error("VERSION_CONFLICT");
  error.status = 409;
  error.currentVersion = current;
  return error;
}

export async function upsertState(key, value, expectedVersion, actor = "") {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const currentItem = db.state[key];
    const current = currentItem ? Number(currentItem.version || 0) : 0;
    if (current !== expectedVersion) throw versionConflict(current);

    const nextVersion = current + 1;
    const now = isoNow();
    db.state[key] = {
      value,
      version: nextVersion,
      updated_at: now
    };
    db.revision = Number(db.revision || 0) + 1;
    db.updated_at = now;
    if (!Array.isArray(db.audit_log)) db.audit_log = [];
    db.audit_log.push({
      id: db.audit_log.length + 1,
      state_key: key,
      action: "UPSERT",
      version: nextVersion,
      payload: serializeValue(value),
      actor,
      created_at: now
    });
    await writeLocalFile(db);
    return { version: nextVersion, revision: db.revision };
  }

  if (usesSupabaseRest()) return upsertStateRest(key, value, expectedVersion, actor);

  return transaction(async (client) => {
    const current = await currentVersion(client, key);
    if (current !== expectedVersion) throw versionConflict(current);

    const nextVersion = current + 1;
    const now = new Date();
    const payload = serializeValue(value);
    if (current === 0) {
      await client.query(
        "INSERT INTO app_state (key, value, version, updated_at) VALUES ($1, $2, $3, $4)",
        [key, payload, nextVersion, now]
      );
    } else {
      await client.query(
        "UPDATE app_state SET value = $1, version = $2, updated_at = $3 WHERE key = $4",
        [payload, nextVersion, now, key]
      );
    }

    const revision = await incrementRevision(client);
    await client.query(
      "INSERT INTO audit_log (state_key, action, version, payload, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [key, "UPSERT", nextVersion, payload, actor, now]
    );
    return { version: nextVersion, revision };
  });
}

export async function deleteState(key, expectedVersion, actor = "") {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const currentItem = db.state[key];
    const current = currentItem ? Number(currentItem.version || 0) : 0;
    if (current !== expectedVersion) throw versionConflict(current);

    delete db.state[key];
    db.revision = Number(db.revision || 0) + 1;
    const now = isoNow();
    db.updated_at = now;
    if (!Array.isArray(db.audit_log)) db.audit_log = [];
    db.audit_log.push({
      id: db.audit_log.length + 1,
      state_key: key,
      action: "DELETE",
      version: current + 1,
      actor,
      created_at: now
    });
    await writeLocalFile(db);
    return { revision: db.revision };
  }

  if (usesSupabaseRest()) return deleteStateRest(key, expectedVersion, actor);

  return transaction(async (client) => {
    const current = await currentVersion(client, key);
    if (current !== expectedVersion) throw versionConflict(current);

    const now = new Date();
    await client.query("DELETE FROM app_state WHERE key = $1", [key]);
    const revision = await incrementRevision(client);
    await client.query(
      "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES ($1, $2, $3, $4, $5)",
      [key, "DELETE", current + 1, actor, now]
    );
    return { revision };
  });
}

export async function importState(entries, actor = "IMPORT") {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const now = isoNow();
    for (const [key, value] of entries) {
      const currentItem = db.state[key];
      const current = currentItem ? Number(currentItem.version || 0) : 0;
      const nextVersion = current + 1;
      db.state[key] = {
        value,
        version: nextVersion,
        updated_at: now
      };
      if (!Array.isArray(db.audit_log)) db.audit_log = [];
      db.audit_log.push({
        id: db.audit_log.length + 1,
        state_key: key,
        action: "IMPORT",
        version: nextVersion,
        payload: serializeValue(value),
        actor,
        created_at: now
      });
    }
    db.revision = Number(db.revision || 0) + 1;
    db.updated_at = now;
    await writeLocalFile(db);
    return { revision: db.revision };
  }

  if (usesSupabaseRest()) return importStateRest(entries, actor);

  return transaction(async (client) => {
    const now = new Date();
    for (const [key, value] of entries) {
      const current = await currentVersion(client, key);
      const nextVersion = current + 1;
      const payload = serializeValue(value);
      if (current === 0) {
        await client.query(
          "INSERT INTO app_state (key, value, version, updated_at) VALUES ($1, $2, $3, $4)",
          [key, payload, nextVersion, now]
        );
      } else {
        await client.query(
          "UPDATE app_state SET value = $1, version = $2, updated_at = $3 WHERE key = $4",
          [payload, nextVersion, now, key]
        );
      }
      await client.query(
        "INSERT INTO audit_log (state_key, action, version, payload, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [key, "IMPORT", nextVersion, payload, actor, now]
      );
    }
    return { revision: await incrementRevision(client) };
  });
}

// Helpers for REST
async function incrementRevision(client) {
  const now = new Date();
  await client.query("UPDATE app_revision SET revision = revision + 1, updated_at = $1 WHERE singleton = $2", [now, "main"]);
  const rows = await client.query("SELECT revision FROM app_revision WHERE singleton = $1", ["main"]);
  return Number(firstValue(rows.rows[0], ["revision"], 0));
}

async function incrementRevisionRest() {
  const now = isoNow();
  const rows = await restRequest("app_revision", {
    params: { select: "revision", singleton: "eq.main", limit: 1 }
  });
  const nextRevision = Number(firstValue(rows?.[0], ["revision"], 0)) + 1;
  await restRequest("app_revision", {
    method: "PATCH",
    params: { singleton: "eq.main" },
    body: { revision: nextRevision, updated_at: now },
    prefer: "return=minimal"
  });
  return nextRevision;
}

async function currentVersion(client, key) {
  const rows = await client.query("SELECT version FROM app_state WHERE key = $1", [key]);
  return Number(firstValue(rows.rows[0], ["version"], 0));
}

async function currentVersionRest(key) {
  const rows = await restRequest("app_state", {
    params: { select: "version", key: `eq.${key}`, limit: 1 }
  });
  return Number(firstValue(rows?.[0], ["version"], 0));
}

async function insertAuditRest({ stateKey, action, version, payload, actor, createdAt }) {
  await restRequest("audit_log", {
    method: "POST",
    body: [{
      state_key: stateKey,
      action,
      version,
      payload,
      actor,
      created_at: createdAt
    }],
    prefer: "return=minimal"
  });
}

async function upsertStateRest(key, value, expectedVersion, actor = "") {
  const current = await currentVersionRest(key);
  if (current !== expectedVersion) throw versionConflict(current);

  const nextVersion = current + 1;
  const now = isoNow();
  const payload = serializeValue(value);

  if (current === 0) {
    await restRequest("app_state", {
      method: "POST",
      body: [{ key, value: payload, version: nextVersion, updated_at: now }],
      prefer: "return=minimal"
    });
  } else {
    await restRequest("app_state", {
      method: "PATCH",
      params: { key: `eq.${key}` },
      body: { value: payload, version: nextVersion, updated_at: now },
      prefer: "return=minimal"
    });
  }

  const revision = await incrementRevisionRest();
  await insertAuditRest({ stateKey: key, action: "UPSERT", version: nextVersion, payload, actor, createdAt: now });
  return { version: nextVersion, revision };
}

async function deleteStateRest(key, expectedVersion, actor = "") {
  const current = await currentVersionRest(key);
  if (current !== expectedVersion) throw versionConflict(current);

  const now = isoNow();
  await restRequest("app_state", {
    method: "DELETE",
    params: { key: `eq.${key}` },
    prefer: "return=minimal"
  });
  const revision = await incrementRevisionRest();
  await insertAuditRest({ stateKey: key, action: "DELETE", version: current + 1, actor, createdAt: now });
  return { revision };
}

async function importStateRest(entries, actor = "IMPORT") {
  const now = isoNow();
  for (const [key, value] of entries) {
    const current = await currentVersionRest(key);
    const nextVersion = current + 1;
    const payload = serializeValue(value);

    if (current === 0) {
      await restRequest("app_state", {
        method: "POST",
        body: [{ key, value: payload, version: nextVersion, updated_at: now }],
        prefer: "return=minimal"
      });
    } else {
      await restRequest("app_state", {
        method: "PATCH",
        params: { key: `eq.${key}` },
        body: { value: payload, version: nextVersion, updated_at: now },
        prefer: "return=minimal"
      });
    }

    await insertAuditRest({ stateKey: key, action: "IMPORT", version: nextVersion, payload, actor, createdAt: now });
  }
  return { revision: await incrementRevisionRest() };
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
  initialized = false;
}
