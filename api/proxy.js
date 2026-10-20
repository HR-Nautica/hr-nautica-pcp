import express from "express";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PROXY_SECRET_HEADER = "x-hrn-proxy-secret";

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"
]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateProxyConfig(environment = process.env, { allowHttpLoopback = false } = {}) {
  const rawOrigin = String(environment.API_ORIGIN || "").trim();
  const secret = String(environment.PROXY_SHARED_SECRET || "").trim();
  let origin;
  try { origin = new URL(rawOrigin); } catch { /* handled below */ }

  const isLoopback = origin && ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
  const validProtocol = origin?.protocol === "https:" || (allowHttpLoopback && isLoopback && origin.protocol === "http:");
  if (!origin || !validProtocol || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw Object.assign(new Error("API_ORIGIN ausente ou invalida."), { code: "PROXY_CONFIG_INVALID" });
  }
  if (Buffer.byteLength(secret) < 32) {
    throw Object.assign(new Error("PROXY_SHARED_SECRET ausente ou invalido."), { code: "PROXY_CONFIG_INVALID" });
  }
  return {
    origin,
    secret,
    timeoutMs: positiveInteger(environment.PROXY_TIMEOUT_MS, 30_000),
    maxBodyBytes: positiveInteger(environment.PROXY_MAX_BODY_BYTES, 25 * 1024 * 1024)
  };
}

function requestHeaders(req, config) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP_HEADERS.has(lower) || lower === "host" || lower === PROXY_SECRET_HEADER) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set(PROXY_SECRET_HEADER, config.secret);
  headers.set("x-forwarded-host", req.headers.host || "");
  headers.set("x-forwarded-proto", req.headers["x-forwarded-proto"] || "https");
  return headers;
}

function limitedBody(req, limit) {
  let received = 0;
  return req.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > limit) callback(Object.assign(new Error("Request body too large"), { code: "BODY_TOO_LARGE" }));
      else callback(null, chunk);
    }
  }));
}

function copyResponseHeaders(upstream, res) {
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "set-cookie") continue;
    res.setHeader(name, value);
  }
  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  else if (upstream.headers.has("set-cookie")) res.setHeader("Set-Cookie", upstream.headers.get("set-cookie"));
}

export function createProxyApp({ environment = process.env, fetchImpl = fetch, allowHttpLoopback = false } = {}) {
  const app = express();
  app.disable("x-powered-by");

  app.use(async (req, res) => {
    let config;
    try {
      config = validateProxyConfig(environment, { allowHttpLoopback });
    } catch {
      return res.status(503).json({ ok: false, error: "Proxy indisponivel por configuracao invalida." });
    }

    const contentLength = Number.parseInt(req.headers["content-length"] || "0", 10);
    if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
      return res.status(413).json({ ok: false, error: "Corpo da requisicao excede o limite permitido." });
    }

    // The destination is always derived from trusted configuration. originalUrl
    // contributes only path/query and can never replace the configured origin.
    const incoming = new URL(req.originalUrl || req.url, "https://proxy.invalid");
    const destination = new URL(config.origin);
    destination.pathname = incoming.pathname;
    destination.search = incoming.search;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    try {
      const upstream = await fetchImpl(destination, {
        method: req.method,
        headers: requestHeaders(req, config),
        body: hasBody ? limitedBody(req, config.maxBodyBytes) : undefined,
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
        signal: controller.signal
      });
      res.status(upstream.status);
      copyResponseHeaders(upstream, res);
      if (!upstream.body) return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error?.code === "BODY_TOO_LARGE" || error?.cause?.code === "BODY_TOO_LARGE") {
        return res.status(413).json({ ok: false, error: "Corpo da requisicao excede o limite permitido." });
      }
      const timedOut = controller.signal.aborted;
      return res.status(timedOut ? 504 : 502).json({ ok: false, error: timedOut ? "API de destino excedeu o tempo limite." : "API de destino indisponivel." });
    } finally {
      clearTimeout(timeout);
    }
  });

  return app;
}
