#!/usr/bin/env bash
set -euo pipefail
umask 077

root=${PRODUCT_DEPLOY_ROOT:-/opt/product-research}
if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ (git-([0-9a-f]{40})-[0-9]+-[0-9]+)$ ]]; then
  echo 'Only a product release deployment is allowed.' >&2
  exit 64
fi
release_id=${BASH_REMATCH[1]}
revision=${BASH_REMATCH[2]}
image="product-research:$release_id"
release="$root/releases/$release_id"
exec 9>"$root/deploy.lock"
flock -w 600 9
previous=$(cd "$root/current" && pwd -P)
test -f "$previous/compose.yaml"
mkdir "$release"
archive="$release/image.tar.gz"
activated=0

compose() {
  local directory=$1
  shift
  local environment="$directory/release.env"
  if [[ ! -f $environment ]]; then environment=/dev/null; fi
  docker compose --env-file "$environment" -f "$directory/compose.yaml" "$@"
}

finish() {
  local status=$?
  trap - EXIT
  if [[ $status != 0 && $activated == 1 ]]; then
    echo 'Release failed. Restoring the previous app image.' >&2
    if ! compose "$previous" up -d --no-build --wait --wait-timeout 90 app; then
      echo 'Rollback failed; production needs attention.' >&2
    fi
  fi
  rm -f "$archive"
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

timeout 300 head -c 1073741825 > "$archive"
if [[ $(wc -c < "$archive") -gt 1073741824 ]]; then
  echo 'Image transfer exceeds 1 GiB.' >&2
  exit 65
fi
python3 "$root/deploy/validate-image.py" "$archive" "$image"
docker image load --input "$archive"
metadata=$(docker image inspect "$image" --format '{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}')
if [[ $metadata != "arm64 $revision" ]]; then
  echo 'Image architecture or source revision did not match the release.' >&2
  exit 65
fi
cp "$root/deploy/compose.yaml" "$release/compose.yaml"
printf 'PRODUCT_IMAGE=%s\n' "$image" > "$release/release.env"
docker image inspect "$image" --format '{{.Id}}' > "$release/image-id"
activated=1
compose "$release" up -d --no-build --wait --wait-timeout 90 app
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 \
  --connect-timeout 5 --max-time 10 \
  --resolve product.kanishq.dev:443:127.0.0.1 https://product.kanishq.dev/healthz
ln -s "$release" "$root/current.next"
python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$root/current.next" "$root/current"
activated=0
printf '\nDeployed %s\n' "$release_id"
