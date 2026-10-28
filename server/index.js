import compression from "compression";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { authSystem } from "./auth.js";
import { closeDatabase, databaseHealth } from "./database.js";
import { createHealthHandler } from "./health.js";
import { createReleaseGuard, normalizedReleaseSha } from "./release.js";
import { sanitizeDatabaseError } from "./postgres-config.js";
import { validateStrictDatabase } from "./strict-database.js";
import { createMigrationGate } from "./migration-gate.js";
import { createProxyAuthentication, validateProxySecret } from "./proxy-auth.js";
import catalogRouter from "./routes/catalog.js";
import productFoundationRouter from "./routes/product-foundation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const app = express();
let strictDatabaseStatus = { strict: false, pending: [] };
const requireProductFoundationSchema = createMigrationGate([3, 4, 6, 7], () => strictDatabaseStatus);

app.disable("x-powered-by");
// A publicacao interna atual e HTTP. HSTS so e aceito sobre transporte seguro
// e anunciaria uma politica incompatível com esse modo de operacao.
app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: false }));
app.use(compression());
app.use(createReleaseGuard(config.releaseSha, {
  directDownloadPaths: ["/api/catalog-export"]
}));

app.get("/healthz", createHealthHandler({ databaseHealth, releaseSha: config.releaseSha }));

app.use("/api", createProxyAuthentication(config.proxySharedSecret));
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
      release: normalizedReleaseSha(config.releaseSha),
      database: "supabase-connected",
      databaseTime
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/product-foundation", requireProductFoundationSchema, productFoundationRouter);
app.use("/api/catalog", requireProductFoundationSchema, catalogRouter);
app.use(express.static(dist, {
  etag: true,
  maxAge: 0,
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); }
}));
app.get("*splat", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(dist, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error("[API]", config.database.strictMode ? sanitizeDatabaseError(error) : error);
  const dbError = ["IM002", "HY000", "08001", "DATABASE_CONFIG_MISSING", "MIGRATIONS_PENDING", "SUPABASE_REST_ERROR"].includes(error.code) || /ODBC|Access|Supabase|database|banco/i.test(error.message || "");
  res.status(dbError ? 503 : 500).json({
    ok: false,
    error: dbError
      ? "Banco Supabase indisponivel ou configuracao invalida."
      : "Erro interno. Nenhuma transacao parcial foi mantida."
  });
});

export async function startServer() {
  if (config.database.strictMode) {
    strictDatabaseStatus = await validateStrictDatabase();
    if (strictDatabaseStatus.pending.length) {
      console.warn(`[STARTUP] Migrations pendentes: V${strictDatabaseStatus.pending.join(", V")}. Funcionalidades dependentes permanecem bloqueadas.`);
    }
  }
  validateProxySecret(config.proxySharedSecret);
  return await new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`HR Nautica PCP disponivel na porta ${config.port}`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

export async function stopServer(server) {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
}

export { app };

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    const server = await startServer();
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await stopServer(server);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (error) {
    console.error(`[STARTUP] ${sanitizeDatabaseError(error)}`);
    process.exitCode = 1;
  }
}


