import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import odbc from "odbc";
import { config } from "./config.js";

let poolPromise;
let initialized = false;

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function runPowerShell(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(stderr || `PowerShell saiu com codigo ${code}`));
    });
  });
}

async function ensureAccessFile() {
  if (config.database.connectionString || await fileExists(config.database.file)) return;
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "create-access-db.ps1"
  );
  await runPowerShell(script, [config.database.file]);
}

function connectionString() {
  if (config.database.connectionString) return config.database.connectionString;
  return `Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=${config.database.file};`;
}

function getPool() {
  if (!poolPromise) poolPromise = odbc.pool(connectionString());
  return poolPromise;
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
  await ensureAccessFile();
  const pool = await getPool();
  const connection = await pool.connect();
  try {
    return await callback(connection);
  } finally {
    await connection.close();
  }
}

async function tableExists(connection, tableName) {
  try {
    await connection.query(`SELECT * FROM ${tableName} WHERE 1 = 0`);
    return true;
  } catch {
    return false;
  }
}

async function ensureTable(connection, tableName, createSql) {
  if (!(await tableExists(connection, tableName))) await connection.query(createSql);
}

export async function initializeDatabase() {
  if (initialized) return;
  await withConnection(async (connection) => {
    await ensureTable(
      connection,
      "app_revision",
      "CREATE TABLE app_revision (singleton TEXT(16) CONSTRAINT pk_app_revision PRIMARY KEY, revision INTEGER NOT NULL, updated_at DATETIME NOT NULL)"
    );
    await ensureTable(
      connection,
      "app_state",
      "CREATE TABLE app_state ([key] TEXT(100) CONSTRAINT pk_app_state PRIMARY KEY, value LONGTEXT NOT NULL, version INTEGER NOT NULL, updated_at DATETIME NOT NULL)"
    );
    await ensureTable(
      connection,
      "audit_log",
      "CREATE TABLE audit_log (id AUTOINCREMENT CONSTRAINT pk_audit_log PRIMARY KEY, state_key TEXT(100) NOT NULL, action TEXT(16) NOT NULL, version INTEGER NOT NULL, payload LONGTEXT, actor TEXT(100), created_at DATETIME NOT NULL)"
    );

    const revisionRows = await connection.query("SELECT revision FROM app_revision WHERE singleton = ?", ["main"]);
    if (!revisionRows.length) {
      await connection.query(
        "INSERT INTO app_revision (singleton, revision, updated_at) VALUES (?, ?, ?)",
        ["main", 0, new Date()]
      );
    }
  });
  initialized = true;
}

export async function transaction(callback) {
  await initializeDatabase();
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function databaseHealth() {
  await initializeDatabase();
  return withConnection(async (connection) => {
    const rows = await connection.query("SELECT revision, updated_at FROM app_revision WHERE singleton = ?", ["main"]);
    return firstValue(rows[0], ["updated_at"], new Date());
  });
}

export async function getStateSnapshot(requestedRevision = 0) {
  await initializeDatabase();
  return withConnection(async (connection) => {
    const revisionRows = await connection.query("SELECT revision FROM app_revision WHERE singleton = ?", ["main"]);
    const revision = Number(firstValue(revisionRows[0], ["revision"], 0));
    if (requestedRevision && requestedRevision === revision) {
      return { modified: false, revision };
    }

    const rows = await connection.query("SELECT [key], value, version FROM app_state ORDER BY [key]");
    const data = {};
    const versions = {};
    for (const row of rows) {
      const key = firstValue(row, ["key"]);
      data[key] = parseStoredValue(firstValue(row, ["value"]));
      versions[key] = Number(firstValue(row, ["version"], 0));
    }
    return { modified: true, revision, data, versions };
  });
}

async function incrementRevision(connection) {
  const now = new Date();
  await connection.query("UPDATE app_revision SET revision = revision + 1, updated_at = ? WHERE singleton = ?", [now, "main"]);
  const rows = await connection.query("SELECT revision FROM app_revision WHERE singleton = ?", ["main"]);
  return Number(firstValue(rows[0], ["revision"], 0));
}

async function currentVersion(connection, key) {
  const rows = await connection.query("SELECT version FROM app_state WHERE [key] = ?", [key]);
  return Number(firstValue(rows[0], ["version"], 0));
}

function versionConflict(current) {
  const error = new Error("VERSION_CONFLICT");
  error.status = 409;
  error.currentVersion = current;
  return error;
}

export async function upsertState(key, value, expectedVersion, actor = "") {
  return transaction(async (connection) => {
    const current = await currentVersion(connection, key);
    if (current !== expectedVersion) throw versionConflict(current);

    const nextVersion = current + 1;
    const now = new Date();
    const payload = serializeValue(value);
    if (current === 0) {
      await connection.query(
        "INSERT INTO app_state ([key], value, version, updated_at) VALUES (?, ?, ?, ?)",
        [key, payload, nextVersion, now]
      );
    } else {
      await connection.query(
        "UPDATE app_state SET value = ?, version = ?, updated_at = ? WHERE [key] = ?",
        [payload, nextVersion, now, key]
      );
    }

    const revision = await incrementRevision(connection);
    await connection.query(
      "INSERT INTO audit_log (state_key, action, version, payload, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [key, "UPSERT", nextVersion, payload, actor, now]
    );
    return { version: nextVersion, revision };
  });
}

export async function deleteState(key, expectedVersion, actor = "") {
  return transaction(async (connection) => {
    const current = await currentVersion(connection, key);
    if (current !== expectedVersion) throw versionConflict(current);

    const now = new Date();
    await connection.query("DELETE FROM app_state WHERE [key] = ?", [key]);
    const revision = await incrementRevision(connection);
    await connection.query(
      "INSERT INTO audit_log (state_key, action, version, actor, created_at) VALUES (?, ?, ?, ?, ?)",
      [key, "DELETE", current + 1, actor, now]
    );
    return { revision };
  });
}

export async function importState(entries, actor = "IMPORT") {
  return transaction(async (connection) => {
    const now = new Date();
    for (const [key, value] of entries) {
      const current = await currentVersion(connection, key);
      const nextVersion = current + 1;
      const payload = serializeValue(value);
      if (current === 0) {
        await connection.query(
          "INSERT INTO app_state ([key], value, version, updated_at) VALUES (?, ?, ?, ?)",
          [key, payload, nextVersion, now]
        );
      } else {
        await connection.query(
          "UPDATE app_state SET value = ?, version = ?, updated_at = ? WHERE [key] = ?",
          [payload, nextVersion, now, key]
        );
      }
      await connection.query(
        "INSERT INTO audit_log (state_key, action, version, payload, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [key, "IMPORT", nextVersion, payload, actor, now]
      );
    }
    return { revision: await incrementRevision(connection) };
  });
}

export async function closeDatabase() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  await pool.close();
  poolPromise = undefined;
  initialized = false;
}
