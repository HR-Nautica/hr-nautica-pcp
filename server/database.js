import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

let pool;
let initialized = false;

function getPool() {
  if (!pool) {
    const connectionString = config.database.connectionString;
    const useSsl = connectionString.includes("supabase") || connectionString.includes("render") || connectionString.includes("elephantsql");
    
    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    });
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

export async function initializeDatabase() {
  if (initialized) return;
  
  await withConnection(async (client) => {
    // Create tables if they do not exist
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

    // Check if main revision exists
    const revisionRows = await client.query("SELECT revision FROM app_revision WHERE singleton = $1", ["main"]);
    if (!revisionRows.rows.length) {
      await client.query(
        "INSERT INTO app_revision (singleton, revision, updated_at) VALUES ($1, $2, $3)",
        ["main", 0, new Date()]
      );
    }
  });
  
  initialized = true;
}

export async function transaction(callback) {
  await initializeDatabase();
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
  return withConnection(async (client) => {
    const rows = await client.query("SELECT revision, updated_at FROM app_revision WHERE singleton = $1", ["main"]);
    return firstValue(rows.rows[0], ["updated_at"], new Date());
  });
}

export async function getStateSnapshot(requestedRevision = 0) {
  await initializeDatabase();
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

async function incrementRevision(client) {
  const now = new Date();
  await client.query("UPDATE app_revision SET revision = revision + 1, updated_at = $1 WHERE singleton = $2", [now, "main"]);
  const rows = await client.query("SELECT revision FROM app_revision WHERE singleton = $1", ["main"]);
  return Number(firstValue(rows.rows[0], ["revision"], 0));
}

async function currentVersion(client, key) {
  const rows = await client.query("SELECT version FROM app_state WHERE key = $1", [key]);
  return Number(firstValue(rows.rows[0], ["version"], 0));
}

function versionConflict(current) {
  const error = new Error("VERSION_CONFLICT");
  error.status = 409;
  error.currentVersion = current;
  return error;
}

export async function upsertState(key, value, expectedVersion, actor = "") {
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

export async function closeDatabase() {
  if (!pool) return;
  await pool.end();
  pool = undefined;
  initialized = false;
}
