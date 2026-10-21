# Producao interna do ERP via HTTP

## Arquitetura

```text
Antigravity -> pull request revisado -> GitHub main
  -> testes no runner GitHub
  -> deploy no runner Ubuntu hr-nautica-production
  -> imagem hr-nautica-pcp:<SHA completo>
  -> Caddy http://192.168.100.180:8444
  -> Express (frontend + API do mesmo SHA)
  -> supabase-db:5433/postgres pela rede supabase_default
```

Somente o Caddy publica `192.168.100.180:8444 -> 80/tcp`. A API possui apenas
`expose: 3001`; nao existe publicacao direta na LAN. O Caddy participa somente
da rede `edge`, enquanto a aplicacao participa de `edge` e da rede externa
`supabase_default`. PostgreSQL, Supabase, n8n e Sistema JM nao sao publicados ou
alterados por este Compose.

Homologacao permanece isolada em `http://192.168.100.180:8443`, com Compose,
cookie, segredo, banco e volumes proprios.

## Limite de seguranca do HTTP

HTTP nao oferece confidencialidade nem integridade do trafego. Credenciais de
login, cookies de sessao, tokens CSRF e dados do ERP podem ser observados ou
alterados por alguem com acesso ao caminho de rede. `HttpOnly` impede leitura do
cookie por JavaScript, `SameSite=Strict` reduz envio entre sites e CSRF protege
operacoes contra requisicoes forjadas, mas nenhum desses controles substitui
TLS contra interceptacao na LAN.

Este modo deve ficar restrito a rede interna autorizada da Kalled. O Compose
vincula a porta somente ao IP privado `192.168.100.180`, nunca a `0.0.0.0`.
Nenhuma regra de firewall ou roteador e alterada pelo repositorio; confirmar a
ausencia de NAT/encaminhamento externo continua sendo responsabilidade do
administrador de rede.

Cookies usam `HttpOnly; SameSite=Strict`, expiracao e revogacao, mas nao usam
`Secure`, pois navegadores nao enviam cookies `Secure` em HTTP. HSTS foi
desativado por ser incompatível com operacao exclusivamente HTTP. Caso algum
cliente tenha politica HTTPS/HSTS antiga em cache, limpar os dados/politicas do
site para o IP antes do primeiro acesso HTTP.

## Identidade da release e autenticacao

A imagem recebe a tag imutavel `hr-nautica-pcp:<SHA completo>`. O mesmo SHA e
gravado no frontend, em `/release.json`, no header da API e em `/healthz`. O
script recusa imagem cujo label OCI de revisao nao corresponda ao SHA pedido e
so conclui depois que os dois endpoints confirmam esse SHA.

O segredo `PROXY_SHARED_SECRET` permanece somente entre Caddy e API. Caddy
sobrescreve o header antes de encaminhar a requisicao; o frontend nunca recebe
o segredo. Login individual, hash Argon2id, sessoes no PostgreSQL, expiracao,
CSRF, troca obrigatoria de senha, logout e bloqueio de tentativas permanecem
inalterados.

## Preparacao unica do Ubuntu

Estes comandos sao para execucao futura pelo administrador; o repositorio nao
os executa remotamente.

1. Confirmar Docker, rede do banco e porta privada livre:

   ```bash
   docker version
   docker compose version
   docker network inspect supabase_default >/dev/null
   sudo ss -lnt '( sport = :8444 )'
   ```

2. Criar os arquivos locais. O runner deve pertencer ao grupo `docker`:

   ```bash
   sudo install -d -m 750 -o root -g docker /etc/hr-nautica
   sudo install -d -m 770 -o root -g docker /var/lib/hr-nautica-deploy
   sudo install -m 640 -o root -g docker \
     deploy/production.env.example /etc/hr-nautica/production.env
   sudo editor /etc/hr-nautica/production.env
   ```

3. Substituir somente `SENHA_FORA_DO_GIT` e `PROXY_SHARED_SECRET`. Gerar o
   segredo com `openssl rand -base64 48`. Manter:

   ```dotenv
   ERP_INTERNAL_HOST=192.168.100.180
   ERP_HTTPS_BIND_IP=192.168.100.180
   ERP_HTTPS_PORT=8444
   DATABASE_URL=postgresql://hr_nautica_app:SENHA_FORA_DO_GIT@supabase-db:5433/postgres
   AUTH_COOKIE_SECURE=false
   ```

   Os nomes `ERP_HTTPS_*` foram mantidos por compatibilidade com os arquivos de
   ambiente existentes; apesar do nome legado, o transporte atual e HTTP.

4. Validar sem iniciar servicos:

   ```bash
   ERP_ENV_FILE=/etc/hr-nautica/production.env \
     docker compose --env-file /etc/hr-nautica/production.env \
       -f deploy/compose.production.yml config --quiet

   docker run --rm \
     -e ERP_INTERNAL_HOST=192.168.100.180 \
     -e PROXY_SHARED_SECRET=validacao-local-sem-uso-operacional-123456 \
     -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
     caddy:2.11.7-alpine \
     caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

5. Instalar o runner self-hosted dedicado com os labels
   `self-hosted`, `linux`, `x64`, `hr-nautica-production`. Ele precisa ler o
   arquivo de ambiente, escrever no diretorio de estado e acessar Docker.

## Ativacao automatica

Depois de revisao e merge autorizado na `main`, o workflow:

1. executa a suite de testes;
2. constroi a imagem com o SHA integral de `github.sha`;
3. chama `scripts/deploy/deploy-production.sh <SHA>` no Ubuntu;
4. valida o Compose e o label OCI da imagem;
5. sobe a imagem sem executar migrations;
6. consulta via HTTP `/healthz` e `/release.json`;
7. grava `current-sha` somente apos confirmar o mesmo SHA nos dois endpoints.

O startup apenas verifica PostgreSQL 17 e o historico existente. Migration
pendente, checksum divergente ou banco inacessivel impedem o startup. Dockerfile,
Compose, workflow e script de deploy nunca chamam `db:migrate`.

Verificacao depois de uma ativacao autorizada:

```bash
curl --fail --show-error http://192.168.100.180:8444/healthz
curl --fail --show-error http://192.168.100.180:8444/release.json
```

Depois, abrir `http://192.168.100.180:8444` e validar login, sessao, CSRF,
logout, bloqueio por tentativas e expiracao.

## Rollback e encerramento

Falha no Compose, banco, health check ou igualdade do SHA restaura a imagem
anterior. Na primeira ativacao, sem imagem anterior, a pilha incompleta e
encerrada. Os volumes `caddy_data` e `caddy_config` continuam declarados e nao
sao apagados na troca de HTTPS para HTTP nem em `down` sem `--volumes`.

Rollback manual autorizado:

```bash
PREVIOUS_IMAGE="$(sudo cat /var/lib/hr-nautica-deploy/previous-image)"
sudo env ERP_IMAGE="$PREVIOUS_IMAGE" \
  ERP_ENV_FILE=/etc/hr-nautica/production.env \
  docker compose --env-file /etc/hr-nautica/production.env \
    -f deploy/compose.production.yml up -d --no-build --remove-orphans
```

Encerramento sem apagar volumes, dados ou imagens:

```bash
sudo env ERP_ENV_FILE=/etc/hr-nautica/production.env \
  docker compose --env-file /etc/hr-nautica/production.env \
    -f deploy/compose.production.yml down --remove-orphans
```

Rollback da aplicacao nao reverte banco. Migrations permanecem um procedimento
administrativo separado, com backup e autorizacao especifica.

## Controles externos pendentes

- branch protection da `main` exigindo revisao e testes;
- environment GitHub `production` restrito a `main`;
- runner dedicado e online;
- confirmar que firewall/roteador nao publicam `8444` fora da LAN, sem alterar
  regras globais sem autorizacao;
- arquivo `/etc/hr-nautica/production.env` fora do Git;
- aceitar formalmente o risco de credenciais e cookies sem criptografia na LAN.

## Homologacao

O procedimento independente esta em `docs/homologacao-interna.md`. Producao
nunca reutiliza banco, cookie, segredo ou projeto Compose da homologacao.
