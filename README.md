# HR Nautica PCP

ERP multiusuario com frontend Vite, API Node.js/Express, autenticacao por sessao
e PostgreSQL 17. A publicacao oficial e interna: HTTPS no Ubuntu, sem Vercel,
Cloudflare ou portas abertas no roteador.

## Desenvolvimento

Requer Node.js 20 ou superior.

```powershell
npm install
npm run dev
```

- Vite: `http://localhost:5173`
- API: `http://localhost:3001`

O proxy do Vite injeta `PROXY_SHARED_SECRET`. Em HTTP local, configure
`AUTH_COOKIE_SECURE=false` somente no `.env.local`. O navegador nunca recebe
credenciais do PostgreSQL ou do proxy.

## Validacao

```powershell
npm run test:ci
npm run build
```

Testes PostgreSQL 17 reais continuam separados e usam exclusivamente containers
descartaveis:

```powershell
npm run db:migrate:test:integration
npm run db:baseline:test:integration
npm run api:strict:test:integration
```

## Banco e migrations

Producao usa `DATABASE_STRICT_MODE=true`: exige `DATABASE_URL`, PostgreSQL 17,
historico valido, checksums integros e nenhuma migration pendente. O startup faz
apenas validacoes e nunca executa DDL ou migrations.

Comandos administrativos:

```powershell
npm run db:migrate:status
npm run db:migrate:validate
npm run db:migrate:dry-run
npm run db:migrate
```

`db:migrate` exige processo autorizado e `MIGRATION_OPERATOR`. Consulte
[database/migrations/README.md](database/migrations/README.md) para baseline,
locks, falhas e recuperacao.

## Deploy interno

- imagem unica e imutavel por commit SHA para frontend e API;
- Caddy com certificado da CA corporativa;
- Compose proprio, sem modificar Supabase ou Sistema JM;
- producao conectada privadamente a `supabase_default`;
- homologacao em Compose, rede, porta, cookie e credenciais separados;
- GitHub Actions via runner self-hosted com conexao iniciada pelo Ubuntu;
- health check de banco e igualdade de SHA, com rollback automatico;
- nenhuma migration automatica.

O procedimento completo de ativacao, configuracao indispensavel e criterios de
habilitacao da `main` estao em
[docs/deploy-interno.md](docs/deploy-interno.md).

Arquivos de entrada:

- `deploy/compose.production.yml` e `deploy/production.env.example`;
- `deploy/compose.homologation.yml` e `deploy/homologation.env.example`;
- `.github/workflows/deploy-internal.yml`;
- `scripts/deploy/deploy-production.sh`.

Segredos, certificados, chaves, `.env` reais e estado do deploy nao pertencem ao
Git. O arquivo `.env.exemplo` documenta apenas os nomes usados em desenvolvimento
e compatibilidade legada.
