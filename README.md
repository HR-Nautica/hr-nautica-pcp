# HR Nautica PCP

Aplicacao local multiusuario:

- frontend Vite Vanilla JS;
- API Node.js + Express rodando em cada PC;
- Microsoft Access `.accdb` compartilhado como fonte persistente;
- cada usuario abre em `http://localhost:3001` no proprio computador;
- funcionamento sem internet, exceto instalacao inicial de dependencias.

## Requisitos de cada PC

- Node.js 20 ou superior;
- Microsoft Access Database Engine 2016, 32 ou 64 bits compatível com o Node instalado;
- acesso de leitura/escrita ao arquivo `.accdb` compartilhado;
- permissao para executar `Iniciar PCP.bat`.

O navegador nao grava diretamente no Access. Cada PC roda uma API local Node.js,
e essa API grava no mesmo arquivo `.accdb` via ODBC.

## Configuracao do banco

Copie `.env.exemplo` para `.env` e configure o caminho do banco:

```env
ACCESS_DB_PATH=\\192.168.100.250\DADOS\NAUTICA\04_PCP\automação\database\pcp.accdb
HOST=127.0.0.1
PORT=3001
```

Use caminho UNC sempre que possivel. Unidade mapeada como `Z:` pode falhar se o
servico/processo for aberto por outro usuario.

## Instalacao

Com o sistema antigo parado, rode uma vez:

```powershell
npm install
npm run db:init
npm run db:migrate -- .\dados_pcp.json
npm run build
npm start
```

`db:init` cria o `.accdb` quando o Microsoft ACE/OLEDB estiver instalado e cria
as tabelas via ODBC. Se a criacao automatica do arquivo falhar, crie um banco
Access vazio em `database\pcp.accdb` e rode `npm run db:init` novamente.

Depois da migracao, o `dados_pcp.json` nao e consultado automaticamente.

## Uso nos PCs

1. Abra `Iniciar PCP.bat`.
2. Acesse `http://localhost:3001`.
3. Informe seu nome no primeiro acesso. Esse nome fica salvo no navegador e entra no `audit_log` das alteracoes.

Cada PC deve apontar para o mesmo `ACCESS_DB_PATH` no `.env`.

## Desenvolvimento

```powershell
npm run dev
```

- Vite: `http://localhost:5173`
- API: `http://localhost:3001`

## Protecao de dados

- cada chave de dados possui versao no Access;
- gravacoes concorrentes com versao antiga sao rejeitadas;
- cada alteracao e registrada em `audit_log` com usuario (`actor`);
- erros de banco executam rollback quando suportado pelo driver ODBC;
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
- `server`: API e conexao Access/ODBC;
- `database/schema.sql`: referencia do schema Access;
- `scripts`: inicializacao, migracao e assets offline;
- `dist`: build de producao.
