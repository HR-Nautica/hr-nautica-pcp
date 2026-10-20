import dotenv from "dotenv";

const INFRASTRUCTURE_KEYS = [
  "DATABASE_STRICT_MODE",
  "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING",
  "DATABASE_SSL_MODE", "DATABASE_SSL_REJECT_UNAUTHORIZED", "HOST", "PORT",
  "AUTH_COOKIE_NAME", "AUTH_COOKIE_SECURE", "AUTH_SESSION_HOURS",
  "PROXY_SHARED_SECRET",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"
];

function snapshotEnvironment(keys) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function trueValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

// .env nunca sobrescreve o ambiente do processo. O comportamento legado de
// .env.local com override é mantido, exceto quando o resultado ativa modo estrito.
dotenv.config();
const infrastructureBeforeLocal = snapshotEnvironment(INFRASTRUCTURE_KEYS);
const strictBeforeLocal = trueValue(process.env.DATABASE_STRICT_MODE);
dotenv.config({ path: ".env.local", override: true });
if (strictBeforeLocal || trueValue(process.env.DATABASE_STRICT_MODE)) restoreEnvironment(infrastructureBeforeLocal);

function env(name) {
  return String(process.env[name] || "").trim();
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(env(name), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const strictMode = trueValue(env("DATABASE_STRICT_MODE"));
const databaseUrl = env("DATABASE_URL");
const sessionHours = positiveInteger("AUTH_SESSION_HOURS", 8);

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  database: {
    strictMode,
    databaseUrl,
    connectionString: strictMode
      ? databaseUrl
      : databaseUrl || env("POSTGRES_URL") || env("POSTGRES_PRISMA_URL") || env("POSTGRES_URL_NON_POOLING"),
    sslMode: env("DATABASE_SSL_MODE").toLowerCase(),
    sslRejectUnauthorized: env("DATABASE_SSL_REJECT_UNAUTHORIZED").toLowerCase() !== "false",
    connectTimeoutMs: positiveInteger("DATABASE_CONNECT_TIMEOUT_MS", 10000)
  },
  supabase: {
    url: env("SUPABASE_URL") || env("VITE_SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    anonKey: env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY")
  },
  auditCleanupEnabled: env("AUDIT_CLEANUP_ENABLED").toLowerCase() === "true",
  auditRetentionDays: positiveInteger("AUDIT_RETENTION_DAYS", 30),
  tinyToken: env("TINY_TOKEN"),
  proxySharedSecret: env("PROXY_SHARED_SECRET"),
  auth: {
    cookieName: env("AUTH_COOKIE_NAME") || "hrn_session",
    secureCookies: env("AUTH_COOKIE_SECURE")
      ? trueValue(env("AUTH_COOKIE_SECURE"))
      : env("NODE_ENV").toLowerCase() === "production",
    sessionDurationMs: sessionHours * 60 * 60 * 1000
  }
};
