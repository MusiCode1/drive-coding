#!/usr/bin/env bash
# Verify runtime installation and persistence contracts with Docker. See TESTING.md.
# Set DC_SKIP_BUILD=1 to reuse an already-built DC_AGENT_IMAGE (still proves
# baked content via image-baked-hashes.sh). Set DC_SKIP_HOME=1 to reuse an
# already-running DC_AGENT_NAME/DC_AGENT_HOME instead of creating a fresh one.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${root}/../../.." && pwd)"
ENGINE=docker
# shellcheck source=guide-contract-lib.sh
source "${root}/guide-contract-lib.sh"

if [[ -z "${SRC:-}" ]]; then
  SRC="$(mktemp -d /tmp/dc-agent-runtime-e2e-src-XXXXXX)"
fi
export SRC
# A fresh id per invocation (unless the caller pins one) -- fixture unit
# names are built from this, so two runs never collide on a `loaded`/`failed`
# systemd --user unit left by the previous one.
export DC_FIXTURE_RUN_ID="${DC_FIXTURE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
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

skipped=()

gate_log "archive source (always — helper scripts run from here)"
git -C "${repo_root}" archive HEAD | tar -x -C "${SRC}"

if [[ "${DC_SKIP_BUILD:-0}" != 1 ]]; then
  gate_log "docker build"
  docker build -f "${SRC}/deploy/container/agent-runtime/Containerfile" \
    --build-arg "DC_UID=${DC_UID}" \
    -t "${DC_AGENT_IMAGE}" "${SRC}"
  docker run --rm --entrypoint node "${DC_AGENT_IMAGE}" --version | grep -q v22.23.3
  gate_log "bootstrap ownership proof (no systemd PID 1)"
  "${root}/bootstrap-ownership-image-proof.sh" "${DC_AGENT_IMAGE}"
else
  gate_log "skip build (DC_SKIP_BUILD=1) — reuse ${DC_AGENT_IMAGE}"
  docker image inspect "${DC_AGENT_IMAGE}" >/dev/null
  skipped+=("build+ownership-proof")
fi

gate_log "image baked-content == source archive"
gate_image_baked_hashes

if [[ "${DC_SKIP_HOME:-0}" != 1 ]]; then
  gate_log "home + release A"
  [[ -d "${DC_AGENT_HOME}" ]] || "${root}/prepare-agent-home.sh" "${DC_AGENT_HOME}" "${DC_UID}"
  HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
    --id A --source "${SRC}" --bun-version 1.3.14
  gate_log "docker compose up"
  (cd "${root}" && source ./compose-project.sh && docker compose up -d)
else
  gate_log "skip home/release/compose (DC_SKIP_HOME=1) — reuse running ${DC_AGENT_NAME}"
  skipped+=("home+release-A+compose-up")
fi

gate_log "health + FE"
gate_health

gate_log "systemd PID1 / linger / dc uid"
dc_uid="$(gate_systemd_pid1_linger_uid)"

gate_log "user tools (npm cowsay+codex, uv, uv tool ruff) + user-unit-tool-check"
gate_user_tools "$dc_uid"

gate_log "provider CLI availability (codex --version, device-auth help; no login)"
gate_provider_cli

gate_log "recoll query does not touch index metadata"
gate_recoll

gate_log "fixture (transient --user unit survives independently of this shell)"
gate_fixture "$dc_uid"

if [[ "${DC_SKIP_RELEASE_SWAP:-0}" != 1 ]]; then
  gate_log "release swap A -> B -> A (exe/maps/cmdline anchors, -u dc)"
  gate_release_swap "$dc_uid"
else
  gate_log "skip release swap (DC_SKIP_RELEASE_SWAP=1 — needs ~release-A-sized free disk for B)"
  skipped+=("release-swap-A-B-A")
fi

gate_log "recreate container (sentinel + recoll meta + tools persist)"
gate_recreate

if [[ "${DC_SKIP_BACKUP_RESTORE:-0}" != 1 ]]; then
  gate_log "backup/restore (tree-sha256)"
  gate_backup_restore
else
  gate_log "skip backup/restore (DC_SKIP_BACKUP_RESTORE=1 — needs ~home-sized free disk for the .tgz)"
  skipped+=("backup-restore")
fi

# 🛑 A DC_SKIP_* run is not a pass of the full contract — never print "ok" for
# it. Report skipped checks explicitly so a partial run is distinguishable
# from a complete one.
if [[ "${#skipped[@]}" -gt 0 ]]; then
  echo "guide-quickstart-e2e: PARTIAL — skipped gates: ${skipped[*]}"
  exit 2
fi
echo "guide-quickstart-e2e: ok"
