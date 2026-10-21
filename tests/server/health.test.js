import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";

import { createHealthHandler } from "../../server/health.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("health check confirma banco e o mesmo SHA da release", async (t) => {
  const app = express();
  app.get("/healthz", createHealthHandler({
    releaseSha: SHA,
    databaseHealth: async () => "2026-10-20T12:00:00.000Z"
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "HR Nautica PCP",
    release: SHA,
    databaseTime: "2026-10-20T12:00:00.000Z"
  });
});
