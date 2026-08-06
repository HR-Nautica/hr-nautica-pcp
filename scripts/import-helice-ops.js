import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, importHeliceProductionOrders } from "../server/database.js";
import { parseHeliceProductionWorkbook } from "./helice-ops-parser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workbookPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "public", "Novas Planilhas", "Acompanhamento_Helice.xlsx");

try {
  const parsed = parseHeliceProductionWorkbook(workbookPath);
  const result = await importHeliceProductionOrders(parsed.orders, "IMPORT_ACOMPANHAMENTO_HELICE");
  console.log(`OPs de hélices importadas: ${result.count} (${parsed.sourceSheet}).`);
} finally {
  await closeDatabase();
}
