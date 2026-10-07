#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
podman_run="${root}/podman-run.sh"

fail() {
  echo "policy.test: $*" >&2
  exit 1
}

# podman-run validation must run before any podman call.
if [[ -f "$podman_run" ]]; then
  if env -u DC_AGENT_NAME -u DC_AGENT_HOME DC_UID=1000 bash "$podman_run" 2>/dev/null; then
    fail "podman-run.sh should fail when DC_AGENT_NAME/DC_AGENT_HOME are missing"
  fi
  if env DC_AGENT_NAME=test DC_UID=1000 bash "$podman_run" 2>/dev/null; then
    fail "podman-run.sh should fail when DC_AGENT_HOME is missing"
  fi
fi

while IFS= read -r -d '' file; do
  base="$(basename "$file")"
  case "$base" in
    *.test.sh | policy.test.sh)
      continue
      ;;
  esac
  if grep -qE 'privileged:[[:space:]]*true' "$file" 2>/dev/null; then
    fail "privileged: true in ${file#$root/}"
  fi
  if grep -q '/sys/fs/cgroup' "$file" 2>/dev/null; then
    fail "/sys/fs/cgroup reference in ${file#$root/}"
  fi
  if grep -qE '/home/[a-zA-Z0-9_-]+/Projects/' "$file" 2>/dev/null; then
    fail "developer Projects path in ${file#$root/}"
  fi
  if grep -qE '(violate|mission)[0-9]+' "$file" 2>/dev/null; then
    fail "private host label in ${file#$root/}"
  fi
  if grep -qE 'chown[[:space:]]+-R' "$file" 2>/dev/null; then
    fail "chown -R in ${file#$root/}"
  fi
done < <(find "$root" -type f -print0)

containerfile="${root}/Containerfile"
if [[ -f "$containerfile" ]]; then
  grep -q 'debian:bookworm@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858' "$containerfile" ||
    fail "Containerfile missing pinned debian digest"
  if grep -qE 'apt-get install.*\bnodejs\b' "$containerfile" 2>/dev/null; then
    fail "Containerfile must not apt-install nodejs"
  fi
  if grep -qE 'apt-get install.*\bnpm\b' "$containerfile" 2>/dev/null; then
    fail "Containerfile must not apt-install npm"
  fi
  grep -q '22.23.3' "$containerfile" || fail "Containerfile missing Node 22.23.3"
  grep -q 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de' "$containerfile" ||
    fail "Containerfile missing Node tarball SHA-256"
fi

compose="${root}/compose.yaml"
if [[ -f "$compose" ]]; then
  grep -q 'writable-cgroups=true' "$compose" || fail "compose.yaml missing writable-cgroups=true"
  grep -qE 'cgroup:[[:space:]]*private' "$compose" || fail "compose.yaml missing cgroup: private"
  if grep -qE 'cap_add|cap-add' "$compose" 2>/dev/null; then
    fail "compose.yaml must not use cap_add"
  fi
  if grep -qi 'apparmor' "$compose" 2>/dev/null; then
    fail "compose.yaml must not override AppArmor"
  fi
  if grep -qE '^[[:space:]]*PORT:' "$compose" 2>/dev/null; then
    fail "compose.yaml must not set PORT to host mapping"
  fi
fi

podman_run="${root}/podman-run.sh"
if [[ -f "$podman_run" ]] && grep -qE '\-e[[:space:]]*"?PORT=' "$podman_run" 2>/dev/null; then
  fail "podman-run.sh must not pass PORT=hostport"
fi

echo "policy.test: ok"
