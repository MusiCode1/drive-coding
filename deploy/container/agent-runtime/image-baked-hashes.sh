#!/usr/bin/env bash
# Compare SHA-256 of every Containerfile COPY path (source tree) vs baked image paths.
set -euo pipefail

src="${1:-}"
uid="${2:-1000}"
image="${3:-}"
engine="${4:-docker}"

if [[ -z "$src" || -z "$image" ]]; then
  echo "usage: image-baked-hashes.sh <repo-root> <DC_UID> <image> [docker|podman]" >&2
  exit 2
fi

run_engine() {
  if [[ "$engine" == podman ]]; then
    podman run --rm --entrypoint cat "$image" "$1"
  else
    docker run --rm --entrypoint cat "$image" "$1"
  fi
}

sha_file() {
  sha256sum "$1" | awk '{print $1}'
}

sha_stream() {
  sha256sum | awk '{print $1}'
}

root="${src}/deploy/container"
fail=0

compare_file() {
  local rel_src="$1"
  local image_path="$2"
  local src_path="${src}/${rel_src}"
  local src_sha image_sha
  src_sha="$(sha_file "$src_path")"
  image_sha="$(run_engine "$image_path" | sha_stream)"
  echo "${rel_src} -> ${image_path}: src=${src_sha} image=${image_sha}"
  if [[ "$src_sha" != "$image_sha" ]]; then
    echo "MISMATCH ${rel_src}" >&2
    fail=1
  fi
}

compare_file "deploy/container/healthcheck.js" "/usr/local/lib/dc-agent-runtime/healthcheck.js"
compare_file "deploy/container/agent-runtime/entrypoint.sh" "/usr/local/bin/dc-agent-runtime-entrypoint.sh"
compare_file "deploy/container/agent-runtime/dc-release-exec" "/usr/local/bin/dc-release-exec"
compare_file "deploy/container/agent-runtime/bootstrap-user-home.sh" "/usr/local/lib/dc-agent-runtime/bootstrap-user-home.sh"
compare_file "deploy/container/agent-runtime/fixture-hold.js" "/usr/local/lib/dc-agent-runtime/fixture-hold.js"

tree_sha="${src}/deploy/container/agent-runtime/tree-sha256.sh"
src_tpl="$("$tree_sha" "${root}/agent-runtime/bootstrap-template")"
if [[ "$engine" == podman ]]; then
  img_tpl="$(podman run --rm -v "${tree_sha}:/tree-sha256.sh:ro" --entrypoint bash "$image" -c 'bash /tree-sha256.sh /usr/local/lib/dc-agent-runtime/bootstrap-template')"
else
  img_tpl="$(docker run --rm -v "${tree_sha}:/tree-sha256.sh:ro" --entrypoint bash "$image" -c 'bash /tree-sha256.sh /usr/local/lib/dc-agent-runtime/bootstrap-template')"
fi
echo "bootstrap-template tree: src=${src_tpl} image=${img_tpl}"
if [[ "$src_tpl" != "$img_tpl" ]]; then
  echo "MISMATCH bootstrap-template" >&2
  fail=1
fi

src_unit="$(sed "s/__DC_UID__/${uid}/g" "${root}/agent-runtime/dc-agent-runtime.service.in" | sha_stream)"
image_unit="$(run_engine /etc/systemd/system/dc-agent-runtime.service | sha_stream)"
echo "dc-agent-runtime.service: src=${src_unit} image=${image_unit}"
if [[ "$src_unit" != "$image_unit" ]]; then
  echo "MISMATCH unit" >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "image-baked-hashes: ok"
