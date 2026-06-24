import { config } from "../server/config.js";
import { closeDatabase, initializeDatabase } from "../server/database.js";

try {
  await initializeDatabase();
  console.log(`Banco Access criado/validado em: ${config.database.file}`);
} finally {
  await closeDatabase();
}
