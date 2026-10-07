#!/usr/bin/env bash
# Run tool version checks inside a user systemd unit (same PATH contract as dc-agent-runtime.service).
set -euo pipefail

engine="${1:-docker}"
name="${2:-}"
uid_in="${3:-}"

if [[ -z "$name" || -z "$uid_in" ]]; then
  echo "usage: user-unit-tool-check.sh <docker|podman> <container> <uid-in-container>" >&2
  exit 2
fi

run_as_dc() {
  if [[ "$engine" == podman ]]; then
    podman exec -u dc "$name" env \
      "XDG_RUNTIME_DIR=/run/user/${uid_in}" \
      "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid_in}/bus" \
      "$@"
  else
    docker exec -u dc "$name" env \
      "XDG_RUNTIME_DIR=/run/user/${uid_in}" \
      "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid_in}/bus" \
      "$@"
  fi
}

run_as_dc systemd-run --user --wait --pipe \
  --setenv=PATH=/home/dc/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
  bash -lc 'set -e; cowsay --version; uv --version; ruff --version; codex --version'
