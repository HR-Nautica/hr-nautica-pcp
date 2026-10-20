import { createHash, timingSafeEqual } from "node:crypto";

export const PROXY_SECRET_HEADER = "x-hrn-proxy-secret";

function digest(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest();
}

export function validateProxySecret(secret) {
  if (Buffer.byteLength(String(secret || "").trim()) < 32) {
    throw Object.assign(new Error("PROXY_SHARED_SECRET ausente ou invalido."), { code: "PROXY_AUTH_CONFIG_INVALID" });
  }
}

export function createProxyAuthentication(secret) {
  return function proxyAuthentication(req, res, next) {
    try { validateProxySecret(secret); } catch {
      return res.status(503).json({ ok: false, error: "API indisponivel por configuracao invalida." });
    }
    const supplied = req.get(PROXY_SECRET_HEADER) || "";
    if (!timingSafeEqual(digest(secret), digest(supplied))) {
      return res.status(401).json({ ok: false, code: "PROXY_AUTH_INVALID", error: "Credencial do proxy invalida." });
    }
    next();
  };
}
