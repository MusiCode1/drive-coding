#!/usr/bin/env bash
# Proof: bootstrap never leaves root-owned seeds; foreign files keep their uid.
# Requires: docker, image already built, no systemd PID 1, no privileged, no host cgroup mount.
set -euo pipefail

image="${1:-${DC_AGENT_IMAGE:-}}"
if [[ -z "$image" ]]; then
  echo "usage: bootstrap-ownership-image-proof.sh <image>" >&2
  echo "   or: DC_AGENT_IMAGE=… bootstrap-ownership-image-proof.sh" >&2
  exit 2
fi

dc_uid="$(docker run --rm --entrypoint cat "$image" /etc/dc-agent-runtime/uid | tr -d '[:space:]')"
foreign_uid=999
if [[ "$foreign_uid" == "$dc_uid" ]]; then
  foreign_uid=998
fi

home="$(mktemp -d)"
trap 'rm -rf "$home"' EXIT

mkdir -p "$home"
chown "${dc_uid}:${dc_uid}" "$home"

docker run --rm --user 0 \
  -v "${home}:/home/dc" \
  --entrypoint bash \
  "$image" \
  -c "touch /home/dc/preserve-foreign && chown ${foreign_uid}:${foreign_uid} /home/dc/preserve-foreign"

before_foreign="$(stat -c '%u' "$home/preserve-foreign")"

docker run --rm --user 0 \
  -v "${home}:/home/dc" \
  --entrypoint /usr/local/lib/dc-agent-runtime/bootstrap-user-home.sh \
  "$image" /home/dc

after_foreign="$(stat -c '%u' "$home/preserve-foreign")"
if [[ "$after_foreign" != "$before_foreign" ]]; then
  echo "proof FAIL: preserve-foreign uid changed ${before_foreign} -> ${after_foreign}" >&2
  exit 1
fi

if [[ ! -d "$home/.recoll" ]]; then
  echo "proof FAIL: .recoll missing" >&2
  exit 1
fi

recoll_uid="$(stat -c '%u' "$home/.recoll")"
if [[ "$recoll_uid" != "$dc_uid" ]]; then
  echo "proof FAIL: .recoll owned by uid ${recoll_uid}, expected ${dc_uid}" >&2
  exit 1
fi

if [[ -d "$home/.recoll/xapian-db" ]] && [[ -n "$(ls -A "$home/.recoll/xapian-db" 2>/dev/null || true)" ]]; then
  idx_uid="$(stat -c '%u' "$home/.recoll/xapian-db")"
  if [[ "$idx_uid" != "$dc_uid" ]]; then
    echo "proof FAIL: index owned by uid ${idx_uid}, expected ${dc_uid}" >&2
    exit 1
  fi
fi

image_id="$(docker image inspect -f '{{.Id}}' "$image")"
echo "proof OK image=${image} id=${image_id} dc_uid=${dc_uid} foreign_kept=${after_foreign} recoll_uid=${recoll_uid}"
