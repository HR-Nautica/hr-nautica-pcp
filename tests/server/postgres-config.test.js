import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostgresConnectionOptions,
  sanitizeDatabaseError,
  validatePostgresUrl,
  validateSslMode
} from "../../server/postgres-config.js";

test("DATABASE_SSL_MODE=disable desativa TLS, não apenas a validação do certificado", () => {
  const disabled = buildPostgresConnectionOptions("postgresql://user:pass@db:5432/app", {
    sslMode: "disable", sslRejectUnauthorized: true
  });
  assert.equal(disabled.ssl, false);
  const relaxedCertificate = buildPostgresConnectionOptions("postgresql://user:pass@db:5432/app", {
    sslMode: "require", sslRejectUnauthorized: false
  });
  assert.deepEqual(relaxedCertificate.ssl, { rejectUnauthorized: false });
});

test("rejeita URL e modo SSL inválidos sem reproduzir credenciais", () => {
  assert.throws(() => validatePostgresUrl("arquivo-local.json"), { code: "DATABASE_CONFIG_INVALID" });
  assert.throws(() => validateSslMode("talvez"), { code: "DATABASE_SSL_MODE_INVALID" });
  const safe = sanitizeDatabaseError(new Error("postgresql://admin:segredo@prod/app password=segredo"));
  assert.equal(safe.includes("segredo"), false);
  assert.equal(safe.includes("admin"), false);
});
