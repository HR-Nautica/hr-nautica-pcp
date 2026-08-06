# HR Nautica PCP

Aplicacao local multiusuario:

- frontend Vite Vanilla JS;
- API Node.js + Express;
- Supabase/PostgreSQL como fonte persistente;
- deploy no Vercel ou execucao local em `http://localhost:3001`;
- sincronizacao centralizada pela API.

## Requisitos

- Node.js 20 ou superior para desenvolvimento local;
- projeto Supabase com as tabelas de `database/schema-postgres.sql`;
- variaveis de ambiente configuradas no Vercel ou no `.env` local.

O navegador nao grava diretamente no banco. Ele conversa com a API Node.js, e a API persiste os dados no Supabase.

## Configuracao do banco

No Vercel, configure pelo menos:

```env
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]
VITE_SUPABASE_ANON_KEY=[ANON_PUBLIC_KEY]
```

Localmente, voce tambem pode usar `DATABASE_URL` para conexao PostgreSQL direta/pooler. Quando `DATABASE_URL` existe, ela tem prioridade; quando nao existe, a API usa `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` via REST.

## Instalacao

Para rodar localmente, rode uma vez:

```powershell
npm install
npm run db:init
npm run db:migrate -- .\dados_pcp.json
npm run build
npm start
```

`db:init` cria/garante as tabelas do Supabase quando `DATABASE_URL` estiver configurada. No Vercel, a API tambem funciona com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` depois que as tabelas existem.

A importacao do Excel na Analise de Producao usa `temp_analise_producao` como tabela de estagio. Cada sincronizacao grava um novo lote completo e remove o lote anterior somente depois da nova gravacao, evitando dados parciais durante a substituicao.

Depois da migracao, o `dados_pcp.json` nao e consultado automaticamente.

## Uso nos PCs

1. Abra `Iniciar PCP.bat`.
2. Acesse `http://localhost:3001`.
3. Informe seu nome no primeiro acesso. Esse nome fica salvo no navegador e entra no `audit_log` das alteracoes.

Todos os ambientes devem apontar para o mesmo projeto Supabase.

## Desenvolvimento

```powershell
npm run dev
```

- Vite: `http://localhost:5173`
- API: `http://localhost:3001`

## Protecao de dados

- cada chave de dados possui versao no Supabase;
- gravacoes concorrentes com versao antiga sao rejeitadas;
- cada alteracao e registrada em `audit_log` com usuario (`actor`);
- erros de banco executam rollback quando suportado pela conexao PostgreSQL;
- se o banco estiver indisponivel, o navegador bloqueia novas gravacoes;
- alteracoes de outros usuarios sao detectadas a cada tres segundos.

## Backup

Faca backup diario do arquivo:

```powershell
Copy-Item "\\192.168.100.250\DADOS\NAUTICA\04_PCP\automação\database\pcp.accdb" "D:\Backups\pcp-$(Get-Date -Format yyyyMMdd-HHmm).accdb"
```

O backup deve ocorrer em horario sem usuarios gravando no sistema.

## Estrutura

- `index.html`: shell visual preservado;
- `public/js`: modulos funcionais existentes e armazenamento remoto;
- `public/css`: layout existente;
- `server`: API e conexao Supabase/PostgreSQL;
- `database/schema.sql`: referencia do schema Supabase;
- `scripts`: inicializacao, migracao e assets offline;
- `dist`: build de producao.



