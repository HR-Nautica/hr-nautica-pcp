import compression from "compression";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { databaseHealth } from "./database.js";
import integrationsRouter from "./routes/integrations.js";
import stateRouter from "./routes/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
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
app.use(express.static(dist, { etag: true, maxAge: "1h" }));
app.get("*splat", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.use((error, _req, res, _next) => {
  console.error("[API]", error);
  const dbError = ["IM002", "HY000", "08001", "DATABASE_CONFIG_MISSING", "SUPABASE_REST_ERROR"].includes(error.code) || /ODBC|Access|Supabase|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco Supabase indisponivel ou configuracao invalida."
      : "Erro interno. Nenhuma transacao parcial foi mantida."
  });
});

app.listen(config.port, config.host, () => {
  console.log(`HR Nautica PCP disponivel na porta ${config.port}`);
});


