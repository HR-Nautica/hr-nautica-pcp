import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const files = {
  production: "deploy/compose.production.yml",
  homologation: "deploy/compose.homologation.yml",
  caddy: "deploy/Caddyfile",
  workflow: ".github/workflows/deploy-internal.yml",
  deploy: "scripts/deploy/deploy-production.sh",
  dockerfile: "Dockerfile"
};

async function read(name) {
  return fs.readFile(files[name], "utf8");
}

function serviceBlock(compose, service, nextService) {
  const end = nextService ? `(?=  ${nextService}:)` : "(?=networks:)";
  return compose.match(new RegExp(`  ${service}:[\\s\\S]*?${end}`))?.[0] || "";
}

test("API nao publica porta e producao usa somente a rede externa esperada", async () => {
  const production = await read("production");
  const app = serviceBlock(production, "app", "proxy");
  assert.match(app, /expose:\s*\n\s*- "3001"/);
  assert.doesNotMatch(app, /\n\s+ports:/);
  assert.match(production, /external: true\s*\n\s+name: supabase_default/);
});

test("homologacao exige rede isolada e nao referencia supabase_default", async () => {
  const homologation = await read("homologation");
  assert.match(homologation, /HOMOLOG_DATABASE_NETWORK:\?/);
  assert.doesNotMatch(homologation, /supabase_default/);
  assert.match(homologation, /AUTH_COOKIE_NAME: hrn_homolog_session/);
});

test("proxy termina TLS e substitui a credencial enviada para a API", async () => {
  const caddy = await read("caddy");
  assert.match(caddy, /tls \/certs\/tls\.crt \/certs\/tls\.key/);
  assert.match(caddy, /header_up X-HRN-Proxy-Secret \{\$PROXY_SHARED_SECRET\}/);
  assert.match(caddy, /reverse_proxy app:3001/);
});

test("workflow faz deploy por SHA em runner interno somente apos testes", async () => {
  const workflow = await read("workflow");
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /needs: test/);
  assert.match(workflow, /self-hosted, linux, x64, hr-nautica-production/);
  assert.match(workflow, /APP_COMMIT_SHA="\$RELEASE_SHA"/);
  assert.match(workflow, /deploy-production\.sh "\$RELEASE_SHA"/);
});

test("startup e deploy nao executam migrations", async () => {
  const combined = [await read("dockerfile"), await read("deploy"), await read("workflow")].join("\n");
  assert.doesNotMatch(combined, /db:migrate|migrations-cli|npm run db:/i);
});
