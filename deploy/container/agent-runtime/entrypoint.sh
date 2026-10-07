#!/bin/bash
set -euo pipefail

uid_file=/etc/dc-agent-runtime/uid
if [[ ! -f "$uid_file" ]]; then
  echo "dc-agent-runtime entrypoint: missing ${uid_file}" >&2
  exit 1
fi

expected_uid="$(tr -d '[:space:]' <"$uid_file")"
owner_uid="$(stat -c '%u' /home/dc)"

if [[ "$owner_uid" != "$expected_uid" ]]; then
  echo "dc-agent-runtime entrypoint: /home/dc owned by uid ${owner_uid}, expected ${expected_uid}" >&2
  exit 1
fi

current_uid="$(id -u)"
if [[ "$current_uid" -eq "$expected_uid" ]]; then
  if ! test -w /home/dc; then
    echo "dc-agent-runtime entrypoint: uid ${current_uid} cannot write /home/dc" >&2
    exit 1
  fi
elif [[ "$current_uid" -eq 0 ]]; then
  if ! runuser -u dc -- test -w /home/dc; then
    echo "dc-agent-runtime entrypoint: user dc cannot write /home/dc" >&2
    exit 1
  fi
else
  echo "dc-agent-runtime entrypoint: unexpected uid ${current_uid}, expected 0 or ${expected_uid}" >&2
  exit 1
fi

bootstrap=/usr/local/lib/dc-agent-runtime/bootstrap-user-home.sh
if [[ "$current_uid" -eq 0 ]]; then
  runuser -u dc -- "$bootstrap" /home/dc
elif [[ "$current_uid" -eq "$expected_uid" ]]; then
  "$bootstrap" /home/dc
else
  echo "dc-agent-runtime entrypoint: cannot bootstrap as uid ${current_uid}" >&2
  exit 1
fi

exec /lib/systemd/systemd
