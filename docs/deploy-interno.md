# Deploy interno definitivo

## Arquitetura

```text
GitHub main
  -> testes em runner hospedado pelo GitHub
  -> runner self-hosted no Ubuntu (somente conexao HTTPS de saida)
  -> imagem hr-nautica-pcp:<commit SHA>
  -> Caddy HTTPS interno -> Express (frontend dist + API da mesma imagem)
                           -> PostgreSQL via supabase_default
```

O Caddy e o ERP usam um Compose proprio (`hr-nautica-prod`). Nenhuma porta ou
container do Supabase ou do Sistema JM e alterado. A API nao publica porta no
host: somente o Caddy participa da rede `edge`, e somente a API participa tambem
da rede externa `supabase_default`.

O SHA completo e gravado na imagem, em `/release.json` e em `/healthz`. O script
de deploy exige que frontend e API retornem o SHA solicitado. Uma pagina aberta
em uma release anterior recebe `RELEASE_MISMATCH` e e recarregada antes de uma
nova operacao de API.

Homologacao usa `hr-nautica-homolog`, hostname, porta, cookie, segredo, arquivo
de ambiente, volumes Caddy e rede de banco diferentes. Seu Compose nunca se
conecta a `supabase_default`.

## Preparacao unica do Ubuntu

Os comandos abaixo sao procedimentos para o administrador executar depois de
autorizar a ativacao; este repositorio nao os executa remotamente.

1. Instalar Docker Engine com Compose v2 e conferir as portas antes de escolher
   a porta HTTPS:

   ```bash
   sudo ss -lntup
   docker network inspect supabase_default
   ```

2. Criar os diretorios locais e copiar o exemplo sem valores reais:

   ```bash
   sudo install -d -m 750 -o root -g docker /etc/hr-nautica/tls/production
   sudo install -d -m 770 -o root -g docker /var/lib/hr-nautica-deploy
   sudo install -m 640 -o root -g docker deploy/production.env.example /etc/hr-nautica/production.env
   ```

3. Definir DNS interno, por exemplo `erp.hrnautica.internal ->
   192.168.100.180`. Emitir na CA corporativa um certificado de servidor com
   SAN para esse nome. Instalar a cadeia em
   `/etc/hr-nautica/tls/production/tls.crt` e a chave em `tls.key`. Distribuir a
   CA raiz confiavel aos computadores por politica corporativa. O certificado
   precisa ser confiavel tambem no Ubuntu, pois o health check nao desativa a
   validacao TLS.

4. Editar `/etc/hr-nautica/production.env`. Gerar um
   `PROXY_SHARED_SECRET` independente com `openssl rand -base64 48`; preencher
   `DATABASE_URL` com o usuario exclusivo do ERP; confirmar o hostname Docker
   real do PostgreSQL na rede `supabase_default`; escolher
   `ERP_HTTPS_PORT=443` somente se estiver livre. Caso contrario, usar outra
   porta livre e ajustar `ERP_HEALTHCHECK_URL` no workflow para incluir a porta.

5. Em uma janela administrativa separada e explicitamente autorizada, criar a
   credencial de banco propria do ERP. A conta deve ser `LOGIN`, sem superuser,
   sem criacao de banco/role e com somente `CONNECT`, `USAGE` no schema e os
   privilegios de DML/sequencias necessarios nas tabelas controladas pelas
   migrations. Nao reutilizar `postgres`, service-role ou a conta da
   homologacao. A senha entra apenas em `/etc/hr-nautica/production.env`.

6. Instalar um GitHub Actions self-hosted runner oficial no Ubuntu como servico,
   dedicado a este repositorio, no grupo restrito de producao e com os labels
   `self-hosted`, `linux`, `x64`, `hr-nautica-production`. O runner precisa ler
   `/etc/hr-nautica/production.env`, escrever em `/var/lib/hr-nautica-deploy` e
   usar Docker. Ele inicia conexoes HTTPS de saida para o GitHub; nao requer
   NAT, encaminhamento de porta, SSH ou webhook de entrada.

7. Antes do primeiro deploy, validar manualmente e sem alteracao:

   ```bash
   docker compose --env-file /etc/hr-nautica/production.env \
     -f deploy/compose.production.yml config --quiet
   DATABASE_STRICT_MODE=true npm run db:migrate:status
   DATABASE_STRICT_MODE=true npm run db:migrate:validate
   ```

   Os comandos de status/validate sao somente leitura. Se houver migration
   pendente, checksum divergente ou historico incompleto, o container recusara
   startup. Aplicar migration e criar/alterar roles continuam sendo operacoes
   administrativas separadas, com backup, revisao e autorizacao explicita.

8. Para a primeira ativacao autorizada, executar o workflow a partir de um
   commit aprovado em `main` (ou fazer o primeiro push/merge depois de habilitar
   o workflow). A imagem recebe a tag do SHA e o script confirma
   `https://erp.hrnautica.internal/healthz` e `/release.json`. Nenhuma migration
   e chamada pelo Dockerfile, Compose, entrypoint, workflow ou script de deploy.

## Rollback

Antes da troca, o script registra a imagem atual. Falha no `compose up`, no
banco, no TLS ou na igualdade do SHA restaura a imagem anterior localmente. O
deploy so grava `current-sha` depois do health check completo. Imagens antigas
nao sao removidas automaticamente.

Para uma restauracao manual autorizada, consulte
`/var/lib/hr-nautica-deploy/previous-image`, defina essa imagem como `ERP_IMAGE`
e execute `docker compose up -d --no-build`. Rollback de aplicacao nao reverte
banco; migrations possuem procedimento proprio e nunca fazem parte do deploy.

## Homologacao

Use `deploy/compose.homologation.yml` com
`/etc/hr-nautica/homologation.env`. Configure `HOMOLOG_DATABASE_NETWORK` com a
rede isolada existente e `DATABASE_URL` para `hr_nautica_homolog`. O hostname
recomendado e `erp-homolog.hrnautica.internal`, a porta padrao e `8443` e o
cookie e `hrn_homolog_session`. Nunca reutilize certificado/chave, segredo,
credencial ou arquivo de ambiente de producao.

## Criterios para habilitar o deploy da main

- DNS interno e certificado corporativo validos em clientes e no Ubuntu;
- porta escolhida comprovadamente livre e firewall do Ubuntu limitado a rede
  interna;
- `supabase_default` existente e hostname do PostgreSQL confirmado, sem alterar
  containers Supabase;
- usuario exclusivo de producao provisionado e testado, sem usar credenciais de
  homologacao;
- todas as migrations aprovadas, aplicadas por procedimento manual e
  `db:migrate:validate` sem pendencias;
- backup operacional testado antes de qualquer futura migration;
- branch protection em `main` exigindo o job `test`, revisao e historico linear;
- environment GitHub `production` limitado a `main`; para deploy totalmente
  automatico, sem aprovacao manual do environment depois que os controles
  anteriores estiverem aceitos;
- runner dedicado online, com label exato e sem outros repositorios autorizados;
- arquivos em `/etc/hr-nautica` fora do Git e com permissoes restritas;
- teste de login, troca de senha, logout, CSRF e sessao em homologacao concluido.

## Desenvolvimento local

`npm run dev` continua expondo Vite em `http://localhost:5173` e a API em
`http://localhost:3001`. O `release.js` local usa `development`, portanto o
guard de SHA nao interfere no Vite. Cookies Secure devem permanecer desativados
somente no `.env.local` de desenvolvimento HTTP.
