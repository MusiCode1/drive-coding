#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec_sh="${root}/dc-release-exec"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

export HOME="$tmpdir/home"
mkdir -p "$HOME/.config/drive-coding" "$HOME/.bun/bin" "$tmpdir/path-head/bin"

release="$HOME/releases/test-a"
mkdir -p "${release}/.runtime/bin" "${release}/packages/backend/src/bin" "${release}/packages/frontend/build"

release_bun="${release}/.runtime/bin/bun"
cat >"$release_bun" <<'EOS'
#!/usr/bin/env bash
echo release-bun-invoked >"${HOME}/.release-bun-hit"
exit 0
EOS
chmod +x "$release_bun"

touch "${release}/packages/backend/src/bin/drive-coding.ts"
touch "${release}/packages/backend/src/bin/agent-sidecar.ts"
mkdir -p "${release}/packages/frontend/build"

decoy() {
  cat >"$1" <<'EOS'
#!/usr/bin/env bash
echo decoy >"${HOME}/.decoy-bun-hit"
exit 9
EOS
  chmod +x "$1"
}

decoy "$HOME/.bun/bin/bun"
decoy "$tmpdir/path-head/bin/bun"

printf 'DC_RELEASE=%s\n' "$release" >"$HOME/.config/drive-coding/release.env"

export PATH="$tmpdir/path-head/bin:/usr/bin:/bin"
"$exec_sh" || true

if [[ -f "$HOME/.decoy-bun-hit" ]]; then
  echo "dc-release-exec.test: decoy bun was invoked" >&2
  exit 1
fi

if [[ ! -f "$HOME/.release-bun-hit" ]]; then
  echo "dc-release-exec.test: release bun was not invoked" >&2
  exit 1
fi

echo "dc-release-exec.test: ok"
