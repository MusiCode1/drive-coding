#!/usr/bin/env bash
# B4 consumer mutation red/green proofs (brief §8.5). Run from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FE="$ROOT/packages/frontend"
LOG_DIR="${LOG_DIR:-/tmp/dc-b4-mutation-proofs}"
mkdir -p "$LOG_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$LOG_DIR/.mutation-backup-$$"
mkdir -p "$BACKUP"

ACTIVE_SOURCE=""
restore() {
  if [[ -n "$ACTIVE_SOURCE" ]]; then
    cp -- "$BACKUP/product.ts" "$ACTIVE_SOURCE"
    ACTIVE_SOURCE=""
  fi
}
cleanup() {
  restore
  rm -f -- "$BACKUP/product.ts"
  rmdir -- "$BACKUP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_case() {
  local name="$1"
  local patch_fn="$2"
  local test_file="$3"
  local source_file="$4"
  local log_red="$LOG_DIR/${TS}-${name}-red.log"
  local log_green="$LOG_DIR/${TS}-${name}-green.log"
  ACTIVE_SOURCE="$ROOT/$source_file"
  cp -- "$ACTIVE_SOURCE" "$BACKUP/product.ts"
  echo "=== $name RED ===" | tee "$log_red"
  "$patch_fn"
  if cmp -s "$ACTIVE_SOURCE" "$BACKUP/product.ts"; then
    echo "FAIL $name: mutation did not change product" >&2
    exit 1
  fi
  set +e
  (cd "$FE" && bunx vitest run "$test_file" 2>&1) | tee -a "$log_red"
  local rc_red="${PIPESTATUS[0]}"
  set -e
  echo "rc=$rc_red" | tee -a "$log_red"
  restore
  echo "=== $name GREEN ===" | tee "$log_green"
  set +e
  (cd "$FE" && bunx vitest run "$test_file" 2>&1) | tee -a "$log_green"
  local rc_green="${PIPESTATUS[0]}"
  set -e
  echo "rc=$rc_green" | tee -a "$log_green"
  if [[ "$rc_red" -eq 0 || "$rc_green" -ne 0 ]] || ! grep -q 'AssertionError:' "$log_red"; then
    echo "FAIL $name: expected assertion red rc!=0 and green rc=0 (got red=$rc_red green=$rc_green)" >&2
    exit 1
  fi
  echo "OK $name"
}

patch_close_noop() {
  python3 - <<'PY'
from pathlib import Path
p = Path("packages/frontend/src/lib/session/ws-connection.ts")
text = p.read_text()
start = text.index("  close(mode: CloseMode): void {")
end = text.index("\n  async reconnect():", start)
p.write_text(text[:start] + "  close(_mode: CloseMode): void {\n    return\n  }\n\n" + text[end + 1 :])
PY
}

patch_late_guard() {
  sed -i 's/if (this.#discardLate(epoch, { createdAgentId })) return/if (false \&\& this.#discardLate(epoch, { createdAgentId })) return/' \
    "$ROOT/packages/frontend/src/lib/session/ws-connection.ts"
}

patch_pending_noop() {
  sed -i '/^export function cancelPendingDialogs/,/^}$/c\
export function cancelPendingDialogs(_deps: PendingRequestDeps): void {\
  return\
}' "$ROOT/packages/frontend/src/lib/view-models/agent-session-pending.ts"
}

cd "$ROOT"
run_case close-noop patch_close_noop "src/lib/view-models/agent-session-owner-consumer.test.svelte.ts" "packages/frontend/src/lib/session/ws-connection.ts"
run_case late-guard patch_late_guard "src/lib/view-models/agent-session-late-setup.test.svelte.ts" "packages/frontend/src/lib/session/ws-connection.ts"
run_case pending-noop patch_pending_noop "src/lib/view-models/agent-session-owner-consumer.test.svelte.ts" "packages/frontend/src/lib/view-models/agent-session-pending.ts"

echo "All mutation proofs OK — logs under $LOG_DIR"
