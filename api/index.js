import compression from "compression";
import express from "express";
import helmet from "helmet";

import { config } from "../server/config.js";
import { databaseHealth } from "../server/database.js";
import analysisTempRouter from "../server/routes/analysis-temp.js";
import integrationsRouter from "../server/routes/integrations.js";
import stateRouter from "../server/routes/state.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "25mb" }));

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
app.use("/api", integrationsRouter);

app.use((error, _req, res, _next) => {
  console.error("[API]", error);
  const dbError = ["IM002", "HY000", "08001", "DATABASE_CONFIG_MISSING", "SUPABASE_REST_ERROR"].includes(error.code) || /ODBC|Access|Supabase|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco de dados indisponivel."
      : "Erro interno. Nenhuma transacao parcial foi mantida.",
    debugMessage: error.message,
    debugStack: error.stack,
    debugCode: error.code,
    envDatabaseUrlExists: !!process.env.DATABASE_URL,
    envSupabaseUrlExists: !!process.env.SUPABASE_URL,
    envSupabaseServiceRoleExists: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
});

export default app;

