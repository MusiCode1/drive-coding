#!/usr/bin/env bash
# Podman launcher for agent-runtime (trial label only).
set -euo pipefail

label_key=org.drivecoding.agent-runtime
label_val=trial

die() {
  echo "podman-run: $*" >&2
  exit 1
}

[[ -n "${DC_AGENT_NAME:-}" ]] || die "DC_AGENT_NAME is required"
[[ -n "${DC_AGENT_HOME:-}" ]] || die "DC_AGENT_HOME is required"

if [[ ! "$DC_AGENT_HOME" = /* ]]; then
  die "DC_AGENT_HOME must be an absolute path"
fi

if [[ ! "$DC_AGENT_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  die "DC_AGENT_NAME contains invalid characters"
fi

image="${DC_AGENT_IMAGE:-dc-agent-runtime:local}"
port="${DC_AGENT_PORT:-18400}"
host_uid="$(id -u)"

expected_uid="${DC_UID:-1000}"

if [[ ! -d "$DC_AGENT_HOME" ]]; then
  mkdir -p "$DC_AGENT_HOME"
fi

owner="$(stat -c '%u' "$DC_AGENT_HOME")"
if [[ "$owner" != "$expected_uid" ]]; then
  die "home ${DC_AGENT_HOME} owned by uid ${owner}, expected ${expected_uid} (new empty home or rebuild --build-arg DC_UID=${owner})"
fi

if command -v podman >/dev/null 2>&1; then
  if podman container exists "$DC_AGENT_NAME" 2>/dev/null; then
    existing_label="$(podman inspect -f "{{ index .Config.Labels \"${label_key}\" }}" "$DC_AGENT_NAME" 2>/dev/null || true)"
    if [[ "$existing_label" != "$label_val" ]]; then
      die "container name ${DC_AGENT_NAME} already in use without ${label_key}=${label_val}"
    fi
    podman rm -f "$DC_AGENT_NAME" >/dev/null
  fi
fi

userns_args=()
user_args=()
if [[ "$host_uid" != "$expected_uid" ]]; then
  die "host uid ${host_uid} != image DC_UID ${expected_uid}; rebuild with --build-arg DC_UID=${host_uid} or use a new home"
fi

userns_args=(--userns=keep-id)
# keep-id alone starts entrypoint as uid 1000; systemd exits 255. Root + keep-id
# keeps bind mounts host-owned as dc while PID 1 is systemd (measured Podman 5.4.2).
user_args=(--user 0)

exec podman run -d --name "$DC_AGENT_NAME" \
  --label "${label_key}=${label_val}" \
  --systemd=always \
  "${userns_args[@]}" \
  "${user_args[@]}" \
  -p "127.0.0.1:${port}:18400" \
  -v "${DC_AGENT_HOME}:/home/dc:Z" \
  "$image"
