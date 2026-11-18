#!/usr/bin/env bash
# Isolate Compose state per trial — default project name follows DC_AGENT_NAME.
# Validates every variable compose.yaml reads. DC_AGENT_IMAGE has no silent
# default here (unlike compose.yaml's own `:local` fallback): a stale or
# unset value would point `docker compose up/--force-recreate` at whichever
# tag happens to exist (there are commonly several `dc-agent-runtime:*` tags
# on a dev host) without any error -- exactly the silent-wrong-tag failure
# mode compose.yaml's own default can't catch.
set -euo pipefail

[[ -n "${DC_AGENT_NAME:-}" ]] || {
  echo "compose-project: DC_AGENT_NAME is required" >&2
  exit 1
}

[[ -n "${DC_AGENT_HOME:-}" ]] || {
  echo "compose-project: DC_AGENT_HOME is required" >&2
  exit 1
}

[[ -n "${DC_AGENT_IMAGE:-}" ]] || {
  echo "compose-project: DC_AGENT_IMAGE is required (no silent default)" >&2
  exit 1
}

export DC_AGENT_IMAGE
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${DC_AGENT_NAME}}"
