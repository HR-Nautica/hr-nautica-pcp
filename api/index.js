import compression from "compression";
import express from "express";
import helmet from "helmet";

import { config } from "../server/config.js";
import { authSystem } from "../server/auth.js";
import { databaseHealth } from "../server/database.js";
import { sanitizeDatabaseError } from "../server/postgres-config.js";
import analysisTempRouter from "../server/routes/analysis-temp.js";
import fundicaoOpsRouter from "../server/routes/fundicao-ops.js";
import heliceOpsRouter from "../server/routes/helice-ops.js";
import integrationsRouter from "../server/routes/integrations.js";
import productionOpsRouter from "../server/routes/production-ops.js";
import rawStockRouter from "../server/routes/raw-stock.js";
import stateRouter from "../server/routes/state.js";

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

app.use((error, _req, res, _next) => {
  console.error("[API]", config.database.strictMode ? sanitizeDatabaseError(error) : error);
  const dbError = ["IM002", "HY000", "08001", "DATABASE_CONFIG_MISSING", "SUPABASE_REST_ERROR"].includes(error.code) || /ODBC|Access|Supabase|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco de dados indisponivel."
      : "Erro interno. Nenhuma transacao parcial foi mantida."
  });
});

export default app;

