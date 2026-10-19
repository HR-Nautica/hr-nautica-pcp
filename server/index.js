import compression from "compression";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { authSystem } from "./auth.js";
import { databaseHealth } from "./database.js";
import { sanitizeDatabaseError } from "./postgres-config.js";
import { validateStrictDatabase } from "./strict-database.js";
import analysisTempRouter from "./routes/analysis-temp.js";
import fundicaoOpsRouter from "./routes/fundicao-ops.js";
import heliceOpsRouter from "./routes/helice-ops.js";
import integrationsRouter from "./routes/integrations.js";
import productionOpsRouter from "./routes/production-ops.js";
import rawStockRouter from "./routes/raw-stock.js";
import stateRouter from "./routes/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const app = express();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use("/api/auth", authSystem.router);
app.use("/api", ...authSystem.protectBusiness);

app.get("/api/status", async (_req, res, next) => {
  try {
    const databaseTime = await databaseHealth();
    res.json({
      ok: true,
      service: "HR Nautica PCP",
      version: "2.0.0",
      database: "supabase-connected",
      databaseTime
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/state", stateRouter);
app.use("/api/analysis-temp", analysisTempRouter);
app.use("/api/helice-ops", heliceOpsRouter);
app.use("/api/fundicao-ops", fundicaoOpsRouter);
app.use("/api/production-ops", productionOpsRouter);
app.use("/api/raw-stock", rawStockRouter);
app.use("/api", integrationsRouter);
app.use(express.static(dist, { etag: true, maxAge: "1h" }));
app.get("*splat", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.use((error, _req, res, _next) => {
  console.error("[API]", config.database.strictMode ? sanitizeDatabaseError(error) : error);
  const dbError = ["IM002", "HY000", "08001", "DATABASE_CONFIG_MISSING", "SUPABASE_REST_ERROR"].includes(error.code) || /ODBC|Access|Supabase|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco Supabase indisponivel ou configuracao invalida."
      : "Erro interno. Nenhuma transacao parcial foi mantida."
  });
});

export async function startServer() {
  if (config.database.strictMode) await validateStrictDatabase();
  return await new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`HR Nautica PCP disponivel na porta ${config.port}`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

export { app };

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    await startServer();
  } catch (error) {
    console.error(`[STARTUP] ${sanitizeDatabaseError(error)}`);
    process.exitCode = 1;
  }
}


