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
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[SENHA]@[POOLER]:6543/postgres?sslmode=require
```

`DATABASE_URL` e obrigatoria para criar, editar ou cancelar ordens que movimentam estoque de pecas brutas, pois essas operacoes usam uma transacao PostgreSQL e bloqueio das linhas envolvidas. Para as demais rotas, quando `DATABASE_URL` nao existe, a API ainda pode usar `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` via REST.

### Modo PostgreSQL estrito para a API

O modo destinado ao container da API é ativado explicitamente:

```text
DATABASE_STRICT_MODE=true
DATABASE_URL=postgresql://usuario:senha@postgres:5432/hr_nautica
DATABASE_SSL_MODE=disable
HOST=0.0.0.0
PORT=3001
```

Nesse modo, somente `DATABASE_URL` é aceita. A API não usa Supabase REST,
arquivo JSON ou variáveis `POSTGRES_*` como fallback. Antes de abrir a porta, ela
confirma PostgreSQL 17, `schema_migrations`, V001 aplicada, checksums e ausência
de migrations pendentes. A validação é somente leitura e nunca executa DDL,
limpeza de auditoria ou migrations.

`DATABASE_SSL_MODE=disable` desativa TLS e deve ser usado somente em rede privada.
Para TLS, use `require`, `verify-ca` ou `verify-full`; a validação do certificado
continua sendo controlada separadamente por
`DATABASE_SSL_REJECT_UNAUTHORIZED`.

Com `DATABASE_STRICT_MODE=false`, os fallbacks e a inicialização legada são
preservados.

## Instalacao

Para rodar localmente, rode uma vez:

```powershell
npm install
npm run db:init
npm run db:migrate -- .\dados_pcp.json
npm run build
npm start
```

`db:init` cria/garante as tabelas do Supabase quando `DATABASE_URL` estiver configurada.

A importacao do Excel na Analise de Producao usa `temp_analise_producao` como tabela de estagio. Cada sincronizacao grava um novo lote completo e remove o lote anterior somente depois da nova gravacao, evitando dados parciais durante a substituicao.

## Estoque de pecas brutas

- os cadastros e saldos oficiais dos brutos ficam em `app_state`, na chave `hrn_materiais`, identificados por `rawCode` e categoria `Peca Bruta`;
- o relacionamento entre a helice e o bruto continua vindo de `hrn_modelos[].codigoBruto`;
- a coluna `estoque_fisico` importada em `temp_analise_producao` representa somente o estoque informativo de helices acabadas do Tiny e nunca altera o saldo dos brutos;
- o saldo bruto e alterado manualmente na Programacao de Fundicao ou automaticamente ao confirmar, editar e cancelar uma OP;
- cada alteracao gera um registro em `app_state.hrn_movimentos`, incluindo bruto, quantidade, OP, data/hora e usuario disponivel;
- saldo insuficiente rejeita a OP inteira e nenhuma baixa parcial e mantida.

Para cadastrar todos os codigos brutos existentes e zerar seus saldos de forma intencional:

```powershell
npm run raw-stock:init
```

O comando exige internamente a opcao de confirmacao `--reset`, ja definida no script NPM. Para validar baixa unica, alteracao por diferenca, bloqueio de saldo negativo e estorno, use `npm run raw-stock:test`; o teste restaura o saldo utilizado ao final.

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
- a limpeza de `audit_log` pode ser ativada com `AUDIT_CLEANUP_ENABLED=true`; a retencao padrao e 30 dias e pode ser ajustada com `AUDIT_RETENTION_DAYS`;
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



