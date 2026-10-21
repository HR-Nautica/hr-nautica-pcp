import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function readConfigWith({ environment, localFile }) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "hrn-config-test-"));
  try {
    await writeFile(path.join(cwd, ".env.local"), localFile, "utf8");
    const configUrl = pathToFileURL(path.resolve("server", "config.js")).href;
    const script = `import { config } from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(config));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...environment }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("ambiente Docker prevalece sobre .env.local no modo estrito", async () => {
  const config = await readConfigWith({
    environment: {
      DATABASE_STRICT_MODE: "true",
      DATABASE_URL: "postgresql://docker:docker@postgres:5432/hrn",
      DATABASE_SSL_MODE: "disable",
      HOST: "0.0.0.0",
      PORT: "3001"
    },
    localFile: [
      "DATABASE_STRICT_MODE=false",
      "DATABASE_URL=postgresql://local:local@localhost:5432/errado",
      "DATABASE_SSL_MODE=require",
      "HOST=127.0.0.1",
      "PORT=9999"
    ].join("\n")
  });
  assert.equal(config.database.databaseUrl, "postgresql://docker:docker@postgres:5432/hrn");
  assert.equal(config.database.sslMode, "disable");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3001);
});

test("comportamento legado mantém override de .env.local e fallback PostgreSQL", async () => {
  const config = await readConfigWith({
    environment: {
      DATABASE_STRICT_MODE: "false",
      DATABASE_URL: "",
      POSTGRES_URL: "postgresql://fallback:fallback@legacy:5432/app",
      HOST: "0.0.0.0",
      PORT: "3001"
    },
    localFile: [
      "POSTGRES_URL=postgresql://local:local@localhost:5432/legacy",
      "HOST=127.0.0.1",
      "PORT=4000"
    ].join("\n")
  });
  assert.equal(config.database.strictMode, false);
  assert.equal(config.database.connectionString, "postgresql://local:local@localhost:5432/legacy");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4000);
});

test("processo da API recusa startup estrito sem DATABASE_URL mesmo com fallbacks", () => {
  const environment = {
    ...process.env,
    DATABASE_STRICT_MODE: "true",
    POSTGRES_URL: "postgresql://fallback:segredo@fallback:5432/app",
    SUPABASE_URL: "https://fallback.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "segredo-fallback"
  };
  delete environment.DATABASE_URL;
  const result = spawnSync(process.execPath, [path.resolve("server", "index.js")], {
    encoding: "utf8", env: environment, timeout: 10000
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /DATABASE_URL é obrigatória/);
  assert.equal(output.includes("segredo"), false);
  assert.equal(output.includes("fallback:5432"), false);
});

test("log de falha de conexão no startup não expõe DATABASE_URL", () => {
  const secret = "nao-expor-123";
  const result = spawnSync(process.execPath, [path.resolve("server", "index.js")], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      DATABASE_STRICT_MODE: "true",
      DATABASE_URL: `postgresql://usuario:${secret}@127.0.0.1:1/inexistente`,
      DATABASE_SSL_MODE: "disable"
    }
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /Não foi possível validar o PostgreSQL configurado/);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("postgresql://"), false);
});
