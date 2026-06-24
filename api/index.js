import compression from "compression";
import express from "express";
import helmet from "helmet";

import { config } from "../server/config.js";
import { databaseHealth } from "../server/database.js";
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
app.use("/api", integrationsRouter);

app.use((error, _req, res, _next) => {
  console.error("[API]", error);
  const dbError = ["IM002", "HY000", "08001"].includes(error.code) || /ODBC|Access|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco de dados indisponivel."
      : "Erro interno. Nenhuma transacao parcial foi mantida."
  });
});

export default app;
