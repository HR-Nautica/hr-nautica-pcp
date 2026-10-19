import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import argon2 from "argon2";
import express from "express";

import { createAuthSystem } from "../../server/auth.js";

function createMemoryRepository(passwordHash) {
  const user = {
    id: 1,
    username: "lucas",
    password_hash: passwordHash,
    role: "admin",
    must_change_password: true,
    active: true,
    failed_login_attempts: 0,
    locked_until: null
  };
  const sessions = new Map();
  return {
    user,
    sessions,
    async findUser(username) { return username === user.username ? { ...user } : null; },
    async recordFailedLogin() {
      user.failed_login_attempts += 1;
      if (user.failed_login_attempts >= 5) user.locked_until = new Date(Date.now() + 900000);
    },
    async createSession(session) {
      user.failed_login_attempts = 0;
      user.locked_until = null;
      sessions.set(session.tokenHash, { ...session, userId: user.id, revoked: false });
    },
    async findSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      if (!session || session.revoked || session.expiresAt <= now) return null;
      return {
        token_hash: tokenHash,
        csrf_token_hash: session.csrfTokenHash,
        expires_at: session.expiresAt,
        user_id: user.id,
        username: user.username,
        role: user.role,
        must_change_password: user.must_change_password,
        active: user.active
      };
    },
    async changePasswordAndRotateSession({ expectedPasswordHash, passwordHash: nextHash, session }) {
      if (user.password_hash !== expectedPasswordHash) return false;
      user.password_hash = nextHash;
      user.must_change_password = false;
      for (const value of sessions.values()) value.revoked = true;
      sessions.set(session.tokenHash, { ...session, userId: user.id, revoked: false });
      return true;
    },
    async revokeSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (session) session.revoked = true;
    }
  };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function json(response) {
  return await response.json().catch(() => ({}));
}

test("login, troca obrigatÃ³ria, CSRF, sessÃ£o e logout", async (t) => {
  const repository = createMemoryRepository(await argon2.hash("temporaria", { type: argon2.argon2id }));
  const auth = createAuthSystem({ repository, secureCookies: false, sessionDurationMs: 3600000 });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth.router);
  app.use("/api", ...auth.protectBusiness);
  app.get("/api/private", (req, res) => res.json({ ok: true, actor: req.auth.username }));
  app.post("/api/private", (req, res) => res.json({ ok: true, actor: req.auth.username }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${base}/api/private`);
  assert.equal(response.status, 401);

  response = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lucas", password: "errada" })
  });
  assert.equal(response.status, 401);

  response = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lucas", password: "temporaria" })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  let cookie = cookieFrom(response);
  let payload = await json(response);
  assert.equal(payload.user.mustChangePassword, true);

  response = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  payload = await json(response);
  let csrfToken = payload.csrfToken;

  response = await fetch(`${base}/api/private`, { headers: { Cookie: cookie, "X-PCP-User": "intruso" } });
  assert.equal(response.status, 403);
  assert.equal((await json(response)).code, "PASSWORD_CHANGE_REQUIRED");

  response = await fetch(`${base}/api/auth/change-password`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "temporaria", newPassword: "nova-senha-segura-123" })
  });
  assert.equal(response.status, 403);
  assert.equal((await json(response)).code, "CSRF_INVALID");

  response = await fetch(`${base}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ currentPassword: "temporaria", newPassword: "nova-senha-segura-123" })
  });
  assert.equal(response.status, 200);
  const previousCookie = cookie;
  cookie = cookieFrom(response);
  payload = await json(response);
  csrfToken = payload.csrfToken;
  assert.equal(payload.user.mustChangePassword, false);

  response = await fetch(`${base}/api/private`, { headers: { Cookie: previousCookie } });
  assert.equal(response.status, 401);

  response = await fetch(`${base}/api/private`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).actor, "lucas");

  response = await fetch(`${base}/api/private`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(response.status, 403);
  response = await fetch(`${base}/api/private`, {
    method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }
  });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/api/auth/logout`, {
    method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);

  response = await fetch(`${base}/api/private`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 401);
});

test("mantem CSRF valido em duas abas e revoga a sessao no logout", async (t) => {
  const repository = createMemoryRepository(await argon2.hash("temporaria", { type: argon2.argon2id }));
  repository.user.must_change_password = false;
  const auth = createAuthSystem({ repository, secureCookies: false, sessionDurationMs: 3600000 });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth.router);
  app.use("/api", ...auth.protectBusiness);
  app.post("/api/private", (req, res) => res.json({ ok: true, actor: req.auth.username }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lucas", password: "temporaria" })
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  const tabA = await json(response);

  response = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const tabB = await json(response);
  assert.equal(tabB.csrfToken, tabA.csrfToken);

  for (const csrfToken of [tabA.csrfToken, tabB.csrfToken]) {
    response = await fetch(`${base}/api/private`, {
      method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }
    });
    assert.equal(response.status, 200);
  }

  response = await fetch(`${base}/api/auth/logout`, {
    method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": tabB.csrfToken }
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/api/private`, {
    method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": tabA.csrfToken }
  });
  assert.equal(response.status, 401);
});

test("bloqueia tentativas repetidas e emite Secure quando configurado", async (t) => {
  const repository = createMemoryRepository(await argon2.hash("temporaria", { type: argon2.argon2id }));
  const auth = createAuthSystem({ repository, secureCookies: true, sessionDurationMs: 3600000 });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth.router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const denied = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "lucas", password: "incorreta" })
    });
    assert.equal(denied.status, 401);
  }
  const locked = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lucas", password: "temporaria" })
  });
  assert.equal(locked.status, 401);

  repository.user.locked_until = null;
  repository.user.failed_login_attempts = 0;
  const anotherRepository = createMemoryRepository(repository.user.password_hash);
  const secureAuth = createAuthSystem({ repository: anotherRepository, secureCookies: true });
  const secureApp = express();
  secureApp.use(express.json());
  secureApp.use("/api/auth", secureAuth.router);
  const secureServer = http.createServer(secureApp);
  await new Promise((resolve) => secureServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => secureServer.close(resolve)));
  const accepted = await fetch(`http://127.0.0.1:${secureServer.address().port}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lucas", password: "temporaria" })
  });
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get("set-cookie"), /Secure/);
});
