#!/usr/bin/env bash
# Seed a user home with optional samples. Never deletes; copies only missing paths.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "bootstrap-user-home: refuse to create files as root; re-exec as dc" >&2
  exec runuser -u dc -- "$0" "$@"
fi

target="${1:-}"
if [[ -z "$target" || "$target" != /* ]]; then
  echo "bootstrap-user-home: absolute home path required" >&2
  exit 1
fi

if [[ ! -d "$target" ]]; then
  mkdir -p "$target"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="${script_dir}/bootstrap-template"

copy_if_missing() {
  local rel="$1"
  local src="${template}/${rel}"
  local dst="${target}/${rel}"
  if [[ -e "$dst" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
  elif [[ -d "$src" ]]; then
    cp -a "$src" "$dst"
  else
    echo "bootstrap-user-home: missing template item: ${rel}" >&2
    exit 1
  fi
}

copy_if_missing ".recoll/recoll.conf"
copy_if_missing ".recoll/example-docs/runtime-sample.md"

dbdir="${target}/.recoll/xapian-db"
if [[ ! -d "$dbdir" ]] || [[ -z "$(ls -A "$dbdir" 2>/dev/null || true)" ]]; then
  if command -v recollindex >/dev/null 2>&1; then
    HOME="$target" recollindex -c "${target}/.recoll"
  fi
fi
