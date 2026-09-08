import "dotenv/config";

import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

function env(name) {
  return String(process.env[name] || "").trim();
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(env(name), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  database: {
    connectionString:
      env("DATABASE_URL") ||
      env("POSTGRES_URL") ||
      env("POSTGRES_PRISMA_URL") ||
      env("POSTGRES_URL_NON_POOLING"),
    sslRejectUnauthorized: env("DATABASE_SSL_REJECT_UNAUTHORIZED").toLowerCase() !== "false"
  },
  supabase: {
    url: env("SUPABASE_URL") || env("VITE_SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    anonKey: env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY")
  },
  auditCleanupEnabled: env("AUDIT_CLEANUP_ENABLED").toLowerCase() === "true",
  auditRetentionDays: positiveInteger("AUDIT_RETENTION_DAYS", 30),
  tinyToken: env("TINY_TOKEN")
};
