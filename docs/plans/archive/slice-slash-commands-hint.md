# Slice — slash-commands-hint — תוכנית (הרחבת slice-slash-commands)

> **תאריך**: 2026-07-07
> **סטטוס**: טרם אימות (ממתין אביגיל)
> **Complexity**: 2/10 (verifier: light)
> **תלות**: `depends_on: []` — Commit נוסף על ה-worktree הקיים `slice/slash-commands` (הבסיס בוצע, GO×2, טרם merge)
> **base**: `slice/slash-commands` @ `f5a6817` (לא dev — זו הרחבת הסלייס לפני merge)

---

## §1 — מטרה

היום ה-`SlashCommandMenu` מציג פר-פקודה **שם + תיאור** בלבד. 7 מ-47 הפקודות של claude מקבלות
**ארגומנט**, וה-hint שלו כבר על ה-wire (`AvailableCommand.input.hint`) אך **לא מרונדר**. הרחבה זו
מציגה את ה-`hint` כרמז-ארגומנט ליד שם-הפקודה — בדיוק כמו ב-Zed/CLI — כך שהמשתמש רואה מה הפקודה
מצפה לקבל (למשל `/code-review [low|medium|high…] [--fix]`, `/compact <optional custom summarization…>`).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| הצגת `cmd.input?.hint` ליד שם-הפקודה ב-dropdown | ✅ | Commit יחיד |
| פקודה ללא `input` (`input:null`) — אין hint, ללא שינוי | ✅ (מבני) | — |
| שינוי VM / engine / BE / חוזה | ❌ | לא נדרש — השדה כבר ב-state, זו תצוגה בלבד |
| רינדור `hint` כ-form/שדות-קלט מובנים | ❌ | future (`slash-commands-typed` ומעבר) — כרגע טקסט-רמז בלבד |
| הבחנת סוגי-פקודה (סקיל/הרנס) | ❌ | slice נפרד `slash-commands-typed` (ר' decisions 2026-07-07) |

---

## §3 — עובדות-קוד מאומתות (לאביגיל לאמת)

- **Type**: `AvailableCommand` (SDK `@agentclientprotocol/sdk` 0.21.1, `zAvailableCommand`) =
  `{ name: string; description: string; input?: { hint: string } | null; _meta?: … }`.
  לכן הגישה הבטוחה ב-strict-TS: `cmd.input?.hint` (טיפוס `string | undefined`).
- **קובץ יחיד לשינוי**: `packages/frontend/src/lib/components/chat/SlashCommandMenu.svelte`.
  המבנה הנוכחי (שורות 53–67): `<button>` פר-match עם `<span>/{cmd.name}</span>` + `{#if cmd.description}<span>…</span>`.
- **נתונים אמיתיים** (הקלטת-wire `29175b45-…-1781776443783.jsonl`): 7 פקודות עם `input.hint` —
  `compact` (`<optional custom summarization instructions>`), `code-review`
  (`[low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<target>]`), `debug` (`[issue description]`),
  `simplify` (`[<target>]`), `batch` (`<instruction>`), `loop` (`[interval] [prompt]`), `design-sync`
  (`[<project hint, e.g. "Acme DS">]`). שאר 40 → `input:null` → אין hint.
- ה-`hint` הוא **data מהספק** (אנגלית דינמית) — **לא עובר `t()`** (עקבי עם `name`/`description`, ר' §6 בבריף המקורי).

---

## §4 — מימוש (Commit יחיד)

**Commit**: `feat(frontend): slash-commands hint — הצגת input.hint פר-פקודה ב-dropdown`

ב-`SlashCommandMenu.svelte`, בתוך ה-`<button>`, ליד ה-`<span>/{cmd.name}</span>`:

- להוסיף — כשקיים `cmd.input?.hint` — `<span>` נוסף עם ה-hint, בסגנון מובחן (משפחת-מונו + עמום, גודל `text-xs`),
  **inline באותה שורה** של שם-הפקודה (`/name` bold + hint עמום), כדי שהתיאור יישאר בשורה נפרדת מתחת.
- **הכרעת-layout ל-hint ארוך (code-review/compact)**: **truncate מקובל ומכוון** — ה-hint הוא *רמז לצורת-הארגומנט*,
  לא מפרט מלא; המשתמש רואה את תחילת הצורה (`/code-review [low|medium…`) ובוחר, וה-CLI/תיאור נותנים את השאר.
  לכן `min-w-0` + `truncate` על ה-hint (או `whitespace-nowrap`+`overflow-hidden`), **בלי wrap לשורה שנייה** —
  wrap היה שובר את גובה-הפריט האחיד ואת חישוב ה-`max-h-64`. hint חתוך = מצב תקין, לא "layout שבור".
- **Token צבע**: `--fg-muted` (קיים בכל הפלטות, `app.css`) — עמום **יותר** מ-`--fg-dim` שבו משתמש התיאור,
  כדי שההבחנה החזותית בין "hint של ארגומנט" (מונו, muted) לבין "תיאור" (dim) תהיה ברורה.

**ללא** שינוי ב-props/interface של הרכיב (ה-`matches: AvailableCommand[]` כבר נושא את `input`).

---

## §5 — Testing strategy + DoD

**Testing**: `manual/browser` (זהה ל-Commit 2 של הבסיס — תצוגה חזותית טהורה, אין לוגיקה חדשה ל-TDD).
`pnpm typecheck` חייב 0. `biome check` פרטני על הקובץ שנגע — נקי.

**DoD**:
1. `pnpm typecheck` = 0 (בפרט: `cmd.input?.hint` עובר `noUncheckedIndexedAccess`/strict ללא `any`/`!`).
2. חי (claude): הקלדת `/co` → בשורת `/code-review` מופיע ה-hint `[low|medium|high…]` ליד השם.
3. חי: `/compact`/`/code-review` (hints ארוכים) — ה-hint מוצג inline ו**truncate כשחורג** (גובה-הפריט נשמר, 0 שבירת-layout). hint חתוך = תקין.
4. חי: פקודה ללא ארגומנט (למשל `/context`, `/usage`) — **אין** hint, הפריט נראה כמו קודם (0 רגרסיה).
5. חי: ה-dropdown עדיין נפתח/מסונן/נבחר כרגיל (0 רגרסיה על התנהגות Commit 2).
6. `SlashCommandMenu` נשאר `depends_on:[]` על שאר-המערכת — שינוי מקומי לרכיב בלבד.

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| גלישת hint ארוך (compact) שוברת layout הפריט | `code-review`/`compact` hints ארוכים | `whitespace-nowrap`+`truncate` על ה-hint או flex `min-w-0`; אימות חי DoD#3 |
| בלבול חזותי בין hint לתיאור | שניהם טקסט עמום | גוון/משפחה מובחנים (מונו לרמז); אימות חי |
| רגרסיה על portal/מיקום מ-Commit 2 | תוספת אלמנט משנה גובה-פריט | flex-col קיים סופג; אימות DoD#5 |

---

## §7 — Complexity

**2/10** — קובץ יחיד, תצוגה בלבד, אפס לוגיקה/VM/BE. verifier: **light**.

## §8 — הערות merge

הרחבה זו מתמזגת **יחד עם הבסיס** (`slice/slash-commands`) כ-Commit נוסף — לא merge נפרד.
אחרי calev GO + preview מחודש שהמשתמשת מאשרת → merge `slice/slash-commands` (4 commits) ל-dev.
