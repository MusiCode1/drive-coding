#!/usr/bin/env bash
# Runs README quickstart blocks in order (Docker Compose on local host).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${root}/../../.." && pwd)"

if [[ -z "${SRC:-}" ]]; then
  SRC="$(mktemp -d /tmp/dc-agent-runtime-e2e-src-XXXXXX)"
fi
export SRC
export DC_UID="${DC_UID:-$(id -u)}"
export DC_AGENT_IMAGE="${DC_AGENT_IMAGE:-dc-agent-runtime:e2e-local}"
export DC_AGENT_NAME="${DC_AGENT_NAME:-dc-agent-runtime-e2e-local}"
export DC_AGENT_PORT="${DC_AGENT_PORT:-18400}"
if [[ -z "${DC_AGENT_HOME:-}" ]]; then
  DC_AGENT_HOME="$(mktemp -d /tmp/dc-agent-runtime-e2e-home-XXXXXX)"
  export DC_AGENT_HOME
  home_owner="$(stat -c '%u' "$DC_AGENT_HOME")"
  if [[ "$home_owner" != "$DC_UID" ]]; then
    echo "guide-quickstart-e2e: temp home uid ${home_owner} != DC_UID ${DC_UID}" >&2
    exit 1
  fi
fi
export DC_AGENT_HOME

echo "=== E2E: archive + docker build ==="
git -C "${repo_root}" archive HEAD | tar -x -C "${SRC}"
docker build -f "${SRC}/deploy/container/agent-runtime/Containerfile" \
  --build-arg "DC_UID=${DC_UID}" \
  -t "${DC_AGENT_IMAGE}" "${SRC}"
docker run --rm --entrypoint node "${DC_AGENT_IMAGE}" --version | grep -q v22.23.3

echo "=== E2E: bootstrap ownership proof (no systemd PID 1) ==="
"${root}/bootstrap-ownership-image-proof.sh" "${DC_AGENT_IMAGE}"

echo "=== E2E: home + release ==="
if [[ ! -d "${DC_AGENT_HOME}" ]]; then
  "${root}/prepare-agent-home.sh" "${DC_AGENT_HOME}" "${DC_UID}"
fi
HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id A --source "${SRC}" --bun-version 1.3.14

echo "=== E2E: docker compose ==="
cd "${SRC}/deploy/container/agent-runtime"
docker compose up -d
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
docker port "${DC_AGENT_NAME}" | grep -q 127.0.0.1

echo "=== E2E: npm + uv (split commands) ==="
docker exec -u dc "${DC_AGENT_NAME}" npm install -g cowsay
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'export PATH="/home/dc/.local/bin:$PATH"; uv --version'

uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemd-run --user --wait --pipe \
  --setenv=PATH=/home/dc/.local/bin:/usr/local/bin:/usr/bin \
  which cowsay

echo "=== E2E: recoll token ==="
docker exec -u dc "${DC_AGENT_NAME}" recollq -c /home/dc/.recoll \
  -e 'dc-agent-runtime-recoll-token' | grep -q dc-agent-runtime-recoll-token

echo "guide-quickstart-e2e: ok"
