# runtime נייד לסוכן drive-coding

מדריך quickstart להרצת backend עם systemd בתוך קונטיינר, release נפרד
מ-Bun, ו-frontend בנוי — בלי ידע ארגוני.

## דרישות

- Git ו-Docker **28+** (rootful, cgroup v2) לנתיב Docker, או Podman 5.4+ לנתיב Podman.
- מארח Linux עם `curl`, `unzip`, ומקום פנוי לבניית release.
- פורט מקומי פנוי על המארח (`DC_AGENT_PORT`, למשל **18400**). בתוך הקונטיינר
  ה-backend מאזין תמיד על **18400** — אל תגדירו `PORT` ב-compose/Podman; אם
  משנים mapping, עדכנו רק את `ports:` / `-p`, לא את `PORT` בתוך הקונטיינר.
  `EnvironmentFile` בבית (`agent-runtime.env`) יכול לשנות הגדרות אחרות.

### שער Docker (writable cgroups)

נתיב Docker/Compose דורש Docker **rootful 28+** עם **cgroup v2** ואופציית
`writable-cgroups=true`. האופציה מרכיבה את cgroup **של הקונטיינר** לכתיבה —
זו **לא** גישה לעץ cgroup של המארח. **Rootless Docker** לא נבדק; לפי המקור
האופציה אינה נתמכת שם. **נבדק בפועל** עם Docker **29.6.1**.
AppArmor נשאר `docker-default` (אין `apparmor=unconfined`).

Podman משתמש ב-`--systemd=always` (מנגנון Podman), לא באותה אופציית Docker.

## הכנת עץ ובניית תמונה

```bash
git clone <repository-url> drive-coding
cd drive-coding
git checkout <commit-sha>

export SRC="$(mktemp -d /tmp/dc-agent-runtime-src-XXXXXX)"
git archive HEAD | tar -x -C "${SRC}"

cd "${SRC}"
export DC_UID="$(id -u)"
export DC_AGENT_IMAGE=dc-agent-runtime:local
docker build -f deploy/container/agent-runtime/Containerfile \
  --build-arg "DC_UID=${DC_UID}" \
  -t "${DC_AGENT_IMAGE}" .
docker run --rm --entrypoint node "${DC_AGENT_IMAGE}" --version
# צפוי: v22.23.3
```

אם `id -u` אינו **1000**, חובה `--build-arg DC_UID=…` תואם לבעלות תיקיית
הבית שת bind-ים (למשל **1001** על מארח שבו uid 1000 שייך למשתמש אחר).

## בית משתמש (bind)

```bash
export DC_AGENT_HOME="${HOME}/.local/share/dc-agent-runtime/home"
export DC_AGENT_NAME="dc-agent-runtime-trial"
export DC_AGENT_PORT=18400
mkdir -p "${DC_AGENT_HOME}"
# בעלות חייבת להתאים ל-DC_UID שבתמונה
chown -R "${DC_UID}:${DC_UID}" "${DC_AGENT_HOME}"
```

## התקנת release (Bun מה-release בלבד)

```bash
HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id A \
  --source "${SRC}" \
  --bun-version 1.3.14
```

`dc-release-exec` מריץ **רק** `$DC_RELEASE/.runtime/bin/bun` — לא `~/.bun` ולא
Bun מהתמונה.

## הרצה — Docker Compose

```bash
cd "${SRC}/deploy/container/agent-runtime"
docker compose up -d
docker compose ps
docker port "${DC_AGENT_NAME}"
# צפוי: 127.0.0.1:18400 -> ...
```

`compose.yaml` מגדיר: `privileged: false`, `cgroup: private`,
`security_opt: [writable-cgroups=true]`, `stop_signal: SIGRTMIN+3`, tmpfs על
`/run`, `/run/lock`, `/tmp`, בלי `cap_add`, ובלי mount כתיב של cgroup מהמארח.

## הרצה — Podman

Podman **לא** רואה תמונות Docker. אחרי `docker build` העבירו תמונה או בנו מחדש:

```bash
# אופציה א — העברה מ-Docker (אותו tag)
docker save "${DC_AGENT_IMAGE}" -o /tmp/dc-agent-runtime-image.tar
podman load -i /tmp/dc-agent-runtime-image.tar

# אופציה ב — בנייה ישירה ב-Podman מאותו עץ
podman build -f "${SRC}/deploy/container/agent-runtime/Containerfile" \
  --build-arg "DC_UID=${DC_UID}" \
  -t "${DC_AGENT_IMAGE}" "${SRC}"
```

```bash
export DC_UID="${DC_UID:-$(id -u)}"
"${SRC}/deploy/container/agent-runtime/podman-run.sh"
podman port "${DC_AGENT_NAME}"
```

כש-uid המארח תואם ל-`DC_UID` בתמונה, הסקריפט מוסיף `--userns=keep-id`.
הסקריפט יוצר/מסיר רק קונטיינרים עם התווית
`org.drivecoding.agent-runtime=trial`.

## systemd, sidecar, ו-PATH

יחידת `dc-agent-runtime.service` מגדירה:

| משתנה | תפקיד |
|--------|--------|
| `AGENT_SIDECAR` | CSV: `cursor,opencode,gemini,claude,codex` — אופן שיגור sidecar |
| `XDG_RUNTIME_DIR` | `/run/user/<uid>` — נדרש ל-`hasSystemdUser` |
| `DBUS_SESSION_BUS_ADDRESS` | bus של user manager |
| `PATH` | כולל `/home/dc/.local/bin` — npm global ו-uv ל-backend ו-sidecar |
| `PORT` | **18400** (גם `ENV PORT` בתמונה ל-healthcheck) |
| `EnvironmentFile=-…/agent-runtime.env` | קובץ חסר לא מפיל; ערכים שם **גוברים** על `Environment=` |
| `DC_DEPLOYMENT_DIR` | תחת הבית — **לא** תחת `/run` (שורד recreate) |

זה מה שגורם לסוכן להיוולד כ-**transient unit** (`systemd-run --user`) ולשרוד
restart של יחידת ה-backend — **לא** shell אינטראקטיבי.

**שער:** `journalctl -u dc-agent-runtime` **אינו** מכיל `no systemd user manager`.

```bash
docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p Environment
```

## כלי משתמש (npm global, uv)

```bash
docker exec -u dc "${DC_AGENT_NAME}" npm install -g cowsay
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'export PATH="/home/dc/.local/bin:$PATH"; uv --version'
```

אימות מתוך סביבת היחידה (לא רק מ-login shell). `systemd-run --user` רק
כמשתמש `dc`, עם runtime dir ו-bus של user manager:

```bash
uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemd-run --user --wait --pipe \
  --setenv=PATH=/home/dc/.local/bin:/usr/local/bin:/usr/bin \
  which cowsay
```

## recoll

Bootstrap יוצר דוגמה עם האסימון `dc-agent-runtime-recoll-token`. אחרי recreate:

```bash
docker exec -u dc "${DC_AGENT_NAME}" recollq -c /home/dc/.recoll \
  -e 'dc-agent-runtime-recoll-token'
```

## בריאות ו-frontend

```bash
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/" | head
```

## fixture (בלי credentials, בלי turn)

```bash
uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
release="$(docker exec -u dc "${DC_AGENT_NAME}" \
  bash -lc 'source ~/.config/drive-coding/release.env && echo "$DC_RELEASE"')"
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemd-run --user --unit=dc-fixture-hold \
  "${release}/.runtime/bin/bun" /usr/local/lib/dc-agent-runtime/fixture-hold.js
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemctl --user status dc-fixture-hold
```

## אימות מול ספקים

אין לאפות מפתחות או `secrets.json` לתוך התמונה. הקובץ, אם קיים, יושב רק על
ה-bind: `${DC_AGENT_HOME}/.config/drive-coding/secrets.json` (בתוך הקונטיינר:
`/home/dc/.config/drive-coding/secrets.json`). קובץ חסר אינו עוצר את ה-backend.
התחברות אינטראקטיבית של CLI רצה כמשתמש `dc`:

דוגמה ל-CLI (בלי turn בתשלום): `codex login --help` מציג `--device-auth`;
אין להריץ login אינטראקטיבי בניסוי.

```bash
docker exec -u dc "${DC_AGENT_NAME}" codex login --help | grep -F device-auth
docker exec -it -u dc "${DC_AGENT_NAME}" bash
```

## החלפת release (A → B → A)

`dc-release-install` מסרב אם תיקיית ה-id כבר קיימת, וכותב את `release.env`
ל-id החדש. אחרי ההתקנה צריך restart של היחידה. העוגן הוא `exe`, `cmdline`
ו-`maps`, לא cwd.

```bash
pid_a="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id B \
  --source "${SRC}" \
  --bun-version 1.3.14
docker exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
pid_b="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
test "$pid_b" != "$pid_a"
docker exec "${DC_AGENT_NAME}" readlink "/proc/${pid_b}/exe"
docker exec "${DC_AGENT_NAME}" bash -lc "tr '\\0' ' ' </proc/${pid_b}/cmdline"
docker exec "${DC_AGENT_NAME}" grep -F '/home/dc/releases/B/.runtime/bin/bun' "/proc/${pid_b}/maps"

printf 'DC_RELEASE=%s\n' /home/dc/releases/A \
  >"${DC_AGENT_HOME}/.config/drive-coding/release.env"
docker exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
pid_back="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
docker exec "${DC_AGENT_NAME}" readlink "/proc/${pid_back}/exe"
```

## restart מול recreate

- **Restart יחידה** (`systemctl restart dc-agent-runtime`): state deployment תחת
  `DC_DEPLOYMENT_DIR` בבית נשמר; sidecar transient ישרוד אם הוגדר כך.
- **Recreate קונטיינר**: tmpfs של `/run` מתאפס; **הבית על ה-bind נשמר**
  (releases, npm, recoll, `agent-runtime.env`).

## גיבוי ושחזור

```bash
"${SRC}/deploy/container/agent-runtime/tree-sha256.sh" "${DC_AGENT_HOME}" >"${DC_AGENT_HOME}.sha256"
tar -C "$(dirname "${DC_AGENT_HOME}")" -czf "${DC_AGENT_HOME}.tgz" "$(basename "${DC_AGENT_HOME}")"
restore_root="$(mktemp -d "${DC_AGENT_HOME}.restore-XXXXXX")"
tar -C "${restore_root}" -xzf "${DC_AGENT_HOME}.tgz"
"${SRC}/deploy/container/agent-runtime/tree-sha256.sh" "${restore_root}/$(basename "${DC_AGENT_HOME}")"
```

לפני חיבור הבית המשוחזר, הבעלות חייבת להתאים ל-`DC_UID` שבתמונה.

## ניקוי (לא מוחק את הבית)

```bash
cd "${SRC}/deploy/container/agent-runtime" && docker compose down
# Podman: podman rm -f "${DC_AGENT_NAME}"  # רק אם התווית trial
```

## אזהרה

ניתוק backend / restart מאפס הגדרות סשן פעילות ומאבד פלט שלא נצבר — **אין
zero-downtime**.
