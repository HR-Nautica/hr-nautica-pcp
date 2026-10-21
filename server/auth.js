import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { Router } from "express";

import { config } from "./config.js";
import { transaction, withConnection } from "./database.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const USERNAME_PATTERN = /^[a-z0-9._-]{1,64}$/;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;
const ACCOUNT_FAILURE_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* cookie invÃ¡lido */ }
  }
  return cookies;
}

function cookieHeader(name, value, { secure, maxAge = 0 } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (secure) parts.push("Secure");
  if (maxAge > 0) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  else parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

function constantTimeHashMatch(value, expectedHash) {
  if (!value || !expectedHash) return false;
  const actual = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createPostgresAuthRepository() {
  return {
    async findUser(username) {
      return withConnection(async (client) => {
        const result = await client.query(
          `SELECT id, username, password_hash, role, must_change_password, active,
                  failed_login_attempts, locked_until
             FROM public.auth_users WHERE username = $1`,
          [username]
        );
        return result.rows[0] || null;
      });
    },

    async recordFailedLogin(userId, now) {
      return transaction(async (client) => {
        const result = await client.query(
          `UPDATE public.auth_users
              SET failed_login_attempts = failed_login_attempts + 1,
                  locked_until = CASE
                    WHEN failed_login_attempts + 1 >= $2 THEN $3
                    ELSE locked_until
                  END,
                  updated_at = $1
            WHERE id = $4
        RETURNING failed_login_attempts, locked_until`,
          [now, ACCOUNT_FAILURE_LIMIT, new Date(now.getTime() + ACCOUNT_LOCK_MS), userId]
        );
        return result.rows[0] || null;
      });
    },

    async createSession({ userId, tokenHash, csrfTokenHash, expiresAt, now }) {
      return transaction(async (client) => {
        await client.query(
          `UPDATE public.auth_users
              SET failed_login_attempts = 0, locked_until = NULL, updated_at = $1
            WHERE id = $2`,
          [now, userId]
        );
        await client.query(
          `INSERT INTO public.auth_sessions
             (token_hash, user_id, csrf_token_hash, expires_at, created_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [tokenHash, userId, csrfTokenHash, expiresAt, now]
        );
      });
    },

    async findSession(tokenHash, now) {
      return withConnection(async (client) => {
        const result = await client.query(
          `SELECT s.token_hash, s.csrf_token_hash, s.expires_at,
                  u.id AS user_id, u.username, u.role, u.must_change_password, u.active
             FROM public.auth_sessions s
             JOIN public.auth_users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
          [tokenHash, now]
        );
        return result.rows[0] || null;
      });
    },

    async changePasswordAndRotateSession({ userId, expectedPasswordHash, passwordHash, session, now }) {
      return transaction(async (client) => {
        const locked = await client.query(
          `SELECT password_hash FROM public.auth_users WHERE id = $1 AND active = true FOR UPDATE`,
          [userId]
        );
        if (!locked.rows.length || locked.rows[0].password_hash !== expectedPasswordHash) return false;
        await client.query(
          `UPDATE public.auth_users
              SET password_hash = $1, must_change_password = false,
                  password_changed_at = $2, updated_at = $2,
                  failed_login_attempts = 0, locked_until = NULL
            WHERE id = $3`,
          [passwordHash, now, userId]
        );
        await client.query(
          `UPDATE public.auth_sessions SET revoked_at = $1
            WHERE user_id = $2 AND revoked_at IS NULL`,
          [now, userId]
        );
        await client.query(
          `INSERT INTO public.auth_sessions
             (token_hash, user_id, csrf_token_hash, expires_at, created_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [session.tokenHash, userId, session.csrfTokenHash, session.expiresAt, now]
        );
        return true;
      });
    },

    async revokeSession(tokenHash, now) {
      return withConnection((client) => client.query(
        `UPDATE public.auth_sessions SET revoked_at = $1
          WHERE token_hash = $2 AND revoked_at IS NULL`,
        [now, tokenHash]
      ));
    }
  };
}

export function createAuthSystem({
  repository = createPostgresAuthRepository(),
  secureCookies = config.auth.secureCookies,
  sessionDurationMs = config.auth.sessionDurationMs,
  clock = () => new Date(),
  randomToken = () => randomBytes(32).toString("base64url"),
  passwordHasher = {
    hash: (password) => argon2.hash(password, { type: argon2.argon2id }),
    verify: (hash, password) => argon2.verify(hash, password)
  }
} = {}) {
  const attempts = new Map();
  const dummyHash = passwordHasher.hash(randomToken());
  const cookieName = config.auth.cookieName;

  function publicUser(user) {
    return {
      id: String(user.user_id || user.id),
      username: user.username,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password)
    };
  }

  function issueTokens(now) {
    const token = randomToken();
    const csrfToken = sha256(`csrf:${token}`);
    return {
      token,
      csrfToken,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      expiresAt: new Date(now.getTime() + sessionDurationMs)
    };
  }

  function setSessionCookie(res, token) {
    res.setHeader("Set-Cookie", cookieHeader(cookieName, token, {
      secure: secureCookies,
      maxAge: sessionDurationMs
    }));
  }

  function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", cookieHeader(cookieName, "", { secure: secureCookies }));
  }

  function reject(res, status, code, message) {
    return res.status(status).json({ ok: false, code, error: message });
  }

  function rateKey(req, username) {
    return `${req.socket?.remoteAddress || "unknown"}:${username}`;
  }

  function isRateLimited(req, username, now) {
    const key = rateKey(req, username);
    const recent = (attempts.get(key) || []).filter((time) => now.getTime() - time < LOGIN_WINDOW_MS);
    attempts.set(key, recent);
    return recent.length >= LOGIN_LIMIT;
  }

  function recordAttempt(req, username, now) {
    const key = rateKey(req, username);
    const recent = (attempts.get(key) || []).filter((time) => now.getTime() - time < LOGIN_WINDOW_MS);
    recent.push(now.getTime());
    attempts.set(key, recent);
  }

  function clearAttempts(req, username) {
    attempts.delete(rateKey(req, username));
  }

  async function authenticate(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[cookieName];
      if (!token) return reject(res, 401, "AUTH_REQUIRED", "AutenticaÃ§Ã£o obrigatÃ³ria.");
      const tokenHash = sha256(token);
      const session = await repository.findSession(tokenHash, clock());
      if (!session || !session.active) {
        clearSessionCookie(res);
        return reject(res, 401, "SESSION_INVALID", "SessÃ£o invÃ¡lida ou expirada.");
      }
      req.auth = publicUser(session);
      req.authSession = { token, tokenHash, csrfTokenHash: session.csrf_token_hash };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!constantTimeHashMatch(req.get("x-csrf-token"), req.authSession?.csrfTokenHash)) {
      return reject(res, 403, "CSRF_INVALID", "Token CSRF invÃ¡lido.");
    }
    return next();
  }

  function requirePasswordChanged(req, res, next) {
    if (req.auth?.mustChangePassword) {
      return reject(res, 403, "PASSWORD_CHANGE_REQUIRED", "Altere a senha temporÃ¡ria antes de continuar.");
    }
    return next();
  }

  const router = Router();

  router.post("/login", async (req, res, next) => {
    const now = clock();
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!USERNAME_PATTERN.test(username) || !password || isRateLimited(req, username, now)) {
      return reject(res, 401, "INVALID_CREDENTIALS", "UsuÃ¡rio ou senha invÃ¡lidos.");
    }
    try {
      const user = await repository.findUser(username);
      const hash = user?.password_hash || await dummyHash;
      const valid = await passwordHasher.verify(hash, password).catch(() => false);
      const locked = user?.locked_until && new Date(user.locked_until) > now;
      if (!user || !user.active || locked || !valid) {
        recordAttempt(req, username, now);
        if (user && !locked) await repository.recordFailedLogin(user.id, now);
        return reject(res, 401, "INVALID_CREDENTIALS", "UsuÃ¡rio ou senha invÃ¡lidos.");
      }
      const session = issueTokens(now);
      await repository.createSession({ userId: user.id, ...session, now });
      clearAttempts(req, username);
      setSessionCookie(res, session.token);
      return res.json({ ok: true, user: publicUser(user), csrfToken: session.csrfToken });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/session", authenticate, async (req, res, next) => {
    try {
      const csrfToken = sha256(`csrf:${req.authSession.token}`);
      return res.json({ ok: true, user: req.auth, csrfToken });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/change-password", authenticate, requireCsrf, async (req, res, next) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (newPassword.length < 10 || newPassword === currentPassword) {
      return reject(res, 400, "PASSWORD_WEAK", "A nova senha deve ter ao menos 10 caracteres e ser diferente da atual.");
    }
    try {
      const currentUser = await repository.findUser(req.auth.username);
      const valid = currentUser && await passwordHasher.verify(currentUser.password_hash, currentPassword).catch(() => false);
      if (!valid) return reject(res, 401, "INVALID_CREDENTIALS", "Senha atual invÃ¡lida.");
      const now = clock();
      const session = issueTokens(now);
      const passwordHash = await passwordHasher.hash(newPassword);
      const changed = await repository.changePasswordAndRotateSession({
        userId: currentUser.id,
        expectedPasswordHash: currentUser.password_hash,
        passwordHash,
        session,
        now
      });
      if (!changed) return reject(res, 409, "PASSWORD_CHANGED", "A senha foi alterada em outra sessÃ£o. Entre novamente.");
      setSessionCookie(res, session.token);
      return res.json({
        ok: true,
        user: { ...req.auth, mustChangePassword: false },
        csrfToken: session.csrfToken
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout", authenticate, requireCsrf, async (req, res, next) => {
    try {
      await repository.revokeSession(req.authSession.tokenHash, clock());
      clearSessionCookie(res);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return {
    router,
    authenticate,
    requireCsrf,
    requirePasswordChanged,
    protectBusiness: [authenticate, requirePasswordChanged, requireCsrf]
  };
}

export const authSystem = createAuthSystem();
