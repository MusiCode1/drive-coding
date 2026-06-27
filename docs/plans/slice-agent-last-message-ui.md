# Slice — agent-last-message-ui — ‏תוכנית

> **‏תאריך**: 2026-06-27
> **‏סטטוס**: ‏טיוטה (‏ממתין לאביגיל)
> **Complexity**: 2/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [agent-last-message-at]
> **‏Base**: `slice/agent-last-message-at` (‏BE slice ‏שלא מוזג ל-dev עדיין — ‏שרשור)
> **‏Dev tip של ה-base**: `b711d7f`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏מבוסס על** `agent-last-message-at` (status: ‏מאומת — ‏אביגיל READY, ‏כלב GO — ‏אך **‏לא מוזג ל-dev**):
- ‏אותו slice ‏מוסיף את השדה `lastMessageAt?: number | null` ‏ל-`AgentPublic` (epoch-ms ‏של הפלט האחרון של הסוכן, runtime-only) ‏ומחזיר אותו ב-`GET /api/agents`.
- ‏**‏בלעדיו ה-FE ‏לא יקבל את השדה** → ‏ה-slice הזה חסר-משמעות בלי ה-base.
- ‏לכן `base = slice/agent-last-message-at`, **‏לא dev**. ‏זו שרשרת: ‏אם ה-base ימוזג ל-dev לפני dispatch, ‏עדכן את ה-base ל-dev.

### Worktree

```bash
cd d:/UserProjects/AI/drive-coding/dev
git worktree add .worktrees/agent-last-message-ui -b slice/agent-last-message-ui slice/agent-last-message-at
cd .worktrees/agent-last-message-ui
pnpm install && pnpm hooks:install
```

> ‏ה-FE ‏משתמש בנכסים סטטיים untracked (‏תמונות/סאונד). ‏אם חסרים ב-worktree — ‏הרץ את ה-skill `git-worktree-shared-assets` (Windows Junction) ‏אחרי היצירה. ‏ל-slice הזה (‏רק זמן-יחסי ‏בפאנל) ‏כנראה לא נדרש, ‏אך אם בדיקה חזותית נכשלת על נכס חסר — ‏זו הסיבה.

### ‏איך להריץ

- BE: ‏מתוך `packages/backend` — Windows ‏ישיר (‏אין צורך ב-TTS proxy לבדיקה הזו): `PORT=4010 bun src/server.ts`. ‏(‏ל-onecli ‏אין צורך כאן.)
- FE: ‏מהשורש — `pnpm --filter @drive-coding/frontend dev` (‏Vite port OS-assigned; ‏proxy ל-BE ‏דרך `BE_PORT=4010 pnpm --filter @drive-coding/frontend dev` ‏אם ה-BE ‏לא על 4000).
- Tests: ‏מהשורש — `pnpm test packages/frontend/src/lib/util/formatting.test.ts`
- typecheck: `pnpm --filter @drive-coding/frontend run typecheck` (+ `@drive-coding/core` ‏אם נגעת ב-keys).

### Browser

‏linux-gui ‏עם `pw-clean.sh`, ‏או מכונה אמיתית. ‏הבדיקה החזותית: ‏פאנל "‏סוכנים פעילים" → ‏שורת metadata ‏של סוכן מציגה "‏לפני X דק'".

### Reading list

**must-read**:
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte` — ‏הווידג'ט (‏מציג כיום `createdAt` ‏מוחלט, busy, pid, acpSessionId; ‏יש כבר `$effect`+`setInterval(12s)` ‏ל-refresh).
- `packages/frontend/src/lib/components/connect/SessionPicker.svelte` ‏שורות 33-46 — ‏הדפוס הקיים ל-`Intl.RelativeTimeFormat` (‏מקור הלוגיקה לחיקוי).
- `packages/frontend/src/lib/util/formatting.ts` — ‏יעד ה-util ‏החדש (‏כיום רק `formatTime`).
- `packages/frontend/src/lib/view-models/i18n.svelte.ts` ‏שורות 23-28 — ‏ה-getter ‏הריאקטיבי `locale` (‏מקור ל-locale ‏הנכון, ‏במקום hardcode).
- `packages/core/src/i18n/keys.ts` ‏שורות ~186-197 (‏בלוק active-agents) + `packages/core/src/i18n/catalogs/*.ts`.

**reference**:
- `docs/design-principles.md` §1-5 (‏5 ‏שכבות; util ‏טהור → `lib/util/`).
- `packages/frontend/AGENTS.md` (‏five golden rules).

---

## §1 — ‏מטרה

‏בפאנל "‏סוכנים פעילים", ‏לצד כל סוכן, ‏המשתמשת רואה **‏מתי הסוכן שלח פלט לאחרונה** ‏כזמן יחסי קריא ("‏לפני 2 ‏דק'", "‏לפני שעה", "‏עכשיו") ‏בשפת הממשק. ‏הערך מתעדכן מעצמו (‏מתקדם מ"‏לפני 2 ‏דק'" ל"‏לפני 3 ‏דק'") ‏ככל שעובר הזמן, ‏בלי לרענן את הדף. ‏זה נותן מבט-על מהיר על אילו סוכנים פעילים-עכשיו ואילו שקטים מזמן.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏util ‏טהור ‏`formatRelativeTime(epochMs, locale, now?)` ‏ב-`formatting.ts` (TDD) | ✅ | ‏בslice הזה |
| ‏render ‏של `agent.lastMessageAt` ‏כזמן יחסי ב-`ActiveProcessesPanel` | ✅ | ‏בslice הזה |
| ‏key ‏i18n ‏ל-label/aria ‏של השדה ("‏פעילות אחרונה") | ✅ | ‏בslice הזה |
| ‏טיפול ב-`null`/`undefined` (‏טרם פלט / ‏סוכן בלי bridge) — ‏לא להציג זמן | ✅ | ‏בslice הזה |
| ‏tick-timer ‏ייעודי לרענון הזמן | ❌ | ‏**‏מיותר** — ‏ה-`setInterval(12s)` ‏הקיים כבר מרנדר מחדש (‏ר' §6) |
| ‏החלפת `createdAt` ‏המוחלט בזמן יחסי | ❌ | ‏מחוץ ל-scope (createdAt ‏נשאר כפי שהוא) |
| ‏refactor ‏של `SessionPicker.formatDate` ‏לשימוש ב-util ‏המשותף | ❌ | ‏slice עתידי (‏ר' §9 ‏ש"פ 2 — ‏להימנע מ-regression ‏ב-SessionPicker) |
| ‏locale-aware ‏(‏לא hardcode "he") | ✅ | ‏בslice הזה — ‏locale ‏מ-i18n |

---

## §3 — Architecture diagram

```
‏GET /api/agents  ──(‏כבר מ-base slice)──►  AgentPublic.lastMessageAt: number|null (epoch-ms)
        │
        ▼
ActiveAgents VM (active-agents.svelte.ts)   ← ‏קיים, ‏לא משתנה
   agents = $state<AgentPublic[]>           ← refresh() ‏כל 12s ‏מחליף את ה-array
        │
        ▼
ActiveProcessesPanel.svelte                 ← ‏קיים, ‏משתנה (render בלבד)
   {#each agents as agent (agent.id)}
      ...status/busy/pid...                  ← ‏קיים
      {#if agent.lastMessageAt != null}      ← ‏חדש
         {formatRelativeTime(               ← ‏חדש — ‏קריאה inline ב-render
            agent.lastMessageAt,             ←   (Date.now() ‏טרי בכל re-render)
            i18n.locale)}
        │
        ▼
lib/util/formatting.ts                       ← ‏קיים, ‏מתווסף
   formatRelativeTime(epochMs, locale, now?) ← ‏חדש, ‏טהור, TDD
      └─ Intl.RelativeTimeFormat(locale,{numeric:"auto"})
```

---

## §4 — Commits ‏בסדר

### Commit 0 — util ‏זמן-יחסי טהור (approach: **tdd**)

**‏קבצים חדשים**: ‏אין (‏מרחיב קובץ קיים).

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/util/formatting.ts` — ‏מוסיף `formatRelativeTime`. ‏לא נוגע ב-`formatTime`.
- `packages/frontend/src/lib/util/formatting.test.ts` — ‏מוסיף describe ל-`formatRelativeTime`.

**API skeleton** (‏החתימה המדויקת — executor ‏אסור לשנות):

```ts
/**
 * זמן יחסי קריא ("לפני 2 דקות" / "עכשיו") מתוך epoch-ms.
 * @param epochMs  זמן הפלט (Date.getTime()/Date.now()), epoch-ms.
 * @param locale   קוד locale (למשל "he" / "en") — מ-i18n, לא hardcode.
 * @param now      epoch-ms נוכחי; ברירת מחדל Date.now(). מוזרק לדטרמיניזם בטסט.
 */
export function formatRelativeTime(epochMs: number, locale: string, now?: number): string
```

**‏לוגיקה מחייבת**:
- `diff = (now ?? Date.now()) - epochMs`.
- **clamp עתיד**: ‏אם `diff < 0` (clock skew) → ‏התייחס כ-0.
- `Intl.RelativeTimeFormat(locale, { numeric: "auto" })`.
- ‏בחירת יחידה: `< 60s` → second · `< 60m` → minute · `< 24h` → hour · ‏אחרת → day. ‏(‏מספר שלילי ל-RTF: ‏עבר.)
- `< 1s` (‏או diff clamped ל-0) → `rtf.format(0, "second")` (‏נותן "‏כעת"/"now" ‏לפי locale, numeric:auto).
- ‏ללא try/catch ‏מסביב ל-`Intl` (‏locale ‏תקין מובטח מ-i18n; ‏פונקציה טהורה).

**‏מקרי-טסט מחייבים** (‏now ‏מוזרק — ‏דטרמיניזם):
1. `now - epochMs = 0` → ‏"‏כעת"/now (‏he/en).
2. ‏30s → minute? ‏לא — second ("‏לפני 30 ‏שניות").
3. ‏120_000ms (2 ‏דק') → "‏לפני 2 ‏דקות" (he).
4. ‏90 ‏דק' → "‏לפני שעה" (numeric:auto, he).
5. ‏26 ‏שעות → "‏אתמול"/"‏לפני יום" (he, numeric:auto).
6. ‏עתיד (`diff < 0`) → ‏לא קורס; ‏מחזיר "‏כעת"/now (clamp).
7. locale="en" → ‏פלט אנגלי ("2 minutes ago").

**Verification**:
```bash
pnpm test packages/frontend/src/lib/util/formatting.test.ts
pnpm --filter @drive-coding/frontend run typecheck
```

### Commit 1 — i18n key ‏ל-label (approach: **none** — ‏טקסט בלבד)

**‏קבצים שמשתנים**:
- `packages/core/src/i18n/keys.ts` — ‏מוסיף לבלוק active-agents: `| "connect.agents.lastMessage"`. ‏**‏ממצא אביגיל 🟢**: ‏הבלוק מסתיים ב-`keys.ts:197` (‏אחרי `connect.agents.working`) — ‏הוסף את ה-key ‏בסוף הבלוק, ‏שם.
- `packages/core/src/i18n/catalogs/he.ts` — `"connect.agents.lastMessage": "פעילות אחרונה",`
- **‏כל קטלוג אחר תחת `catalogs/`** (‏בדוק את התיקייה — ‏יש en?) — ‏ערך מתאים ("Last activity"). ‏**‏חובה לעדכן את כולם** — ‏מפתח חסר בקטלוג = ‏typecheck/test ‏אדום.

**Verification**:
```bash
pnpm --filter @drive-coding/core run build
pnpm --filter @drive-coding/core run typecheck   # מוודא שכל הקטלוגים מכסים את ה-key
```

### Commit 2 — render ‏בווידג'ט (approach: **manual** — ‏visual)

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte`:
  - import `formatRelativeTime` ‏מ-`$lib/util/formatting`. ⚠️ **‏ממצא אביגיל 🟢**: ‏הקומפוננטה כבר מכילה `formatDate(iso)` ‏מקומי שמשרת את `createdAt` ‏(‏תאריך מוחלט) — ‏**‏אל תחליף/‏תבלבל אותו**; ‏ה-util ‏החדש נפרד ומיועד ל-`lastMessageAt` ‏בלבד.
  - ‏גישה ל-`i18n.locale` (‏ה-i18n ‏כבר מיובא — `getI18n()`; ‏השתמש ב-`i18n.locale`).
  - ‏בשורת ה-metadata ‏של כל סוכן (‏ליד/אחרי ה-`busy`/`pid`), ‏הוסף:
    ```svelte
    {#if agent.lastMessageAt != null}
      <span class="last-msg" title={t("connect.agents.lastMessage")}>
        {formatRelativeTime(agent.lastMessageAt, i18n.locale)}
      </span>
    {/if}
    ```
  - **‏אל תוסיף tick-timer** — ‏ה-`$effect`+`setInterval(12s)` ‏הקיים מספיק (§6).
  - ‏עיצוב: ‏עקבי עם ה-metadata ‏הקיים (‏קלאסים לוגיים, ‏לא physical left/right — ‏ר' rtl).

**DELETE block**: ‏אין.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend run typecheck
pnpm lint:i18n        # אסור מחרוזת עברית קשיחה בקוד — הכל דרך t() / Intl
# manual: BE על 4010 + agent חי שפולט; פתח הפאנל; ודא "לפני X" מופיע ומתקדם
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | util ‏עובר טסטים | `pnpm test .../formatting.test.ts` — ‏כל 7 ‏המקרים ירוקים |
| 2 | typecheck + build (core+frontend) | `pnpm --filter @drive-coding/core run build && pnpm --filter @drive-coding/frontend run typecheck` |
| 3 | lint:i18n ‏נקי | `pnpm lint:i18n` — ‏אין מחרוזת עברית קשיחה |
| 4 | ‏זמן יחסי מוצג | ‏BE+agent ‏חי, ‏פאנל פתוח: ‏סוכן שפלט מציג "‏לפני X" (‏לא ריק, ‏לא epoch גולמי) |
| 5 | ‏מתעדכן עם הזמן | ‏המתן >1 ‏דקה (≤12s refresh): "‏לפני 2 ‏דק'" → "‏לפני 3 ‏דק'" ‏בלי reload |
| 6 | `null` ‏לא שובר | ‏סוכן שטרם פלט / ‏בלי bridge: ‏לא מוצג זמן (‏אין "NaN"/"Invalid"/epoch גולמי), ‏הפאנל תקין |
| 7 | locale | ‏החלף שפה ל-en ‏בהגדרות → ‏הזמן עובר ל-"X minutes ago" (‏ריאקטיבי) |
| 8 | regression: ‏הפאנל | busy-dot, pid, kill, pin, refresh — ‏עדיין עובדים |
| 9 | mobile + desktop | screenshot ‏שני viewports — ‏הזמן לא שובר layout |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew strings | dev-conventions | ‏אין מחרוזת literal — ‏Intl ‏מייצר את הטקסט, ‏label ‏דרך `t()`. pre-commit `lint:i18n` ‏חוסם. |
| hardcode ‏של locale "he" | ‏תקדים-חוב ב-SessionPicker | ‏locale ‏מועבר כפרמטר מ-`i18n.locale` (‏getter ריאקטיבי) — ‏לא literal. |
| ‏הזמן לא מתעדכן (‏לא ריאקטיבי) | Svelte 5 | ‏ה-`refresh()` ‏כל 12s ‏עושה `this.agents = await listAgents()` — ‏השמה חדשה ל-`$state` array → re-render ‏מלא → `formatRelativeTime(...,Date.now())` ‏רץ מחדש עם זמן טרי. ‏**‏לא צריך tick נפרד.** ‏ודא שה-`{#each}` ‏עם key ‏`(agent.id)`. ⚠️ **‏ממצא אביגיל 🟡**: ‏ההנחה תקפה **‏רק** ‏כי `listAgents()` ‏בונה objects ‏טריים מ-`res.json()` ‏בכל poll (references ‏חדשות). ‏אם בעתיד יתווסף dedup/memo ‏ב-VM ‏ששומר references ‏ישנות → ‏ה-re-render ‏לא יקרה והזמן **‏יקפא**; ‏אז יידרש tick-timer ‏של דקה (§7 escalation). |
| `lastMessageAt` ‏עתידי (clock skew) | BE/FE ‏שעונים שונים | ‏clamp `diff<0`→0 ב-util (‏מקרה-טסט 6). |
| `lastMessageAt` ‏נעדר ‏(undefined ‏ב-base ‏ישן / ‏בלי bridge) | enrichment ‏אופציונלי | ‏guard `agent.lastMessageAt != null` (‏תופס גם null ‏וגם undefined). |
| ‏קטלוג i18n ‏חסר key | ‏טיפוס keys ‏ממופה | ‏עדכן **‏כל** ‏קובץ ב-`catalogs/`; `core` typecheck ‏יתפוס חוסר. |
| RTL/physical classes | rtl-adaptation | ‏השתמש בקלאסים לוגיים (`ms/me/ps/pe`), ‏לא `left/right`. |

---

## §7 — Escalation triggers

- ‏ה-12s refresh ‏מתברר כלא-מספיק לרענון הזמן (‏נדרש tick נפרד) → ‏עצור, ‏עדכן את התכנון (‏זו הכרעת-מפתח ב-§6).
- ‏ה-i18n ‏לא חושף locale ‏בצורה ריאקטיבית בקומפוננטה → ‏שאל (‏ההנחה: `i18n.locale` ‏עובד).
- ‏אין קטלוג en (‏רק he) ‏ומבנה ה-keys ‏שונה ממה שתואר → ‏עצור, ‏ה-brief ‏מבוסס על מבנה שראינו.
- ‏רוצה לסטות מ-tdd ‏על ה-util → ‏אסור בלי אישור.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| >5 files ‏ב->2 packages (frontend util+component + core i18n) | +1 |
| Pure logic util (‏ה-util ‏טהור, ‏אין IO) | -2 |
| TDD מלא על ה-util | -1 |
| Greenfield (‏פונקציה חדשה, ‏אין call-sites ‏קיימים לה) | -1 |

**Score**: 2/10 (clamped) — ‏ה-render ‏הוא תוספת קטנה על פאנל קיים, ‏אין data-flow ‏חדש, ‏נשען על polling ‏קיים.

**Tier**: 0-3 → `calev` (light) ‏בלבד.

**‏Verifier-phase**: ‏אין (‏slice ‏קטן).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏טקסט ה-label: "‏פעילות אחרונה" ‏או "‏הודעה אחרונה"? | "‏פעילות אחרונה" (‏כי "‏כל פלט" ‏ולא רק הודעת-טקסט) | ❌ |
| 2 | ‏לחלץ את `formatDate` ‏מ-SessionPicker ל-util ‏המשותף ‏ולהחליף שם? | ‏לא בסבב הזה (‏SessionPicker ‏עובד על ISO, ‏ה-util ‏שלנו על epoch — ‏איחוד = regression-risk; ‏slice עתידי) | ❌ |
| 3 | ‏להציג גם tooltip ‏עם הזמן המוחלט (hover) ‏בנוסף ליחסי? | ‏לא (‏יחסי בלבד; tooltip=label) — ‏אפשר בעתיד | ❌ |
| 4 | ‏מיקום בשורת ה-metadata (‏לפני/אחרי pid)? | ‏אחרי busy, ‏לפני pid — ‏executor ‏מחליט לפי layout | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- ...
