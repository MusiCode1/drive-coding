<div dir="rtl">

# drive-coding

[English](./README.md) · **עברית**

עוזר קוד מבוסס-AI — פקודה אחת מרימה את שרת ה-backend ומגישה את ממשק הווב
מאותו origin.

## התחלה מהירה

```bash
bunx drive-coding
```

הפקודה מרימה את השרת על **http://localhost:4000** ומגישה את ממשק הווב מאותו
origin. פתחו את ה-URL שמודפס בדפדפן.

> **דורש [Bun](https://bun.sh).** ה-binary רץ תחת Bun (`#!/usr/bin/env bun`).
> התקנת Bun: `curl -fsSL https://bun.sh/install | bash`.

להתקנה חד-פעמית והרצה חוזרת:

```bash
bun add -g drive-coding
drive-coding
```

## דרישות

- **Bun** ≥ 1.3 — סביבת הריצה.
- **CLI של agent** לסשני קוד בפועל. כברירת מחדל `drive-coding` מחפש את
  [`opencode`](https://opencode.ai) ב-`PATH`. השרת עולה גם בלעדיו (תופיע אזהרה) —
  נוח לעיון בממשק — אבל סשני agent דורשים agent זמין.

## הגדרה

ניתן להגדיר דרך **flags של CLI** או **משתני סביבה**.
‏Flags גוברים על משתני סביבה; משתני סביבה גוברים על ברירות המחדל.

### ‏CLI flags

```
drive-coding [options]

  -p, --port <n>            Port to listen on            (env: PORT, default: 4000)
      --opencode-bin <bin>  Agent binary to look for     (env: OPENCODE_BIN, default: opencode)
      --fe-static-dir <dir> Override served web-UI dir   (env: FE_STATIC_DIR)
      --cors-origins <list> Comma-separated CORS origins  (env: CORS_ORIGINS)
  -h, --help                Show this help and exit
  -V, --version             Show version and exit
```

```bash
drive-coding --port 4100
drive-coding --opencode-bin /opt/opencode/bin/opencode
drive-coding --help
drive-coding --version
```

### משתני סביבה

| משתנה | מה | ברירת מחדל |
|-------|-----|------------|
| `PORT` | הפורט שעליו השרת מאזין | `4000` |
| `OPENCODE_BIN` | נתיב/שם ה-agent binary לחיפוש | `opencode` |
| `FE_STATIC_DIR` | override לתיקיית ממשק הווב (נדיר) | ה-`frontend-dist` המבונדל |
| `CORS_ORIGINS` | רשימת origins מופרדים בפסיקים לאפשר | אותו origin בלבד |

```bash
PORT=4100 drive-coding                 # פורט מותאם (משתנה סביבה)
OPENCODE_BIN=/opt/opencode/bin/opencode drive-coding
```

## מה יש בפנים

חבילה אחת self-contained:

- שרת ה-backend (Hono) — REST API + WebSocket, מבונדל לקובץ יחיד;
- ממשק הווב הבנוי מראש, מוגש מאותו origin (אין תהליך שני, אין CORS);
- ה-plugin `prompt-injector`, נטען ע"י תהליך ה-agent ב-runtime.

בלי monorepo, בלי workspace, בלי build step מצדכם — הכל נשלח בחבילה.

## פתרון תקלות

| תופעה | סיבה / פתרון |
|-------|--------------|
| `Warning: agent binary "opencode" not found in PATH` | התקינו opencode, או הגדירו `OPENCODE_BIN` ל-agent שלכם. השרת עולה בכל מקרה. |
| `command not found: bunx` | התקינו Bun (`curl -fsSL https://bun.sh/install \| bash`), ואז הפעילו מחדש את ה-shell. |
| הפורט תפוס | הגדירו `PORT` לפורט פנוי, למשל `PORT=4100 drive-coding`. |
| הדף ריק / 404 על `/` | כנראה הגדרתם `FE_STATIC_DIR` לנתיב ריק או שגוי — בטלו אותו כדי להשתמש בממשק המבונדל. |

## רישיון

MIT

</div>
