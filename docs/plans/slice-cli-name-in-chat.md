# Slice cli-name-in-chat — הצגת שם ה-CLI הפעיל במסך הצ'אט — תוכנית

> **תאריך**: 2026-07-03 · **תיקון r1**: 2026-07-03 (אביגיל USABLE-AFTER-FIX → הוכרע מנגנון-ריאקטיביות)
> **סטטוס**: ✅ מאושר (אביגיל r2 READY — 2026-07-03) · ready ל-dispatch
> **Complexity**: 3/10 (verifier: light)
> **תלות (depends_on)**: `[]` — עצמאי. נוגע ב-`agent-session.svelte.ts` (getter) + `SessionOptionsPanel.svelte` + קטלוגי i18n.
> **Base**: `dev` HEAD `c5deb8f`.

> **⚠️ הכרעת-מרדכי אחרי אביגיל r1 (finding 🔴)**: `#cliKind` (`agent-session.svelte.ts:251`) הוא שדה פרטי **לא-`$state`**, וה-VM הוא **singleton** (`+layout.svelte:72`) שהפאנל קורא דרך `getSession()` **בלי `{#key}`** → getter רגיל עליו **לא-ריאקטיבי**, וה-badge ייתקע במעבר-CLI חי. **ההכרעה: הופכים את `#cliKind` ל-`$state`** (Commit 1). זה **בטוח**: `CliKind` הוא primitive (string|null) → signal פשוט בלי proxy; הקריאות ב-reconnect guards הן קריאות-מתודה **סינכרוניות** ולא מושפעות מ-`$state` (רק contexts ריאקטיביים מגיבים לשינוי). ההנחה השגויה ב-§6 (remount) הוסרה.

---

## §0 — Pre-flight

### רקע — הערך קיים אך פרטי
- ה-CLI הפעיל של הסשן יושב ב-`#cliKind: CliKind | null` **פרטי** ב-`packages/frontend/src/lib/view-models/agent-session.svelte.ts:251`. **אין getter ציבורי** → ה-UI לא יכול להציג אותו.
- `CliKind` = `"claude" | "opencode" | "codex"` (מ-`@drive-coding/core`; רשימה `CLI_KINDS`).
- היום ה-CLI נבחר במסך-החיבור (`+page.svelte:120-129`) ומוצג שם כמחרוזת גולמית ב-dropdown — אבל **בתוך** הצ'אט אין אינדיקציה באיזה CLI אתה. זו הבקשה.
- מיקום היעד (בקשת המשתמשת): **מעל** סקשן "אפשרויות סוכן" ב-`SessionOptionsPanel.svelte` (הכותרת `{t("sidebar.agentOptions")}` בשורות 330-333).

### Worktree
```bash
git worktree add .worktrees/cli-name-in-chat -b slice/cli-name-in-chat dev
cd .worktrees/cli-name-in-chat
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- FE: `pnpm --filter @drive-coding/frontend dev` (port OS-assigned)

### Browser
- Chrome רגיל. התחבר לתיקייה כלשהי עם CLI `opencode` → פתח את פאנל-הצד (דסקטופ) / ה-sheet (מובייל) → ודא ששם ה-CLI ("opencode") מוצג מעל "אפשרויות סוכן".

### OneCLI
- `voice-acp` (רק כדי שהתחברות ל-opencode/claude תעבוד; הפיצ'ר עצמו FE-טהור).

### Reading list
**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:250-296` (איפה `#cliKind` + דפוס ה-get_for_test).
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte:36-45` (`getSession()`) + `:325-334` (ראש אזור-הגלילה + כותרת "אפשרויות סוכן").

**reference**:
- `packages/core/src/i18n/catalogs/{he,en}.ts` + `keys.ts`.

---

## §1 — מטרה

אחרי הסלייס, בתוך הצ'אט (בפאנל-הצד/ה-sheet, מעל "אפשרויות סוכן") מוצג בבירור באיזה CLI הסשן הנוכחי רץ — `claude` / `opencode` / `codex` — כך שהמשתמשת יודעת מיד מול מי היא עובדת, בלי לחזור למסך-החיבור.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| getter ציבורי `session.cliKind` | ✅ | Commit 1 |
| שורת-תווית "פועל על: <cli>" מעל "אפשרויות סוכן" | ✅ | Commit 2 |
| מפתח i18n `sidebar.runningOn` | ✅ | Commit 2 |
| הצגה גם ב-`AppHeader` העליון | ❌ | ר' §9 Q1 — ברירת-מחדל: פאנל בלבד (כבקשת המשתמשת "מעל אפשרויות סוכן") |
| אייקון/לוגו פר-CLI | ❌ | future — טקסט בלבד עכשיו |
| תרגום שמות ה-CLI ("claude"→"Claude Code") | ❌ | future — מציגים את ה-kind הגולמי (מזוהה חד-משמעית) |

## §3 — Architecture diagram

```
view-model                            component (layout)
AgentSession (singleton)              SessionOptionsPanel.svelte
  #cliKind = $state<CliKind|null>()    const session = getSession()
  get cliKind(): CliKind|null   ◄────── {#if session.cliKind}
      return this.#cliKind                <div>{t("sidebar.runningOn")}: {session.cliKind}</div>  ← מעל "אפשרויות סוכן"
      (ריאקטיבי — $state)               {/if}
```
> שכבה: הפיכת שדה קיים ל-`$state` + getter ב-VM + הצגה ב-component. **לא TDD** (glue/UI). אין core-logic. הריאקטיביות (`$state`) היא מה שהופך את ה-badge לעקבי במעבר-CLI.

## §4 — Commits

### Commit 1 — הפיכת `#cliKind` ל-`$state` + getter ציבורי ריאקטיבי (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — שני שינויים בלבד:
  1. **שורה 251** — הפוך את ההצהרה ל-`$state` (זהו הליבה — בלעדיו ה-getter לא-ריאקטיבי):
```ts
// לפני:  #cliKind: CliKind | null = null
// אחרי:
/** ה-CLI של ה-attach/loadSession האחרון — $state כדי שה-getter הציבורי יהיה ריאקטיבי (slice cli-name-in-chat). */
#cliKind = $state<CliKind | null>(null)
```
  2. **getter ציבורי** ליד שאר ה-accessors:
```ts
/** ה-CLI של הסשן הפעיל (claude/opencode/codex), או null כשאין סשן. slice cli-name-in-chat. */
get cliKind(): CliKind | null {
  return this.#cliKind
}
```
> - `CliKind` כבר מיובא (`agent-session.svelte.ts:19`). הקובץ הוא `.svelte.ts` (runes פעילים) → `$state` על שדה פרטי נתמך.
> - **אין לגעת** ב-3 ה-setters (`attach:627`, `loadSession:797`, `attachToLiveAgent:890`) ולא ב-reconnect guards שקוראים `#cliKind` — הם קריאות/כתיבות **סינכרוניות** רגילות; `$state` על primitive (string|null) הוא signal בלי proxy → אפס שינוי-התנהגות שם.
> - **אל** תוסיף שדה-מראה ציבורי נפרד — ה-`$state` הישיר על `#cliKind` הוא הפתרון הנקי (מקור-אמת יחיד).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck   # ירוק — $state על #private תקין ב-.svelte.ts
pnpm --filter @drive-coding/frontend test        # אם יש טסטים על agent-session (reconnect/attach) — ירוקים (לא אמורים להיפגע)
```

### Commit 2 — הצגה ב-SessionOptionsPanel + i18n (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — הוספת שורת-תווית **מעל** בלוק "אפשרויות סוכן" (מיד אחרי פתיחת `<div class="flex flex-col gap-4 ... overflow-y-auto ...">` בשורה 327, לפני `<!-- אפשרויות סוכן -->` בשורה 329):
```svelte
{#if session.cliKind}
  <div class="flex items-center gap-2 px-1 shrink-0 text-[11px]" style="color:var(--fg-dim)">
    <span class="uppercase tracking-wider font-semibold">{t("sidebar.runningOn")}</span>
    <span class="px-2 py-0.5 rounded-md font-mono font-semibold"
          style="background:var(--bg-card); border:1px solid var(--border); color:var(--fg)"
          dir="ltr">{session.cliKind}</span>
  </div>
{/if}
```
  > `session` ו-`t` כבר קיימים בקובץ (`:37`, `:36`). שם ה-CLI ב-`dir="ltr"` (מונח לועזי). CSS-vars קיימים (עקביות themes).
- `packages/core/src/i18n/keys.ts` — הוספת `"sidebar.runningOn"` ל-registry.
- `packages/core/src/i18n/catalogs/he.ts` — `"sidebar.runningOn": "פועל על"`.
- `packages/core/src/i18n/catalogs/en.ts` — `"sidebar.runningOn": "Running on"`.

**Verification**:
```bash
pnpm --filter @drive-coding/core build && pnpm --filter @drive-coding/frontend typecheck
pnpm lint:i18n   # "פועל על" רק בקטלוג; בקוד רק t()
# smoke: התחבר עם opencode → פאנל-צד מציג "פועל על  opencode" מעל אפשרויות סוכן
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `session.cliKind` getter ציבורי, קריאה-בלבד | code review + typecheck |
| מחובר → שם ה-CLI מוצג מעל "אפשרויות סוכן" | smoke בדפדפן (opencode/claude) |
| לא-מחובר (`cliKind===null`) → השורה מוסתרת (אין "null") | smoke: מסך-חיבור/detach |
| שם ה-CLI ב-`dir="ltr"` (לא נשבר ב-RTL) | code review + מבט בעברית |
| מפתח `sidebar.runningOn` קיים ב-he+en | typecheck + טסט-שלמות-קטלוגים (אם קיים) |
| `pnpm lint:i18n` נקי | הפקודה |
| typecheck 0 | הפקודה |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחרוזת עברית קשיחה ("פועל על") → pre-commit חוסם | learnings gotcha #1 | רק בקטלוג `he.ts`; בקוד `t("sidebar.runningOn")` |
| `session.cliKind` לא ריאקטיבי → ה-badge נתקע ב-CLI הראשון | אביגיל r1 🔴 (VM singleton, פאנל בלי `{#key}`) | **נפתר ב-Commit 1**: `#cliKind` הופך ל-`$state` → ה-getter ריאקטיבי, ה-badge מתעדכן בכל מעבר-CLI חי. (ההנחה הישנה על "remount של הפאנל" הייתה **שגויה עובדתית** — אין remount; לכן `$state` הכרחי, לא אופציונלי.) |
| הצגת השורה גם כשאין סשן → "null" | — | `{#if session.cliKind}` — guard מפורש (DoD) |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- הפיכת `#cliKind` ל-`$state` **שוברת** טסט קיים של reconnect/attach (לא צפוי — primitive signal בלי proxy) → סימן ל-coupling לא-מתועד. **אל תעקוף** — דווח.
- ה-badge עדיין לא מתעדכן במעבר-CLI חי גם אחרי `$state` (סימן שהמעבר לא עובר דרך ה-setters שמופו) — escalate עם ה-frame/flow.
- המשתמשת/מרדכי מעדיפים גם ב-`AppHeader` (§9 Q1) — שינוי מיקום.

## §8 — Complexity score

- commits: 2 · שכבות חדשות: 0 · APIs חיצוניים: 0 · async/streaming: לא · state refactor: לא · protocol: לא.
- getter קריאה-בלבד + הצגת-טקסט + 1 מפתח i18n.

**Score ≈ 3/10 → verifier `calev` mode: light.**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | גם ב-`AppHeader` העליון (תמיד גלוי) בנוסף לפאנל? | פאנל בלבד (בקשת המשתמשת "מעל אפשרויות סוכן"). קל להוסיף להדר בהמשך. | ❌ |
| 2 | תווית "פועל על" או "CLI" או "מנוע"? | "פועל על" (he) / "Running on" (en). | ❌ |
| 3 | להציג את ה-kind הגולמי (`opencode`) או שם-יפה ("Claude Code")? | גולמי — חד-משמעי, אפס תחזוקת-מיפוי. | ❌ |
