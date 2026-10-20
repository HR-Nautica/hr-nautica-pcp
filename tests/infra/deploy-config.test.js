import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const files = {
  production: "deploy/compose.production.yml",
  homologation: "deploy/compose.homologation.yml",
  caddy: "deploy/Caddyfile",
  homologationCaddy: "deploy/Caddyfile.homologation",
  homologationEnv: "deploy/homologation.env.example",
  homologationDeploy: "scripts/deploy/homologation.sh",
  workflow: ".github/workflows/deploy-internal.yml",
  deploy: "scripts/deploy/deploy-production.sh",
  dockerfile: "Dockerfile"
};

async function read(name) {
  return fs.readFile(files[name], "utf8");
}

function serviceBlock(compose, service, nextService) {
  const end = nextService ? `(?=^  ${nextService}:)` : "(?=^networks:)";
  return compose.match(new RegExp(`^  ${service}:[\\s\\S]*?${end}`, "m"))?.[0] || "";
}

test("API nao publica porta e producao usa somente a rede externa esperada", async () => {
  const production = await read("production");
  const app = serviceBlock(production, "app", "proxy");
  assert.match(app, /expose:\s*\n\s*- "3001"/);
  assert.doesNotMatch(app, /\n\s+ports:/);
  assert.match(production, /external: true\s*\n\s+name: supabase_default/);
});

test("homologacao publica somente o proxy e preserva a rede exclusiva do banco", async () => {
  const homologation = await read("homologation");
  const app = serviceBlock(homologation, "app", "proxy");
  const proxy = serviceBlock(homologation, "proxy");
  const edge = homologation.match(/networks:\s*\n  edge:\s*\n([\s\S]*?)(?=  homolog_database:)/)?.[1] || "";
  assert.match(homologation, /HOMOLOG_DATABASE_NETWORK:\?/);
  assert.doesNotMatch(homologation, /supabase_default/);
  assert.match(homologation, /AUTH_COOKIE_NAME: hrn_homolog_session/);
  assert.match(app, /expose:\s*\n\s*- "3001"/);
  assert.doesNotMatch(app, /\n\s+ports:/);
  assert.match(app, /- edge[\s\S]*- homolog_database/);
  assert.match(proxy, /ports:\s*\n\s*- "\$\{ERP_HTTPS_BIND_IP:-192\.168\.100\.180\}:\$\{ERP_HTTPS_PORT:-8443\}:443"/);
  assert.match(proxy, /networks:\s*\n\s*- edge/);
  assert.doesNotMatch(proxy, /homolog_database/);
  assert.match(edge, /driver: bridge/);
  assert.match(edge, /internal: false/);
  assert.doesNotMatch(edge, /internal: true/);
  assert.match(homologation, /Caddyfile\.homologation/);
});

test("proxy termina TLS e substitui a credencial enviada para a API", async () => {
  const caddy = await read("caddy");
  assert.match(caddy, /tls \/certs\/tls\.crt \/certs\/tls\.key/);
  assert.match(caddy, /header_up X-HRN-Proxy-Secret \{\$PROXY_SHARED_SECRET\}/);
  assert.match(caddy, /reverse_proxy app:3001/);
});

test("homologacao emite TLS interno para o IP e mantem o segredo fora do frontend", async () => {
  const caddy = await read("homologationCaddy");
  assert.match(caddy, /https:\/\/\{\$ERP_INTERNAL_HOST:192\.168\.100\.180\}/);
  assert.match(caddy, /tls internal/);
  assert.match(caddy, /header_up X-HRN-Proxy-Secret \{\$PROXY_SHARED_SECRET\}/);
  assert.match(caddy, /reverse_proxy app:3001/);

  const frontend = await fs.readFile("public/js/bootstrap.js", "utf8");
  assert.doesNotMatch(frontend, /PROXY_SHARED_SECRET|X-HRN-Proxy-Secret/i);
});

test("ativacao de homologacao fixa IP, banco, rede e verifica TLS e SHA", async () => {
  const script = await read("homologationDeploy");
  const env = await read("homologationEnv");
  assert.match(env, /ERP_INTERNAL_HOST=192\.168\.100\.180/);
  assert.match(env, /DATABASE_URL=.*\/hr_nautica_homolog/);
  assert.match(script, /database_target.*hr_nautica_homolog/s);
  assert.match(script, /network.*supabase_default/s);
  assert.match(script, /--cacert "\$CA_FILE"/);
  assert.match(script, /release\.json/);
  assert.match(script, /db:migrate:validate/);
  assert.doesNotMatch(script, /db:migrate(?:\s|"|')/);
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

test("imagem de runtime mantem codigo legivel pelo usuario node", async () => {
  const dockerfile = await read("dockerfile");
  for (const source of ["server", "scripts/db", "scripts/auth", "database/migrations"]) {
    assert.match(
      dockerfile,
      new RegExp(`COPY --chown=node:node --chmod=0755 ${source.replace("/", "\\/")}`)
    );
  }
  assert.match(dockerfile, /COPY --chown=node:node --chmod=0644 package\*\.json/);
  assert.match(dockerfile, /COPY --from=build --chown=node:node --chmod=0755 \/app\/dist/);
  assert.match(dockerfile, /\nUSER node\n/);
});
