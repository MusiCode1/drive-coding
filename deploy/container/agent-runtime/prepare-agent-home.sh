#!/usr/bin/env bash
# Create a new bind-mount home owned by DC_UID (never reassign ownership on existing trees).
set -euo pipefail

home="${1:-}"
uid="${2:-${DC_UID:-$(id -u)}}"

if [[ -z "$home" || "$home" != /* ]]; then
  echo "usage: prepare-agent-home.sh /absolute/new/path [uid]" >&2
  exit 2
fi

if [[ -e "$home" ]]; then
  echo "prepare-agent-home: path already exists (use a new path): ${home}" >&2
  exit 1
fi

runner="$(id -u)"
if [[ "$runner" -eq "$uid" ]]; then
  mkdir -p "$home"
elif [[ "$runner" -eq 0 ]]; then
  install -d -o "$uid" -g "$uid" -m 0755 "$home"
else
  echo "prepare-agent-home: run as uid ${uid} or root to create ${home}" >&2
  exit 1
fi

owner="$(stat -c '%u' "$home")"
if [[ "$owner" != "$uid" ]]; then
  echo "prepare-agent-home: ${home} owned by uid ${owner}, expected ${uid}" >&2
  exit 1
fi
