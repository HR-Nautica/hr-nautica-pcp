import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";
import { buildPostgresConnectionOptions } from "./postgres-config.js";
import { assertGenericStateWriteAllowed } from "./state-write-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB_PATH = path.resolve(__dirname, "../database/local_state.json");

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
  if (config.database.strictMode) return false;
  return !hasPostgresUrl() && Boolean(config.supabase.url && supabaseKey());
}

function usesLocalFile() {
  if (config.database.strictMode) return false;
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
  if (config.database.strictMode && !hasPostgresUrl()) {
    const error = new Error("DATABASE_URL is required in strict mode.");
    error.code = "DATABASE_CONFIG_MISSING";
    throw error;
  }
  if (usesLocalFile()) {
    throw new Error("PostgreSQL pool unavailable in local file mode.");
  }
  if (usesSupabaseRest()) {
    throw new Error("PostgreSQL pool unavailable when using Supabase REST mode.");
  }

  if (!pool) {
    const connectionString = config.database.connectionString;
    if (config.database.strictMode || config.database.sslMode) {
      pool = new Pool(buildPostgresConnectionOptions(connectionString, config.database));
      return pool;
    }
    try {
      const params = new URL(connectionString);
      pool = new Pool({
        user: params.username ? decodeURIComponent(params.username) : undefined,
        password: params.password ? decodeURIComponent(params.password) : undefined,
        host: params.hostname,
        port: params.port ? Number(params.port) : 5432,
        database: params.pathname ? params.pathname.split("/")[1] : undefined,
        ssl: { rejectUnauthorized: config.database.sslRejectUnauthorized }
      });
    } catch (err) {
      let cleanedString = connectionString || "";
      cleanedString = cleanedString.replace(/[?&]sslmode=[^&]+/g, "");
      pool = new Pool({
        connectionString: cleanedString,
        ssl: { rejectUnauthorized: config.database.sslRejectUnauthorized }
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

export async function withConnection(callback) {
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

  await pruneAuditLogRest();
}

function auditCutoff() {
  return new Date(Date.now() - config.auditRetentionDays * 24 * 60 * 60 * 1000);
}

async function pruneAuditLogRest() {
  if (!config.auditCleanupEnabled || !config.supabase.serviceRoleKey) return;
  await restRequest("audit_log", {
    method: "DELETE",
    params: { action: "eq.DELETE", version: "eq.1" },
    prefer: "return=minimal"
  });
  await restRequest("audit_log", {
    method: "DELETE",
    params: { created_at: `lt.${auditCutoff().toISOString()}` },
    prefer: "return=minimal"
  });
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
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
      ON audit_log (created_at)
    `);

    if (config.auditCleanupEnabled) {
      await client.query(
        "DELETE FROM audit_log WHERE created_at < $1 OR (action = 'DELETE' AND version = 1)",
        [auditCutoff()]
      );
    }

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

    await client.query(`CREATE SEQUENCE IF NOT EXISTS helice_op_number_seq START WITH 1`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS helice_production_orders (
        id BIGSERIAL PRIMARY KEY,
        op_number VARCHAR(24) NOT NULL UNIQUE DEFAULT ('OPH-' || LPAD(nextval('helice_op_number_seq')::TEXT, 6, '0')),
        source_key VARCHAR(255) NOT NULL UNIQUE,
        source_file TEXT NOT NULL,
        source_sheet TEXT NOT NULL,
        source_row INTEGER NOT NULL,
        entry_date DATE,
        description TEXT NOT NULL,
        priority TEXT,
        sku VARCHAR(120) NOT NULL,
        raw_code VARCHAR(120),
        operations JSONB NOT NULL DEFAULT '[]'::JSONB,
        operation_history JSONB NOT NULL DEFAULT '[]'::JSONB,
        current_operation VARCHAR(2) NOT NULL DEFAULT '01',
        current_operation_name TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        spreadsheet_location TEXT,
        elapsed_time TEXT,
        status VARCHAR(24) NOT NULL DEFAULT 'em_producao',
        finished_at TIMESTAMPTZ,
        finished_by VARCHAR(100),
        imported_by VARCHAR(100),
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE helice_production_orders ADD COLUMN IF NOT EXISTS finished_by VARCHAR(100)`);
    await client.query(`ALTER TABLE helice_production_orders ADD COLUMN IF NOT EXISTS operation_history JSONB NOT NULL DEFAULT '[]'::JSONB`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_helice_production_orders_status
      ON helice_production_orders (status, current_operation, op_number)
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

  if (config.database.strictMode) {
    await withConnection((client) => client.query("SELECT 1"));
    initialized = true;
    return;
  }

  if (usesLocalFile()) {
    const db = await readLocalFile();
    if (!config.auditCleanupEnabled) {
      initialized = true;
      return;
    }
    const cutoff = auditCutoff().toISOString();
    const currentAudit = Array.isArray(db.audit_log) ? db.audit_log : [];
    const retainedAudit = currentAudit.filter((entry) => {
      const isNoopDelete = entry.action === "DELETE" && Number(entry.version) === 1;
      return !isNoopDelete && (!entry.created_at || entry.created_at >= cutoff);
    });
    if (retainedAudit.length !== currentAudit.length) {
      db.audit_log = retainedAudit;
      await writeLocalFile(db);
    }
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

function normalizeHeliceProductionRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("As OPs de hélices devem ser uma lista.");
  if (rows.length > 5000) throw new RangeError("A importação excede o limite de 5.000 OPs.");

  return rows.map((row, index) => {
    const sourceFile = String(row.sourceFile || "Acompanhamento_Helice.xlsx").trim();
    const sourceSheet = String(row.sourceSheet || "prod-comp helices").trim();
    const sourceRow = Math.max(1, Number.parseInt(row.sourceRow, 10) || index + 1);
    const operations = Array.isArray(row.operations) ? row.operations.slice(0, 9).map((operation, operationIndex) => ({
      code: String(operation.code || operationIndex + 1).padStart(2, "0").slice(-2),
      name: String(operation.name || `Operação ${operationIndex + 1}`).trim(),
      quantity: operation.quantity === null || operation.quantity === undefined || operation.quantity === ""
        ? null
        : Math.max(0, Number.parseInt(operation.quantity, 10) || 0)
    })) : [];
    const currentOperation = String(row.currentOperation || "01").padStart(2, "0").slice(-2);
    const status = row.status === "finalizada" ? "finalizada" : "em_producao";

    return {
      sourceKey: String(row.sourceKey || `${sourceFile}|${sourceSheet}|${sourceRow}`).slice(0, 255),
      sourceFile,
      sourceSheet,
      sourceRow,
      entryDate: row.entryDate || null,
      description: String(row.description || "").trim(),
      priority: String(row.priority || "").trim(),
      sku: String(row.sku || "").trim().slice(0, 120),
      rawCode: String(row.rawCode || "").trim().slice(0, 120),
      operations,
      currentOperation,
      currentOperationName: String(row.currentOperationName || "").trim(),
      quantity: Math.max(0, Number.parseInt(row.quantity, 10) || 0),
      spreadsheetLocation: String(row.spreadsheetLocation || "").trim(),
      elapsedTime: String(row.elapsedTime || "").trim(),
      status,
      finishedAt: row.finishedAt || null
    };
  }).filter(row => row.sku && row.description);
}

function mapHeliceProductionRow(row) {
  const operations = firstValue(row, ["operations"], []);
  return {
    id: String(firstValue(row, ["id"], "")),
    opNumber: String(firstValue(row, ["op_number", "opNumber"], "")),
    sourceKey: String(firstValue(row, ["source_key", "sourceKey"], "")),
    sourceFile: String(firstValue(row, ["source_file", "sourceFile"], "")),
    sourceSheet: String(firstValue(row, ["source_sheet", "sourceSheet"], "")),
    sourceRow: Number(firstValue(row, ["source_row", "sourceRow"], 0)),
    entryDate: firstValue(row, ["entry_date", "entryDate"], null),
    description: String(firstValue(row, ["description"], "")),
    priority: String(firstValue(row, ["priority"], "")),
    sku: String(firstValue(row, ["sku"], "")),
    rawCode: String(firstValue(row, ["raw_code", "rawCode"], "")),
    operations: Array.isArray(operations) ? operations : parseStoredValue(operations) || [],
    operationHistory: (() => {
      const history = firstValue(row, ["operation_history", "operationHistory"], []);
      return Array.isArray(history) ? history : parseStoredValue(history) || [];
    })(),
    currentOperation: String(firstValue(row, ["current_operation", "currentOperation"], "01")),
    currentOperationName: String(firstValue(row, ["current_operation_name", "currentOperationName"], "")),
    quantity: Number(firstValue(row, ["quantity"], 0)),
    spreadsheetLocation: String(firstValue(row, ["spreadsheet_location", "spreadsheetLocation"], "")),
    elapsedTime: String(firstValue(row, ["elapsed_time", "elapsedTime"], "")),
    status: String(firstValue(row, ["status"], "em_producao")),
    finishedAt: firstValue(row, ["finished_at", "finishedAt"], null),
    finishedBy: String(firstValue(row, ["finished_by", "finishedBy"], "") || ""),
    importedAt: firstValue(row, ["imported_at", "importedAt"], null),
    updatedAt: firstValue(row, ["updated_at", "updatedAt"], null)
  };
}

export async function getHeliceProductionOrders() {
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    return (db.helice_production_orders || []).map(mapHeliceProductionRow);
  }

  if (usesSupabaseRest()) {
    const rows = await restRequest("helice_production_orders", {
      params: { select: "*", order: "op_number.asc" }
    });
    return (rows || []).map(mapHeliceProductionRow);
  }

  return withConnection(async (client) => {
    const result = await client.query("SELECT * FROM helice_production_orders ORDER BY op_number");
    return result.rows.map(mapHeliceProductionRow);
  });
}

export async function importHeliceProductionOrders(rows, actor = "") {
  await initializeDatabase();
  const normalized = normalizeHeliceProductionRows(rows);
  if (!normalized.length) throw new RangeError("A planilha não possui OPs de hélices identificáveis.");
  const importedBy = String(actor || "IMPORT_PLANILHA").trim().slice(0, 100);
  const importedAt = isoNow();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const existing = new Map((db.helice_production_orders || []).map(row => [row.sourceKey, row]));
    let sequence = Number(db.helice_op_sequence || 0);
    for (const row of normalized) {
      const previous = existing.get(row.sourceKey);
      if (!previous) sequence++;
      const hasManualHistory = Array.isArray(previous?.operationHistory) && previous.operationHistory.length > 0;
      existing.set(row.sourceKey, {
        ...previous,
        ...row,
        ...(hasManualHistory ? {
          operations: previous.operations,
          currentOperation: previous.currentOperation,
          currentOperationName: previous.currentOperationName,
          quantity: previous.quantity
        } : {}),
        id: previous?.id || String(sequence),
        opNumber: previous?.opNumber || `OPH-${String(sequence).padStart(6, "0")}`,
        status: previous?.status === "finalizada" ? "finalizada" : row.status,
        finishedAt: previous?.status === "finalizada" ? previous.finishedAt : row.finishedAt,
        importedBy,
        importedAt,
        updatedAt: importedAt
      });
    }
    db.helice_op_sequence = sequence;
    db.helice_production_orders = [...existing.values()];
    db.updated_at = importedAt;
    await writeLocalFile(db);
    return { count: normalized.length, importedAt };
  }

  if (usesSupabaseRest()) {
    const existingRows = await restRequest("helice_production_orders", {
      params: { select: "source_key,status,finished_at,operation_history,operations,current_operation,current_operation_name,quantity" }
    });
    const existingByKey = new Map((existingRows || []).map(row => [row.source_key, row]));
    const records = normalized.map(row => {
      const previous = existingByKey.get(row.sourceKey);
      const hasManualHistory = Array.isArray(previous?.operation_history) && previous.operation_history.length > 0;
      return {
        source_key: row.sourceKey, source_file: row.sourceFile, source_sheet: row.sourceSheet,
        source_row: row.sourceRow, entry_date: row.entryDate, description: row.description,
        priority: row.priority, sku: row.sku, raw_code: row.rawCode, operations: hasManualHistory ? previous.operations : row.operations,
        current_operation: hasManualHistory ? previous.current_operation : row.currentOperation,
        current_operation_name: hasManualHistory ? previous.current_operation_name : row.currentOperationName,
        quantity: hasManualHistory ? previous.quantity : row.quantity, spreadsheet_location: row.spreadsheetLocation,
        elapsed_time: row.elapsedTime, status: previous?.status === "finalizada" ? "finalizada" : row.status,
        finished_at: previous?.status === "finalizada" ? previous.finished_at : row.finishedAt, imported_by: importedBy,
        imported_at: importedAt, updated_at: importedAt
      };
    });
    await restRequest("helice_production_orders", {
      method: "POST",
      params: { on_conflict: "source_key" },
      body: records,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
    return { count: normalized.length, importedAt };
  }

  return transaction(async (client) => {
    for (const row of normalized) {
      const values = [
        row.sourceKey, row.sourceFile, row.sourceSheet, row.sourceRow, row.entryDate,
        row.description, row.priority, row.sku, row.rawCode, JSON.stringify(row.operations),
        row.currentOperation, row.currentOperationName, row.quantity, row.spreadsheetLocation,
        row.elapsedTime, row.status, row.finishedAt, importedBy, importedAt
      ];
      const updated = await client.query(`
        UPDATE helice_production_orders SET
          source_file = $2, source_sheet = $3, source_row = $4, entry_date = $5,
          description = $6, priority = $7, sku = $8, raw_code = $9,
          operations = CASE WHEN jsonb_array_length(operation_history) > 0 THEN operations ELSE $10::jsonb END,
          current_operation = CASE WHEN jsonb_array_length(operation_history) > 0 THEN current_operation ELSE $11 END,
          current_operation_name = CASE WHEN jsonb_array_length(operation_history) > 0 THEN current_operation_name ELSE $12 END,
          quantity = CASE WHEN jsonb_array_length(operation_history) > 0 THEN quantity ELSE $13 END,
          spreadsheet_location = $14, elapsed_time = $15,
          status = CASE WHEN status = 'finalizada' THEN 'finalizada' ELSE $16 END,
          finished_at = CASE WHEN status = 'finalizada' THEN finished_at ELSE $17 END,
          imported_by = $18, imported_at = $19, updated_at = $19
        WHERE source_key = $1
        RETURNING id
      `, values);

      if (!updated.rowCount) {
        await client.query(`
          INSERT INTO helice_production_orders (
            source_key, source_file, source_sheet, source_row, entry_date, description,
            priority, sku, raw_code, operations, current_operation, current_operation_name,
            quantity, spreadsheet_location, elapsed_time, status, finished_at,
            imported_by, imported_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19
          )
        `, values);
      }
    }

    const sequence = await client.query(`
      SELECT COALESCE(MAX(NULLIF(regexp_replace(op_number, '\\D', '', 'g'), '')::BIGINT), 0) AS value
      FROM helice_production_orders
    `);
    const sequenceValue = Number(sequence.rows[0]?.value || 0);
    await client.query("SELECT setval('helice_op_number_seq', $1, $2)", [Math.max(1, sequenceValue), sequenceValue > 0]);
    return { count: normalized.length, importedAt };
  });
}

export function buildOperationMovement(order, forwardQuantity, actor, at, remainingAction = "split", existingOrders = []) {
  const operations = Array.isArray(order.operations) ? order.operations.map(operation => ({ ...operation })) : [];
  const currentIndex = Math.max(0, Number.parseInt(order.currentOperation, 10) - 1);
  if (currentIndex >= 8) throw new RangeError("A OP já está na última operação. Use Finalizar.");
  const inputQuantity = Math.max(0, Number.parseInt(operations[currentIndex]?.quantity, 10) || Number.parseInt(order.quantity, 10) || 0);
  const forwardedQuantity = Math.max(0, Number.parseInt(forwardQuantity, 10) || 0);
  if (forwardedQuantity > inputQuantity) {
    throw new RangeError(`A quantidade que avança não pode superar ${inputQuantity} peças.`);
  }

  const remainingQuantity = inputQuantity - forwardedQuantity;
  const isScrap = remainingAction === "scrap" || remainingAction === "refugo";

  let createdOrder = null;
  let createdOpNumber = null;

  if (remainingQuantity > 0) {
    const parentOpNum = String(order.opNumber || "OPH-000000");
    const baseOpNumber = parentOpNum.split(".")[0];

    if (isScrap) {
      const scrapMatches = (existingOrders || []).filter(row => {
        const num = String(row.opNumber || row.op_number || "");
        return num.startsWith(`${baseOpNumber}.REF.`);
      });
      const seq = scrapMatches.length + 1;
      createdOpNumber = `${baseOpNumber}.REF.${seq}`;
    } else {
      const splitMatches = (existingOrders || []).filter(row => {
        const num = String(row.opNumber || row.op_number || "");
        return num.startsWith(`${baseOpNumber}.`) && !num.includes(".REF.");
      });
      const seq = splitMatches.length + 1;
      createdOpNumber = `${baseOpNumber}.${seq}`;
    }

    const currentOpObj = operations[currentIndex] || {
      code: String(currentIndex + 1).padStart(2, "0"),
      name: order.currentOperationName || "Operação"
    };

    const newOps = operations.map((op, idx) => {
      if (idx === currentIndex) return { ...op, quantity: remainingQuantity };
      if (idx < currentIndex) return { ...op };
      return { ...op, quantity: null };
    });

    const uniqueId = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    createdOrder = {
      id: uniqueId,
      opNumber: createdOpNumber,
      sourceKey: `${isScrap ? "SCRAP" : "SPLIT"}_${parentOpNum}_${uniqueId}`,
      sourceFile: order.sourceFile || "Rastreio PCP",
      sourceSheet: order.sourceSheet || "Rastreio",
      sourceRow: 0,
      entryDate: order.entryDate || (at ? String(at).slice(0, 10) : null),
      description: isScrap ? `${order.description} [REFUGO]` : order.description,
      priority: isScrap ? "Normal" : (order.priority || "Normal"),
      sku: order.sku,
      rawCode: order.rawCode || "",
      operations: newOps,
      operationHistory: [
        {
          type: isScrap ? "scrap_created" : "split_created",
          fromOp: parentOpNum,
          quantity: remainingQuantity,
          at,
          actor: String(actor || "").slice(0, 100)
        }
      ],
      currentOperation: currentOpObj.code,
      currentOperationName: isScrap ? `${currentOpObj.name} (Refugo)` : currentOpObj.name,
      quantity: remainingQuantity,
      spreadsheetLocation: order.spreadsheetLocation || "",
      elapsedTime: order.elapsedTime || "",
      status: isScrap ? "refugada" : "em_producao",
      finishedAt: isScrap ? at : null,
      finishedBy: isScrap ? String(actor || "").slice(0, 100) : "",
      importedBy: String(actor || "").slice(0, 100),
      importedAt: at,
      updatedAt: at
    };
  }

  const nextIndex = currentIndex + 1;
  const nextOperation = operations[nextIndex];
  if (!nextOperation) throw new RangeError("Próxima operação não encontrada.");
  nextOperation.quantity = forwardedQuantity;

  const movement = {
    type: "advance",
    fromOperation: operations[currentIndex]?.code || String(currentIndex + 1).padStart(2, "0"),
    fromOperationName: operations[currentIndex]?.name || "",
    toOperation: nextOperation.code,
    toOperationName: nextOperation.name,
    inputQuantity,
    forwardedQuantity,
    scrapQuantity: inputQuantity - forwardedQuantity,
    remainingQuantity,
    remainingAction: isScrap ? "scrap" : "split",
    createdOpNumber: createdOpNumber || null,
    actor: String(actor || "").slice(0, 100),
    at
  };

  return { operations, movement, nextOperation, forwardedQuantity, remainingQuantity, createdOrder };
}

export async function advanceHeliceProductionOrder(id, forwardQuantity, actor = "", remainingAction = "split") {
  await initializeDatabase();
  const orderId = String(id || "").trim();
  if (!/^\d+$/.test(orderId)) throw new TypeError("OP de hélice inválida.");
  const now = isoNow();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const list = db.helice_production_orders || [];
    const index = list.findIndex(row => String(row.id) === orderId);
    if (index < 0) return null;
    if (list[index].status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (list[index].status === "refugada") throw new RangeError("A OP está marcada como refugada.");

    const result = buildOperationMovement(list[index], forwardQuantity, actor, now, remainingAction, list);
    list[index] = {
      ...list[index],
      operations: result.operations,
      operationHistory: [...(list[index].operationHistory || []), result.movement],
      currentOperation: result.nextOperation.code,
      currentOperationName: result.nextOperation.name,
      quantity: result.forwardedQuantity,
      updatedAt: now
    };
    if (result.createdOrder) {
      list.push(result.createdOrder);
    }
    db.helice_production_orders = list;
    db.updated_at = now;
    await writeLocalFile(db);
    return {
      order: mapHeliceProductionRow(list[index]),
      createdOrder: result.createdOrder ? mapHeliceProductionRow(result.createdOrder) : null
    };
  }

  if (usesSupabaseRest()) {
    const allRows = await restRequest("helice_production_orders", {
      params: { select: "*" }
    });
    const order = (allRows || []).map(mapHeliceProductionRow).find(o => String(o.id) === orderId);
    if (!order) return null;
    if (order.status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (order.status === "refugada") throw new RangeError("A OP está marcada como refugada.");

    const existingOrders = (allRows || []).map(mapHeliceProductionRow);
    const result = buildOperationMovement(order, forwardQuantity, actor, now, remainingAction, existingOrders);

    if (result.createdOrder) {
      const row = result.createdOrder;
      await restRequest("helice_production_orders", {
        method: "POST",
        body: [{
          op_number: row.opNumber,
          source_key: row.sourceKey,
          source_file: row.sourceFile,
          source_sheet: row.sourceSheet,
          source_row: row.sourceRow,
          entry_date: row.entryDate,
          description: row.description,
          priority: row.priority,
          sku: row.sku,
          raw_code: row.rawCode,
          operations: row.operations,
          operation_history: row.operationHistory,
          current_operation: row.currentOperation,
          current_operation_name: row.currentOperationName,
          quantity: row.quantity,
          spreadsheet_location: row.spreadsheetLocation,
          elapsed_time: row.elapsedTime,
          status: row.status,
          finished_at: row.finishedAt,
          finished_by: row.finishedBy,
          imported_by: row.importedBy,
          imported_at: row.importedAt,
          updated_at: now
        }],
        prefer: "resolution=merge-duplicates,return=minimal"
      });
    }

    const updated = await restRequest("helice_production_orders", {
      method: "PATCH", params: { id: `eq.${orderId}` },
      body: {
        operations: result.operations,
        operation_history: [...order.operationHistory, result.movement],
        current_operation: result.nextOperation.code,
        current_operation_name: result.nextOperation.name,
        quantity: result.forwardedQuantity,
        updated_at: now
      },
      prefer: "return=representation"
    });

    return {
      order: updated?.[0] ? mapHeliceProductionRow(updated[0]) : null,
      createdOrder: result.createdOrder ? mapHeliceProductionRow(result.createdOrder) : null
    };
  }

  return transaction(async client => {
    const selected = await client.query("SELECT * FROM helice_production_orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = selected.rows[0] ? mapHeliceProductionRow(selected.rows[0]) : null;
    if (!order) return null;
    if (order.status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (order.status === "refugada") throw new RangeError("A OP está marcada como refugada.");

    const baseOpNumber = order.opNumber.split('.')[0];
    const existingResult = await client.query("SELECT op_number FROM helice_production_orders WHERE op_number LIKE $1", [`${baseOpNumber}.%`]);
    const existingOrders = existingResult.rows.map(r => ({ opNumber: r.op_number }));

    const result = buildOperationMovement(order, forwardQuantity, actor, now, remainingAction, existingOrders);

    if (result.createdOrder) {
      const row = result.createdOrder;
      await client.query(`
        INSERT INTO helice_production_orders (
          op_number, source_key, source_file, source_sheet, source_row, entry_date,
          description, priority, sku, raw_code, operations, operation_history,
          current_operation, current_operation_name, quantity, spreadsheet_location,
          elapsed_time, status, finished_at, finished_by, imported_by, imported_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
          $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )
      `, [
        row.opNumber, row.sourceKey, row.sourceFile, row.sourceSheet, row.sourceRow, row.entryDate,
        row.description, row.priority, row.sku, row.rawCode, JSON.stringify(row.operations),
        JSON.stringify(row.operationHistory), row.currentOperation, row.currentOperationName,
        row.quantity, row.spreadsheetLocation, row.elapsedTime, row.status, row.finishedAt,
        row.finishedBy, row.importedBy, row.importedAt, now
      ]);
    }

    const updated = await client.query(`
      UPDATE helice_production_orders
      SET operations = $1::jsonb, operation_history = operation_history || $2::jsonb,
          current_operation = $3, current_operation_name = $4, quantity = $5, updated_at = $6
      WHERE id = $7 RETURNING *
    `, [
      JSON.stringify(result.operations), JSON.stringify([result.movement]),
      result.nextOperation.code, result.nextOperation.name, result.forwardedQuantity, now, orderId
    ]);

    return {
      order: mapHeliceProductionRow(updated.rows[0]),
      createdOrder: result.createdOrder ? mapHeliceProductionRow(result.createdOrder) : null
    };
  });
}

export async function finalizeHeliceProductionOrder(id, actor = "") {
  await initializeDatabase();
  const orderId = String(id || "").trim();
  if (!/^\d+$/.test(orderId)) throw new TypeError("OP de hélice inválida.");
  const now = isoNow();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const list = db.helice_production_orders || [];
    const index = list.findIndex(row => String(row.id) === orderId);
    if (index < 0) return null;
    if (list[index].status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (String(list[index].currentOperation) !== "09") throw new RangeError("Avance a OP até a operação 9 antes de finalizar.");
    const finalizedOperations = (list[index].operations || []).map(operation => operation.code === "09" ? { ...operation, quantity: list[index].quantity } : operation);
    const finishEvent = { type: "finish", operation: "09", quantity: list[index].quantity, actor: String(actor || "").slice(0, 100), at: now };
    list[index] = { ...list[index], operations: finalizedOperations, operationHistory: [...(list[index].operationHistory || []), finishEvent], status: "finalizada", currentOperation: "09", currentOperationName: "9 - Finalizado", finishedAt: now, updatedAt: now, finishedBy: actor };
    db.helice_production_orders = list;
    db.updated_at = now;
    await writeLocalFile(db);
    return mapHeliceProductionRow(list[index]);
  }

  if (usesSupabaseRest()) {
    const currentRows = await restRequest("helice_production_orders", {
      params: { select: "quantity,operations,current_operation,operation_history,status", id: `eq.${orderId}`, limit: 1 }
    });
    const current = currentRows?.[0];
    if (!current) return null;
    if (current.status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (String(current.current_operation) !== "09") throw new RangeError("Avance a OP até a operação 9 antes de finalizar.");
    const finalizedOperations = (current.operations || []).map(operation => operation.code === "09" ? { ...operation, quantity: Number(current.quantity) || 0 } : operation);
    const finishEvent = { type: "finish", operation: "09", quantity: Number(current.quantity) || 0, actor: String(actor || "").slice(0, 100), at: now };
    const rows = await restRequest("helice_production_orders", {
      method: "PATCH", params: { id: `eq.${orderId}` },
      body: { operations: finalizedOperations, operation_history: [...(current.operation_history || []), finishEvent], status: "finalizada", current_operation: "09", current_operation_name: "9 - Finalizado", finished_at: now, finished_by: String(actor || "").slice(0, 100), updated_at: now },
      prefer: "return=representation"
    });
    return rows?.[0] ? mapHeliceProductionRow(rows[0]) : null;
  }

  return transaction(async (client) => {
    const selected = await client.query("SELECT current_operation, status FROM helice_production_orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!selected.rows.length) return null;
    if (selected.rows[0].status === "finalizada") throw new RangeError("A OP já foi finalizada.");
    if (String(selected.rows[0].current_operation) !== "09") {
      throw new RangeError("Avance a OP até a operação 9 antes de finalizar.");
    }
    const finishEvent = { type: "finish", operation: "09", actor: String(actor || "").slice(0, 100), at: now };
    const result = await client.query(`
      UPDATE helice_production_orders
      SET operations = jsonb_set(operations, '{8,quantity}', to_jsonb(quantity), true),
          operation_history = operation_history || ($1::jsonb || jsonb_build_object('quantity', quantity)),
          status = 'finalizada', current_operation = '09', current_operation_name = '9 - Finalizado',
          finished_at = $2, finished_by = $3, updated_at = $2
      WHERE id = $4 RETURNING *
    `, [JSON.stringify(finishEvent), now, String(actor || "").slice(0, 100), orderId]);
    return result.rows[0] ? mapHeliceProductionRow(result.rows[0]) : null;
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
  assertGenericStateWriteAllowed(key, "PUT");
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
      actor,
      created_at: now
    });
    await writeLocalFile(db);
    return { version: nextVersion, revision: db.revision };
  }

  if (usesSupabaseRest()) return upsertStateRest(key, value, expectedVersion, actor);

  return transaction(client => upsertStatePostgres(client, key, value, expectedVersion, actor));
}

export async function upsertStatePostgres(client, key, value, expectedVersion, actor = "") {
  assertGenericStateWriteAllowed(key, "PUT");
  const expected = Number(expectedVersion);
  const nextVersion = expected + 1;
  const now = new Date();
  const payload = serializeValue(value);
  let changed;

  if (expected === 0) {
    changed = await client.query(
      `INSERT INTO app_state (key, value, version, updated_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING version`,
      [key, payload, now]
    );
  } else {
    changed = await client.query(
      `UPDATE app_state
       SET value = $1, version = version + 1, updated_at = $2
       WHERE key = $3 AND version = $4
       RETURNING version`,
      [payload, now, key, expected]
    );
  }

  if (!changed.rowCount) throw versionConflict(await currentVersion(client, key));

  const version = Number(firstValue(changed.rows[0], ["version"], nextVersion));
  const revision = await incrementRevision(client);
  await client.query(
    "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES ($1, $2, $3, $4, $5)",
    [key, "UPSERT", version, actor, now]
  );
  return { version, revision };
}

export async function deleteState(key, expectedVersion, actor = "") {
  assertGenericStateWriteAllowed(key, "DELETE");
  await initializeDatabase();

  if (usesLocalFile()) {
    const db = await readLocalFile();
    const currentItem = db.state[key];
    const current = currentItem ? Number(currentItem.version || 0) : 0;
    if (current !== expectedVersion) throw versionConflict(current);

    if (current === 0) return { revision: Number(db.revision || 0) };

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

  return transaction(client => deleteStatePostgres(client, key, expectedVersion, actor));
}

export async function deleteStatePostgres(client, key, expectedVersion, actor = "") {
  assertGenericStateWriteAllowed(key, "DELETE");
  const expected = Number(expectedVersion);
  const now = new Date();
  const deleted = await client.query(
    "DELETE FROM app_state WHERE key = $1 AND version = $2 RETURNING version",
    [key, expected]
  );

  if (!deleted.rowCount) {
    const current = await currentVersion(client, key);
    if (expected !== 0 || current !== 0) throw versionConflict(current);
    return { revision: await currentRevision(client) };
  }

  const deletedVersion = Number(firstValue(deleted.rows[0], ["version"], expected));
  const revision = await incrementRevision(client);
  await client.query(
    "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES ($1, $2, $3, $4, $5)",
    [key, "DELETE", deletedVersion + 1, actor, now]
  );
  return { revision };
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
        "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES ($1, $2, $3, $4, $5)",
        [key, "IMPORT", nextVersion, actor, now]
      );
    }
    return { revision: await incrementRevision(client) };
  });
}

// Helpers for REST
async function incrementRevision(client) {
  const now = new Date();
  const rows = await client.query(
    "UPDATE app_revision SET revision = revision + 1, updated_at = $1 WHERE singleton = $2 RETURNING revision",
    [now, "main"]
  );
  return Number(firstValue(rows.rows[0], ["revision"], 0));
}

async function currentRevision(client) {
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

  if (current === 0) {
    const rows = await restRequest("app_revision", {
      params: { select: "revision", singleton: "eq.main", limit: 1 }
    });
    return { revision: Number(firstValue(rows?.[0], ["revision"], 0)) };
  }

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

const RAW_MATERIAL_CATEGORY = "Peca Bruta";

function normalizeRawCode(value) {
  return String(value || "").trim().toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
}

function isRawMaterial(material) {
  return normalizeRawCode(material?.categoria) === normalizeRawCode(RAW_MATERIAL_CATEGORY)
    || Boolean(material?.rawCode);
}

function rawStockView(materials, movements = []) {
  return (Array.isArray(materials) ? materials : [])
    .filter(isRawMaterial)
    .map(material => ({
      id: String(material.id || ""),
      rawCode: normalizeRawCode(material.rawCode || material.nome),
      quantity: Math.max(0, Number(material.saldo) || 0),
      updatedAt: material.atualizadoEm || material.criadoEm || null,
      updatedBy: material.atualizadoPor || ""
    }))
    .sort((a, b) => a.rawCode.localeCompare(b.rawCode, "pt-BR"))
    .map(item => ({
      ...item,
      movements: (Array.isArray(movements) ? movements : [])
        .filter(movement => String(movement.materialId || "") === item.id)
        .slice(0, 20)
    }));
}

export async function getRawMaterialStock() {
  const snapshot = await getStateSnapshot(0);
  return {
    items: rawStockView(snapshot.data?.hrn_materiais, snapshot.data?.hrn_movimentos),
    version: Number(snapshot.versions?.hrn_materiais || 0),
    revision: Number(snapshot.revision || 0)
  };
}

async function lockStateRows(client, defaults) {
  const keys = Object.keys(defaults).sort();
  for (const key of keys) {
    await client.query(
      "INSERT INTO app_state (key, value, version, updated_at) VALUES ($1, $2, 1, NOW()) ON CONFLICT (key) DO NOTHING",
      [key, serializeValue(defaults[key])]
    );
  }
  const result = await client.query(
    "SELECT key, value, version FROM app_state WHERE key = ANY($1::varchar[]) ORDER BY key FOR UPDATE",
    [keys]
  );
  return new Map(result.rows.map(row => [row.key, {
    value: parseStoredValue(row.value),
    version: Number(row.version || 0)
  }]));
}

async function saveLockedStates(client, locked, changes, actor, action) {
  const now = new Date();
  const versions = {};
  for (const [key, value] of Object.entries(changes)) {
    const nextVersion = Number(locked.get(key)?.version || 0) + 1;
    await client.query(
      "UPDATE app_state SET value = $1, version = $2, updated_at = $3 WHERE key = $4",
      [serializeValue(value), nextVersion, now, key]
    );
    await client.query(
      "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES ($1, $2, $3, $4, $5)",
      [key, action, nextVersion, actor, now]
    );
    versions[key] = nextVersion;
  }
  return { versions, revision: await incrementRevision(client) };
}

function rawStockTransactionRequired() {
  const error = new Error("O estoque de brutos requer DATABASE_URL para garantir transacao atomica.");
  error.code = "RAW_STOCK_TRANSACTION_REQUIRED";
  error.status = 503;
  throw error;
}

function insufficientStock(rawCode, available, required) {
  const error = new RangeError(`Estoque insuficiente de ${rawCode}: disponivel ${available}, necessario ${required}.`);
  error.code = "INSUFFICIENT_RAW_STOCK";
  error.status = 409;
  return error;
}

function findRawMaterial(materials, rawCode) {
  const code = normalizeRawCode(rawCode);
  return materials.find(material => isRawMaterial(material)
    && normalizeRawCode(material.rawCode || material.nome) === code);
}

function movement({ material, type, quantity, balance, actor, op, reason, eventKey }) {
  return {
    id: randomUUID(),
    materialId: material.id,
    materialNome: material.nome,
    tipo: type,
    qty: Math.abs(Number(quantity) || 0),
    opId: op?.id || "",
    opNumero: op?.numero || "",
    obs: reason,
    data: isoNow(),
    usuario: actor,
    categoria: RAW_MATERIAL_CATEGORY,
    saldoApos: balance,
    eventKey
  };
}

function rawCodesFromState(locked) {
  const models = Array.isArray(locked.get("hrn_modelos")?.value) ? locked.get("hrn_modelos").value : [];
  const catalog = Array.isArray(locked.get("hrn_fundicao_catalog")?.value) ? locked.get("hrn_fundicao_catalog").value : [];
  const registered = Array.isArray(locked.get("hrn_coquilhas_catalog")?.value) ? locked.get("hrn_coquilhas_catalog").value : [];
  return [...new Set([
    ...models.map(item => item.codigoBruto),
    ...catalog.map(item => item.coquilha),
    ...registered.map(item => typeof item === "string" ? item : item.coquilha)
  ].map(normalizeRawCode).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function initializeRawMaterialStock(actor = "MIGRACAO_ESTOQUE_BRUTO") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, {
      hrn_fundicao_catalog: [], hrn_coquilhas_catalog: [], hrn_materiais: [], hrn_modelos: []
    });
    const materials = Array.isArray(locked.get("hrn_materiais").value)
      ? [...locked.get("hrn_materiais").value]
      : [];
    const now = isoNow();
    for (const rawCode of rawCodesFromState(locked)) {
      let material = findRawMaterial(materials, rawCode);
      if (!material) {
        material = { id: `raw_${randomUUID()}`, nome: rawCode, rawCode, categoria: RAW_MATERIAL_CATEGORY, unidade: "un", minimo: 0, fornecedor: "", criadoEm: now };
        materials.push(material);
      }
      material.nome = rawCode;
      material.rawCode = rawCode;
      material.categoria = RAW_MATERIAL_CATEGORY;
      material.unidade = "un";
      material.saldo = 0;
      material.atualizadoEm = now;
      material.atualizadoPor = actor;
    }
    const saved = await saveLockedStates(client, locked, { hrn_materiais: materials }, actor, "RAW_STOCK_INIT");
    return { ...saved, items: rawStockView(materials), count: materials.filter(isRawMaterial).length };
  });
}

export async function adjustRawMaterialStock(rawCode, quantity, expectedVersion, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();
  const normalizedCode = normalizeRawCode(rawCode);
  const target = Number(quantity);
  if (!normalizedCode || !Number.isFinite(target) || target < 0) throw new RangeError("Informe um estoque fisico maior ou igual a zero.");
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_materiais: [], hrn_movimentos: [] });
    if (Number(locked.get("hrn_materiais").version) !== Number(expectedVersion)) {
      throw versionConflict(Number(locked.get("hrn_materiais").version));
    }
    const materials = [...locked.get("hrn_materiais").value];
    const movements = [...locked.get("hrn_movimentos").value];
    const material = findRawMaterial(materials, normalizedCode);
    if (!material) throw new RangeError(`Peca bruta ${normalizedCode} nao cadastrada.`);
    const previous = Math.max(0, Number(material.saldo) || 0);
    if (previous === target) return { items: rawStockView(materials, movements), version: locked.get("hrn_materiais").version };
    material.saldo = target;
    material.atualizadoEm = isoNow();
    material.atualizadoPor = actor;
    movements.unshift(movement({ material, type: target > previous ? "Entrada" : "Saida", quantity: target - previous, balance: target, actor, reason: `Ajuste manual de ${previous} para ${target}`, eventKey: `RAW-ADJUST-${randomUUID()}` }));
    const saved = await saveLockedStates(client, locked, { hrn_materiais: materials, hrn_movimentos: movements }, actor, "RAW_STOCK_ADJUST");
    return { ...saved, items: rawStockView(materials, movements), version: saved.versions.hrn_materiais };
  });
}

function inventoryTransactionRequired() {
  const error = new Error("O estoque interno requer DATABASE_URL para garantir transacao atomica.");
  error.code = "INVENTORY_TRANSACTION_REQUIRED";
  error.status = 503;
  throw error;
}

function assertInventoryVersions(locked, expected = {}) {
  for (const key of ["hrn_materiais", "hrn_movimentos"]) {
    // lockStateRows materializa agregados ainda inexistentes na versão 1;
    // o primeiro cliente, que leu ausência como versão 0, pode inicializá-los.
    const initializing = Number(expected[key]) === 0 && Number(locked.get(key).version) === 1;
    if (expected[key] !== undefined && !initializing && Number(locked.get(key).version) !== Number(expected[key])) {
      throw versionConflict(Number(locked.get(key).version));
    }
  }
}

function inventoryResponse(saved, materials, movements) {
  return { ...saved, materials, movements, versions: saved.versions };
}

function sameInventoryEvent(existing, candidate, fields) {
  return fields.every(field => String(existing?.[field] ?? "") === String(candidate?.[field] ?? ""));
}

export async function mutateInventory(action, id, data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return inventoryTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_materiais: [], hrn_movimentos: [] });
    assertInventoryVersions(locked, expectedVersions);
    const materials = [...locked.get("hrn_materiais").value];
    const movements = [...locked.get("hrn_movimentos").value];
    const now = isoNow();
    if (action === "create") {
      const name = String(data.nome || "").trim();
      if (!name) throw new RangeError("Informe o nome do material.");
      const opening = Number(data.saldo || 0);
      if (!Number.isFinite(opening) || opening < 0) throw new RangeError("Saldo inicial invalido.");
      const eventKey = String(data.eventKey || "").trim();
      if (!eventKey) throw new RangeError("eventKey e obrigatorio para criar material.");
      const duplicate = materials.find(item => item.eventKey === eventKey);
      if (duplicate) {
        if (!sameInventoryEvent(duplicate, data, ["nome", "categoria", "unidade", "minimo", "fornecedor", "saldo"])) throw new RangeError("eventKey ja foi usado com dados diferentes.");
        return inventoryResponse({ versions: { hrn_materiais: locked.get("hrn_materiais").version, hrn_movimentos: locked.get("hrn_movimentos").version }, revision: await currentRevision(client), duplicate: true }, materials, movements);
      }
      const material = { id: `mat_${randomUUID()}`, eventKey, nome: name, categoria: String(data.categoria || ""), unidade: String(data.unidade || "kg"), minimo: Math.max(0, Number(data.minimo) || 0), fornecedor: String(data.fornecedor || ""), saldo: opening, criadoEm: now, atualizadoEm: now, atualizadoPor: actor };
      materials.push(material);
      if (opening > 0) movements.unshift({ id: randomUUID(), materialId: material.id, materialNome: material.nome, tipo: "Entrada", qty: opening, opId: "", opNumero: "", obs: "Saldo inicial", data: now, usuario: actor, eventKey, saldoApos: opening });
      const changes = opening > 0 ? { hrn_materiais: materials, hrn_movimentos: movements } : { hrn_materiais: materials };
      return inventoryResponse(await saveLockedStates(client, locked, changes, actor, "INV_MAT_CREATE"), materials, movements);
    }
    const index = materials.findIndex(item => String(item.id) === String(id));
    if (index < 0) return null;
    const material = materials[index];
    if (isRawMaterial(material)) throw new RangeError("Pecas brutas usam a API de estoque de brutos.");
    if (action === "update") {
      if (Object.prototype.hasOwnProperty.call(data, "saldo")) throw new RangeError("Saldo so pode ser alterado por movimentacao.");
      materials[index] = { ...material, nome: String(data.nome || material.nome).trim(), categoria: String(data.categoria ?? material.categoria ?? ""), unidade: String(data.unidade || material.unidade || "kg"), minimo: Math.max(0, Number(data.minimo ?? material.minimo) || 0), fornecedor: String(data.fornecedor ?? material.fornecedor ?? ""), atualizadoEm: now, atualizadoPor: actor };
      if (!materials[index].nome) throw new RangeError("Informe o nome do material.");
      return inventoryResponse(await saveLockedStates(client, locked, { hrn_materiais: materials }, actor, "INV_MAT_UPDATE"), materials, movements);
    }
    if (action === "delete") {
      if (Number(material.saldo) !== 0 || movements.some(item => String(item.materialId) === String(material.id))) throw new RangeError("Material com saldo ou historico nao pode ser excluido.");
      materials.splice(index, 1);
      return inventoryResponse(await saveLockedStates(client, locked, { hrn_materiais: materials }, actor, "INV_MAT_DELETE"), materials, movements);
    }
    throw new RangeError("Acao de material invalida.");
  });
}

export async function createInventoryMovement(data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return inventoryTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_materiais: [], hrn_movimentos: [] });
    const materials = [...locked.get("hrn_materiais").value];
    const movements = [...locked.get("hrn_movimentos").value];
    const eventKey = String(data.eventKey || "").trim();
    if (!eventKey) throw new RangeError("eventKey e obrigatorio para movimentacao.");
    const duplicate = movements.find(item => item.eventKey === eventKey);
    if (duplicate) {
      if (!sameInventoryEvent(duplicate, data, ["materialId", "tipo", "qty", "opId", "opNumero", "obs"])) throw new RangeError("eventKey ja foi usado com dados diferentes.");
      return inventoryResponse({ versions: { hrn_materiais: locked.get("hrn_materiais").version, hrn_movimentos: locked.get("hrn_movimentos").version }, revision: await currentRevision(client), duplicate: true }, materials, movements);
    }
    assertInventoryVersions(locked, expectedVersions);
    const material = materials.find(item => String(item.id) === String(data.materialId));
    if (!material) throw new RangeError("Material nao encontrado.");
    if (isRawMaterial(material)) throw new RangeError("Pecas brutas usam a API de estoque de brutos.");
    const quantity = Number(data.qty);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new RangeError("Informe uma quantidade maior que zero.");
    const type = data.tipo === "Saida" ? "Saida" : data.tipo === "Entrada" ? "Entrada" : null;
    if (!type) throw new RangeError("Tipo de movimentacao invalido.");
    const previous = Number(material.saldo) || 0;
    const next = type === "Entrada" ? previous + quantity : previous - quantity;
    if (next < 0) throw insufficientStock(material.nome, previous, quantity);
    material.saldo = next; material.atualizadoEm = isoNow(); material.atualizadoPor = actor;
    movements.unshift({ id: randomUUID(), materialId: material.id, materialNome: material.nome, tipo: type, qty: quantity, opId: String(data.opId || ""), opNumero: String(data.opNumero || ""), obs: String(data.obs || ""), data: isoNow(), usuario: actor, eventKey, saldoApos: next });
    return inventoryResponse(await saveLockedStates(client, locked, { hrn_materiais: materials, hrn_movimentos: movements }, actor, "INV_MOVE_CREATE"), materials, movements);
  });
}

const BUCHA_ENTRY_STAGES = new Map([
  ["usinagem", "Usinagem"],
  ["retrabalho", "Retrabalho"],
  ["vulcanizacao", "Vulcanizacao"],
  ["vulcanização", "Vulcanizacao"],
  ["estoque final", "Estoque Final"]
]);

function normalizeBuchaSku(value) {
  return String(value || "").trim().toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
}

function normalizeBuchaEntryStage(value) {
  return BUCHA_ENTRY_STAGES.get(String(value || "").trim().toLocaleLowerCase("pt-BR")) || null;
}

function buchaTransactionRequired() {
  const error = new Error("As entradas de buchas requerem DATABASE_URL para garantir transacao atomica.");
  error.code = "BUCHA_TRANSACTION_REQUIRED";
  error.status = 503;
  throw error;
}

function buchaEntryCandidate(data, sku, stage, quantity) {
  return {
    sku,
    etapaAtual: stage,
    quantidade: quantity,
    origemObs: String(data.origemObs || "Entrada manual de lote").trim()
  };
}

function sameBuchaEntryEvent(existing, candidate) {
  return String(existing?.sku || "").trim().toLocaleUpperCase("pt-BR") === candidate.sku
    && String(existing?.etapaAtual || "") === candidate.etapaAtual
    && Number(existing?.quantidade) === candidate.quantidade
    && String(existing?.origemObs || "").trim() === candidate.origemObs;
}

function assertBuchaEntryVersions(locked, expected = {}) {
  for (const key of ["hrn_buchas", "hrn_buchas_entradas"]) {
    const current = Number(locked.get(key).version);
    const initializing = Number(expected[key]) === 0 && current === 1;
    if (expected[key] !== undefined && !initializing && current !== Number(expected[key])) throw versionConflict(current);
  }
}

function buchaEntryCode(entries) {
  const numbers = entries
    .map(item => Number.parseInt(String(item?.codigoEntrada || "").replace(/\D/g, ""), 10))
    .filter(Number.isFinite);
  return `ENT-BCH-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(6, "0")}`;
}

function derivedBuchaEntryCode(parentCode, entries) {
  const base = String(parentCode || "ENT-BCH").trim();
  const used = new Set(entries.map(item => String(item?.codigoEntrada || "").trim()));
  let suffix = 1;
  while (used.has(`${base}.${suffix}`)) suffix += 1;
  return `${base}.${suffix}`;
}

function allowedBuchaTransition(from, to) {
  const flow = {
    Usinagem: new Set(["Retrabalho", "Vulcanizacao", "Estoque Final"]),
    Retrabalho: new Set(["Vulcanizacao", "Estoque Final"]),
    Vulcanizacao: new Set(["Estoque Final"]),
    "Estoque Final": new Set()
  };
  return Boolean(flow[from]?.has(to));
}

function transitionEventCandidate(id, quantity, stage, remainingAction) {
  return { entryId: String(id), quantity, proximaEtapa: stage, acaoSaldoRestante: remainingAction };
}

function sameBuchaTransitionEvent(existing, candidate) {
  return String(existing?.entryId || "") === candidate.entryId
    && Number(existing?.quantity) === candidate.quantity
    && String(existing?.proximaEtapa || "") === candidate.proximaEtapa
    && String(existing?.acaoSaldoRestante || "") === candidate.acaoSaldoRestante;
}

function buchaEntryReadModel(catalog, entries, outputs, versions = {}, revision = 0, ops = []) {
  const bySku = new Map();
  const inconsistencies = [];
  const entryCodes = new Map();
  const outputCodes = new Map();
  const ensure = (sku, source) => {
    const key = normalizeBuchaSku(sku);
    if (!key) {
      inconsistencies.push({ code: "BUCHA_SKU_MISSING", source });
      return null;
    }
    if (!bySku.has(key)) bySku.set(key, { sku: key, descricao: "", usinagem: 0, retrabalho: 0, vulcanizacao: 0, estoqueFinalEntradas: 0, saidas: 0, catalogado: false });
    return bySku.get(key);
  };
  for (const item of Array.isArray(catalog) ? catalog : []) {
    const row = ensure(item?.sku, "catalogo");
    if (!row) continue;
    row.descricao = String(item?.descricao || item?.description || row.descricao || "").trim();
    row.catalogado = true;
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const row = ensure(entry?.sku, "entrada");
    const qty = Number(entry?.quantidade);
    if (!row || !Number.isFinite(qty) || qty < 0) { inconsistencies.push({ code: "BUCHA_ENTRY_QUANTITY_INVALID", id: entry?.id || null, sku: normalizeBuchaSku(entry?.sku) || null }); continue; }
    const stage = normalizeBuchaEntryStage(entry?.etapaAtual);
    if (String(entry?.status || "") === "Concluido" || stage === "Estoque Final") row.estoqueFinalEntradas += qty;
    else if (stage === "Usinagem") row.usinagem += qty;
    else if (stage === "Retrabalho") row.retrabalho += qty;
    else if (stage === "Vulcanizacao") row.vulcanizacao += qty;
    else if (stage === "Estoque Final") row.estoqueFinalEntradas += qty;
    else inconsistencies.push({ code: "BUCHA_ENTRY_STAGE_UNKNOWN", id: entry?.id || null, sku: normalizeBuchaSku(entry?.sku) || null, stage: entry?.etapaAtual || null });
    const code = String(entry?.codigoEntrada || "").trim();
    if (code) entryCodes.set(code, [...(entryCodes.get(code) || []), entry?.id || null]);
  }
  for (const output of Array.isArray(outputs) ? outputs : []) {
    const row = ensure(output?.sku, "saida");
    const qty = Number(output?.quantidade ?? output?.qty ?? output?.quantidadeSaida);
    if (!row || !Number.isFinite(qty) || qty < 0) { inconsistencies.push({ code: "BUCHA_OUTPUT_QUANTITY_INVALID", id: output?.id || null, sku: normalizeBuchaSku(output?.sku) || null }); continue; }
    row.saidas += qty;
    const code = String(output?.codigoSaida || "").trim();
    if (code) outputCodes.set(code, [...(outputCodes.get(code) || []), output?.id || null]);
  }
  for (const [code, ids] of entryCodes) if (ids.length > 1) inconsistencies.push({ code: "BUCHA_ENTRY_CODE_DUPLICATE", value: code, ids });
  for (const [code, ids] of outputCodes) if (ids.length > 1) inconsistencies.push({ code: "BUCHA_OUTPUT_CODE_DUPLICATE", value: code, ids });
  const items = [...bySku.values()].map(row => {
    if (!row.catalogado) inconsistencies.push({ code: "BUCHA_SKU_NOT_IN_CATALOG", sku: row.sku });
    const estoqueFinal = row.estoqueFinalEntradas - row.saidas;
    if (estoqueFinal < 0) {
      inconsistencies.push({ code: "BUCHA_FINISHED_NEGATIVE", sku: row.sku, value: estoqueFinal });
      inconsistencies.push({ code: "BUCHA_OUTPUT_EXCEEDS_FINISHED", sku: row.sku, value: row.saidas - row.estoqueFinalEntradas });
    }
    return { sku: row.sku, descricao: row.descricao, usinagem: row.usinagem, retrabalho: row.retrabalho, vulcanizacao: row.vulcanizacao, estoqueFinal, total: row.usinagem + row.retrabalho + row.vulcanizacao + estoqueFinal };
  }).sort((a, b) => a.sku.localeCompare(b.sku, "pt-BR"));
  const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.id || ""), entry]));
  for (const op of Array.isArray(ops) ? ops : []) {
    const entryId = String(op?.entradaId || op?.entryId || op?.loteEntradaId || "");
    if (!entryId) continue;
    const entry = byId.get(entryId);
    if (!entry || (op?.sku && normalizeBuchaSku(op.sku) !== normalizeBuchaSku(entry.sku)) || (op?.quantity && Number(op.quantity) > Number(entry.quantidade))) inconsistencies.push({ code: "BUCHA_OP_ENTRY_DIVERGENCE", id: op?.id || null, entryId });
  }
  return { origin: "ERP_INTERNAL_TRANSACTIONS", versions, revision, catalog: Array.isArray(catalog) ? catalog : [], entries: Array.isArray(entries) ? entries : [], outputs: Array.isArray(outputs) ? outputs : [], ops: Array.isArray(ops) ? ops : [], items, inconsistencies: inconsistencies.map(issue => ({ severity: "error", ...issue })) };
}

export async function getBuchasStock() {
  const snapshot = await getStateSnapshot(0);
  return buchaEntryReadModel(snapshot.data?.hrn_buchas, snapshot.data?.hrn_buchas_entradas, snapshot.data?.hrn_buchas_saidas, snapshot.versions, snapshot.revision, snapshot.data?.hrn_buchas_ops);
}

export async function createBuchaEntry(data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return buchaTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_buchas: [], hrn_buchas_entradas: [], hrn_buchas_saidas: [] });
    const catalog = Array.isArray(locked.get("hrn_buchas").value) ? [...locked.get("hrn_buchas").value] : [];
    const entries = Array.isArray(locked.get("hrn_buchas_entradas").value) ? [...locked.get("hrn_buchas_entradas").value] : [];
    const outputs = Array.isArray(locked.get("hrn_buchas_saidas").value) ? locked.get("hrn_buchas_saidas").value : [];
    const eventKey = String(data.eventKey || "").trim();
    if (!eventKey) throw new RangeError("eventKey e obrigatorio para entrada de bucha.");
    const sku = normalizeBuchaSku(data.sku);
    const stage = normalizeBuchaEntryStage(data.etapaInicial);
    const quantity = Number(data.quantidade);
    if (!sku) throw new RangeError("SKU de bucha e obrigatorio.");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("A quantidade deve ser um inteiro positivo.");
    if (!stage) throw new RangeError("Etapa inicial de bucha invalida.");
    const candidate = buchaEntryCandidate(data, sku, stage, quantity);
    const duplicate = entries.find(item => String(item?.eventKey || "") === eventKey);
    if (duplicate) {
      if (!sameBuchaEntryEvent(duplicate, candidate)) throw new RangeError("eventKey ja foi usado com dados diferentes.");
      return { ...buchaEntryReadModel(catalog, entries, outputs, { hrn_buchas: locked.get("hrn_buchas").version, hrn_buchas_entradas: locked.get("hrn_buchas_entradas").version, hrn_buchas_saidas: locked.get("hrn_buchas_saidas").version }, await currentRevision(client)), entry: duplicate, duplicate: true };
    }
    assertBuchaEntryVersions(locked, expectedVersions);
    const bucha = catalog.find(item => normalizeBuchaSku(item?.sku) === sku);
    if (!bucha) throw new RangeError("SKU de bucha nao cadastrado.");
    const now = isoNow();
    const entry = { id: `ent_${randomUUID()}`, codigoEntrada: buchaEntryCode(entries), eventKey, sku, descricao: String(bucha.descricao || bucha.description || "").trim(), quantidade: quantity, etapaAtual: stage, status: stage === "Estoque Final" ? "Concluido" : "Em Andamento", dataCriacao: now, origemObs: candidate.origemObs, historico: [{ data: now, acao: `Entrada registrada em ${stage} com ${quantity} un`, usuario: actor || "Sistema" }] };
    entries.unshift(entry);
    const saved = await saveLockedStates(client, locked, { hrn_buchas_entradas: entries }, actor, "BCH_ENTRY_CREATE");
    return { ...buchaEntryReadModel(catalog, entries, outputs, { ...saved.versions, hrn_buchas: locked.get("hrn_buchas").version, hrn_buchas_saidas: locked.get("hrn_buchas_saidas").version }, saved.revision), ...saved, entry };
  });
}

export async function transitionBuchaEntry(id, data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return buchaTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_buchas_entradas: [] });
    const entries = Array.isArray(locked.get("hrn_buchas_entradas").value) ? [...locked.get("hrn_buchas_entradas").value] : [];
    const eventKey = String(data.eventKey || "").trim();
    if (!eventKey) throw new RangeError("eventKey e obrigatorio para transicao de bucha.");
    const quantity = Number(data.quantidade);
    const stage = normalizeBuchaEntryStage(data.proximaEtapa);
    const remainingAction = String(data.acaoSaldoRestante || "manter").trim();
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("A quantidade deve ser um inteiro positivo.");
    if (!stage) throw new RangeError("Proxima etapa de bucha invalida.");
    if (!["manter", "split"].includes(remainingAction)) throw new RangeError("Tratamento do saldo restante invalido.");
    const candidate = transitionEventCandidate(id, quantity, stage, remainingAction);
    if (entries.some(item => String(item?.eventKey || "") === eventKey)) throw new RangeError("eventKey ja foi usado por outra operacao de entrada.");
    const duplicate = entries.flatMap(item => Array.isArray(item?.transitionEvents) ? item.transitionEvents.map(event => ({ item, event })) : [])
      .find(({ event }) => String(event.eventKey || "") === eventKey);
    if (duplicate) {
      if (!sameBuchaTransitionEvent(duplicate.event, candidate)) throw new RangeError("eventKey ja foi usado com dados diferentes.");
      return { entry: duplicate.item, entries, versions: { hrn_buchas_entradas: locked.get("hrn_buchas_entradas").version }, revision: await currentRevision(client), duplicate: true };
    }
    const expected = expectedVersions?.hrn_buchas_entradas;
    const currentVersion = Number(locked.get("hrn_buchas_entradas").version);
    if (expected !== undefined && Number(expected) !== currentVersion) throw versionConflict(currentVersion);
    const index = entries.findIndex(item => String(item?.id) === String(id));
    if (index < 0) throw new RangeError("Lote de bucha nao encontrado.");
    const entry = entries[index];
    const available = Number(entry.quantidade);
    if (!Number.isInteger(available) || available <= 0) throw new RangeError("Quantidade disponivel do lote invalida.");
    if (quantity > available) throw new RangeError("Quantidade movimentada supera o saldo disponivel do lote.");
    const from = normalizeBuchaEntryStage(entry.etapaAtual);
    if (!from || !allowedBuchaTransition(from, stage)) throw new RangeError("Transicao de etapa nao permitida para este lote.");
    const now = isoNow();
    const remaining = available - quantity;
    const transition = { eventKey, ...candidate, at: now, actor: actor || "Sistema" };
    const priorHistory = Array.isArray(entry.historico) ? entry.historico : [];
    if (remaining > 0) {
      const remainder = {
        ...entry,
        id: `ent_${randomUUID()}`,
        codigoEntrada: derivedBuchaEntryCode(entry.codigoEntrada, entries),
        quantidade: remaining,
        parentEntryId: entry.id,
        loteOrigemId: entry.loteOrigemId || entry.id,
        historico: [...priorHistory, { data: now, acao: `Desmembrado de ${entry.codigoEntrada}; ${remaining} un permanecem em ${entry.etapaAtual}`, usuario: actor || "Sistema" }],
        transitionEvents: []
      };
      entries.splice(index + 1, 0, remainder);
    }
    const moved = {
      ...entry,
      quantidade: quantity,
      etapaAtual: stage,
      status: stage === "Estoque Final" ? "Concluido" : "Em Andamento",
      historico: [...priorHistory, { data: now, acao: `Avancou ${quantity} un de ${entry.etapaAtual} para ${stage}`, usuario: actor || "Sistema" }],
      transitionEvents: [...(Array.isArray(entry.transitionEvents) ? entry.transitionEvents : []), transition]
    };
    entries[index] = moved;
    const saved = await saveLockedStates(client, locked, { hrn_buchas_entradas: entries }, actor, "BCH_ENTRY_MOVE");
    return { entry: moved, entries, ...saved };
  });
}

function assertBuchaOutputVersions(locked, expected = {}) {
  for (const key of ["hrn_buchas", "hrn_buchas_entradas", "hrn_buchas_saidas"]) {
    const current = Number(locked.get(key).version);
    const initializing = Number(expected[key]) === 0 && current === 1;
    if (expected[key] !== undefined && !initializing && current !== Number(expected[key])) throw versionConflict(current);
  }
}

function buchaOutputCode(outputs) {
  const numbers = outputs.map(item => Number.parseInt(String(item?.codigoSaida || "").replace(/\D/g, ""), 10)).filter(Number.isFinite);
  return `SAI-BCH-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(6, "0")}`;
}

function sameBuchaOutputEvent(existing, candidate) {
  return normalizeBuchaSku(existing?.sku) === candidate.sku
    && Number(existing?.quantidade) === candidate.quantidade
    && String(existing?.destinoObs || "").trim() === candidate.destinoObs;
}

function insufficientBuchaStock(sku, available, requested) {
  const error = new RangeError(`Estoque Final insuficiente de ${sku}: disponivel ${available}, necessario ${requested}.`);
  error.code = "INSUFFICIENT_BUCHA_STOCK";
  error.status = 409;
  return error;
}

export async function createBuchaOutput(data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return buchaTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_buchas: [], hrn_buchas_entradas: [], hrn_buchas_saidas: [] });
    const catalog = Array.isArray(locked.get("hrn_buchas").value) ? [...locked.get("hrn_buchas").value] : [];
    const entries = Array.isArray(locked.get("hrn_buchas_entradas").value) ? locked.get("hrn_buchas_entradas").value : [];
    const outputs = Array.isArray(locked.get("hrn_buchas_saidas").value) ? [...locked.get("hrn_buchas_saidas").value] : [];
    const eventKey = String(data.eventKey || "").trim();
    const sku = normalizeBuchaSku(data.sku);
    const quantity = Number(data.quantidade);
    const candidate = { sku, quantidade: quantity, destinoObs: String(data.destinoObs || "Baixa de estoque").trim() };
    if (!eventKey) throw new RangeError("eventKey e obrigatorio para saida de bucha.");
    const duplicate = outputs.find(item => String(item?.eventKey || "") === eventKey);
    if (duplicate) {
      if (!sameBuchaOutputEvent(duplicate, candidate)) throw new RangeError("eventKey ja foi usado com dados diferentes.");
      return { ...buchaEntryReadModel(catalog, entries, outputs, { hrn_buchas: locked.get("hrn_buchas").version, hrn_buchas_entradas: locked.get("hrn_buchas_entradas").version, hrn_buchas_saidas: locked.get("hrn_buchas_saidas").version }, await currentRevision(client)), output: duplicate, duplicate: true };
    }
    if (entries.some(item => String(item?.eventKey || "") === eventKey) || entries.some(item => Array.isArray(item?.transitionEvents) && item.transitionEvents.some(event => String(event?.eventKey || "") === eventKey))) throw new RangeError("eventKey ja foi usado por outra operacao de bucha.");
    assertBuchaOutputVersions(locked, expectedVersions);
    if (!sku) throw new RangeError("SKU de bucha e obrigatorio.");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("A quantidade deve ser um inteiro positivo.");
    const bucha = catalog.find(item => normalizeBuchaSku(item?.sku) === sku);
    if (!bucha) throw new RangeError("SKU de bucha nao cadastrado.");
    const stock = buchaEntryReadModel(catalog, entries, outputs, {}, 0);
    const affectedIssues = stock.inconsistencies.filter(issue => issue.sku === sku);
    if (affectedIssues.length) throw new RangeError("Inconsistencia historica impede determinar o saldo de bucha.");
    const item = stock.items.find(row => row.sku === sku);
    const available = Number(item?.estoqueFinal);
    if (!Number.isFinite(available) || available < 0) throw new RangeError("Inconsistencia historica impede determinar o saldo acabado.");
    if (quantity > available) throw insufficientBuchaStock(sku, available, quantity);
    const now = isoNow();
    const output = { id: `sai_${randomUUID()}`, codigoSaida: buchaOutputCode(outputs), eventKey, sku, descricao: String(bucha.descricao || bucha.description || "").trim(), quantidade: quantity, destinoObs: candidate.destinoObs, dataSaida: now, usuario: actor || "Sistema", historico: [{ data: now, acao: `Saida registrada de ${quantity} un do Estoque Final`, usuario: actor || "Sistema" }] };
    outputs.unshift(output);
    const saved = await saveLockedStates(client, locked, { hrn_buchas_saidas: outputs }, actor, "BCH_OUT_CREATE");
    return { ...buchaEntryReadModel(catalog, entries, outputs, { ...saved.versions, hrn_buchas: locked.get("hrn_buchas").version, hrn_buchas_entradas: locked.get("hrn_buchas_entradas").version }, saved.revision), ...saved, output };
  });
}

function trackingError(message, code = "TRACKING_RECONCILE_INVALID", status = 400) {
  const error = new RangeError(message); error.code = code; error.status = status; return error;
}

function normalizeTrackingRecord(item, index) {
  const sourceId = String(item?.sourceId || item?.externalLotId || item?.originId || "").trim();
  const sku = normalizeBuchaSku(item?.sku);
  const modelo = String(item?.modelo || item?.model || "").trim();
  const codigoBruto = normalizeRawCode(item?.codigoBruto || item?.bruto);
  const quantity = Number(item?.quantidade ?? item?.qty);
  if (!sourceId) throw trackingError(`Registro ${index + 1} sem identificacao estavel de origem.`, "TRACKING_IDENTITY_REQUIRED");
  if (!sku && !modelo) throw trackingError(`Registro ${index + 1} sem SKU ou modelo.`);
  if (!Number.isInteger(quantity) || quantity <= 0) throw trackingError(`Registro ${index + 1} com quantidade invalida.`);
  return { sourceId, externalLotId: String(item?.externalLotId || "").trim(), sku, modelo, codigoBruto, quantidade: quantity, localizacao: String(item?.localizacao || "").trim(), operacao: String(item?.operacao || item?.operacaoAtual || "").trim() || "01", sourceRef: String(item?.sourceRef || item?.linhaOrigem || "").trim(), importId: String(item?.importId || "").trim() };
}

function trackingFingerprint(records) { return JSON.stringify(records); }

function assertTrackingVersions(locked, expected = {}) {
  for (const key of ["hrn_ops", "hrn_pecas", "hrn_tracking_reconcile_events"]) {
    const current = Number(locked.get(key).version);
    const initializing = Number(expected[key]) === 0 && current === 1;
    if (expected[key] !== undefined && !initializing && current !== Number(expected[key])) throw versionConflict(current);
  }
}

export async function reconcileProductionTracking(data = {}, expectedVersions = {}, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return inventoryTransactionRequired();
  const rawRecords = Array.isArray(data?.records) ? data.records : [];
  if (!rawRecords.length) throw trackingError("Informe ao menos um registro de rastreio.");
  const records = rawRecords.map(normalizeTrackingRecord);
  const ids = new Set();
  for (const record of records) { if (ids.has(record.sourceId)) throw trackingError(`Identificacao de origem duplicada: ${record.sourceId}.`, "TRACKING_IDENTITY_AMBIGUOUS", 409); ids.add(record.sourceId); }
  const eventKey = String(data?.eventKey || "").trim();
  if (!eventKey) throw trackingError("eventKey e obrigatorio para reconciliacao.");
  const fingerprint = trackingFingerprint(records);
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_ops: [], hrn_pecas: [], hrn_tracking_reconcile_events: [] });
    const ops = Array.isArray(locked.get("hrn_ops").value) ? [...locked.get("hrn_ops").value] : [];
    const pieces = Array.isArray(locked.get("hrn_pecas").value) ? [...locked.get("hrn_pecas").value] : [];
    const events = Array.isArray(locked.get("hrn_tracking_reconcile_events").value) ? [...locked.get("hrn_tracking_reconcile_events").value] : [];
    const duplicate = events.find(event => event.eventKey === eventKey);
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint) throw trackingError("eventKey ja foi usado com dados diferentes.", "TRACKING_EVENT_CONFLICT", 409);
      return { ...duplicate.result, versions: { hrn_ops: locked.get("hrn_ops").version, hrn_pecas: locked.get("hrn_pecas").version, hrn_tracking_reconcile_events: locked.get("hrn_tracking_reconcile_events").version }, revision: await currentRevision(client), duplicate: true };
    }
    assertTrackingVersions(locked, expectedVersions);
    const now = isoNow(); const result = { created: [], updated: [], unchanged: [], rejected: [] };
    let nextNumber = Math.max(0, ...ops.filter(op => op?.origin === "tracking_import").map(op => Number.parseInt(String(op.numero || "").replace(/\D/g, ""), 10) || 0));
    for (const record of records) {
      const matchingPieces = pieces.filter(piece => String(piece?.trackingSourceId || "") === record.sourceId);
      const matchingOps = ops.filter(op => String(op?.trackingSourceId || "") === record.sourceId);
      if (matchingPieces.length > 1 || matchingOps.length > 1) throw trackingError(`Identificacao ${record.sourceId} e ambigua no rastreio existente.`, "TRACKING_IDENTITY_AMBIGUOUS", 409);
      const piece = matchingPieces[0]; const op = matchingOps[0];
      if ((piece && piece.origin !== "tracking_import") || (op && op.origin !== "tracking_import")) throw trackingError(`Identificacao ${record.sourceId} pertence a registro de origem incompativel.`, "TRACKING_ORIGIN_CONFLICT", 409);
      if (piece && op && String(piece.opId || "") !== String(op.id || "")) throw trackingError(`Vinculo de OP inconsistente para ${record.sourceId}.`, "TRACKING_LINK_CONFLICT", 409);
      if (!piece && op) throw trackingError(`OP de acompanhamento sem lote para ${record.sourceId}.`, "TRACKING_LINK_CONFLICT", 409);
      const desired = { modelo: record.modelo, sku: record.sku, tipoFundicao: record.codigoBruto, qty: record.quantidade, operacaoAtual: record.operacao, localizacao: record.localizacao, sourceRef: record.sourceRef, importId: record.importId };
      if (!piece) {
        const newOp = { id: randomUUID(), numero: `TRK-${String(++nextNumber).padStart(4, "0")}`, modelo: record.modelo || record.sku, qty: record.quantidade, cliente: "Estoque Interno", etapa: record.operacao, prioridade: "Normal", obs: `Acompanhamento importado. Bruto: ${record.codigoBruto}. Loc: ${record.localizacao}`, origin: "tracking_import", trackingSourceId: record.sourceId, criadoEm: now, atualizadoEm: now };
        const newPiece = { id: randomUUID(), numero: record.externalLotId || `TRK-${record.sourceId}`, ...desired, opId: newOp.id, opNumero: newOp.numero, origin: "tracking_import", trackingSourceId: record.sourceId, historico: [{ op: record.operacao, data: now, obs: `Importado de rastreio${record.importId ? ` (${record.importId})` : ""}` }], criadoEm: now, atualizadoEm: now };
        ops.push(newOp); pieces.push(newPiece); result.created.push({ sourceId: record.sourceId, pieceId: newPiece.id, opId: newOp.id });
        continue;
      }
      const changed = Object.entries(desired).some(([key, value]) => String(piece[key] ?? "") !== String(value ?? ""));
      if (!changed) { result.unchanged.push({ sourceId: record.sourceId, pieceId: piece.id, opId: piece.opId }); continue; }
      const pieceIndex = pieces.findIndex(item => item.id === piece.id); const opIndex = ops.findIndex(item => item.id === piece.opId);
      const history = Array.isArray(piece.historico) ? [...piece.historico] : [];
      history.push({ op: record.operacao, data: now, obs: `Atualizado de rastreio${record.importId ? ` (${record.importId})` : ""}` });
      pieces[pieceIndex] = { ...piece, ...desired, historico: history, atualizadoEm: now };
      if (opIndex >= 0) ops[opIndex] = { ...ops[opIndex], modelo: record.modelo || record.sku, qty: record.quantidade, etapa: record.operacao, obs: `Acompanhamento importado. Bruto: ${record.codigoBruto}. Loc: ${record.localizacao}`, atualizadoEm: now };
      result.updated.push({ sourceId: record.sourceId, pieceId: piece.id, opId: piece.opId });
    }
    events.unshift({ id: randomUUID(), eventKey, fingerprint, actor, at: now, result });
    const saved = await saveLockedStates(client, locked, { hrn_ops: ops, hrn_pecas: pieces, hrn_tracking_reconcile_events: events }, actor, "TRK_RECONCILE");
    return { ...result, operations: ops, pieces, ...saved };
  });
}

function normalizeManualOpData(data) {
  const quantity = Math.max(0, Number.parseInt(data?.qty, 10) || 0);
  if (!String(data?.modelo || "").trim()) throw new RangeError("Selecione um modelo de helice.");
  if (quantity <= 0) throw new RangeError("Informe uma quantidade maior que zero.");
  return {
    modelo: String(data.modelo).trim(), qty: quantity,
    cliente: String(data.cliente || "").trim(), prazo: String(data.prazo || ""),
    etapa: String(data.etapa || "Fila de Espera"), prioridade: String(data.prioridade || "Normal"),
    obs: String(data.obs || "").trim()
  };
}

function modelRawCode(models, modelName) {
  const normalized = normalizeRawCode(modelName);
  const model = models.find(item => normalizeRawCode(item.nome) === normalized);
  const rawCode = normalizeRawCode(model?.codigoBruto);
  if (!rawCode) throw new RangeError(`O modelo ${modelName} nao possui peca bruta vinculada.`);
  return rawCode;
}

export async function mutateManualProductionOrder(action, id, data, expectedVersion, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();
  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_config: {}, hrn_materiais: [], hrn_modelos: [], hrn_movimentos: [], hrn_ops: [] });
    const opsState = locked.get("hrn_ops");
    if (Number(opsState.version) !== Number(expectedVersion)) throw versionConflict(Number(opsState.version));
    const ops = [...opsState.value];
    const materials = [...locked.get("hrn_materiais").value];
    const movements = [...locked.get("hrn_movimentos").value];
    const models = locked.get("hrn_modelos").value;
    const now = isoNow();
    let op;

    if (action === "create") {
      const normalized = normalizeManualOpData(data);
      const rawCode = modelRawCode(models, normalized.modelo);
      const material = findRawMaterial(materials, rawCode);
      const available = Math.max(0, Number(material?.saldo) || 0);
      if (!material || available < normalized.qty) throw insufficientStock(rawCode, available, normalized.qty);
      const configState = { ...(locked.get("hrn_config").value || {}) };
      configState.opCounter = Math.max(Number(configState.opCounter) || 0, ...ops.map(item => Number.parseInt(String(item.numero || "").replace(/\D/g, ""), 10) || 0)) + 1;
      op = { id: randomUUID(), numero: `OP-${String(configState.opCounter).padStart(4, "0")}`, ...normalized, rawCode, rawStockQuantity: normalized.qty, rawStockConsumed: true, rawStockRevision: 1, criadoEm: now, atualizadoEm: now };
      material.saldo = available - normalized.qty;
      material.atualizadoEm = now;
      material.atualizadoPor = actor;
      movements.unshift(movement({ material, type: "Saida", quantity: normalized.qty, balance: material.saldo, actor, op, reason: `Consumo automatico na criacao da ${op.numero}`, eventKey: `${op.id}:consume:1` }));
      ops.push(op);
      const saved = await saveLockedStates(client, locked, { hrn_config: configState, hrn_materiais: materials, hrn_movimentos: movements, hrn_ops: ops }, actor, "OP_CREATE_RAW");
      return { ...saved, op, operations: ops, stock: rawStockView(materials, movements), version: saved.versions.hrn_ops };
    }

    const index = ops.findIndex(item => String(item.id) === String(id));
    if (index < 0) return null;
    const previous = ops[index];
    let stockChanged = false;

    if (action === "delete") {
      if (previous.rawStockConsumed) {
        const material = findRawMaterial(materials, previous.rawCode);
        if (!material) throw new RangeError(`Peca bruta ${previous.rawCode || "vinculada"} nao cadastrada; a OP nao foi cancelada.`);
        stockChanged = true;
        material.saldo = Math.max(0, Number(material.saldo) || 0) + Number(previous.rawStockQuantity || previous.qty || 0);
        material.atualizadoEm = now;
        material.atualizadoPor = actor;
        movements.unshift(movement({ material, type: "Entrada", quantity: previous.rawStockQuantity || previous.qty, balance: material.saldo, actor, op: previous, reason: `Estorno por cancelamento da ${previous.numero}`, eventKey: `${previous.id}:cancel:${Number(previous.rawStockRevision || 1) + 1}` }));
      }
      ops.splice(index, 1);
    } else {
      const normalized = normalizeManualOpData(data);
      op = { ...previous, ...normalized, atualizadoEm: now };
      if (previous.rawStockConsumed) {
        const oldCode = normalizeRawCode(previous.rawCode);
        const newCode = modelRawCode(models, normalized.modelo);
        const oldQty = Number(previous.rawStockQuantity || previous.qty || 0);
        const newQty = normalized.qty;
        const oldMaterial = findRawMaterial(materials, oldCode);
        const newMaterial = findRawMaterial(materials, newCode);
        if (!oldMaterial || !newMaterial) throw new RangeError("Peca bruta vinculada nao cadastrada no estoque.");
        if (oldCode === newCode) {
          const difference = newQty - oldQty;
          const available = Math.max(0, Number(oldMaterial.saldo) || 0);
          if (difference > available) throw insufficientStock(newCode, available, difference);
          if (difference !== 0) {
            stockChanged = true;
            oldMaterial.saldo = available - difference;
            oldMaterial.atualizadoEm = now;
            oldMaterial.atualizadoPor = actor;
            movements.unshift(movement({ material: oldMaterial, type: difference > 0 ? "Saida" : "Entrada", quantity: difference, balance: oldMaterial.saldo, actor, op, reason: `Ajuste de quantidade da ${previous.numero}: ${oldQty} para ${newQty}`, eventKey: `${previous.id}:adjust:${Number(previous.rawStockRevision || 1) + 1}` }));
          }
        } else {
          stockChanged = true;
          oldMaterial.saldo = Math.max(0, Number(oldMaterial.saldo) || 0) + oldQty;
          const availableNew = Math.max(0, Number(newMaterial.saldo) || 0);
          if (availableNew < newQty) throw insufficientStock(newCode, availableNew, newQty);
          newMaterial.saldo = availableNew - newQty;
          oldMaterial.atualizadoEm = now;
          oldMaterial.atualizadoPor = actor;
          newMaterial.atualizadoEm = now;
          newMaterial.atualizadoPor = actor;
          movements.unshift(movement({ material: oldMaterial, type: "Entrada", quantity: oldQty, balance: oldMaterial.saldo, actor, op: previous, reason: `Estorno por troca de bruto da ${previous.numero}`, eventKey: `${previous.id}:return:${Number(previous.rawStockRevision || 1) + 1}` }));
          movements.unshift(movement({ material: newMaterial, type: "Saida", quantity: newQty, balance: newMaterial.saldo, actor, op, reason: `Consumo apos troca de bruto da ${previous.numero}`, eventKey: `${previous.id}:consume:${Number(previous.rawStockRevision || 1) + 1}` }));
        }
        op.rawCode = newCode;
        op.rawStockQuantity = newQty;
        op.rawStockRevision = Number(previous.rawStockRevision || 1) + (stockChanged ? 1 : 0);
      }
      ops[index] = op;
    }
    const changes = stockChanged
      ? { hrn_materiais: materials, hrn_movimentos: movements, hrn_ops: ops }
      : { hrn_ops: ops };
    const saved = await saveLockedStates(client, locked, changes, actor, action === "delete" ? "OP_CANCEL_RAW" : "OP_UPDATE_RAW");
    return { ...saved, op: action === "delete" ? previous : op, operations: ops, stock: rawStockView(materials, movements), version: saved.versions.hrn_ops };
  });
}

export async function getFundicaoOrders() {
  const snapshot = await getStateSnapshot(0);
  const orders = Array.isArray(snapshot.data?.hrn_fundicoes) ? snapshot.data.hrn_fundicoes : [];
  return {
    orders,
    version: Number(snapshot.versions?.hrn_fundicoes || 0)
  };
}

export async function createFundicaoOrder(data, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();
  const quantity = Math.max(1, Number.parseInt(data?.qtyPlanejada || data?.qty, 10) || 1);
  const coquilha = normalizeRawCode(data?.coquilha || data?.codigo || data?.modelo);
  if (!coquilha) throw new RangeError("Selecione o produto / coquilha.");

  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_config: {}, hrn_fundicoes: [] });
    const orders = [...(Array.isArray(locked.get("hrn_fundicoes")?.value) ? locked.get("hrn_fundicoes").value : [])];
    const configState = { ...(locked.get("hrn_config")?.value || {}) };
    const now = isoNow();

    configState.fundicaoOpCounter = Math.max(
      Number(configState.fundicaoOpCounter) || 0,
      ...orders.map(item => Number.parseInt(String(item.numero || item.lote || "").replace(/\D/g, ""), 10) || 0)
    ) + 1;

    const opNumero = `OP-FND-${String(configState.fundicaoOpCounter).padStart(4, "0")}`;

    const op = {
      id: randomUUID(),
      numero: opNumero,
      lote: opNumero,
      produto: String(data?.produto || coquilha).trim(),
      codigo: coquilha,
      coquilha: coquilha,
      modelo: coquilha,
      qtyPlanejada: quantity,
      qty: quantity,
      qtyProduzida: null,
      status: "Em aberto",
      dataCriacao: now,
      dataPrevista: String(data?.dataPrevista || "").trim(),
      dataFinalizacao: null,
      responsavel: String(actor || data?.responsavel || "").trim(),
      liga: String(data?.liga || "Alumínio AlMg5").trim(),
      pesoUnitario: Number(data?.pesoUnitario) || 0,
      obs: String(data?.obs || "").trim(),
      criadoEm: now,
      atualizadoEm: now
    };

    orders.unshift(op);
    const saved = await saveLockedStates(
      client,
      locked,
      { hrn_config: configState, hrn_fundicoes: orders },
      actor,
      "FUND_OP_CREATE"
    );

    return { ...saved, op, orders, version: saved.versions.hrn_fundicoes };
  });
}

export async function finalizeFundicaoOrder(opId, finishData, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();

  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_fundicoes: [], hrn_materiais: [], hrn_movimentos: [] });
    const orders = [...(Array.isArray(locked.get("hrn_fundicoes")?.value) ? locked.get("hrn_fundicoes").value : [])];
    const materials = [...(Array.isArray(locked.get("hrn_materiais")?.value) ? locked.get("hrn_materiais").value : [])];
    const movements = [...(Array.isArray(locked.get("hrn_movimentos")?.value) ? locked.get("hrn_movimentos").value : [])];
    const now = isoNow();

    const opIndex = orders.findIndex(item => String(item.id) === String(opId));
    if (opIndex < 0) return null;
    const op = { ...orders[opIndex] };

    // Idempotência: impede re-finalização
    if (op.status === "Fundido") {
      throw new RangeError(`A ordem ${op.numero || op.lote} já foi finalizada anteriormente.`);
    }

    const qtyProduzida = Math.max(1, Number(finishData?.qtyProduzida || finishData?.quantidadeProduzida || op.qtyPlanejada || op.qty) || 1);
    const rawCode = normalizeRawCode(op.coquilha || op.codigo || op.modelo);

    let material = findRawMaterial(materials, rawCode);
    if (!material) {
      material = {
        id: `raw_${randomUUID()}`,
        nome: rawCode,
        rawCode: rawCode,
        categoria: RAW_MATERIAL_CATEGORY,
        unidade: "un",
        saldo: 0,
        minimo: 0,
        fornecedor: "",
        criadoEm: now,
        atualizadoEm: now,
        atualizadoPor: actor
      };
      materials.push(material);
    }

    const previousStock = Math.max(0, Number(material.saldo) || 0);
    const newStock = previousStock + qtyProduzida;
    material.saldo = newStock;
    material.atualizadoEm = now;
    material.atualizadoPor = actor;

    const opFinalizedResponsavel = String(finishData?.responsavel || finishData?.responsavelConclusao || actor || op.responsavel || "").trim();

    movements.unshift(movement({
      material,
      type: "Entrada",
      quantity: qtyProduzida,
      balance: newStock,
      actor: opFinalizedResponsavel,
      op: { id: op.id, numero: op.numero || op.lote },
      reason: `Produção finalizada da fundição (${op.numero || op.lote})`,
      eventKey: `FUNDICAO-FINALIZAR-${op.id}`
    }));

    op.status = "Fundido";
    op.qtyProduzida = qtyProduzida;
    op.dataFinalizacao = finishData?.dataFinalizacao ? new Date(finishData.dataFinalizacao).toISOString() : now;
    op.responsavel = opFinalizedResponsavel;
    op.obsFinalizacao = String(finishData?.obs || finishData?.observacoes || "").trim();
    op.atualizadoEm = now;

    orders[opIndex] = op;

    const saved = await saveLockedStates(
      client,
      locked,
      { hrn_fundicoes: orders, hrn_materiais: materials, hrn_movimentos: movements },
      actor,
      "FUND_OP_FINALIZE"
    );

    return {
      ...saved,
      op,
      orders,
      stock: rawStockView(materials, movements),
      version: saved.versions.hrn_fundicoes
    };
  });
}

export async function updateFundicaoOrder(opId, data, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();

  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_fundicoes: [] });
    const orders = [...(Array.isArray(locked.get("hrn_fundicoes")?.value) ? locked.get("hrn_fundicoes").value : [])];
    const opIndex = orders.findIndex(item => String(item.id) === String(opId));
    if (opIndex < 0) return null;

    const previous = orders[opIndex];
    if (previous.status === "Fundido") {
      throw new RangeError("Não é possível alterar uma OP já finalizada e registrada no estoque.");
    }

    const coquilha = normalizeRawCode(data?.coquilha || data?.codigo || data?.modelo || previous.coquilha);
    if (!coquilha) throw new RangeError("Selecione o produto / coquilha.");

    const quantity = Math.max(1, Number.parseInt(data?.qtyPlanejada || data?.qty || previous.qtyPlanejada || previous.qty, 10) || 1);
    const op = {
      ...previous,
      produto: String(data?.produto || coquilha).trim(),
      codigo: coquilha,
      coquilha,
      modelo: coquilha,
      qtyPlanejada: quantity,
      qty: quantity,
      dataPrevista: String(data?.dataPrevista || "").trim(),
      responsavel: String(actor || data?.responsavel || previous.responsavel || "").trim(),
      liga: String(data?.liga || previous.liga || "Alumínio AlMg5").trim(),
      pesoUnitario: Number(data?.pesoUnitario) || Number(previous.pesoUnitario) || 0,
      obs: String(data?.obs || "").trim(),
      atualizadoEm: isoNow()
    };
    orders[opIndex] = op;

    const saved = await saveLockedStates(client, locked, { hrn_fundicoes: orders }, actor, "FUND_OP_UPDATE");
    return { ...saved, op, orders, version: saved.versions.hrn_fundicoes };
  });
}

export async function deleteFundicaoOrder(opId, actor = "") {
  await initializeDatabase();
  if (usesLocalFile() || usesSupabaseRest()) return rawStockTransactionRequired();

  return transaction(async client => {
    const locked = await lockStateRows(client, { hrn_fundicoes: [] });
    const orders = [...(Array.isArray(locked.get("hrn_fundicoes")?.value) ? locked.get("hrn_fundicoes").value : [])];
    const opIndex = orders.findIndex(item => String(item.id) === String(opId));
    if (opIndex < 0) return null;
    const previous = orders[opIndex];

    if (previous.status === "Fundido") {
      throw new RangeError("Não é possível excluir uma OP que já foi finalizada e entrou no estoque.");
    }

    orders.splice(opIndex, 1);
    const saved = await saveLockedStates(client, locked, { hrn_fundicoes: orders }, actor, "FUND_OP_DELETE");
    return { ...saved, op: previous, orders, version: saved.versions.hrn_fundicoes };
  });
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
  initialized = false;
}
