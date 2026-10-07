#!/usr/bin/env bash
# Isolate Compose state per trial — default project name follows DC_AGENT_NAME.
set -euo pipefail

[[ -n "${DC_AGENT_NAME:-}" ]] || {
  echo "compose-project: DC_AGENT_NAME is required" >&2
  exit 1
}

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${DC_AGENT_NAME}}"
