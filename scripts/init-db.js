import { closeDatabase, initializeDatabase } from "../server/database.js";

try {
  await initializeDatabase();
  console.log("Banco de dados PostgreSQL (Supabase) inicializado com sucesso!");
} finally {
  await closeDatabase();
}
