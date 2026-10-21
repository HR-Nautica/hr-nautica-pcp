#!/usr/bin/env bash
set -Eeuo pipefail

readonly SHA="${1:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Uso: $0 <commit-sha-completo>" >&2
  exit 2
fi

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly COMPOSE_FILE="$REPOSITORY_ROOT/deploy/compose.production.yml"
readonly ENV_FILE="${ERP_ENV_FILE:-/etc/hr-nautica/production.env}"
readonly STATE_DIR="${ERP_DEPLOY_STATE_DIR:-/var/lib/hr-nautica-deploy}"
readonly IMAGE_REPOSITORY="${ERP_IMAGE_REPOSITORY:-hr-nautica-pcp}"
readonly TARGET_IMAGE="${IMAGE_REPOSITORY}:${SHA}"
readonly HEALTH_URL="${ERP_HEALTHCHECK_URL:-}"

env_value() {
  local key="$1"
  sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\\1/p" "$ENV_FILE" | tail -n 1
}

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado ou ilegivel: $ENV_FILE" >&2
  exit 3
fi
if [[ "$HEALTH_URL" != "http://192.168.100.180:8444" ]]; then
  echo "ERP_HEALTHCHECK_URL deve ser http://192.168.100.180:8444" >&2
  exit 3
fi

database_url="$(env_value DATABASE_URL)"
internal_host="$(env_value ERP_INTERNAL_HOST)"
bind_ip="$(env_value ERP_HTTPS_BIND_IP)"
https_port="$(env_value ERP_HTTPS_PORT)"
proxy_secret="$(env_value PROXY_SHARED_SECRET)"
if [[ "$database_url" != postgresql://hr_nautica_app:*@supabase-db:5433/postgres* ]]; then
  echo "DATABASE_URL deve usar hr_nautica_app em supabase-db:5433/postgres." >&2
  exit 3
fi
if [[ "$internal_host" != "192.168.100.180" || "$bind_ip" != "192.168.100.180" || "$https_port" != "8444" ]]; then
  echo "Producao exige IP 192.168.100.180 e porta HTTP 8444 nesta etapa." >&2
  exit 3
fi
if (( ${#proxy_secret} < 32 )) || [[ "$proxy_secret" == *SUBSTITUIR* ]]; then
  echo "PROXY_SHARED_SECRET deve ter ao menos 32 caracteres aleatorios." >&2
  exit 3
fi
docker image inspect "$TARGET_IMAGE" >/dev/null
image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$TARGET_IMAGE")"
if [[ "$image_revision" != "$SHA" ]]; then
  echo "A imagem alvo nao possui o label de revisao igual ao SHA solicitado." >&2
  exit 3
fi
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  echo "Outro deploy do ERP ja esta em andamento." >&2
  exit 3
fi

compose() {
  ERP_IMAGE="$1" ERP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${@:2}"
}

previous_image=""
current_container="$(compose "$TARGET_IMAGE" ps -q app 2>/dev/null || true)"
if [[ -n "$current_container" ]]; then
  previous_image="$(docker inspect --format '{{.Config.Image}}' "$current_container" 2>/dev/null || true)"
fi

rollback() {
  if [[ -z "$previous_image" ]] || ! docker image inspect "$previous_image" >/dev/null 2>&1; then
    echo "Sem imagem anterior; encerrando a pilha incompleta." >&2
    compose "$TARGET_IMAGE" down --remove-orphans
    return
  fi
  echo "Restaurando imagem anterior: $previous_image" >&2
  compose "$previous_image" up -d --no-build --remove-orphans
}

verify_release() {
  local health release
  health="$(curl --fail --silent --show-error --max-time 10 "${HEALTH_URL%/}/healthz")" || return 1
  release="$(curl --fail --silent --show-error --max-time 10 "${HEALTH_URL%/}/release.json")" || return 1
  [[ "$health" == *"\"ok\":true"* && "$health" == *"\"release\":\"$SHA\""* ]] || return 1
  [[ "$release" == *"\"release\":\"$SHA\""* ]] || return 1
}

if ! compose "$TARGET_IMAGE" config --quiet; then
  echo "Configuracao Compose invalida; nada foi alterado." >&2
  exit 4
fi

if ! compose "$TARGET_IMAGE" up -d --no-build --remove-orphans; then
  rollback || true
  exit 5
fi

healthy=false
for _attempt in $(seq 1 30); do
  if verify_release; then
    healthy=true
    break
  fi
  sleep 3
done

if [[ "$healthy" != true ]]; then
  echo "Health check nao confirmou o SHA $SHA; iniciando rollback." >&2
  rollback || true
  exit 6
fi

printf '%s\n' "$SHA" > "$STATE_DIR/current-sha"
if [[ -n "$previous_image" && "$previous_image" != "$TARGET_IMAGE" ]]; then
  printf '%s\n' "$previous_image" > "$STATE_DIR/previous-image"
fi
echo "Deploy confirmado no SHA $SHA"
