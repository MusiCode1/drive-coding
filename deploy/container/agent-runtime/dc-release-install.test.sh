#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install="${root}/dc-release-install"

fail() {
  echo "dc-release-install.test: $*" >&2
  exit 1
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

export HOME="$tmpdir/home"
mkdir -p "$HOME/releases"
fake_src="$tmpdir/src"
mkdir -p "$fake_src"
touch "$fake_src/package.json" "$fake_src/bun.lock"

if env HOME="$HOME" "$install" --id '../evil' --source "$fake_src" 2>/dev/null; then
  fail "should reject traversal id"
fi

if env HOME="$HOME" "$install" --id A --source 'relative/path' 2>/dev/null; then
  fail "should reject relative source"
fi

if env HOME="$HOME" "$install" --id A --source "$fake_src" --bun-version 9.9.9 2>/dev/null; then
  fail "should reject unsupported bun version"
fi

echo "dc-release-install.test: ok"
