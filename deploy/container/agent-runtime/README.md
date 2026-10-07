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
# בית חדש בלבד — אם הנתיב כבר קיים, בחרו נתיב אחר.
"${SRC}/deploy/container/agent-runtime/prepare-agent-home.sh" "${DC_AGENT_HOME}"
```

🛑 **`DC_AGENT_IMAGE`, `DC_AGENT_NAME`, `DC_AGENT_HOME`, וכן `SRC` עצמו
נדרשים גם בסעיפי "גיבוי ושחזור" ו-"ניקוי" למטה — לא רק כאן.** אם אלה
מגיעים בסשן shell חדש, שחזרו אותם לפני המשך. `printf '%q'` כדי שנתיב עם
רווח (למשל `DC_AGENT_HOME` תחת `~/.local/share/My Drive/…`) לא ישבור את
ה-`source` בסשן החדש:

```bash
{
  printf 'SRC=%q\n' "${SRC}"
  printf 'DC_AGENT_IMAGE=%q\n' "${DC_AGENT_IMAGE}"
  printf 'DC_AGENT_NAME=%q\n' "${DC_AGENT_NAME}"
  printf 'DC_AGENT_HOME=%q\n' "${DC_AGENT_HOME}"
  printf 'DC_AGENT_PORT=%q\n' "${DC_AGENT_PORT}"
} >"${SRC}/.dc-agent-runtime.env"
# בסשן חדש: set -a; source "${SRC}/.dc-agent-runtime.env"; set +a
```

`compose-project.sh` (נקרא בכל סעיף שמריץ `docker compose`) מאמת בפועל
ש-`DC_AGENT_NAME` ו-`DC_AGENT_HOME` מוגדרים ונכשל במפורש אם לא — זו
ההגנה שעוצרת המשך-ריצה עם משתנים חסרים, לא רק תזכורת.

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
# project name = DC_AGENT_NAME (לא ברירת המחדל agent-runtime — מונע דריסת ניסויים אחרים)
source ./compose-project.sh
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

## כלי משתמש (npm global, uv, uv tool)

```bash
docker exec -u dc "${DC_AGENT_NAME}" npm install -g cowsay @openai/codex
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'export PATH="/home/dc/.local/bin:$PATH"; uv tool install --python 3.12 ruff'
```

אימות מתוך סביבת היחידה (לא רק מ-login shell). `systemd-run --user` רק
כמשתמש `dc`, עם runtime dir ו-bus של user manager — **גם אחרי recreate
קונטיינר**:

```bash
uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
"${SRC}/deploy/container/agent-runtime/user-unit-tool-check.sh" docker "${DC_AGENT_NAME}" "${uid}"
```

(ב-Podman: החליפו `docker` ב-`podman` בארגומנט הראשון.)

## recoll

Bootstrap יוצר דוגמה עם האסימון `dc-agent-runtime-recoll-token`. לפני/אחרי
recreate, שמרו inode/ctime/hash של `~/.recoll/recoll.conf` וקבצי
`~/.recoll/xapian-db/` (לא רק שורת שאילתה):

```bash
"${SRC}/deploy/container/agent-runtime/recoll-path-meta.sh" "${DC_AGENT_HOME}"
docker exec -u dc "${DC_AGENT_NAME}" recollq -c /home/dc/.recoll \
  -e 'dc-agent-runtime-recoll-token'
```

## בריאות ו-frontend

```bash
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/" | head
```

## fixture (בלי credentials, בלי turn)

🛑 **שם-היחידה חייב להיות ייחודי לכל ריצה.** ‏`systemd-run --user --unit=X`
מסרב אם `X` עדיין `loaded` — גם אם הוא `failed`, לא רק `active` — ולכן שם
קבוע חוסם כל ריצה שנייה על אותו קונטיינר עד `reset-failed` ידני. קבעו
`RUN_ID` **פעם אחת** ובנו ממנו את שם-היחידה.

🛑 **הסעיף הזה הוא דמו עצמאי — לא תנאי-מוקדם לסעיף "החלפת release" למטה.**
שם ה-fixture כאן (`-demo-`) שונה מהפאר שהסעיף ההוא יוצר לעצמו, ושני הסעיפים
לא תלויים זה בזה: אפשר לדלג על הסעיף הזה ולהריץ A→B→A בסשן נקי, ואפשר
להריץ את הסעיף הזה בלי להמשיך ל-A→B→A בכלל.

```bash
export RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
FIXTURE_A="dc-fixture-hold-demo-${RUN_ID}"

uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
release="$(docker exec -u dc "${DC_AGENT_NAME}" \
  bash -lc 'source ~/.config/drive-coding/release.env && echo "$DC_RELEASE"')"
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemd-run --user --unit="${FIXTURE_A}" \
  "${release}/.runtime/bin/bun" /usr/local/lib/dc-agent-runtime/fixture-hold.js
docker exec -u dc "${DC_AGENT_NAME}" env \
  "XDG_RUNTIME_DIR=/run/user/${uid}" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
  systemctl --user status "${FIXTURE_A}"
```

## אימות מול ספקים

אין לאפות מפתחות או `secrets.json` לתוך התמונה. הקובץ, אם קיים, יושב רק על
ה-bind: `${DC_AGENT_HOME}/.config/drive-coding/secrets.json` (בתוך הקונטיינר:
`/home/dc/.config/drive-coding/secrets.json`). קובץ חסר אינו עוצר את ה-backend.
התחברות אינטראקטיבית של CLI רצה כמשתמש `dc`:

🛑 **`docker exec -u dc` ללא shell-login אינו כולל `/home/dc/.local/bin`
ב-PATH** (ה-prefix של `npm -g`, שם `codex` יושב) — רק `bash -lc` קורא את
ה-profile ומוסיף אותו. `docker exec -u dc "${DC_AGENT_NAME}" codex --version`
כלשונו נכשל (`exit 127`, `executable file not found in $PATH`).

```bash
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex --version'
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex login --help' | grep -F device-auth
```

התחברות אינטראקטיבית (מכונת המשתמש, לא חלק מניסוי אוטומטי):

```bash
docker exec -it -u dc "${DC_AGENT_NAME}" bash -lc 'codex login --device-auth'
```

(Podman: `podman exec -it -u dc … bash -lc '…'`.)

## החלפת release (A → B → A)

🛑 **הבלוק הזה עצמאי — אינו תלוי בסעיף "fixture" למעלה ולא במשתנה-shell
כלשהו מסשן קודם.** נמדד (D-1): סשן טרמינל חדש ששיחזר רק את
`.dc-agent-runtime.env` (SRC/IMAGE/NAME/HOME/PORT, כמתואר ב-"בית משתמש")
ואז דילג היישר לכאן נכשל על `RUN_ID: unbound variable` — `RUN_ID` ו-`uid`
היו משתנים מקומיים של סעיף "fixture", לא חלק מבלוק-השחזור. התיקון: הבלוק
מחשב `uid` משלו, מגדיר `RUN_ID` טרי משלו (זמן+PID, לא תלוי בסעיף הקודם),
ויוצר **פאר fixture עצמאי** (`FIXTURE_A`/`FIXTURE_B`) בשם שלא מתנגש עם זה
של סעיף "fixture" — אין כאן `stop`/`reset-failed` על שום יחידה שהבלוק הזה
לא יצר בעצמו.

`dc-release-install` מסרב אם תיקיית ה-id כבר קיימת, וכותב את `release.env`
ל-id החדש. אחרי ההתקנה צריך restart של היחידה. העוגן הוא `exe`, `cmdline`
ו-`maps`, לא cwd. `B_ID` למטה הוא **אותו מזהה** שמוזרק להתקנה ולשלושת
העוגנים — לא ערך-קוד נפרד; שינוי `B_ID` אחד מספיק להרצה על בית שכבר שימש.

🛑 **הרצה חוזרת על בית שבו `releases/B` כבר קיים** (ניסוי קודם, לא נוקה) —
`dc-release-install --id "$B_ID"` יסרב, וההרנסים (`guide-quickstart-e2e.sh` /
`guide-podman-e2e.sh`) **לא** ינסו להזיז או למחוק אותו: לא ניתן להוכיח
מה-host בוודאות שאף תהליך (למשל fixture) לא רץ על אותו release, ולכן
העברה/מחיקה אוטומטית היא בדיוק סוג הניחוש-המסוכן ש-F1 הזהיר ממנו. קבעו
`B_ID` לערך שלא היה בשימוש — ברירת-המחדל של ההרנסים היא id עם חותמת-זמן.
בדיקה וניקוי ידני של release ישן (שלא בשימוש בפועל) הם באחריות המפעיל.

**חמש נקודות, לא שתיים:** (1) backend על A, (2) `FIXTURE_A` — נוצר כאן,
אחרי אימות ה-backend על A ולפני התקנת B, ובלתי-תלוי ביחידת ה-backend —
(3) backend עובר ל-B **ו-`FIXTURE_A` נשאר אותו PID ואותו exe A**,
(4) `FIXTURE_B` **חדש** מוקם בזמן ש-`$DC_RELEASE` מצביע ל-B ואכן מריץ
את ה-exe של B (מוכיח ש-fixture חדש אוסף את ה-release הנוכחי, לא רק
ש-fixture ישן שורד), (5) backend חוזר ל-A ו-`FIXTURE_A` עדיין לא זע.

🛑 **קריאת `/proc/<pid>/exe` ו-`/proc/<pid>/maps` חייבת `-u dc`.** ה-backend
רץ כמשתמש `dc`, לא כ-root; `docker exec` (ברירת-מחדל root) מקבל `Permission
denied` על שתיהן — ו-`readlink` נכשל **בשקט** (exit 1, פלט ריק) אם לא בודקים
את קוד-היציאה.

🛑 **הבלוק מתחיל ב-`set -euo pipefail`** — בלי זה, `cmd | grep -F …` שבו
`cmd` נכשל (למשל `Permission denied`) עדיין מחזיר את קוד-היציאה של `grep`
(שנכשל גם הוא, אבל זו מקריות ולא אכיפה), והרצף הבא ממשיך על נתון ריק.
וכל restart מחכה ל-health **מוגבל** לפני שהוא קורא PID — אחרת יש חשש שה-PID
שנקרא שייך לתהליך שעדיין בתהליך crash-restart ולא לזה שבאמת עונה.

```bash
set -euo pipefail

uid="$(docker exec "${DC_AGENT_NAME}" cat /etc/dc-agent-runtime/uid)"
B_ID="${DC_RELEASE_B_ID:-B-$(date -u +%Y%m%dT%H%M%SZ)}"
SWAP_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"   # עצמאי מ-RUN_ID של סעיף "fixture"
FIXTURE_A="dc-fixture-hold-swap-${SWAP_RUN_ID}-a"
FIXTURE_B="dc-fixture-hold-swap-${SWAP_RUN_ID}-b"

wait_health() {
  local i
  for i in $(seq 1 40); do
    curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health" >/dev/null 2>&1 && return 0
    sleep 3
  done
  echo "wait_health: timed out" >&2
  return 1
}
unit_pid() {   # MainPID של יחידת --user, כמו ב-guide-contract-lib.sh
  docker exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user show "$1" -p MainPID --value | tr -d '[:space:]'
}
run_fixture() {   # systemd-run עם TimeoutStopSec קצר — רק ליחידות שהבלוק הזה יוצר
  local unit="$1" release_path="$2"
  docker exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemd-run --user --unit="${unit}" --property=TimeoutStopSec=5s \
    "${release_path}/.runtime/bin/bun" /usr/local/lib/dc-agent-runtime/fixture-hold.js
}

pid_a="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_a}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

# FIXTURE_A: פאר עצמאי שהבלוק הזה יוצר, אחרי אימות A ולפני התקנת B
run_fixture "$FIXTURE_A" /home/dc/releases/A
fix_a_pid="$(unit_pid "$FIXTURE_A")"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_a_pid}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id "$B_ID" \
  --source "${SRC}" \
  --bun-version 1.3.14
docker exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
wait_health
pid_b="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
test "$pid_b" != "$pid_a"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_b}/exe" | grep -F "/home/dc/releases/${B_ID}/.runtime/bin/bun"
docker exec -u dc "${DC_AGENT_NAME}" bash -lc "tr '\\0' ' ' </proc/${pid_b}/cmdline" | grep -F "/home/dc/releases/${B_ID}/.runtime/bin/bun"
docker exec -u dc "${DC_AGENT_NAME}" grep -F "/home/dc/releases/${B_ID}/.runtime/bin/bun" "/proc/${pid_b}/maps"

# FIXTURE_A: לא זע מהחלפת ה-backend (אותו PID, exe עדיין A)
fix_a_pid_after="$(unit_pid "$FIXTURE_A")"
test "$fix_a_pid_after" = "$fix_a_pid"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_a_pid_after}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

# FIXTURE_B: יחידה חדשה, מוקמת עכשיו בעוד $DC_RELEASE מצביע ל-B
run_fixture "$FIXTURE_B" "/home/dc/releases/${B_ID}"
fix_b_pid="$(unit_pid "$FIXTURE_B")"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${fix_b_pid}/exe" | grep -F "/home/dc/releases/${B_ID}/.runtime/bin/bun"

rollback_env="$(mktemp "${DC_AGENT_HOME}/.config/drive-coding/release.env.XXXXXX")"
printf 'DC_RELEASE=%s\n' /home/dc/releases/A >"$rollback_env"
chmod 600 "$rollback_env"
mv -f "$rollback_env" "${DC_AGENT_HOME}/.config/drive-coding/release.env"
docker exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
wait_health
pid_back="$(docker exec "${DC_AGENT_NAME}" systemctl show dc-agent-runtime -p MainPID --value)"
docker exec -u dc "${DC_AGENT_NAME}" readlink "/proc/${pid_back}/exe" | grep -F '/home/dc/releases/A/.runtime/bin/bun'

# FIXTURE_A: עדיין לא זע
fix_a_pid_back="$(unit_pid "$FIXTURE_A")"
test "$fix_a_pid_back" = "$fix_a_pid"

# ניקוי — רק הפאר שהבלוק הזה יצר (לא נוגע ב-FIXTURE_A של סעיף "fixture")
for u in "$FIXTURE_A" "$FIXTURE_B"; do
  docker exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user stop "$u" || true
  docker exec -u dc "${DC_AGENT_NAME}" env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user reset-failed "$u" 2>/dev/null || true
done
```

(Podman: `podman exec -u dc …` ו-`podman exec …` במקום `docker exec …`.)

## restart מול recreate

- **Restart יחידה** (`systemctl restart dc-agent-runtime`): state deployment תחת
  `DC_DEPLOYMENT_DIR` בבית נשמר; sidecar transient ישרוד אם הוגדר כך.
- **Recreate קונטיינר**: tmpfs של `/run` מתאפס; **הבית על ה-bind נשמר**
  (releases, npm, recoll, `agent-runtime.env`).

## גיבוי ושחזור

```bash
cd "${SRC}/deploy/container/agent-runtime"
source ./compose-project.sh
docker compose stop
hash_live="$("${SRC}/deploy/container/agent-runtime/tree-sha256.sh" "${DC_AGENT_HOME}")"
tar -C "$(dirname "${DC_AGENT_HOME}")" -czf "${DC_AGENT_HOME}.tgz" "$(basename "${DC_AGENT_HOME}")"
docker compose start

restore_parent="$(mktemp -d /tmp/dc-agent-restore-parent-XXXXXX)"
tar -C "${restore_parent}" -xzf "${DC_AGENT_HOME}.tgz"
restored="${restore_parent}/$(basename "${DC_AGENT_HOME}")"
hash_restored="$("${SRC}/deploy/container/agent-runtime/tree-sha256.sh" "${restored}")"
test "$hash_live" = "$hash_restored"
```

לפני bind של בית משוחזר לקונטיינר חדש, הבעלות חייבת להתאים ל-`DC_UID`
(בית **חדש** — `prepare-agent-home.sh`, לא דריסת בית קיים). Podman: `podman
stop` / `podman start` במקום `docker compose stop/start`.

## ניקוי (לא מוחק את הבית)

```bash
cd "${SRC}/deploy/container/agent-runtime" && source ./compose-project.sh && docker compose down
# Podman: podman rm -f "${DC_AGENT_NAME}"  # רק אם התווית trial
```

## אזהרה

ניתוק backend / restart מאפס הגדרות סשן פעילות ומאבד פלט שלא נצבר — **אין
zero-downtime**.
