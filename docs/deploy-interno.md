# Producao interna do ERP

## Fluxo aprovado

```text
Antigravity -> pull request revisado -> GitHub main
  -> job test em runner GitHub
  -> job deploy no runner Ubuntu hr-nautica-production
  -> imagem hr-nautica-pcp:<SHA completo>
  -> Caddy https://192.168.100.180:8444
  -> Express (frontend + API do mesmo SHA)
  -> supabase-db:5433/postgres pela rede supabase_default
```

O workflow so executa o deploy em `push` na `main` e somente depois do job de
testes. O environment GitHub `production` deve aceitar apenas a `main`. A
aprovacao acontece antes do merge; depois de uma atualizacao aprovada da
`main`, o deploy e automatico.

Homologacao permanece separada em `https://192.168.100.180:8443`, com outro
Compose, cookie, segredo, banco e volumes Caddy.

## Isolamento e identidade da release

- somente o Caddy publica `192.168.100.180:8444 -> 443/tcp`;
- a API possui apenas `expose: 3001`, sem porta publicada no host;
- o Caddy participa somente da rede `edge`;
- somente a aplicacao participa de `edge` e da rede externa
  `supabase_default`;
- nenhum servico PostgreSQL, Supabase, n8n ou Sistema JM e criado ou alterado
  por este Compose;
- a imagem recebe a tag imutavel `hr-nautica-pcp:<SHA completo>` e o mesmo SHA
  e gravado no frontend, `/release.json`, header da API e `/healthz`.

Uma pagina antiga recebe `RELEASE_MISMATCH` antes de operar contra uma API de
outro SHA.

## HTTPS interno por IP

Producao usa `tls internal` e `default_sni 192.168.100.180`. Assim, o Caddy
apresenta o certificado correto inclusive a clientes TLS sem SNI. A CA de
producao fica no volume `hr-nautica-prod_caddy_data`, separado da homologacao.

O deploy exporta somente o certificado raiz publico para:

```text
/var/lib/hr-nautica-deploy/caddy-root.crt
```

O health check usa explicitamente essa CA com `curl --cacert`; a validacao TLS
nunca e desativada. Nao apagar o volume Caddy: isso geraria outra CA e exigiria
nova distribuicao aos clientes.

## Preparacao unica do Ubuntu

Estes comandos devem ser executados futuramente pelo administrador no Ubuntu;
o repositorio e o workflow nao os executam remotamente.

1. Confirmar Docker, rede do banco e porta livre:

   ```bash
   docker version
   docker compose version
   docker network inspect supabase_default >/dev/null
   sudo ss -lnt '( sport = :8444 )'
   ```

2. Criar os arquivos locais. O runner precisa pertencer ao grupo `docker`:

   ```bash
   sudo install -d -m 750 -o root -g docker /etc/hr-nautica
   sudo install -d -m 770 -o root -g docker /var/lib/hr-nautica-deploy
   sudo install -m 640 -o root -g docker \
     deploy/production.env.example /etc/hr-nautica/production.env
   sudo editor /etc/hr-nautica/production.env
   ```

3. No arquivo privado, substituir apenas `SENHA_FORA_DO_GIT` e
   `PROXY_SHARED_SECRET`. Gerar um segredo exclusivo de producao:

   ```bash
   openssl rand -base64 48
   ```

   Manter estes valores confirmados:

   ```dotenv
   ERP_INTERNAL_HOST=192.168.100.180
   ERP_HTTPS_BIND_IP=192.168.100.180
   ERP_HTTPS_PORT=8444
   DATABASE_URL=postgresql://hr_nautica_app:SENHA_FORA_DO_GIT@supabase-db:5433/postgres
   ```

4. Validar Compose e Caddy sem iniciar servicos:

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

5. Instalar o runner self-hosted oficial, dedicado a este repositorio, com os
   labels exatos `self-hosted`, `linux`, `x64`, `hr-nautica-production`. Ele
   precisa ler `/etc/hr-nautica/production.env`, escrever em
   `/var/lib/hr-nautica-deploy` e acessar Docker. Nenhuma porta de entrada,
   webhook ou SSH e exigido pelo GitHub Actions.

## Primeira ativacao automatica

Depois da aprovacao do pull request, o merge autorizado na `main` dispara o
workflow `.github/workflows/deploy-internal.yml`. Nao executar o script
manualmente na primeira ativacao normal.

O workflow:

1. executa toda a suite de testes;
2. constroi a imagem com o SHA integral de `github.sha`;
3. executa `scripts/deploy/deploy-production.sh <SHA>` no runner interno;
4. valida a configuracao Compose;
5. sobe a imagem sem executar migrations;
6. exporta a CA do Caddy;
7. confirma `/healthz` e `/release.json` via HTTPS e exige o mesmo SHA;
8. grava `current-sha` somente depois de todas as validacoes.

O startup da API verifica PostgreSQL 17 e o historico existente. Migration
pendente, checksum divergente ou banco inacessivel fazem o startup/deploy
falhar. Dockerfile, Compose, workflow e script de deploy nunca chamam
`db:migrate`.

## Confianca da CA e verificacao

Depois do primeiro deploy bem-sucedido, conferir no Ubuntu:

```bash
sha256sum /var/lib/hr-nautica-deploy/caddy-root.crt
curl --cacert /var/lib/hr-nautica-deploy/caddy-root.crt \
  https://192.168.100.180:8444/healthz
curl --cacert /var/lib/hr-nautica-deploy/caddy-root.crt \
  https://192.168.100.180:8444/release.json
```

Distribuir `caddy-root.crt` por canal administrativo autenticado somente aos
computadores autorizados e conferir o fingerprint fora de banda. Nunca
distribuir chaves privadas nem criar excecao TLS.

Windows, em PowerShell elevado:

```powershell
certutil -addstore -f Root .\caddy-root.crt
```

Debian/Ubuntu cliente:

```bash
sudo install -m 644 caddy-root.crt \
  /usr/local/share/ca-certificates/hr-nautica-production.crt
sudo update-ca-certificates
```

Depois, abrir `https://192.168.100.180:8444` e validar login, sessao, CSRF,
logout e troca de senha.

## Rollback e encerramento

Em falha no Compose, banco, TLS, health check ou igualdade do SHA, o script
restaura automaticamente a imagem anterior. Se ainda nao existir imagem
anterior, encerra a pilha incompleta. Nenhuma imagem antiga e removida
automaticamente.

Rollback manual autorizado:

```bash
PREVIOUS_IMAGE="$(sudo cat /var/lib/hr-nautica-deploy/previous-image)"
sudo env ERP_IMAGE="$PREVIOUS_IMAGE" \
  ERP_ENV_FILE=/etc/hr-nautica/production.env \
  docker compose --env-file /etc/hr-nautica/production.env \
    -f deploy/compose.production.yml up -d --no-build --remove-orphans
```

Encerramento sem apagar CA, volumes ou imagens:

```bash
sudo env ERP_ENV_FILE=/etc/hr-nautica/production.env \
  docker compose --env-file /etc/hr-nautica/production.env \
    -f deploy/compose.production.yml down --remove-orphans
```

Rollback da aplicacao nao reverte banco. Qualquer futura migration continua um
procedimento administrativo separado, com backup e autorizacao especifica.

## Controles externos ainda necessarios

- branch protection da `main` exigindo revisao e job `test` aprovado;
- environment GitHub `production` restrito a `main`;
- runner dedicado e online;
- firewall do Ubuntu permitindo `8444/tcp` apenas da rede interna autorizada;
- arquivo `/etc/hr-nautica/production.env` fora do Git;
- distribuicao controlada da CA de producao.

## Homologacao

O procedimento independente de homologacao continua em
`docs/homologacao-interna.md`. Producao nunca reutiliza o banco, cookie, segredo
ou volume Caddy da homologacao.
