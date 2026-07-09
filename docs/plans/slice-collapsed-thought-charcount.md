# Slice — collapsed-thought-charcount (9e) — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: ‏טיוטה
> **Complexity**: 3/10 (verifier: light — `calev`)
> **תלות**: depends_on: []. **base=dev**. ‏FE-טהור, ‏לוקאלי (ללא wire).

מ-`ui-feature-backlog §9e` / ‏roadmap §5 "streaming/typing indicator". ‏כשבועת-**מחשבה** מקופלת,
המשתמשת לא רואה אם הסוכן עדיין חושב או נתקע. ‏ה-slice מוסיף **ספירת-תווים חיה** על הכותרת המקופלת —
המספר עולה תוך כדי הזרמת-המחשבה; ‏כשהוא מפסיק לעלות → ‏הסתיים/נתקע. ‏מכין את לוגיקת-הספירה ל-9d.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/collapsed-thought-charcount -b slice/collapsed-thought-charcount dev
cd .worktrees/collapsed-thought-charcount
pnpm install && pnpm hooks:install
```

### Run
‏- ‏FE: `pnpm --filter @drive-coding/frontend dev`
‏- ‏Tests: `pnpm --filter @drive-coding/frontend test bubble-rendering` (ל-Commit 0 TDD)
‏- ‏Gates: `pnpm --filter @drive-coding/frontend typecheck && pnpm lint && pnpm lint:i18n`

### Browser
‏- ‏Chrome. ‏הבדיקה הקריטית: ‏להקפיל בועת-מחשבה (הגדרה `showThoughts=false`, ‏או קיפול ידני) ‏בזמן ש-turn חי מזרים מחשבה → ‏לראות את המספר עולה.

### Reading list
**‏must-read לפני**:
‏- `packages/frontend/src/lib/components/chat/bubbles/ThoughtBubble.svelte` — ‏**כל הקובץ** (89 שורות). ‏במיוחד: ‏`open = $state(settings.showThoughts)` (:38), ‏ה-`<details bind:open ontoggle>` (:57), ‏ה-`<summary>` (:58-60), ‏ו-`{bubble.segments.length}` span (:82, ‏כופה ריאקטיביות).
‏- `packages/frontend/src/lib/components/chat/bubbles/bubble-rendering.ts` — ‏11 שורות; ‏`joinSegmentText` ו-`visibleThoughtSegments`. ‏כאן מוסיפים את ההלפר החדש.
**‏reference**:
‏- `packages/core/src/i18n/catalogs/he.ts` — ‏מבנה ה-catalog; ‏המפתח `chat.bubble.thought` כבר קיים (ה-summary משתמש בו). ‏מוסיפים מפתח-אח לספירה.

## §1 — מטרה

אחרי ה-slice: ‏בכל בועת-**מחשבה מקופלת**, ‏לצד תווית "‏מחשבה" ‏מופיעה ספירת-תווים חיה
(‏למשל "‏מחשבה · ‏1,240 תווים") ‏שמתעדכנת תוך כדי הזרמת ה-chunks. ‏בבועה **פתוחה** ‏אין ספירה
(‏הטקסט גלוי ממילא). ‏זה נותן feedback "‏רץ / ‏נתקע" ‏בלי לפתוח את המחשבה.

## §2 — Scope: מה כן, מה לא

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏ספירת-תווים חיה על בועת-מחשבה מקופלת | ✅ | ‏Commit 1 |
| ‏הלפר טהור `segmentsCharCount` (TDD) | ✅ | ‏Commit 0 |
| ‏ספירה על בועת-**כלי** | ❌ | ‏לכלי progress = ‏status-dot (קיים). ‏ספירת-כלים תופיע על בועת-הקבוצה ב-9d |
| ‏קיבוץ מחשבות+כלים לבועה משותפת | ❌ | ‏slice 9d (`collapsed-activity-group`) — ‏ימחזר את ההלפר הזה |
| ‏ספירת **טוקנים** (מ-`usage_update`) | ❌ | ‏תווים בלבד (בחירת המשתמשת) — ‏לוקאלי, ‏ללא wire. ‏טוקנים = `context-window-meter` נפרד |
| ‏הצגה גם כשפתוח | ❌ | ‏רק במצב מקופל (`!open`) |

## §3 — Architecture diagram

```
components/chat/bubbles/
  bubble-rendering.ts   ← Commit 0: + segmentsCharCount(segments) — פונקציה טהורה (TDD)
  ThoughtBubble.svelte  ← Commit 1: charCount ($derived) + הצגה ב-<summary> כש-!open
core/src/i18n/catalogs/
  he.ts (+ שאר) ← Commit 1: מפתח chat.bubble.charCount = "{count} תווים"
```
‏קובץ-לוגיקה אחד (הלפר), ‏רכיב אחד, ‏מפתח-i18n אחד. ‏אין שכבה חדשה, ‏אין נגיעה ב-VM/wire.

## §4 — Commits

### Commit 0 — הלפר טהור `segmentsCharCount` (approach: **TDD**)

**‏שינויים**: `bubble-rendering.ts` — ‏להוסיף:
```ts
/** ספירת-תווים מצטברת של segments — feedback "רץ/נתקע" לבועה מקופלת (9e). */
export function segmentsCharCount(segments: Segment[]): number {
  let n = 0
  for (const seg of segments) n += seg.text.length
  return n
}
```
> ‏למה פונקציה ולא inline: ‏(א) ‏testable ב-TDD; ‏(ב) ‏9d ממחזר אותה על בועות-המחשבה שבקבוצה.
> ‏משתמש ב-`Segment` (כבר מיובא בקובץ). ‏**לא** ‏`joinSegmentText(...).length` — ‏מיותר-אלוקציה על stream.

**‏Verification (TDD)**:
```bash
cd packages/frontend && pnpm test bubble-rendering
# טסטים: [] → 0 · [{text:"abc"}] → 3 · [{text:"אב"},{text:"גד"}] → 4 (תווי-עברית נספרים כ-code units)
pnpm typecheck
```

### Commit 1 — הצגה ב-ThoughtBubble כש-מקופל (approach: **manual** — ‏ויזואלי חי)

**‏שינויים**:
‏1. ‏`ThoughtBubble.svelte` — ‏ייבוא `segmentsCharCount`; ‏הוספת
   ```ts
   const charCount = $derived(segmentsCharCount(bubble.segments))
   ```
   ‏(‏על `bubble.segments` הגולמי — ‏ריאקטיבי; ‏ה-span הקיים `{bubble.segments.length}` ‏כבר כופה re-render בעת push).
‏2. ‏ב-`<summary>` (:58-60) — ‏להוסיף את הספירה **רק כש-`!open`**:
   ```svelte
   <summary class="...">
     {t("chat.bubble.thought")}
     {#if !open}<span class="thought-count">· {t("chat.bubble.charCount", { count: charCount })}</span>{/if}
   </summary>
   ```
   > ‏`!open` ‏נגזר מה-`bind:open` הקיים (:57) — ‏ריאקטיבי. ‏כשפותחים, ‏הספירה נעלמת (הטקסט גלוי).
‏3. ‏CSS זעיר (`.thought-count { opacity:.55; font-weight:400 }`) — ‏אופציונלי.

**‏i18n**: ‏מפתח `chat.bubble.charCount` ‏בכל ה-catalogs (`he.ts` ‏+ ‏השאר). ‏עברית: `"{count} תווים"`.
‏להריץ `pnpm lint:i18n`. **‏אין מחרוזת גולמית בקוד** — ‏רק `t(key)`.

**‏Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm lint && pnpm lint:i18n
pnpm --filter @drive-coding/frontend build
# ידני: הגדרה showThoughts=false → מחשבות מקופלות → turn חי → המספר עולה חי
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏`segmentsCharCount` ‏נכון | `pnpm test bubble-rendering` (Commit 0) |
| ‏typecheck + ‏lint + ‏lint:i18n ירוקים | ‏הפקודות למעלה |
| ‏build עובר | `pnpm --filter @drive-coding/frontend build` |
| ‏מחשבה **מקופלת** — ‏ספירה מוצגת ומתעדכנת חי בזמן turn | ‏preview: ‏showThoughts=false, ‏prompt חי |
| ‏מחשבה **פתוחה** — ‏אין ספירה | ‏preview: ‏לפתוח בועה → ‏הספירה נעלמת |
| ‏אין רגרסיה: ‏snap-back/scroll-intent עדיין תקין בקיפול/פתיחה | ‏preview: ‏toggle בועה |
| ‏עברית: ‏"{count} תווים" ‏נכון; ‏מספר קריא | ‏preview |

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏Svelte 5 reactivity — ‏`charCount` לא מתעדכן בעת `segments.push()` | learnings #2 | ‏ה-span הקיים `{bubble.segments.length}` (:82) כבר כופה re-render; ‏`$derived(segmentsCharCount(bubble.segments))` נגזר מאותו array → ‏מתעדכן. ‏לאמת חי שהמספר עולה. |
| ‏Hardcoded Hebrew יחסום ב-pre-commit | learnings #1 | ‏המחרוזת דרך `t("chat.bubble.charCount")` — ‏`lint:i18n` ‏בירוק |
| ‏`translateThoughts` ‏פעיל → ‏displaySegments שונה מ-segments | ‏מודל | ‏הספירה על `bubble.segments` הגולמי (מקור-האמת של מה שנכנס) — ‏עקבי כ-feedback "רץ/נתקע"; ‏לא תלוי בתרגום |
| ‏OneCLI/SDK | learnings #3 | ‏לא רלוונטי — ‏FE-טהור |

## §7 — Escalation triggers
‏- ‏אם `$derived` על `segments` לא מתעדכן חי (Svelte reactivity) ‏למרות ה-span — ‏עצור ושאל מרדכי.
‏- ‏אם נדרש לגעת ב-`agent-session.svelte.ts` / ‏ב-VM כדי לקבל את הספירה → ‏עצור (סימן ש-scope שגוי; ‏הספירה לוקאלית לרכיב).

## §8 — Complexity score
‏- ‏commits: 2 · ‏שכבות חדשות: 0 · ‏APIs חיצוניים: 0 · ‏streaming: קריאה-בלבד (אין pipeline חדש) · ‏state-model: לא · ‏protocol: לא
‏- ‏**Score: 3/10 → verifier: light (`calev`)**.

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏פורמט המספר — ‏גולמי (`1240`) ‏או מקובץ (`1,240`)? | ‏מקובץ ל-locale (`count.toLocaleString(settings.locale)`) לקריאוּת | ❌ |
| 2 | ‏להציג גם אייקון (⌁/spinner) ‏לצד המספר בזמן turn פעיל? | ‏לא ב-9e (המספר-שעולה הוא ה-feedback); ‏spinner שמור ל-9d group | ❌ |
| 3 | ‏להראות ספירה גם על בועת-**message** מקופלת? | ‏לא — ‏message לא מקופלת (אין `<details>`); ‏מחוץ ל-scope | ❌ |
