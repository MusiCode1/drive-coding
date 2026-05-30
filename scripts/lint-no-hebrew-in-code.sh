#!/usr/bin/env bash
# Block hardcoded Hebrew strings in source code.
#
# Hebrew text in the UI must come from `@drive-coding/core/i18n` (`t(key)`).
# This script enforces that by scanning source files for Hebrew inside string
# literals (single, double, or backtick quotes). Comments are allowed.
#
# Exit 0 = clean. Exit 1 = violations found.
#
# Scope: packages/frontend/, packages/core/, packages/backend/.
#
# Usage: scripts/lint-no-hebrew-in-code.sh
# Run from repo root.
#
# Implementation: pure-Node `.mjs` (no deps, no build). Falls back to bun, then
# to the legacy Python script, so the hook runs in any environment.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/scripts"

if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/lint-no-hebrew-in-code.mjs" "$@"
elif command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT_DIR/lint-no-hebrew-in-code.mjs" "$@"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 "$SCRIPT_DIR/lint-no-hebrew-in-code.py" "$@"
else
  echo "lint-no-hebrew: no node/bun/python3 runtime found" >&2
  exit 2
fi
