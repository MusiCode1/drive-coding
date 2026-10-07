#!/usr/bin/env bash
# Isolate Compose state per trial — default project name follows DC_AGENT_NAME.
# Validates every variable compose.yaml reads (DC_AGENT_NAME, DC_AGENT_HOME are
# required with no default there; DC_AGENT_IMAGE falls back to :local but a stale
# value here would silently point compose at the wrong tag).
set -euo pipefail

[[ -n "${DC_AGENT_NAME:-}" ]] || {
  echo "compose-project: DC_AGENT_NAME is required" >&2
  exit 1
}

[[ -n "${DC_AGENT_HOME:-}" ]] || {
  echo "compose-project: DC_AGENT_HOME is required" >&2
  exit 1
}

export DC_AGENT_IMAGE="${DC_AGENT_IMAGE:-dc-agent-runtime:local}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${DC_AGENT_NAME}}"
