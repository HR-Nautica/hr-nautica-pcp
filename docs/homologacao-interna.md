# Primeira homologacao interna por IP

## Resultado esperado

O ERP fica disponivel somente em `https://192.168.100.180:8443`. Caddy serve o
frontend e encaminha `/api` para o mesmo container de aplicacao, portanto o
navegador usa uma unica origem para login, cookie de sessao e CSRF. A porta
`3001` aparece apenas na rede Docker `edge` e nao e publicada na LAN.

A imagem recebe o SHA completo durante o build. Esse mesmo SHA fica no frontend
(`/release.json`), no header da API e em `/healthz`; a ativacao so termina quando
os dois endpoints confirmam o SHA solicitado.

`PROXY_SHARED_SECRET` continua sendo uma credencial exclusiva do salto
Caddy -> API. O Caddy sobrescreve o header antes do proxy. O JavaScript nao
conhece nem envia esse segredo; usuarios se autenticam por login, cookie
`Secure; HttpOnly; SameSite=Strict` e token CSRF.

## Pre-requisitos que o administrador deve confirmar

- Docker Engine, Compose v2, `curl`, `git` e `flock` no Ubuntu;
- IP `192.168.100.180` configurado no Ubuntu e TCP `8443` permitido somente para
  a rede interna autorizada;
- um PostgreSQL 17 de homologacao ja preparado, com banco exatamente
  `hr_nautica_homolog`, schema e historico de migrations validos;
- uma rede Docker exclusiva que alcance somente esse PostgreSQL. Ela nao pode
  ser `supabase_default`;
- uma credencial PostgreSQL exclusiva de homologacao, sem acesso ao banco
  operacional;
- checkout limpo no commit aprovado da branch `infra/ubuntu-homologacao`.

O procedimento nao cria banco, nao executa migrations e nao conecta a
`supabase_default`. Se o banco estiver incompleto ou tiver migration pendente,
a validacao somente leitura interrompe a ativacao.

## Preparacao unica

No Ubuntu, a partir do checkout aprovado:

```bash
sudo install -d -m 750 -o root -g docker /etc/hr-nautica
sudo install -d -m 750 -o root -g docker /var/lib/hr-nautica-homolog
sudo install -m 640 -o root -g docker \
  deploy/homologation.env.example /etc/hr-nautica/homologation.env
sudo editor /etc/hr-nautica/homologation.env
```

No arquivo privado, substitua somente os placeholders de
`HOMOLOG_DATABASE_NETWORK`, `DATABASE_URL` e `PROXY_SHARED_SECRET`. Gere o
segredo, por exemplo, com `openssl rand -base64 48`. Nao grave o arquivo ou a
senha no Git. Mantenha IP, porta e nome do banco conforme o exemplo.

Confira antes de ativar:

```bash
sudo ss -lnt '( sport = :8443 )'
docker network inspect NOME_DA_REDE_EXCLUSIVA_DE_HOMOLOGACAO
```

## Ativacao

Uma unica chamada constroi a imagem, valida a configuracao e o historico do
banco sem escrita, inicia os containers, exporta a CA e testa HTTPS + banco +
SHA:

```bash
SHA="$(git rev-parse HEAD)"
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh activate "$SHA"
```

Para criar o primeiro usuario somente se ele ainda nao existir, execute o
comando abaixo. A senha temporaria e lida sem eco, nao entra no arquivo de
ambiente e deve ser trocada no primeiro login:

```bash
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh bootstrap-admin lucas
```

Esse comando escreve apenas nas tabelas de autenticacao do banco de
homologacao. Se ja houver um administrador valido, nao e necessario executa-lo.

## Confiar na CA interna do Caddy

`tls internal` cria uma CA exclusiva e persistente no volume
`hr-nautica-homolog_caddy_data`. A ativacao exporta somente o certificado
publico raiz para:

`/var/lib/hr-nautica-homolog/caddy-root.crt`

Copie esse arquivo por canal administrativo autenticado apenas para os
computadores autorizados e confira seu SHA-256 fora de banda. Nunca distribua
arquivos `*.key`. A validacao TLS deve permanecer habilitada.

No Windows, em PowerShell elevado:

```powershell
certutil -addstore -f Root .\caddy-root.crt
```

Chrome e Edge usam o repositório do Windows. No Firefox, habilite o uso das
raizes do sistema pela politica corporativa ou importe `caddy-root.crt` em
Privacidade e Seguranca > Certificados > Autoridades. Nao crie excecao de
certificado.

Em Debian/Ubuntu cliente:

```bash
sudo install -m 644 caddy-root.crt \
  /usr/local/share/ca-certificates/hr-nautica-homolog.crt
sudo update-ca-certificates
```

Depois, abra `https://192.168.100.180:8443`, confirme certificado valido e faca
login. Preservar o volume Caddy preserva a CA; apagar o volume exige distribuir
uma nova raiz.

## Verificacao, rollback e encerramento

```bash
# Estado dos containers
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh status

# Restaurar a imagem anterior registrada (nao altera o banco)
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh rollback

# Encerrar a homologacao sem apagar volumes, imagens ou CA
sudo ERP_ENV_FILE=/etc/hr-nautica/homologation.env \
  bash scripts/deploy/homologation.sh stop
```

O rollback e somente da aplicacao. Como este fluxo nao executa migrations, nao
ha rollback de schema embutido. Para revogar a confianca em um computador,
remova a raiz do Caddy identificada pelo fingerprint conferido na instalacao do
mesmo repositorio de certificados em que ela foi adicionada.
