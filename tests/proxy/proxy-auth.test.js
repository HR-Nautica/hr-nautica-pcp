import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";

import { createProxyAuthentication, validateProxySecret } from "../../server/proxy-auth.js";

const SECRET = "backend-test-secret-with-at-least-32-chars";

async function serve(secret) {
  const app = express();
  app.use("/api", createProxyAuthentication(secret));
  app.all("/api/test", (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/api/test` };
}

test("backend valida credencial server-to-server antes das rotas", async (t) => {
  const api = await serve(SECRET);
  t.after(() => api.server.close());
  let response = await fetch(api.url);
  assert.equal(response.status, 401);
  response = await fetch(api.url, { headers: { "x-hrn-proxy-secret": "wrong" } });
  assert.equal(response.status, 401);
  response = await fetch(api.url, { headers: { "x-hrn-proxy-secret": SECRET } });
  assert.equal(response.status, 200);
});

test("backend falha fechado quando o secret nao esta configurado", async (t) => {
  assert.throws(() => validateProxySecret("short"), { code: "PROXY_AUTH_CONFIG_INVALID" });
  const api = await serve("");
  t.after(() => api.server.close());
  const response = await fetch(api.url, { headers: { "x-hrn-proxy-secret": SECRET } });
  assert.equal(response.status, 503);
});
