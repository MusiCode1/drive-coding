# הרצת Drive Coding בקונטיינר

מדריך להתקנת Drive Coding עם systemd, בית משתמש קבוע, ושדרוג היישום תוך
שמירת תהליכי סוכנים שהופעלו כיחידות sidecar נפרדות.

תמונת הקונטיינר מספקת את מערכת ההפעלה וכלי הבסיס. קוד היישום, ה-frontend
הבנוי ועותק Bun נעוץ נשמרים יחד בכל תיקיית release בבית המשתמש.
כלים שמותקנים בבית, הגדרות ואישורי התחברות נשמרים ב-bind מהמארח.
החלפת קונטיינר עוצרת את התהליכים שבו; ראו את סעיף restart מול recreate.

הפקודות מיועדות ל-Bash במארח, כמשתמש רגיל עם גישה למנוע הקונטיינרים.
בחרו Docker או Podman; אל תריצו את שניהם על אותו בית משתמש במקביל.
בסעיפי השימוש המשותפים החליפו `docker exec` ב-`podman exec` אם בחרתם Podman.

## דרישות

- Git ו-Docker **28+** (rootful, cgroup v2) לנתיב Docker, או Podman 5.4+ לנתיב Podman.
- מארח Linux **x86-64** עם Bash, `curl`, `unzip` ומקום פנוי לבניית release.
  קובצי Node ו-Bun במימוש הנוכחי הם `linux-x64`; אין תמיכה מובנית ב-ARM64.
- לנתיב Docker נדרש גם תוסף Docker Compose.
- פורט מקומי פנוי על המארח (`DC_AGENT_PORT`, למשל **18400**). בתוך הקונטיינר
  בתצורה המסופקת ה-backend מאזין על **18400** — אל תגדירו `PORT` ב-compose/Podman; אם
  משנים mapping, עדכנו רק את `ports:` / `-p`, לא את `PORT` בתוך הקונטיינר.
  `EnvironmentFile` בבית (`agent-runtime.env`) יכול לשנות הגדרות אחרות.

### systemd ב-Docker וב-Podman

Compose משתמש ב-Docker rootful עם cgroup v2 ובאופציה
`writable-cgroups=true`, שנוספה ב-[Docker 28](https://docs.docker.com/engine/release-notes/28/).
האופציה מאפשרת כתיבה ל-cgroups של הקונטיינר. התצורה משתמשת ב-namespace
פרטי, ללא privileged או bind של עץ cgroup מהמארח, ומשאירה את AppArmor
בברירת המחדל של Docker.

בדיקות התאימות ב-2026-10-07 בוצעו עם Docker rootful 29.6.1 ו-Podman
rootless 5.4.2. Docker rootless לא נבדק עבור התצורה הזאת.
Podman משתמש ב-`--systemd=always` וב-`--userns=keep-id --user 0`.

## הכנת עץ ובניית תמונה

```bash
set -euo pipefail
git clone https://github.com/MusiCode1/drive-coding.git drive-coding
cd drive-coding
read -r -p 'Git ref to install (tag, branch or commit): ' INSTALL_REF
test -n "${INSTALL_REF}"
git checkout --detach "${INSTALL_REF}"
export REPO="$(pwd)"

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
הבית שמחברים ב-bind (למשל **1001** על מארח שבו uid 1000 שייך למשתמש אחר).

## בית משתמש (bind)

```bash
export DC_AGENT_HOME="${HOME}/.local/share/dc-agent-runtime/home"
export DC_AGENT_NAME="dc-agent-runtime-trial"
export DC_AGENT_PORT=18400
# בית חדש בלבד — אם הנתיב כבר קיים, בחרו נתיב אחר.
"${SRC}/deploy/container/agent-runtime/prepare-agent-home.sh" "${DC_AGENT_HOME}"
```

שמרו את משתני ההתקנה כדי להמשיך בטרמינל חדש. לכל התקנה נוצר קובץ נפרד;
שמרו את פקודת ה-`source` שמודפסת בסוף. `SRC` מצביע לעץ שחולץ ב-`/tmp`:
שמרו גם אותו כל עוד פקודות התחזוקה משתמשות בו, או עדכנו את הנתיב בקובץ
המשתנים לעותק קבוע של אותו מקור.

```bash
mkdir -p "${HOME}/.config/drive-coding-containers"
RUNTIME_ENV="${HOME}/.config/drive-coding-containers/${DC_AGENT_NAME}.env"
{
  printf 'REPO=%q\n' "${REPO}"
  printf 'SRC=%q\n' "${SRC}"
  printf 'DC_UID=%q\n' "${DC_UID}"
  printf 'DC_AGENT_IMAGE=%q\n' "${DC_AGENT_IMAGE}"
  printf 'DC_AGENT_NAME=%q\n' "${DC_AGENT_NAME}"
  printf 'DC_AGENT_HOME=%q\n' "${DC_AGENT_HOME}"
  printf 'DC_AGENT_PORT=%q\n' "${DC_AGENT_PORT}"
} >"${RUNTIME_ENV}"
printf 'set -a; source %q; set +a\n' "${RUNTIME_ENV}"
```

`compose-project.sh` דורש `DC_AGENT_IMAGE`, `DC_AGENT_NAME` ו-`DC_AGENT_HOME`
מוגדרים לפני הרצת Compose.

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
# שם פרויקט Compose נגזר מ-DC_AGENT_NAME, אלא אם הוגדר COMPOSE_PROJECT_NAME
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

הסקריפט דורש התאמה בין UID המארח ל-`DC_UID` ומשתמש ב-`--userns=keep-id`
וב-`--user 0`, כדי ש-systemd יעלה כ-PID 1 ויישום Drive Coding ירוץ כ-`dc`.
אם כבר קיים קונטיינר באותו שם עם התווית `org.drivecoding.agent-runtime=trial`,
הסקריפט **מסיר אותו ומקים חדש**, ועוצר בכך את התהליכים שבו. קונטיינר באותו
שם ללא התווית הזאת לא יוסר. לשדרוג היישום השתמשו בסעיף השדרוג למטה.

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

סוכן שמופעל במסלול sidecar עם user manager זמין נוצר כיחידת משתמש נפרדת
באמצעות `systemd-run --user`. הפרדה זו מאפשרת לתהליך להמשיך לרוץ כאשר
מפעילים מחדש את יחידת ה-backend.

בדקו את סביבת היחידה. הודעת `no systemd user manager` ביומן מצביעה על
שיגור חלופי שאינו שומר את התהליך בעת restart ליחידת ה-backend.

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

Recoll מותקן עם מסמך דוגמה ואינדקס תחת `/home/dc/.recoll`, שנשמר בבית
הקבוע. בדקו חיפוש במסמך הדוגמה:

```bash
docker exec -u dc "${DC_AGENT_NAME}" recollq -c /home/dc/.recoll \
  -e 'dc-agent-runtime-recoll-token'
```

## בריאות ו-frontend

```bash
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
curl -fsS "http://127.0.0.1:${DC_AGENT_PORT}/" -o /dev/null
```

## התחברות לספק

אין לאפות מפתחות או `secrets.json` לתוך התמונה. הקובץ, אם קיים, יושב רק על
ה-bind: `${DC_AGENT_HOME}/.config/drive-coding/secrets.json` (בתוך הקונטיינר:
`/home/dc/.config/drive-coding/secrets.json`). קובץ חסר אינו עוצר את ה-backend.
התחברות אינטראקטיבית של CLI רצה כמשתמש `dc`:

השתמשו ב-`bash -lc` כדי לטעון את ה-PATH של המשתמש, הכולל את הכלים
שהותקנו ב-`/home/dc/.local/bin`. הפקודות הבאות בודקות את זמינות Codex
ואפשרות ההתחברות; הן אינן מבצעות התחברות.

```bash
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex --version'
docker exec -u dc "${DC_AGENT_NAME}" bash -lc 'codex login --help' | grep -F device-auth
```

להתחברות, הריצו מהטרמינל שלכם ופעלו לפי ההוראות ש-Codex מציג:

```bash
docker exec -it -u dc "${DC_AGENT_NAME}" bash -lc 'codex login --device-auth'
```

(Podman: `podman exec -it -u dc … bash -lc '…'`.)

## שדרוג היישום

טענו את משתני ההתקנה ששמרתם. בחרו tag או commit חדש מהריפו והתקינו אותו
במזהה release חדש. בניית ה-release מתקיימת במארח ואינה מחליפה את התמונה.
דרושים מקום נוסף לתיקיית release וזיכרון לבניית ה-frontend.

הפקודות שומרות עותק של `release.env` לפני ההתקנה ב-`release.env.before-upgrade`.
כל שדרוג מחליף את הגיבוי הזה. `dc-release-install` מעדכן את ה-release הנבחר
רק לאחר הצלחת הבנייה; restart של יחידת ה-backend מפעיל אותו.

```bash
set -euo pipefail
ENGINE=docker                 # ל-Podman: ENGINE=podman
read -r -p 'Git ref to upgrade to (tag or commit): ' RELEASE_REF
test -n "${RELEASE_REF}"
git -C "${REPO}" fetch origin --tags
RELEASE_SHA="$(git -C "${REPO}" rev-parse --verify "${RELEASE_REF}^{commit}")"
NEXT_SRC="$(mktemp -d /tmp/dc-agent-runtime-upgrade-XXXXXX)"
git -C "${REPO}" archive "${RELEASE_SHA}" | tar -x -C "${NEXT_SRC}"
RELEASE_ID="${RELEASE_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"

config_dir="${DC_AGENT_HOME}/.config/drive-coding"
cp -p "${config_dir}/release.env" "${config_dir}/release.env.before-upgrade"
HOME="${DC_AGENT_HOME}" "${SRC}/deploy/container/agent-runtime/dc-release-install" \
  --id "${RELEASE_ID}" --source "${NEXT_SRC}" --bun-version 1.3.14
"${ENGINE}" exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
curl --retry 40 --retry-delay 3 --retry-connrefused --retry-all-errors \
  -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
```

אל תשנו או תמחקו release ישן כל עוד סוכנים פעילים משתמשים בו. גם Bun
שבתוכו נדרש להם. מזהה שכבר קיים נדחה; בחרו מזהה חדש גם אחרי בנייה שנכשלה
והשאירה תיקייה חלקית. פרטי בדיקת שימור תהליכים נמצאים ב-[מדריך הבדיקות](TESTING.md).

## חזרה לגרסה שלפני השדרוג

טענו את משתני ההתקנה. שחזרו את ההפניה השמורה והפעילו מחדש את יחידת
ה-backend. תיקיית ה-release הישן צריכה עדיין להיות קיימת.

```bash
set -euo pipefail
ENGINE=docker                 # ל-Podman: ENGINE=podman
config_dir="${DC_AGENT_HOME}/.config/drive-coding"
rollback_env="$(mktemp "${config_dir}/release.env.XXXXXX")"
cp -p "${config_dir}/release.env.before-upgrade" "${rollback_env}"
mv -f "${rollback_env}" "${config_dir}/release.env"
"${ENGINE}" exec "${DC_AGENT_NAME}" systemctl restart dc-agent-runtime
curl --retry 40 --retry-delay 3 --retry-connrefused --retry-all-errors \
  -fsS "http://127.0.0.1:${DC_AGENT_PORT}/api/health"
```

## restart מול recreate

| פעולה | תהליכים פעילים | קבצים בבית המשתמש |
|-------|----------------|-------------------|
| `systemctl restart dc-agent-runtime` | ה-backend מוחלף; סוכנים שהופעלו כיחידות sidecar נפרדות ממשיכים לרוץ | נשמרים |
| עצירה או יצירה מחדש של הקונטיינר | כל התהליכים בקונטיינר נעצרים; יש להפעיל סוכנים מחדש | נשמרים כשמשתמשים באותו bind |

שימור תהליך sidecar אינו מבטיח רציפות של חיבור הממשק, הגדרות הסשן או כל
הפלט בזמן ניתוק ה-backend. בהחלפת היישום יש הפרעה לשירות ה-backend;
אין כאן הבטחת zero-downtime.

## גיבוי ושחזור

הגיבוי הבא עוצר את הקונטיינר ואת הסוכנים שבו כדי להעתיק בית שאינו משתנה.
הפעלתו מחדש אינה מחזירה תהליכים שנעצרו. נדרש מקום לארכיון ולעותק המשוחזר.

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

## בדיקות נוספות

[מדריך הבדיקות](TESTING.md) כולל תהליכי דמה, בדיקת החלפת release וחזרה,
והסבר על סקריפטי האימות ל-Docker ול-Podman. הריצו בדיקות אלה על התקנה
נפרדת מזו שמריצה את הסוכנים שלכם.
