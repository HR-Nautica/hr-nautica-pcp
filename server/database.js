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
