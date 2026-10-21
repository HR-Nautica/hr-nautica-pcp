const SSL_MODES = new Set(["", "disable", "require", "verify-ca", "verify-full"]);

export function validatePostgresUrl(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw Object.assign(new Error("DATABASE_URL inválida."), { code: "DATABASE_CONFIG_INVALID" });
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw Object.assign(new Error("DATABASE_URL inválida."), { code: "DATABASE_CONFIG_INVALID" });
  }
  return parsed;
}

export function validateSslMode(sslMode) {
  const normalized = String(sslMode || "").trim().toLowerCase();
  if (!SSL_MODES.has(normalized)) {
    throw Object.assign(new Error("DATABASE_SSL_MODE inválido."), { code: "DATABASE_SSL_MODE_INVALID" });
  }
  return normalized;
}

export function buildPostgresConnectionOptions(connectionString, {
  sslMode = "", sslRejectUnauthorized = true, connectTimeoutMs = 10000
} = {}) {
  const params = validatePostgresUrl(connectionString);
  const mode = validateSslMode(sslMode);
  return {
    user: params.username ? decodeURIComponent(params.username) : undefined,
    password: params.password ? decodeURIComponent(params.password) : undefined,
    host: params.hostname,
    port: params.port ? Number(params.port) : 5432,
    database: params.pathname.slice(1),
    ssl: mode === "disable" ? false : { rejectUnauthorized: Boolean(sslRejectUnauthorized) },
    connectionTimeoutMillis: connectTimeoutMs
  };
}

export function sanitizeDatabaseError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REMOVIDA]")
    .replace(/(password|senha)\s*[=:]\s*[^\s,;]+/gi, "$1=[REMOVIDO]");
}
