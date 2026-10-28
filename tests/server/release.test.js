import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";

import { createReleaseGuard, normalizedReleaseSha } from "../../server/release.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

async function serve(release = SHA, options = {}) {
  const app = express();
  app.use(createReleaseGuard(release, options));
  app.get("/api/probe", (_req, res) => res.json({ ok: true }));
  app.get("/api/catalog-export", (_req, res) => res.json({ ok: true }));
  app.get("/release.json", (_req, res) => res.json({ release }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("normaliza somente SHA Git completo", () => {
  assert.equal(normalizedReleaseSha(SHA.toUpperCase()), SHA);
  assert.equal(normalizedReleaseSha("6547d0c"), "development");
  assert.equal(normalizedReleaseSha(""), "development");
});

test("release de producao recusa frontend ausente ou divergente", async (t) => {
  const target = await serve();
  t.after(() => target.server.close());

  let response = await fetch(`${target.origin}/api/probe`);
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("x-hrn-release-mismatch"), "1");

  response = await fetch(`${target.origin}/api/probe`, { headers: { "x-hrn-release-sha": SHA } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-hrn-release-sha"), SHA);

  response = await fetch(`${target.origin}/release.json`);
  assert.equal(response.status, 200);
});

test("desenvolvimento local nao exige cabecalho de release", async (t) => {
  const target = await serve("development");
  t.after(() => target.server.close());
  const response = await fetch(`${target.origin}/api/probe`);
  assert.equal(response.status, 200);
});

test("download autenticado configurado aceita navegacao GET direta", async (t) => {
  const target = await serve(SHA, { directDownloadPaths: ["/api/catalog-export"] });
  t.after(() => target.server.close());

  let response = await fetch(`${target.origin}/api/catalog-export`);
  assert.equal(response.status, 200);

  response = await fetch(`${target.origin}/api/catalog-export`, { method: "POST" });
  assert.equal(response.status, 409);

  response = await fetch(`${target.origin}/api/probe`);
  assert.equal(response.status, 409);
});
