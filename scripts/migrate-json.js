import fs from "node:fs/promises";
import path from "node:path";
import { closeDatabase, importState } from "../server/database.js";

const input = path.resolve(process.argv[2] || "dados_pcp.json");
const raw = JSON.parse(await fs.readFile(input, "utf8"));

function decode(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

try {
  const entries = Object.entries(raw)
    .filter(([key]) => /^hrn_[a-zA-Z0-9_]+$/.test(key) && key !== "hrn_sync_timestamp")
    .map(([key, encodedValue]) => [key, decode(encodedValue)]);
  const result = await importState(entries, "IMPORT_JSON");
  console.log(`Dados importados de ${input}. Revisao atual: ${result.revision}`);
} finally {
  await closeDatabase();
}
