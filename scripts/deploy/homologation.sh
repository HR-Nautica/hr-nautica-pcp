#!/usr/bin/env bash
set -Eeuo pipefail

readonly ACTION="${1:-help}"
readonly ARGUMENT="${2:-}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly COMPOSE_FILE="$REPOSITORY_ROOT/deploy/compose.homologation.yml"
readonly ENV_FILE="${ERP_ENV_FILE:-/etc/hr-nautica/homologation.env}"
readonly STATE_DIR="${ERP_HOMOLOG_STATE_DIR:-/var/lib/hr-nautica-homolog}"
readonly IMAGE_REPOSITORY="${ERP_IMAGE_REPOSITORY:-hr-nautica-pcp}"
readonly CA_FILE="$STATE_DIR/caddy-root.crt"

usage() {
  cat <<'EOF'
Uso:
  homologation.sh activate <commit-sha-completo>
  homologation.sh bootstrap-admin [usuario]
  homologation.sh export-ca [arquivo-destino]
  homologation.sh status
  homologation.sh rollback
  homologation.sh stop

O script nunca executa migrations. ERP_ENV_FILE e ERP_HOMOLOG_STATE_DIR podem
sobrescrever os caminhos padrao sob /etc e /var/lib.
EOF
}

env_value() {
  local key="$1"
  sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\\1/p" "$ENV_FILE" | tail -n 1
}

require_safe_environment() {
  if [[ ! -r "$ENV_FILE" ]]; then
    echo "Arquivo de ambiente nao encontrado ou ilegivel: $ENV_FILE" >&2
    exit 3
  fi

  local database_url network internal_host bind_ip https_port secret database_target
  database_url="$(env_value DATABASE_URL)"
  network="$(env_value HOMOLOG_DATABASE_NETWORK)"
  internal_host="$(env_value ERP_INTERNAL_HOST)"
  bind_ip="$(env_value ERP_HTTPS_BIND_IP)"
  https_port="$(env_value ERP_HTTPS_PORT)"
  secret="$(env_value PROXY_SHARED_SECRET)"
  database_target="${database_url%%\?*}"

  if [[ "$database_target" != */hr_nautica_homolog ]]; then
    echo "DATABASE_URL deve apontar exclusivamente para o banco hr_nautica_homolog." >&2
    exit 3
  fi
  if [[ -z "$network" || "$network" == *SUBSTITUIR* || "$network" == "supabase_default" ]]; then
    echo "HOMOLOG_DATABASE_NETWORK deve ser uma rede isolada e nunca supabase_default." >&2
    exit 3
  fi
  if [[ "$internal_host" != "192.168.100.180" || "$bind_ip" != "192.168.100.180" || "$https_port" != "8443" ]]; then
    echo "Esta primeira homologacao exige IP 192.168.100.180 e porta HTTPS 8443." >&2
    exit 3
  fi
  if (( ${#secret} < 32 )) || [[ "$secret" == *SUBSTITUIR* ]]; then
    echo "PROXY_SHARED_SECRET deve ter ao menos 32 caracteres aleatorios." >&2
    exit 3
  fi
}

compose() {
  local image="${1:-$(env_value ERP_IMAGE)}"
  shift || true
  ERP_IMAGE="$image" ERP_ENV_FILE="$ENV_FILE" \
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

current_image() {
  local container
  container="$(compose "$(env_value ERP_IMAGE)" ps -q app 2>/dev/null || true)"
  [[ -n "$container" ]] && docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true
}

export_ca() {
  local destination="${1:-$CA_FILE}"
  mkdir -p "$(dirname -- "$destination")"
  compose "$(current_image)" cp proxy:/data/caddy/pki/authorities/local/root.crt "$destination"
  chmod 0644 "$destination"
  echo "CA raiz exportada para: $destination"
}

verify_release() {
  local sha="$1" health release
  health="$(curl --fail --silent --show-error --cacert "$CA_FILE" --max-time 10 \
    "https://192.168.100.180:8443/healthz")" || return 1
  release="$(curl --fail --silent --show-error --cacert "$CA_FILE" --max-time 10 \
    "https://192.168.100.180:8443/release.json")" || return 1
  [[ "$health" == *"\"ok\":true"* && "$health" == *"\"release\":\"$sha\""* ]] || return 1
  [[ "$release" == *"\"release\":\"$sha\""* ]] || return 1
}

activate() {
  local sha="$1" target_image previous_image="" healthy=false
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Informe o SHA completo de 40 caracteres." >&2
    exit 2
  fi
  if [[ "$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)" != "$sha" ]]; then
    echo "O checkout local nao corresponde ao SHA solicitado." >&2
    exit 4
  fi
  if ! git -C "$REPOSITORY_ROOT" diff --quiet || ! git -C "$REPOSITORY_ROOT" diff --cached --quiet; then
    echo "Ha alteracoes rastreadas no checkout; a imagem nao seria reproduzivel." >&2
    exit 4
  fi

  target_image="${IMAGE_REPOSITORY}:${sha}"
  previous_image="$(current_image)"
  docker build --pull --build-arg "APP_COMMIT_SHA=$sha" \
    --label "org.opencontainers.image.revision=$sha" --tag "$target_image" "$REPOSITORY_ROOT"
  compose "$target_image" config --quiet

  # Validacao somente leitura; startup e este script recusam migrations pendentes.
  docker run --rm --network "$(env_value HOMOLOG_DATABASE_NETWORK)" --env-file "$ENV_FILE" \
    -e DATABASE_STRICT_MODE=true -e DATABASE_SSL_MODE=disable \
    "$target_image" npm run db:migrate:validate

  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/homologation.lock"
  if ! flock -n 9; then
    echo "Outra operacao de homologacao esta em andamento." >&2
    exit 5
  fi

  if ! compose "$target_image" up -d --no-build --remove-orphans; then
    rollback_to "$previous_image"
    exit 5
  fi
  for _attempt in $(seq 1 30); do
    if export_ca "$CA_FILE" >/dev/null 2>&1 && verify_release "$sha"; then
      healthy=true
      break
    fi
    sleep 3
  done
  if [[ "$healthy" != true ]]; then
    echo "Health check TLS nao confirmou o SHA $sha; iniciando rollback." >&2
    rollback_to "$previous_image"
    exit 6
  fi

  printf '%s\n' "$sha" > "$STATE_DIR/current-sha"
  if [[ -n "$previous_image" && "$previous_image" != "$target_image" ]]; then
    printf '%s\n' "$previous_image" > "$STATE_DIR/previous-image"
  fi
  echo "Homologacao ativa em https://192.168.100.180:8443 no SHA $sha"
  echo "CA raiz para os computadores autorizados: $CA_FILE"
}

rollback_to() {
  local image="$1"
  if [[ -n "$image" ]] && docker image inspect "$image" >/dev/null 2>&1; then
    echo "Restaurando imagem anterior: $image" >&2
    compose "$image" up -d --no-build --remove-orphans
  else
    echo "Sem imagem anterior; encerrando a pilha incompleta." >&2
    compose "$(env_value ERP_IMAGE)" down --remove-orphans
  fi
}

require_safe_environment
case "$ACTION" in
  activate) activate "$ARGUMENT" ;;
  bootstrap-admin)
    read -r -s -p "Senha temporaria do administrador: " password
    echo
    [[ -n "$password" ]] || { echo "Senha vazia recusada." >&2; exit 3; }
    export INITIAL_ADMIN_USERNAME="${ARGUMENT:-lucas}"
    export INITIAL_ADMIN_PASSWORD="$password"
    compose "$(current_image)" exec -T -e INITIAL_ADMIN_USERNAME \
      -e INITIAL_ADMIN_PASSWORD app npm run auth:bootstrap-admin
    unset password INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_USERNAME
    ;;
  export-ca) export_ca "${ARGUMENT:-$CA_FILE}" ;;
  status) compose "$(current_image)" ps ;;
  rollback)
    [[ -r "$STATE_DIR/previous-image" ]] || { echo "Imagem anterior nao registrada." >&2; exit 3; }
    rollback_to "$(<"$STATE_DIR/previous-image")"
    ;;
  stop) compose "$(current_image)" down --remove-orphans ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
