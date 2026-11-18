# בדיקת שימור תהליכים ונתונים

בדיקות אלה מיועדות לקונטיינר ניסוי עם בית נפרד. הן מתקינות כלים ו-releases,
מפעילות מחדש את ה-backend, ובסקריפטי האימות גם יוצרות מחדש את הקונטיינר.
להתקנה ולתחזוקה שוטפת ראו [מדריך השימוש](README.md).

## החלפת release וחזרה לגרסה הקודמת

תנאים: השלימו את ההתקנה במדריך, ודאו שה-backend רץ על release בשם `A`,
וטענו את משתני ההתקנה מהקובץ ששמרתם. הפקודות להלן משתמשות ב-Docker;
ל-Podman החליפו את פקודות `docker exec` ב-`podman exec`.

הבדיקה יוצרת שתי יחידות משתמש זמניות עם `SWAP_RUN_ID` ייחודי ומנקה אותן
בסוף. היא מחשבת את `uid` בעצמה, אך דורשת את `SRC`, `DC_AGENT_HOME`,
`DC_AGENT_NAME` ו-`DC_AGENT_PORT` מהמדריך.

A ו-B נבנים כאן מאותו מקור. זו בדיקת החלפת release, ולא שדרוג לגרסת קוד
חדשה. לשדרוג ראו את סעיף השדרוג במדריך. בחרו `DC_RELEASE_B_ID` חדש אם
תרצו לקבוע את המזהה בעצמכם; המתקין מסרב לדרוס תיקיית release קיימת.
שמרו releases ישנים כל עוד תהליכים משתמשים בהם.

הבדיקה מאמתת:

1. ה-backend ותהליך דמה פועלים עם Bun מתוך A.
2. אחרי החלפת ה-backend ל-B, תהליך הדמה נשאר עם אותו PID ו-Bun מתוך A.
3. תהליך דמה נוסף, שמופעל **במפורש עם הנתיב ל-B**, רץ עם Bun מתוך B.
4. אחרי החזרת ה-backend ל-A, תהליך הדמה הראשון נשאר עם אותו PID.

תהליך הדמה אינו סוכן דרך ממשק Drive Coding. הבדיקה אינה מאמתת בחירת
release אוטומטית עבור סוכן חדש, התחברות לספק או ביצוע turn.

קריאות `/proc` מתבצעות כמשתמש `dc`, שבבעלותו התהליכים. `set -euo pipefail`
עוצר את הרצף בכשל בדיקה, והמתנה ל-health קודמת לקריאת PID אחרי restart.
אם הבדיקה נעצרת באמצע, בדקו את `release.env` ואת שתי היחידות ששמותיהן
ב-`FIXTURE_A` ו-`FIXTURE_B` לפני המשך או ניקוי.

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
unit_pid() {   # MainPID של יחידת משתמש
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

# FIXTURE_A: זוג עצמאי שהבלוק הזה יוצר, אחרי אימות A ולפני התקנת B
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

# ניקוי — רק הזוג שהבלוק הזה יצר (לא נוגע ב-FIXTURE_A של סעיף "fixture")
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

## סקריפטי אימות מלאים

`guide-quickstart-e2e.sh` ל-Docker ו-`guide-podman-e2e.sh` ל-Podman בודקים
את חוזי ההתקנה: תוכן אפוי, systemd ו-linger, כלי משתמש, Recoll, החלפת
release, שימור קבצים אחרי יצירה מחדש, וגיבוי ושחזור. אלה בדיקות נפרדות
מפקודות ההתקנה הידניות; הצלחתן אינה טענה שכל פקודה במדריך הורצה כלשונה.

בדיקת Codex מאמתת שה-CLI זמין ושהעזרה כוללת `--device-auth`. התחברות
אמיתית מחייבת משתמש, ואינה חלק מהריצה האוטומטית.

הריצו את הסקריפט מתוך checkout של הקוד עם בית, שם קונטיינר ופורט המיועדים
לבדיקה בלבד. Podman דורש תמונה שכבר נבנתה או `DC_IMAGE_TAR` לטעינה.
עיינו במשתני `DC_SKIP_*` בראש הסקריפט לפני שימוש: ריצה שדילגה על בדיקות
מחזירה `PARTIAL` וקוד יציאה 2; ריצה מלאה שעברה מחזירה 0.

נדרש מקום לדיסק עבור מקור הקוד, releases A ו-B, ארכיון גיבוי ובית משוחזר.
`recoll-path-meta.sh` מאפשר להשוות מטא-דאטה לפני ואחרי יצירה מחדש;
`tree-sha256.sh` משווה תוכן קבצים ויעדי קישורים בגיבוי, ולא בעלות והרשאות.
