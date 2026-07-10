# Slice localhost-bind-hotfix — סגירת האזנה חיצונית כברירת מחדל — בריף

> **תאריך**: 2026-07-11
> **סוג מסמך**: בריף ביצועי/רטרואקטיבי להוטפיקס דחוף
> **סטטוס**: מאומת runtime / מוכן להחלטת commit
> **אימות אביגיל**: READY (r2; דוח: `reports/drive-coding/localhost-bind-hotfix-avigail-r2.md`)
> **אימות כלב**: GO (light; דוח: `reports/drive-coding/localhost-bind-hotfix-calev.md`)
> **Dispatch**: לא רלוונטי; ההוטפיקס כבר יושם בגלל חשיפה חיה. הבריף נועד לנעול אימות פורמלי לפני commit/merge.
> **Complexity**: 3/10 (verifier: calev light)
> **תלויות (`depends_on`)**: []
> **Base**: `dev`
> **Dev tip**: `6d99dcbf5e3750f637a0549e7658a1e0dbe39be7`

---

## §0 — Pre-flight

### תלויות

הסלייס מבוסס ישירות על `dev`; אין תלויות ב-slices אחרים.

### הקשר דחוף

השרת רץ ב-tmux על `:4000` והיה נגיש מבחוץ דרך `http://REDACTED-PUBLIC-IP:4000/`, כי `@hono/node-server` עלה ללא `hostname` מפורש והאזין על כל הממשקים.

ה-hotfix בוצע מיד: ברירת המחדל של backend bind היא `127.0.0.1`. לאחר מכן נוסף flag מפורש לפתיחה מכוונת החוצה.

### Worktree

לא לפתוח worktree חדש להוטפיקס הזה. העבודה כבר נמצאת ב-`dev` כדי לסגור חשיפה חיה. לפני commit, ודא שאין staging של קבצי `offline-page` או `@Vendor/`.

### איך להריץ

```bash
bun run --filter @drive-coding/core build
bun run --filter @drive-coding/core typecheck
bun run --filter @drive-coding/backend typecheck
cd packages/core && bun run test config-resolve
cd ../backend && bun run test load-config
bun run lint:i18n
```

Smoke חי, בלי לגעת בשרת tmux:

```bash
PORT=4098 DRIVE_CODING_HOST=127.0.0.1 bun packages/backend/src/bin/drive-coding.ts --env-file ../.env &
smoke_pid=$!
ss -ltnp 'sport = :4098'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4098/api/agents
kill "$smoke_pid"
```

### Reading list

must-read:
- `packages/backend/src/server.ts` — מקור ה-bind לשרת HTTP/HTTPS.
- `packages/backend/src/bin/drive-coding.ts` — CLI flag/help/defaults.
- `packages/backend/src/config/load-config.ts` — precedence של config/env/flag.
- `packages/core/src/config/schema.ts` — schema של `DriveCodingConfig`.
- `packages/backend/tests/load-config.test.ts`
- `packages/core/tests/config-resolve.test.ts`

---

## §1 — מטרה

כברירת מחדל, drive-coding מאזין רק על loopback (`127.0.0.1`) ולא נחשף לרשת/אינטרנט. משתמש שרוצה לפתוח את השרת במפורש יכול לעשות זאת דרך `--host 0.0.0.0` או `DRIVE_CODING_HOST=0.0.0.0`.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| bind default ל-`127.0.0.1` בשרת | ✅ | בסלייס הזה |
| `--host <addr>` ב-CLI | ✅ | בסלייס הזה |
| `DRIVE_CODING_HOST` כשכבת env/config | ✅ | בסלייס הזה |
| config file field `host` דרך `DriveCodingConfig` | ✅ | בסלייס הזה |
| טסטי precedence ל-host | ✅ | בסלייס הזה |
| systemd main/dev מצהירים loopback | ✅ | בסלייס הזה |
| docs מבהירים ש-CF tunnel חייב לפנות ל-localhost | ✅ | בסלייס הזה |
| firewall/ufw/cloud security group | ❌ | מחוץ ל-scope |
| auth לממשק | ❌ | slice נפרד |
| שינוי CORS | ❌ | מחוץ ל-scope |

---

## §3 — Architecture diagram

```text
CLI / config file / env
        |
        v
loadConfig()
  file.host < DRIVE_CODING_HOST < --host
        |
        v
process.env.DRIVE_CODING_HOST
        |
        v
packages/backend/src/server.ts
  hostname = DRIVE_CODING_HOST ?? "127.0.0.1"
        |
        v
@hono/node-server serve({ hostname, port, fetch })
```

---

## §4 — Commits בסדר

### Commit 0 — default loopback bind + explicit host override (approach: manual)

**קבצים משתנים**:
- `packages/backend/src/server.ts`
- `packages/backend/src/bin/drive-coding.ts`
- `packages/backend/src/config/load-config.ts`
- `packages/core/src/config/schema.ts`

**דרישות**:
- `server.ts` חייב להשתמש ב-`process.env.DRIVE_CODING_HOST ?? "127.0.0.1"`.
- קריאות `serve(...)` חייבות לקבל `hostname` גם במסלול HTTP וגם במסלול HTTPS.
- log `listening` חייב לכלול `hostname` ו-`port`.
- `drive-coding.ts` חייב לתמוך ב-`--host <addr>`, להציג אותו ב-`--help`, ולדחות `--host ""`.
- `load-config.ts` חייב לקרוא `DRIVE_CODING_HOST`, לקבל `--host`, ולכתוב `DRIVE_CODING_HOST` ל-`envPatch`.
- `schema.ts` חייב לכלול `"host?": "string"`.

**Verification**:

```bash
bun packages/backend/src/bin/drive-coding.ts --help
bun packages/backend/src/bin/drive-coding.ts --host ''
bun run --filter @drive-coding/backend typecheck
```

### Commit 1 — host precedence tests + smoke verification (approach: manual)

**קבצים משתנים**:
- `packages/backend/tests/load-config.test.ts`
- `packages/core/tests/config-resolve.test.ts`
- `deploy/systemd/voice-acp-main.service`
- `deploy/systemd/voice-acp-dev.service`
- `docs/deploy-local-service.md`

**דרישות**:
- `resolveConfig` בודק precedence ל-`host`.
- `loadConfig` בודק `DRIVE_CODING_HOST` ו-`--host` מול config file.
- smoke חי מאמת ששרת זמני על פורט אחר מאזין על `127.0.0.1:<port>`.
- אימות שרת חי על `:4000` מאמת `127.0.0.1:4000`, לא `*:4000`.
- יחידות systemd של main/dev מגדירות `DRIVE_CODING_HOST=127.0.0.1`.
- התיעוד דורש ש-CF tunnel ingress יפנה ל-`http://localhost:<port>`, לא לכתובת LAN.

**Verification**:

```bash
bun run --filter @drive-coding/core build
bun run --filter @drive-coding/core typecheck
bun run --filter @drive-coding/backend typecheck
cd packages/core && bun run test config-resolve
cd ../backend && bun run test load-config
bun run lint:i18n
ss -ltnp 'sport = :4000'
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | השרת החי לא חשוף החוצה | `ss -ltnp 'sport = :4000'` מציג `127.0.0.1:4000` |
| 2 | default בקוד הוא loopback | `server.ts` משתמש ב-`DRIVE_CODING_HOST ?? "127.0.0.1"` |
| 3 | override מפורש זמין | `drive-coding --help` מציג `--host <addr>` |
| 4 | config precedence תקין | טסטי `config-resolve` ו-`load-config` |
| 5 | typecheck ירוק | core/backend typecheck |
| 6 | i18n lint נקי | `bun run lint:i18n` |
| 7 | smoke זמני עובד | שרת זמני על `127.0.0.1:4098` + `/api/agents` מחזיר 200 |
| 8 | systemd לא פותח LAN בטעות | `deploy/systemd/voice-acp-*.service` מכילים `DRIVE_CODING_HOST=127.0.0.1` |
| 9 | CF tunnel path מתועד כ-localhost | `docs/deploy-local-service.md` לא מפנה ל-`192.168.x.x:<port>` |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| חשיפה חוזרת בטעות | bind default לא מפורש | default קשיח ל-`127.0.0.1` |
| משתמש צריך חשיפה מכוונת | tunnel/dev remote use cases | `--host` / `DRIVE_CODING_HOST` מפורשים |
| התנגשות עם env כללי `HOST` | env נפוץ בכלים אחרים | שם ייעודי `DRIVE_CODING_HOST` |
| build של backend רואה dist ישן של core | backend צורך types מ-`@drive-coding/core` | להריץ `bun run --filter @drive-coding/core build` לפני backend typecheck |
| CF tunnel נשבר אם ingress נשאר על LAN IP | השרת כבר לא מאזין על LAN | לעדכן routing ב-CF API ל-`http://localhost:<port>`; services/docs מצהירים זאת |

---

## §7 — Escalation triggers

- אם `ss` מראה `*:4000` אחרי restart.
- אם `--host 0.0.0.0` לא עובר דרך `loadConfig` לשרת.
- אם CF tunnel עדיין מוגדר ל-`192.168.x.x:<port>` במקום `localhost:<port>`.
- אם טסטי config נכשלו בגלל schema/ArkType.
- אם צריך auth או firewall כדי לסגור את הסיכון המיידי.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---:|
| Security-sensitive default | +2 |
| Cross-package config schema | +1 |
| Runtime smoke required | +1 |
| Small scoped change | -1 |

**Score**: 3/10

**Tier**: `calev light`.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם להוסיף auth לממשק? | לא בהוטפיקס הזה | ❌ |
| 2 | האם לעדכן systemd/tmux docs עם `--host`? | כן — כלול בסלייס | ❌ |

---

## סטיות מהתכנון

- 2026-07-11 — ההוטפיקס יושם לפני כתיבת הבריף כדי לסגור חשיפה חיה.
- 2026-07-11 — בעקבות אביגיל r1: נוסף scope מפורש ל-systemd/docs, ותוקנה פקודת smoke ל-background + PID.
- 2026-07-11 — אביגיל r2 החזירה READY, findings: 0.
- 2026-07-11 — כלב light החזיר GO, DoD 9/9, findings: 0.
