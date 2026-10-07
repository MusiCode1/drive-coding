#!/usr/bin/env bash
# Runs every README quickstart contract gate, in README order (Podman engine).
# Image must already exist locally or be loadable via DC_IMAGE_TAR.
# Set DC_SKIP_HOME=1 to reuse an already-running DC_AGENT_NAME/DC_AGENT_HOME.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${root}/../../.." && pwd)"
ENGINE=podman
# shellcheck source=guide-contract-lib.sh
source "${root}/guide-contract-lib.sh"

if [[ -z "${SRC:-}" ]]; then
  SRC="$(mktemp -d /tmp/dc-agent-runtime-podman-src-XXXXXX)"
fi
export SRC
# A fresh id per invocation (unless the caller pins one) -- fixture unit
# names are built from this, so two runs never collide on a `loaded`/`failed`
# systemd --user unit left by the previous one.
export DC_FIXTURE_RUN_ID="${DC_FIXTURE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export DC_UID="${DC_UID:-$(id -u)}"
export DC_AGENT_IMAGE="${DC_AGENT_IMAGE:-dc-agent-runtime:podman-e2e}"
export DC_AGENT_NAME="${DC_AGENT_NAME:-dc-agent-runtime-podman-e2e}"
export DC_AGENT_PORT="${DC_AGENT_PORT:-18409}"
export DC_IMAGE_TAR="${DC_IMAGE_TAR:-}"

if [[ -n "$DC_IMAGE_TAR" && -f "$DC_IMAGE_TAR" ]]; then
  gate_log "load image"
  podman load -i "$DC_IMAGE_TAR"
fi

if ! podman image exists "${DC_AGENT_IMAGE}" 2>/dev/null; then
  echo "guide-podman-e2e: missing image ${DC_AGENT_IMAGE} (build or set DC_IMAGE_TAR)" >&2
  exit 1
fi

gate_log "archive source (always — helper scripts run from here)"
git -C "${repo_root}" archive HEAD | tar -x -C "${SRC}"

gate_log "image baked-content == source archive"
gate_image_baked_hashes

if [[ -z "${DC_AGENT_HOME:-}" ]]; then
  DC_AGENT_HOME="$(mktemp -d /tmp/dc-agent-runtime-podman-e2e-home-XXXXXX)"
  export DC_AGENT_HOME
  home_owner="$(stat -c '%u' "$DC_AGENT_HOME")"
  if [[ "$home_owner" != "$DC_UID" ]]; then
    echo "guide-podman-e2e: temp home uid ${home_owner} != DC_UID ${DC_UID}" >&2
    exit 1
  fi
fi
export DC_AGENT_HOME

skipped=()

if [[ "${DC_SKIP_HOME:-0}" != 1 ]]; then
  gate_log "home + release A"
  [[ -d "${DC_AGENT_HOME}" ]] || "${root}/prepare-agent-home.sh" "${DC_AGENT_HOME}" "${DC_UID}"
  HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
    --id A --source "${SRC}" --bun-version 1.3.14
  gate_log "podman-run"
  export DC_AGENT_IMAGE DC_AGENT_HOME DC_AGENT_NAME DC_AGENT_PORT DC_UID
  "${root}/podman-run.sh"
else
  gate_log "skip home/release/run (DC_SKIP_HOME=1) — reuse running ${DC_AGENT_NAME}"
  skipped+=("home+release-A+podman-run")
fi

gate_log "health + FE"
gate_health

gate_log "systemd PID1 / linger / dc uid"
dc_uid="$(gate_systemd_pid1_linger_uid)"

gate_log "user tools (npm cowsay+codex, uv, uv tool ruff) + user-unit-tool-check"
gate_user_tools "$dc_uid"

gate_log "provider auth (codex --version, login --help device-auth)"
gate_provider_auth

gate_log "recoll query does not touch index metadata"
gate_recoll

gate_log "fixture (transient --user unit survives independently of this shell)"
gate_fixture "$dc_uid"

gate_log "release swap A -> B -> A (exe/maps/cmdline anchors, -u dc)"
gate_release_swap "$dc_uid"

gate_log "recreate container (sentinel + recoll meta + tools persist)"
gate_recreate

gate_log "backup/restore (tree-sha256)"
gate_backup_restore

# 🛑 Same rule as guide-quickstart-e2e.sh: a DC_SKIP_* run is not a pass of
# the full contract. Printing "ok" here for a skipped-home run would make
# the two harnesses draw opposite conclusions from the same flag.
if [[ "${#skipped[@]}" -gt 0 ]]; then
  echo "guide-podman-e2e: PARTIAL — skipped gates: ${skipped[*]}"
  exit 2
fi
echo "guide-podman-e2e: ok"
