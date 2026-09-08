import { closeDatabase, initializeRawMaterialStock } from "../server/database.js";

if (!process.argv.includes("--reset")) throw new Error("Use --reset para confirmar o saldo inicial zero dos brutos.");

try {
  const result = await initializeRawMaterialStock("MIGRACAO_ESTOQUE_BRUTO");
  console.log(`Estoque interno inicializado: ${result.count} pecas brutas com saldo zero.`);
} finally {
  await closeDatabase();
}
