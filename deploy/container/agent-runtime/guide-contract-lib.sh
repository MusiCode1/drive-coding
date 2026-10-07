#!/usr/bin/env bash
# Shared checks for the Docker and Podman runtime test scripts (see TESTING.md).
# Checks cover selected installation and persistence contracts; they do not
# execute the README verbatim or authenticate with a provider.
#
# Caller must set before sourcing/calling: ENGINE, root (this dir), SRC,
# DC_AGENT_NAME, DC_AGENT_HOME, DC_AGENT_PORT, DC_UID, DC_AGENT_IMAGE.
set -euo pipefail
# 🛑 Without this, `errexit` does NOT propagate into a function run via
# command substitution (bash gives that subshell its own, unset -e state
# unless inherit_errexit is on). Measured: `set -euo pipefail; f(){ false;
# printf accepted; }; result=$(f)` prints "accepted" with exit 0 -- a failing
# assertion earlier in a multi-statement function is invisible once a later
# statement succeeds. gate_systemd_pid1_linger_uid is called as
# `dc_uid="$(gate_systemd_pid1_linger_uid)"` and is exactly this shape.
shopt -s inherit_errexit

eng() {
  if [[ "$ENGINE" == podman ]]; then
    podman "$@"
  else
    docker "$@"
  fi
}

gate_log() { echo "=== GATE (${ENGINE}): $* ==="; }

# Aborts loudly instead of letting install/backup run out of disk mid-way.
require_free_space_mb() {
  local path="$1" need_mb="$2" avail_kb avail_mb
  avail_kb="$(df -Pk "$path" | awk 'NR==2{print $4}')"
  avail_mb=$((avail_kb / 1024))
  if ((avail_mb < need_mb)); then
    echo "require_free_space_mb: need ~${need_mb}MB free at ${path}, have ${avail_mb}MB" >&2
    exit 1
  fi
  echo "require_free_space_mb: ok (${avail_mb}MB free >= ${need_mb}MB needed at ${path})" >&2
}

# Refuse existing release directories: processes may still use their code or
# interpreter. Pick a fresh id instead of inferring liveness from /proc access.
require_free_release_slot() {
  local id="$1"
  local dir="${DC_AGENT_HOME}/releases/${id}"
  if [[ -e "$dir" ]]; then
    echo "require_free_release_slot: releases/${id} already exists -- refusing to touch it." >&2
    echo "require_free_release_slot: set DC_RELEASE_B_ID to an id that has never been used." >&2
    exit 1
  fi
}

# MainPID of a transient --user unit.
unit_pid() {
  local uid="$1" unit="$2"
  eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user show "${unit}" -p MainPID --value | tr -d '[:space:]'
}

# Scope fixture units to one run; a loaded or failed unit cannot be reused.
# Both units share DC_FIXTURE_RUN_ID, with distinct suffixes.
fixture_unit_name() {
  local pair="$1" # "a" or "b"
  printf 'dc-fixture-hold-%s-%s' "${DC_FIXTURE_RUN_ID:?DC_FIXTURE_RUN_ID must be set}" "$pair"
}

# Starts fixture-hold.js as a transient --user unit, bound to $DC_RELEASE as
# it resolves *right now* (so calling this while backend is on B starts a
# fixture running release B's bun, not A's). reset-failed first is safe and
# never touches another run's unit: the name itself is this run's own
# (fixture_unit_name), so a leftover `failed` record under that exact name
# can only be this run's own retry, never someone else's.
start_fixture_unit() {
  local uid="$1" unit="$2" release
  eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user reset-failed "${unit}" >/dev/null 2>&1 || true
  release="$(eng exec -u dc "${DC_AGENT_NAME}" bash -lc \
    'source ~/.config/drive-coding/release.env && echo "$DC_RELEASE"')"
  eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemd-run --user --unit="${unit}" \
    "${release}/.runtime/bin/bun" /usr/local/lib/dc-agent-runtime/fixture-hold.js
}

# Stops and clears a fixture unit *this run created* (never a fixed/shared
# name) so it doesn't sit `loaded failed` and isn't left for a future run
# to trip over, even if that future run happens to reuse the same
# DC_FIXTURE_RUN_ID on purpose.
stop_fixture_unit() {
  local uid="$1" unit="$2"
  eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user stop "${unit}" || true
  eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user reset-failed "${unit}" >/dev/null 2>&1 || true
}

gate_health() {
  local i health_body fe_body port_body
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done
  # curl into a variable first, THEN grep -- `curl | grep -q` risks SIGPIPE
  # (curl exit 23) when grep exits right after its first match, under pipefail.
  health_body="$(curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health")"
  printf '%s' "$health_body" | grep -q '"status":"ok"'
  fe_body="$(curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/")"
  printf '%s' "$fe_body" | grep -qi '<!doctype html>'
  port_body="$(eng port "${DC_AGENT_NAME}")"
  printf '%s' "$port_body" | grep -q 127.0.0.1
}

# Echoes the in-container uid of `dc` on success. Called as
# `dc_uid="$(gate_systemd_pid1_linger_uid)"` -- every assertion below is
# explicit (`|| exit 1`), not a bare statement relying on inherited errexit,
# so a failure can never be masked by this function's own later success.
gate_systemd_pid1_linger_uid() {
  local comm linger_list
  comm="$(eng exec "${DC_AGENT_NAME}" cat /proc/1/comm)"
  printf '%s' "$comm" | grep -q systemd || {
    echo "gate_systemd: PID 1 comm is not systemd (${comm})" >&2
    exit 1
  }
  linger_list="$(eng exec "${DC_AGENT_NAME}" ls /var/lib/systemd/linger/)"
  printf '%s' "$linger_list" | grep -q dc || {
    echo "gate_systemd: dc not in /var/lib/systemd/linger/ (${linger_list})" >&2
    exit 1
  }
  local uid mp mp_uid no_mgr
  uid="$(eng exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid | tr -d '[:space:]')"
  mp="$(eng exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value | tr -d '[:space:]')"
  mp_uid="$(eng exec "${DC_AGENT_NAME}" stat -c '%u' "/proc/${mp}")"
  [[ "$mp_uid" == "$uid" ]] || {
    echo "gate_systemd: MainPID uid ${mp_uid} != dc uid ${uid}" >&2
    exit 1
  }
  no_mgr="$(eng exec "${DC_AGENT_NAME}" journalctl -u dc-agent-runtime 2>/dev/null | grep -c 'no systemd user manager' || true)"
  [[ "$no_mgr" -eq 0 ]] || {
    echo "gate_systemd: journal contains 'no systemd user manager' (${no_mgr}x)" >&2
    exit 1
  }
  printf '%s' "$uid"
}

gate_user_tools() {
  local uid="$1"
  eng exec -u dc "${DC_AGENT_NAME}" npm install -g cowsay @openai/codex
  eng exec -u dc "${DC_AGENT_NAME}" bash -lc 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
  eng exec -u dc "${DC_AGENT_NAME}" bash -lc 'export PATH="/home/dc/.local/bin:$PATH"; uv tool install --python 3.12 ruff'
  "${root}/user-unit-tool-check.sh" "$ENGINE" "${DC_AGENT_NAME}" "$uid"
}

gate_provider_cli() {
  # Load the user's PATH; verify CLI availability and help, without logging in.
  eng exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex --version'
  eng exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex login --help' | grep -F device-auth
}

# Proves a recoll query does not touch index metadata (no reindex-on-query).
gate_recoll() {
  local before after query_out
  before="$("${root}/recoll-path-meta.sh" "${DC_AGENT_HOME}")"
  query_out="$(eng exec -u dc "${DC_AGENT_NAME}" recollq -c /home/dc/.recoll \
    -e 'dc-agent-runtime-recoll-token')"
  printf '%s' "$query_out" | grep -q dc-agent-runtime-recoll-token
  after="$("${root}/recoll-path-meta.sh" "${DC_AGENT_HOME}")"
  [[ "$before" == "$after" ]] || {
    echo "gate_recoll: recoll path metadata changed across a query" >&2
    diff <(printf '%s' "$before") <(printf '%s' "$after") >&2 || true
    exit 1
  }
}

gate_fixture() {
  local uid="$1" unit_a state
  unit_a="$(fixture_unit_name a)"
  start_fixture_unit "$uid" "$unit_a"
  state="$(eng exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user is-active "$unit_a")"
  printf '%s' "$state" | grep -q active
}

# Five-point A -> B -> A, anchored on exe/maps/cmdline with -u dc:
#   1. backend on A        2. fixture-A on A (started by gate_fixture, same PID throughout)
#   3. backend swaps to B, *fixture-A stays the same PID and exe A* (decoupled from the backend unit)
#   4. a brand-new fixture-B is started *while backend is on B* and its exe resolves to B
#      — proving both generations side by side, not just that the old one survives
#   5. backend rolls back to A; fixture-A still unchanged; fixture-B is stopped (test-only)
# Requires gate_fixture to have been run first (same uid). Installs a real
# release B (bun install + FE build). `du -sm releases/A` is a *correct upper
# bound* but can badly overstate the real new disk need: `bun install`
# hardlinks from its package cache (location follows $BUN_INSTALL if set,
# not $HOME), so a second release sharing that cache mostly adds directory
# entries, not new bytes. Default stays the conservative full-A-size
# estimate; override DC_RELEASE_B_MIN_MB only after confirming the cache is
# actually warm and shared (e.g. `stat -c %h` on a node_modules file shows
# nlink > 1 into $BUN_INSTALL/install/cache, not a per-release-home cache).
gate_release_swap() {
  local uid="$1"
  local b_id pid_a fix_a_pid fix_a_pid_b fix_a_pid_back fix_b_pid pid_b pid_back rollback_env a_size_mb min_mb

  # A fresh id by default (never reused across runs) -- set DC_RELEASE_B_ID
  # explicitly to pin it. Either way, require_free_release_slot refuses
  # outright if that exact id is already on disk; nothing here ever moves
  # or deletes existing material.
  b_id="${DC_RELEASE_B_ID:-B-$(date -u +%Y%m%dT%H%M%SZ)}"
  require_free_release_slot "$b_id"

  a_size_mb="$(du -sm "${DC_AGENT_HOME}/releases/A" 2>/dev/null | awk '{print $1}')"
  min_mb="${DC_RELEASE_B_MIN_MB:-${a_size_mb:-2048}}"
  require_free_space_mb "$(dirname "${DC_AGENT_HOME}")" "$min_mb"

  local unit_a unit_b
  unit_a="$(fixture_unit_name a)"
  unit_b="$(fixture_unit_name b)"

  pid_a="$(eng exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value | tr -d '[:space:]')"
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_a}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

  fix_a_pid="$(unit_pid "$uid" "$unit_a")"
  [[ -n "$fix_a_pid" && "$fix_a_pid" != 0 ]] || {
    echo "gate_release_swap: fixture-A MainPID missing — run gate_fixture first" >&2
    exit 1
  }
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_a_pid}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

  HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
    --id "$b_id" --source "${SRC}" --bun-version 1.3.14
  eng exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
  gate_health
  pid_b="$(eng exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value | tr -d '[:space:]')"
  [[ "$pid_b" != "$pid_a" ]] || {
    echo "gate_release_swap: backend MainPID did not change A -> ${b_id}" >&2
    exit 1
  }
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_b}/exe" | grep -F "/home/dc/releases/${b_id}/.runtime/bin/bun"
  eng exec -u dc "${DC_AGENT_NAME}" bash -lc "tr '\\0' ' ' </proc/${pid_b}/cmdline" | grep -F "/home/dc/releases/${b_id}/.runtime/bin/bun"
  eng exec -u dc "${DC_AGENT_NAME}" grep -F "/home/dc/releases/${b_id}/.runtime/bin/bun" "/proc/${pid_b}/maps"

  # fixture-A: untouched by the backend swap (same PID, exe still release A)
  fix_a_pid_b="$(unit_pid "$uid" "$unit_a")"
  [[ "$fix_a_pid_b" == "$fix_a_pid" ]] || {
    echo "gate_release_swap: fixture-A PID changed across backend swap A->${b_id} (${fix_a_pid} -> ${fix_a_pid_b})" >&2
    exit 1
  }
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_a_pid_b}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

  # fixture-B: a *new* unit started now, while $DC_RELEASE resolves to the new
  # id — both generations exist side by side, proving new fixtures pick up
  # the current release.
  start_fixture_unit "$uid" "$unit_b"
  fix_b_pid="$(unit_pid "$uid" "$unit_b")"
  [[ -n "$fix_b_pid" && "$fix_b_pid" != 0 ]] || {
    echo "gate_release_swap: fixture-B MainPID missing after start_fixture_unit" >&2
    exit 1
  }
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_b_pid}/exe" | grep -F "/home/dc/releases/${b_id}/.runtime/bin/bun"

  rollback_env="$(mktemp "${DC_AGENT_HOME}/.config/drive-coding/release.env.XXXXXX")"
  printf 'DC_RELEASE=%s\n' /home/dc/releases/A >"$rollback_env"
  chmod 600 "$rollback_env"
  mv -f "$rollback_env" "${DC_AGENT_HOME}/.config/drive-coding/release.env"
  eng exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
  gate_health
  pid_back="$(eng exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value | tr -d '[:space:]')"
  eng exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_back}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

  fix_a_pid_back="$(unit_pid "$uid" "$unit_a")"
  [[ "$fix_a_pid_back" == "$fix_a_pid" ]] || {
    echo "gate_release_swap: fixture-A PID changed across rollback ${b_id}->A (${fix_a_pid} -> ${fix_a_pid_back})" >&2
    exit 1
  }

  # fixture-A is left running: it's still live evidence (same unit, same PID)
  # that the backend swap/rollback never touched it. Only fixture-B, a
  # test-only artifact of this function, is cleaned up here.
  stop_fixture_unit "$uid" "$unit_b"
}

# Recreate the container (not just restart the unit): an *existing* sentinel
# file on the bind home is mutated, and its exact content + ownership/mode
# (not a substring grep) must round-trip; recoll metadata must be untouched;
# installed tools must persist.
gate_recreate() {
  local sentinel="${DC_AGENT_HOME}/.dc-recreate-sentinel"
  local before before_stat after after_stat recoll_before recoll_after uid

  [[ -f "$sentinel" ]] || printf 'dc-recreate-sentinel\n' >"$sentinel"
  printf 'recreate-%s\n' "$(date -u +%s)" >>"$sentinel"
  before="$(cat "$sentinel")"
  before_stat="$(stat -c '%u:%g:%a' "$sentinel")"
  recoll_before="$("${root}/recoll-path-meta.sh" "${DC_AGENT_HOME}")"

  if [[ "$ENGINE" == podman ]]; then
    podman rm -f "${DC_AGENT_NAME}" >/dev/null
    "${root}/podman-run.sh"
  else
    (cd "${root}" && source ./compose-project.sh && docker compose up -d --force-recreate)
  fi

  gate_health

  after="$(cat "$sentinel")"
  after_stat="$(stat -c '%u:%g:%a' "$sentinel")"
  [[ "$after" == "$before" ]] || {
    echo "gate_recreate: sentinel content changed across recreate" >&2
    diff <(printf '%s' "$before") <(printf '%s' "$after") >&2 || true
    exit 1
  }
  [[ "$after_stat" == "$before_stat" ]] || {
    echo "gate_recreate: sentinel ownership/mode changed (${before_stat} -> ${after_stat})" >&2
    exit 1
  }

  recoll_after="$("${root}/recoll-path-meta.sh" "${DC_AGENT_HOME}")"
  [[ "$recoll_before" == "$recoll_after" ]] || {
    echo "gate_recreate: recoll metadata changed across container recreate" >&2
    exit 1
  }

  eng exec -u dc "${DC_AGENT_NAME}" bash -lc \
    'command -v cowsay >/dev/null && command -v uv >/dev/null && command -v codex >/dev/null'
  uid="$(eng exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid | tr -d '[:space:]')"
  "${root}/user-unit-tool-check.sh" "$ENGINE" "${DC_AGENT_NAME}" "$uid"
}

# Backup (stop) / restore, compared with tree-sha256.sh. DC_BACKUP_DIR picks
# where the .tgz is written and DC_RESTORE_DIR where it is extracted back to
# (both default to next to DC_AGENT_HOME) — override either when that
# filesystem is tight (e.g. a tmpfs backup dir, a separate restore disk). Each
# target's *own* free space is checked, not DC_AGENT_HOME's filesystem, so a
# tgz routed to e.g. /dev/shm doesn't get budgeted against the wrong disk. The
# experiment is always restarted before this function returns or exits, even
# if tar/hash fails mid-way; the backup tgz uses a unique mktemp name so it
# never collides with (or deletes) a pre-existing one.
gate_backup_restore() {
  local hash_live hash_restored restore_parent restored tgz backup_dir restore_dir home_size_mb rc

  home_size_mb="$(du -sm "${DC_AGENT_HOME}" 2>/dev/null | awk '{print $1}')"
  home_size_mb="${home_size_mb:-1}"
  backup_dir="${DC_BACKUP_DIR:-$(dirname "${DC_AGENT_HOME}")}"
  restore_dir="${DC_RESTORE_DIR:-$(dirname "${DC_AGENT_HOME}")}"
  mkdir -p "$backup_dir" "$restore_dir"
  require_free_space_mb "$backup_dir" "$home_size_mb"
  require_free_space_mb "$restore_dir" "$home_size_mb"

  tgz="$(mktemp "${backup_dir}/dc-agent-home-backup-XXXXXX.tgz")"

  stop_experiment() {
    if [[ "$ENGINE" == podman ]]; then
      podman stop "${DC_AGENT_NAME}"
    else
      (cd "${root}" && source ./compose-project.sh && docker compose stop)
    fi
  }
  start_experiment() {
    if [[ "$ENGINE" == podman ]]; then
      podman start "${DC_AGENT_NAME}"
    else
      (cd "${root}" && source ./compose-project.sh && docker compose start)
    fi
  }

  stop_experiment

  rc=0
  hash_live="$("${root}/tree-sha256.sh" "${DC_AGENT_HOME}")" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    tar -C "$(dirname "${DC_AGENT_HOME}")" -czf "$tgz" "$(basename "${DC_AGENT_HOME}")" || rc=$?
  fi

  start_experiment
  gate_health

  if [[ "$rc" -ne 0 ]]; then
    rm -f "$tgz"
    echo "gate_backup_restore: backup step failed, experiment restarted" >&2
    exit 1
  fi

  restore_parent="$(mktemp -d "${restore_dir}/dc-agent-restore-parent-XXXXXX")"
  rc=0
  tar -C "${restore_parent}" -xzf "$tgz" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    restored="${restore_parent}/$(basename "${DC_AGENT_HOME}")"
    hash_restored="$("${root}/tree-sha256.sh" "${restored}")" || rc=$?
  fi

  # `hash_restored` is only ever referenced below the rc check now -- it is
  # declared via `local` but, on a tar/hash failure, never assigned, and
  # under `set -u` a bare `${hash_restored}` expansion there is itself a
  # fatal "unbound variable" that aborts the function *before* the intended
  # "restore step failed" message prints (and loses hash_live along with
  # it). rc=0 is the only path where hash_restored is guaranteed set.
  rm -rf "${restore_parent}" "$tgz"

  if [[ "$rc" -ne 0 ]]; then
    echo "gate_backup_restore: restore step failed (hash_live=${hash_live})" >&2
    exit 1
  fi

  # Log both hashes -- rc=0 alone proves nothing to a reader of the log; the
  # actual values are the evidence, and restore_parent/tgz are already gone.
  echo "gate_backup_restore: hash_live=${hash_live} hash_restored=${hash_restored}" >&2

  [[ "$hash_live" == "$hash_restored" ]] || {
    echo "gate_backup_restore: tree-sha256 MISMATCH live=${hash_live} restored=${hash_restored}" >&2
    exit 1
  }
  echo "gate_backup_restore: match confirmed (live == restored)" >&2
}

gate_image_baked_hashes() {
  bash "${root}/image-baked-hashes.sh" "${SRC}" "${DC_UID}" "${DC_AGENT_IMAGE}" "${ENGINE}"
}
