import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createProxyApp, validateProxyConfig } from "../../api/proxy.js";

const SECRET = "test-only-secret-with-at-least-32-characters";

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function proxyFor(t, upstreamOrigin, extraEnvironment = {}) {
  const app = createProxyApp({
    environment: { API_ORIGIN: `${upstreamOrigin}/`, PROXY_SHARED_SECRET: SECRET, ...extraEnvironment },
    allowHttpLoopback: true
  });
  const proxy = await listen(app);
  t.after(() => proxy.server.close());
  return proxy.origin;
}

test("encaminha metodo, path, query, corpo, cookies e headers e sobrescreve a credencial", async (t) => {
  const upstream = await listen(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ method: req.method, url: req.url, body, headers: req.headers }));
  });
  t.after(() => upstream.server.close());
  const proxyOrigin = await proxyFor(t, upstream.origin);

  const response = await fetch(`${proxyOrigin}/api/items?order=desc&x=1`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: "hrn_session=user-cookie",
      "x-csrf-token": "csrf-token",
      "x-hrn-proxy-secret": "attacker-controlled"
    },
    body: JSON.stringify({ ok: true })
  });
  const received = await response.json();
  assert.equal(received.method, "PATCH");
  assert.equal(received.url, "/api/items?order=desc&x=1");
  assert.equal(received.body, '{"ok":true}');
  assert.equal(received.headers.cookie, "hrn_session=user-cookie");
  assert.equal(received.headers["x-csrf-token"], "csrf-token");
  assert.equal(received.headers["x-hrn-proxy-secret"], SECRET);
});

test("preserva todos os Set-Cookie e o status do backend", async (t) => {
  const upstream = await listen((_req, res) => {
    res.statusCode = 201;
    res.setHeader("Set-Cookie", [
      "hrn_session=abc; HttpOnly; Secure; SameSite=Strict; Path=/",
      "preference=compact; Secure; SameSite=Lax; Path=/"
    ]);
    res.end("created");
  });
  t.after(() => upstream.server.close());
  const proxyOrigin = await proxyFor(t, upstream.origin);
  const response = await fetch(`${proxyOrigin}/api/auth/login`);
  assert.equal(response.status, 201);
  assert.deepEqual(response.headers.getSetCookie().length, 2);
  assert.match(response.headers.getSetCookie()[0], /HttpOnly/);
  assert.equal(await response.text(), "created");
});

test("falha fechada em configuracao ausente, destino inseguro ou tentativa de trocar destino", async (t) => {
  assert.throws(() => validateProxyConfig({}), { code: "PROXY_CONFIG_INVALID" });
  assert.throws(() => validateProxyConfig({ API_ORIGIN: "http://example.com", PROXY_SHARED_SECRET: SECRET }), { code: "PROXY_CONFIG_INVALID" });
  assert.throws(() => validateProxyConfig({ API_ORIGIN: "https://user:pass@example.com", PROXY_SHARED_SECRET: SECRET }), { code: "PROXY_CONFIG_INVALID" });

  let requestedUrl;
  const upstream = await listen((req, res) => { requestedUrl = req.url; res.end("ok"); });
  t.after(() => upstream.server.close());
  const proxyOrigin = await proxyFor(t, upstream.origin);
  const response = await fetch(`${proxyOrigin}//unauthorized.example/api?target=https://evil.example`);
  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "/api?target=https://evil.example");

  const invalid = createProxyApp({ environment: {} });
  const invalidServer = await listen(invalid);
  t.after(() => invalidServer.server.close());
  const invalidResponse = await fetch(`${invalidServer.origin}/api/status`);
  assert.equal(invalidResponse.status, 503);
});

test("aplica limite de corpo, timeout e erro seguro de conexao", async (t) => {
  const upstream = await listen((_req, res) => setTimeout(() => res.end("late"), 100));
  t.after(() => upstream.server.close());
  const proxyOrigin = await proxyFor(t, upstream.origin, { PROXY_TIMEOUT_MS: "20", PROXY_MAX_BODY_BYTES: "4" });
  let response = await fetch(`${proxyOrigin}/api/upload`, { method: "POST", body: "12345" });
  assert.equal(response.status, 413);
  response = await fetch(`${proxyOrigin}/api/slow`);
  assert.equal(response.status, 504);

  const unavailable = await proxyFor(t, "http://127.0.0.1:1");
  response = await fetch(`${unavailable}/api/status`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "API de destino indisponivel." });
});
