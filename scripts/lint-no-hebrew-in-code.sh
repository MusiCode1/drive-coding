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

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$REPO_ROOT/scripts/lint-no-hebrew-in-code.py" "$@"
