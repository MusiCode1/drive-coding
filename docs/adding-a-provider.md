# הוספת ספק ACP חדש (checklist)

מסמך זה מתעד את המתכון המינימלי הקיים כבר בקוד להוספת ספק **spawn** חדש (CLI חיצוני
שמדבר ACP דרך stdio) — הוכח פעמיים בפועל (Cursor + Grok, `slice-cursor-acp`,
2026-07-11). זו **לא** מנגנון-קונפיגורציה חדש — זה תיעוד של מה שכבר עובד, כדי שהוספת
ספק ה-spawn הבאה תהיה checklist ולא מחקר-מחדש.

> ל-in-process hosting (כמו `claude`/`codex`) יש נתיב שונה ומורכב יותר — לא מכוסה כאן.

---

## Checklist

### 1. רשומה ב-`CLI_SPECS`

`packages/core/src/schemas/agent.ts`:

```ts
export const CLI_SPECS = {
  // ...קיימים
  <name>: {
    bin: "<binary>",
    args: ["<arg1>", "<arg2>", ...],
    supportsModelFlag: <true|false>,
  },
} as const satisfies Record<string, CliSpec>
```

`CLI_KINDS`/`CliKind` (arktype union) נגזרים אוטומטית ממפתחות `CLI_SPECS` — אין
מקום שני לעדכן.

⚠️ **`supportsModelFlag`**: אם ה-CLI לא תומך ב-`--model` בכלל, או שהוא תומך אבל
**במיקום ספציפי ב-argv** שלא תואם למימוש הנוכחי של `getCliCommand` (שמוסיף `--model`
**בסוף** רשימת ה-args) — חובה `false`. דוגמה חיה: Grok דורש `grok agent --model X
stdio` ולא `grok agent stdio --model X` (הראשון FAIL exit 2) — לכן `supportsModelFlag:
false` אצלו, למרות שה-CLI **כן** תומך ב-flag עקרונית. בדוק argv אמיתי לפני שמסמנים
`true`.

### 2. `staticCapsFor` — case אופציונלי

`packages/provider/src/connection/capabilities-static.ts` — הוסף `case "<name>"` רק
אם היכולות הסטטיות שונות מ-`default` (כרגע `default` מכסה MVP פונקציונלית; ה-`mcp`
היחיד שדורש לרוב `case` ייעודי אם ה-CLI תומך `http`/`sse`).

### 3. `authenticate` — בדוק אם נדרש

בדוק בתגובת `initialize` של ה-CLI: אם `authMethods` **לא ריק** — השכבה הגנרית
ב-`packages/provider/src/client/client.ts` כבר קוראת `authenticate` אוטומטית **בלי
שינוי קוד**:

- `resolveAuthMethodId` בוחר `methodId` לפי `PREFERRED`-list (סדר עדיפות), ואם אין
  התאמה — נופל לראשון ברשימת ה-`authMethods` שה-CLI החזיר.
- **הוסף `methodId` ל-`PREFERRED`** רק אם יש לספק שלך עדיפות ספציפית (כמו
  `cached_token` ל-Grok). אחרת ה-fallback-לראשון כבר עובד בלי שום שינוי.
- כישלון `authenticate` הוא **לא-פאטלי כברירת מחדל** — `isAuthRequiredError`
  (`client.ts`) בודק אם זו שגיאת `auth_required` אמיתית (`data.code ===
  "auth_required"`); אם כן — פאטלי (סוגר transport, זורק). אחרת (למשל CLI שמכריז
  `authMethods` לא-ריק אבל לא מיישם את ה-RPC בפועל, כמו opencode) — `console.warn`
  + ממשיך כאילו `authenticate` לא נקרא. **אל תהפוך את זה לפאטלי-תמיד** בלי לוודא
  שזה לא שובר ספק קיים — ר' `reports/drive-coding/cursor-acp-calev.md` לרגרסיה
  חיה שנתפסה בדיוק על זה.
- אם `authMethods` ריק/חסר — `authenticate` לא נקרא בכלל (ספקים כמו claude/codex
  לא מושפעים).

### 4. Extensions חוסמים (blocking ext)

אם ה-CLI שולח בקשות-הרחבה שחוסמות את ה-turn עד תשובה (כמו `cursor/ask_question`,
`cursor/create_plan` אצל Cursor) — הוסף handler ב-`extMethod` של
`packages/provider/src/client/client-impl.ts` שמחזיר תשובה בטוחה (לא לתקוע את ה-UI).
דוגמה: `cursor/ask_question` → `{ outcome: { outcome: "skipped" } }`.

### 5. Deploy override + docs

- `deploy/cli-specs.jsonc` — הוסף שורת-הערה (מוערת) לדוגמת override של `bin` (נתיב
  מלא) — שימושי כש-הבינארי לא ב-PATH (נפוץ ב-Windows).
- `docs/running-locally.md` — פסקה קצרה: login/env vars נדרשים, הערות ידועות
  (rate-limit/free-tier, upstream bugs).

### 6. טסטים

- `packages/core/tests/agent-schema.test.ts` — ודא ש-`CLI_KINDS` כולל את הספק החדש
  (אם הטסט לולאה כללית על `CLI_KINDS` — אין צורך בשינוי; אם הוא רשימה קשיחה —
  הרחב).
- `packages/provider/cli-config.test.ts` — `getCliCommand("<name>")` מחזיר
  `{ bin, args }` צפויים; אם `supportsModelFlag: false` — ודא ש-`modelOverride` לא
  מוסיף `--model` ל-args.

---

## מה כבר אוטומטי — בלי לגעת בקוד

- **ניתוב spawn** (`packages/backend/src/acp/connection-registry.ts`) — כל `cliKind`
  שאינו `claude`/`codex` נופל אוטומטית ל-`connectSpawn`. אין רשימה נפרדת לעדכן.
- **`authenticate` גנרי** (מ-`slice-cursor-acp` Commit 1) — ר' §3 למעלה.
- **דרופדאון ה-FE** (`packages/frontend/src/routes/+page.svelte`) — נגזר מ-`CLI_KINDS`
  (`options={CLI_KINDS.map(...)}`). אין רשימת FE נפרדת.

---

## למה לא config-driven מלא (JSON בלי קוד)

`CliKind` הוא union סגור **בזמן-קומפילציה** (`packages/core/src/schemas/agent.ts`,
`CLI_KINDS`/`CliKind` נגזרים ממפתחות `CLI_SPECS`), הנצרך בכל שכבות ה-FE/BE: arktype
validation, VMs (`permission-mode.ts`, `agent-session.svelte.ts`), ודרופדאון ה-FE.
הפיכתו ל-`CliKind: string` דינמי מ-JSON runtime תפגע ב-type-safety (עיקרון-הפרויקט:
"No `any`", ArkType בכל מקום) ותרחיב את ה-scope לכל השכבות.

הוחלט במפורש (2026-07-11, `slice-cursor-acp`) **לא** לבנות מנגנון-registry
config-driven מלא בסלייס הזה — המתכון הקיים (checklist זה) מספיק, והרעיון המלא נרשם
כפריט עתידי נפרד ב-`docs/roadmap.md` (Track A) לשיקול אם/כש-קצב הוספת-ספקים יצדיק את
מחיר ה-type-safety.
