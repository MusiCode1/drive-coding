#!/usr/bin/env bash
# README Podman blocks: load image (optional), release, podman-run, npm/uv split, health.
# Run on a host with Podman. Image must already exist locally or via load.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${root}/../../.." && pwd)"

if [[ -z "${SRC:-}" ]]; then
  SRC="$(mktemp -d /tmp/dc-agent-runtime-podman-src-XXXXXX)"
fi
export SRC
export DC_UID="${DC_UID:-$(id -u)}"
export DC_AGENT_IMAGE="${DC_AGENT_IMAGE:-dc-agent-runtime:podman-e2e}"
export DC_AGENT_NAME="${DC_AGENT_NAME:-dc-agent-runtime-podman-e2e}"
export DC_AGENT_PORT="${DC_AGENT_PORT:-18409}"
export DC_IMAGE_TAR="${DC_IMAGE_TAR:-}"

if [[ -n "$DC_IMAGE_TAR" && -f "$DC_IMAGE_TAR" ]]; then
  echo "=== E2E Podman: load image ==="
  podman load -i "$DC_IMAGE_TAR"
fi

if ! podman image exists "${DC_AGENT_IMAGE}" 2>/dev/null; then
  echo "guide-podman-e2e: missing image ${DC_AGENT_IMAGE} (build or set DC_IMAGE_TAR)" >&2
  exit 1
fi

echo "=== E2E Podman: archive source for release (if needed) ==="
if [[ ! -f "${SRC}/package.json" ]]; then
  git -C "${repo_root}" archive HEAD | tar -x -C "${SRC}"
fi

export DC_AGENT_HOME="${DC_AGENT_HOME:-$(mktemp -d /tmp/dc-agent-runtime-podman-e2e-home-XXXXXX)}"

echo "=== E2E Podman: home + release ==="
"${root}/prepare-agent-home.sh" "${DC_AGENT_HOME}" "${DC_UID}"
HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id A --source "${SRC}" --bun-version 1.3.14

echo "=== E2E Podman: podman-run ==="
export DC_AGENT_IMAGE DC_AGENT_HOME DC_AGENT_NAME DC_AGENT_PORT DC_UID
"${root}/podman-run.sh"

echo "=== E2E Podman: wait health ==="
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
podman port "${DC_AGENT_NAME}" | grep -q 127.0.0.1

echo "=== E2E Podman: npm + uv (split commands) ==="
podman exec -u dc "${DC_AGENT_NAME}" npm install -g cowsay
podman exec -u dc "${DC_AGENT_NAME}" bash -lc 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
podman exec -u dc "${DC_AGENT_NAME}" bash -lc 'export PATH="/home/dc/.local/bin:$PATH"; uv --version'

uid="$(podman exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
podman exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemd-run --user --wait --pipe \
  --setenv=PATH=/home/dc/.local/bin:/usr/local/bin:/usr/bin \
  which cowsay

echo "guide-podman-e2e: ok"
