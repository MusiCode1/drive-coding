#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bootstrap="${root}/bootstrap-user-home.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

home="$tmpdir/dc-home"
mkdir -p "$home"

"$bootstrap" "$home"

sample="${home}/.recoll/example-docs/runtime-sample.md"
if [[ ! -f "$sample" ]]; then
  echo "bootstrap-user-home.test: sample doc missing" >&2
  exit 1
fi

if ! grep -q 'dc-agent-runtime-recoll-token' "$sample"; then
  echo "bootstrap-user-home.test: recoll token missing" >&2
  exit 1
fi

marker="${home}/.recoll/preserve-me"
echo keep >"$marker"
"$bootstrap" "$home"
if [[ "$(cat "$marker")" != "keep" ]]; then
  echo "bootstrap-user-home.test: existing file was overwritten" >&2
  exit 1
fi

echo "bootstrap-user-home.test: ok"
