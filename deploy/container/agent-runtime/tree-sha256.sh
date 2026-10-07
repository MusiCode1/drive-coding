#!/usr/bin/env bash
# Stable SHA-256 over a directory tree (relative paths, sorted, NUL-safe).
set -euo pipefail

root="${1:-}"
if [[ -z "$root" || ! -d "$root" ]]; then
  echo "tree-sha256: directory argument required" >&2
  exit 1
fi

root="$(cd "$root" && pwd)"

(
  cd "$root"
  find . -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    [[ -n "$rel" ]] || continue
    path="./${rel}"
    if [[ -L "$path" ]]; then
      printf 'symlink\0%s\0' "$rel"
      readlink -n "$path"
      printf '\0'
    elif [[ -f "$path" ]]; then
      printf 'file\0%s\0' "$rel"
      cat "$path"
      printf '\0'
    fi
  done
) | sha256sum | awk '{print $1}'
