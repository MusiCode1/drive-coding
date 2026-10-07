#!/usr/bin/env bash
# Print inode, ctime, size, sha256 for recoll.conf and xapian db files under a home.
set -euo pipefail

home="${1:-}"
if [[ -z "$home" || ! -d "$home" ]]; then
  echo "usage: recoll-path-meta.sh /path/to/home" >&2
  exit 2
fi

conf="${home}/.recoll/recoll.conf"
if [[ -f "$conf" ]]; then
  echo "recoll.conf $(stat -c 'ino=%i ctime=%Z size=%s' "$conf") sha256=$(sha256sum "$conf" | awk '{print $1}')"
fi

db="${home}/.recoll/xapian-db"
if [[ -d "$db" ]]; then
  while IFS= read -r -d '' f; do
    echo "xapian $(stat -c 'path=%n ino=%i ctime=%Z size=%s' "$f") sha256=$(sha256sum "$f" | awk '{print $1}')"
  done < <(find "$db" -type f -print0 2>/dev/null | LC_ALL=C sort -z)
fi
