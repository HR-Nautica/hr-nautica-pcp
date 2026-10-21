# Homologacao interna via HTTP

## Resultado esperado

O ERP de homologacao fica em `http://192.168.100.180:8443`. Caddy serve o
frontend e encaminha `/api` pela mesma origem. Somente o proxy publica porta; a
API permanece em `3001` apenas na rede Docker `edge`.

A aplicacao tambem participa da rede externa privada `homolog_database`. Caddy
nao participa dessa rede, e o Compose recusa `supabase_default`. Homologacao e
producao mantem projetos Compose, portas, cookies, segredos, volumes e bancos
separados.

## Aviso de seguranca

HTTP nao cifra credenciais, cookies ou dados. Um equipamento capaz de observar
ou modificar trafego na LAN pode capturar login/sessao ou adulterar respostas.
`HttpOnly`, `SameSite=Strict`, CSRF, expiracao e bloqueio de tentativas continuam
ativos, mas nao protegem contra interceptacao de rede.

A porta e vinculada somente ao IP privado `192.168.100.180`, nunca a
`0.0.0.0`. O repositorio nao altera firewall ou roteador; o administrador deve
confirmar que `8443/tcp` nao possui NAT ou encaminhamento para a internet.

Cookies `Secure` foram desativados porque navegadores nao os enviam em HTTP.
HSTS tambem foi removido. Se um cliente tiver politica HTTPS antiga em cache,
limpar os dados/politicas do site referentes ao IP antes do primeiro acesso.

## Garantias mantidas

- login individual e senhas Argon2id;
- cookie `HttpOnly; SameSite=Strict`, expiracao e revogacao;
- CSRF em operacoes mutaveis;
- troca obrigatoria de senha e bloqueio de tentativas;
- segredo do proxy somente entre Caddy e API;
- frontend, API, `/healthz` e `/release.json` no mesmo SHA;
- API e PostgreSQL sem portas publicadas por este Compose;
- nenhuma migration automatica.

## Pre-requisitos

- Docker Engine, Compose v2, `curl`, `git` e `flock` no Ubuntu;
- IP `192.168.100.180` configurado e porta `8443` livre;
- PostgreSQL 17 de homologacao previamente preparado no banco
  `hr_nautica_homolog`;
- rede Docker exclusiva desse PostgreSQL, diferente de `supabase_default`;
- credencial exclusiva de homologacao;
- checkout limpo no SHA aprovado.

## Preparacao unica

```bash
sudo install -d -m 750 -o root -g docker /etc/hr-nautica
sudo install -d -m 750 -o root -g docker /var/lib/hr-nautica-homolog
sudo install -m 640 -o root -g docker \
  deploy/homologation.env.example /etc/hr-nautica/homologation.env
sudo editor /etc/hr-nautica/homologation.env
```

Substituir os placeholders de `HOMOLOG_DATABASE_NETWORK`, `DATABASE_URL` e
`PROXY_SHARED_SECRET`. Manter:

```dotenv
ERP_INTERNAL_HOST=192.168.100.180
ERP_HTTPS_BIND_IP=192.168.100.180
ERP_HTTPS_PORT=8443
AUTH_COOKIE_SECURE=false
```

Os nomes `ERP_HTTPS_*` sao legados preservados por compatibilidade; o transporte
atual e HTTP.

Conferir sem alteracao:

```bash
sudo ss -lnt '( sport = :8443 )'
docker network inspect NOME_DA_REDE_EXCLUSIVA_DE_HOMOLOGACAO
ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  docker compose --env-file /etc/hr-nautica/homologation.env \
    -f deploy/compose.homologation.yml config --quiet
```

## Ativacao

O script constroi a imagem, valida o historico do banco somente em leitura,
inicia a pilha e confirma HTTP + banco + SHA:

```bash
SHA="$(git rev-parse HEAD)"
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh activate "$SHA"
```

Para criar o primeiro usuario apenas se ele ainda nao existir:

```bash
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh bootstrap-admin lucas
```

A senha temporaria e lida sem eco e deve ser trocada no primeiro login. O
comando escreve somente nas tabelas de autenticacao da homologacao.

Verificar:

```bash
curl --fail --show-error http://192.168.100.180:8443/healthz
curl --fail --show-error http://192.168.100.180:8443/release.json
```

Depois, abrir `http://192.168.100.180:8443`.

## Rollback e encerramento

```bash
# Estado
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh status

# Restaurar imagem anterior, sem alterar o banco
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh rollback

# Encerrar sem apagar volumes, imagens ou dados
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh stop
```

Os volumes Caddy existentes permanecem declarados e nao sao removidos. O fluxo
nao executa migrations e rollback de aplicacao nao altera schema ou dados.
