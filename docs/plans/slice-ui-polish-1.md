# Slice ui-polish-1 — ליטושי UI (footer, header, breadcrumb, load-btn) — ‏תוכנית

> **‏תאריך**: 2026-06-03
> **‏סטטוס**: טיוטה
> **Complexity**: 2/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `e87389d`

---

## §0 — Pre-flight

> ‏slice של ליטושי-UI טהורים — ‏CSS + markup מקומי בלבד. ‏אין BE, ‏אין לוגיקה, ‏אין state חדש, ‏אין adapter. ‏5 שינויים קטנים ב-3 קבצי `.svelte`. ‏כל שינוי עצמאי לחלוטין מהאחרים.

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`e87389d`).

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-ui-polish-1 -b slice-ui-polish-1 dev
cd .worktrees/slice-ui-polish-1
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: ‏לא נדרש (FE-only). ‏אם בכל זאת רוצים לראות footer/header במצב מחובר: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, ראה startup log).
- ‏Typecheck: `pnpm --filter @drive-coding/frontend typecheck`.
- ‏Build: `pnpm --filter @drive-coding/frontend build`.
- ‏lint:i18n: `pnpm lint:i18n`.

### Browser

‏בדיקה ב-linux-gui Chrome :9222 profile voice-acp:
`playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
‏⚠️ ‏תמיד `-s=vacp`. ‏אין DISPLAY במכונה — ‏רק linux-gui.
‏טיפ — ‏בדיקה ללא BE: ‏את ה-footer וה-header אפשר לראות במסך `/chat` ‏עם mock fixture: ‏טען `/chat?mock=greeting` (‏ראה handoff — ‏דורש reload מלא). ‏את ה-connect/breadcrumb רואים ב-`/`.

### Reading list

**must-read** (‏לפני שמתחילים):
- ‏`packages/frontend/AGENTS.md` — ‏5 חוקי הזהב. ‏רלוונטי כאן: ‏components הם leaves, ‏CSS/markup מקומי מותר; ‏אסור מחרוזות עברית בקוד.

**reference** (‏בזמן עבודה):
- ‏הקבצים שמשתנים (‏ראה §4) — ‏כל אחד קצר (50-180 שורות).

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏4 ליטושים ויזואליים: ‏(1) ‏ב-footer מצב-הקלדה — ‏כפתור השליחה מציג רק את אייקון המטוס (בלי המילה "שלח"), ‏והאייקון מצביע שמאלה (כיוון השליחה ב-RTL). ‏(2) ‏בשורת הפעולות (sidebar/sheet) — ‏כפתור היציאה (disconnect) ‏הוא הימני ביותר. ‏(3) ‏בבורר התיקיות — ‏ה-breadcrumb מציג רווח סימטרי סביב כל `/`, ‏ולחיצה על שם תיקייה ב-breadcrumb מנווטת לאותו עומק. ‏(4) ‏בטופס connect — ‏כפתור "טען סשנים אחרונים" ‏מיושר לרוחב מלא של הטופס (במקום צמוד-שמאל).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏הסרת המילה "שלח" מכפתור השליחה + ‏היפוך אייקון לשמאל | ✅ | ‏בslice הזה (TypeArea) |
| ‏סידור 3 כפתורי שורת-הפעולות — ‏יציאה ימני | ✅ | ‏בslice הזה (SessionOptionsPanel) |
| ‏רווח סימטרי סביב `/` ב-breadcrumb | ✅ | ‏בslice הזה (FolderPickerDialog) |
| ‏breadcrumb crumbs לוחיצים (ניווט לעומק) | ✅ | ‏בslice הזה (FolderPickerDialog) |
| ‏יישור כפתור "טען סשנים אחרונים" לרוחב מלא | ✅ | ‏בslice הזה (SessionPicker) |
| ‏checkbox תיקיות מוסתרות | ❌ | slice-folder-hidden (נפרד) |
| ‏בוררי מודל/סוכן בטופס connect | ❌ | slice-connect-options (נפרד) |
| ‏מחיקת/עריכת-שם סשנים | ❌ | ‏חסום-פרוטוקול (ראה docs/investigations/2026-06-03-session-delete-rename.md) |

---

## §3 — Architecture diagram

```
‏4 קבצים, ‏שינויים מקומיים בלבד (אין data-flow חדש):

TypeArea.svelte         ← ‏(1) ‏הסר {t("record.send")}, ‏הפוך SendIcon אופקית
  └ ‏כפתור submit: ‏רק <SendIcon> ‏עם scaleX(-1)

SessionOptionsPanel.svelte ← ‏(2) ‏סדר 3 הכפתורים: [⚙ הגדרות][🔊 שמע][⎋ יציאה]→ימני
  └ ‏שורת הפעולות (כיום: שמע, יציאה, הגדרות)

FolderPickerDialog.svelte  ← ‏(3) breadcrumb: ‏רווח סביב /, crumbs כ-<button>
  └ ‏breadcrumb: spans → buttons עם navigateToDepth(i)

SessionPicker.svelte    ← ‏(4) .load-btn: ‏הסר align-self:flex-start → width:100%
```

---

## §4 — Commits ‏בסדר

### Commit 0 — כפתור שליחה: ‏אייקון בלבד, ‏מצביע שמאלה (approach: manual)

> ‏מטרה: ‏בתמונת המשתמשת — ‏כפתור השליחה מציג "✈ שלח". ‏הרצוי: ‏רק האייקון, ‏מצביע שמאלה (כיוון השליחה הטבעי ב-RTL).

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — ‏בלוק כפתור ה-submit (שורות 51-62).

**‏פרטי מימוש** (‏שורות מאומתות ע"י אביגיל — ‏המבנה: aria-label:55, `<SendIcon>`:57, ‏טקסט נראה `{t("record.send")}`:58):
- ‏שורה **58**: ‏הסר את `{t("record.send")}` ‏(הטקסט הנראה שאחרי `<SendIcon>`). ‏השאר רק את `<SendIcon ... />` ‏(שורה 57).
- ‏ה-`aria-label={t("record.send")}` ‏(שורה **55**) **‏נשאר** — ‏נגישות (קורא מסך עדיין צריך "שלח"). ‏אל תסיר אותו. ‏(‏המפתח `record.send` ‏עדיין בשימוש ב-aria-label → ‏לא orphan, ‏אל תמחק מהקטלוג.)
- ‏היפוך האייקון אופקית: ‏ה-`SendIcon` ‏של Lucide (מטוס נייר) ‏מצביע ימינה־למעלה כברירת מחדל. ‏ב-RTL ‏הכיוון הטבעי לשליחה הוא שמאלה. ‏הוסף `style="transform:scaleX(-1)"` ‏ל-`<SendIcon>` ‏(או class `class="-scale-x-100"` ‏של Tailwind). **‏העדפה**: `style="transform:scaleX(-1)"` ‏ישיר על האייקון (‏עקבי עם שאר הקובץ שמשתמש ב-inline style).
- ‏הכפתור כרגע: `class="rounded-xl px-4 py-2.5 ... flex items-center gap-1.5 shrink-0"`. ‏אחרי הסרת הטקסט — ‏ה-`gap-1.5` ‏מיותר (אין מה לרווח), ‏אבל לא מזיק. ‏אפשר להשאיר. ‏ה-`px-4` ‏אפשר להקטין ל-`px-3` ‏לכפתור אייקון-בלבד מאוזן יותר — ‏**‏אופציונלי**, ‏לשיקול ויזואלי של המבצע.

**Verification**:
```bash
pnpm lint:i18n   # record.send עדיין בשימוש (aria-label) → תקין
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני (linux-gui): /chat?mock=greeting → ‏מצב הקלדה (טאב "הקלדה") → ‏הכפתור = ‏אייקון בלבד, ‏מצביע שמאלה
```

### Commit 1 — שורת פעולות: ‏יציאה ימנית (approach: manual)

> ‏מטרה: ‏בתמונת המשתמשת — ‏הסדר הנוכחי (מימין לשמאל ב-RTL): ‏⚙ הגדרות, ‏⎋ יציאה, ‏🔊 שמע. ‏הרצוי: ‏כפתור היציאה הימני ביותר.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — ‏שורת הפעולות (שורות 141-180).

**‏פרטי מימוש**:
- ‏שורת הפעולות היא `<div class="flex items-center gap-2 shrink-0">` ‏(שורה 142) ‏עם 3 כפתורים ‏בסדר ה-DOM: (א) ‏audio toggle (144-156), (ב) ‏disconnect (159-167), (ג) ‏הגדרות (170-179).
- ‏ב-RTL, ‏הכפתור הראשון ב-DOM ‏מופיע **‏הכי ימני**. ‏כדי שהיציאה (disconnect) ‏תהיה הימנית ביותר → ‏העבר את בלוק ה-disconnect (159-167) ‏להיות **‏הראשון** ב-DOM (לפני audio toggle).
- ‏הסדר החדש ב-DOM: `[disconnect][audio][settings]`. ‏ב-RTL ‏זה יוצג: ‏יציאה (ימין) · ‏שמע · ‏הגדרות (שמאל).
- ‏**‏שמור את כל ה-classes/handlers/aria של כל כפתור כמו שהם** — ‏רק מזיז את סדר הבלוקים. ‏אל תיגע בלוגיקה (`onDisconnect`, `speaker.toggle`, `toggleSettings`).
- ‏⚠️ ‏הערות הקוד בעברית (`<!-- disconnect -->` וכו') ‏עוברות יחד עם הבלוקים.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני (linux-gui): /chat → ‏פתח sidebar (דסקטופ) ‏או sheet (מובייל) → ‏שורת הפעולות:
#   ‏כפתור היציאה (אייקון log-out, ‏צבע אדום --recording) ‏הוא הימני ביותר
```

### Commit 2 — breadcrumb: ‏רווח סימטרי + ‏ניווט בלחיצה (approach: manual)

> ‏מטרה: ‏(א) ‏בתמונת המשתמשת ה-breadcrumb הוא `home /user /projects /voice-acp` — ‏רווח רק לפני ה-`/`, ‏לא אחרי. ‏הרצוי: ‏רווח סימטרי משני הצדדים. ‏(ב) ‏לחיצה על שם תיקייה ב-breadcrumb מנווטת לאותו עומק.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — ‏בלוק ה-breadcrumb (שורות 99-111) + ‏פונקציית ניווט.

**‏פרטי מימוש**:
- ‏ה-breadcrumb כיום (שורות 105-110): ‏`{#each breadcrumbs as crumb, i}` → `<span style="color:var(--accent-hi)">{crumb}</span>` ‏ואז `<span class="opacity-40">/</span>` ‏(רק אם `i < length-1`).
- ‏**‏רווח סימטרי (א)**: ‏ה-`/` ‏הוא `<span class="opacity-40">/</span>` ‏בלי margin. ‏הוסף רווח משני הצדדים: `<span class="opacity-40 mx-1">/</span>` ‏(או `px-1`). **‏העדפה**: `mx-1` (margin אופקי סימטרי). ‏זה נותן רווח שווה לפני ואחרי הסלאש.
- ‏**‏crumb לוחיץ (ב)**: ‏הפוך כל `<span>{crumb}</span>` ‏ל-`<button>` ‏שמנווט. ‏ה-breadcrumbs הם `currentPath.split("/").filter(Boolean)` (שורות 34-36) — ‏כלומר `["home","user","projects","voice-acp"]`. ‏לחיצה על crumb ‏באינדקס `i` ‏צריכה לנווט ל-`/` + ‏join של `breadcrumbs[0..i]`.
- ‏הוסף פונקציה (ליד `navigateTo`/`navigateUp`, ‏שורות 58-65):
  ```ts
  function navigateToDepth(index: number) {
    // ‏בונה נתיב אבסולוטי עד ה-crumb באינדקס index (כולל)
    const path = "/" + breadcrumbs.slice(0, index + 1).join("/")
    void loadFolder(path)
  }
  ```
- ‏שנה את ה-markup:
  ```svelte
  {#each breadcrumbs as crumb, i}
    <button
      type="button"
      class="hover:underline"
      style="color:var(--accent-hi)"
      onclick={() => navigateToDepth(i)}
    >{crumb}</button>
    {#if i < breadcrumbs.length - 1}
      <span class="opacity-40 mx-1">/</span>
    {/if}
  {/each}
  ```
- ‏⚠️ ‏ה-container של ה-breadcrumb (שורה 100-104) ‏הוא `dir="ltr"` — ‏זה **‏נשאר** (נתיבי קבצים תמיד LTR). ‏ה-buttons יורשים את זה.
- ‏⚠️ ‏ה-`<button>` ‏צריך להיות inline (לא block) ‏כדי לשבת בשורה עם ה-`/`. ‏ה-container הוא `whitespace-nowrap overflow-x-auto` ‏(שורה 101) — ‏buttons הם inline-block כברירת מחדל ב-flow הזה; ‏אם נשבר, ‏הוסף `class="inline"` ‏ל-button. **‏בדוק ויזואלית.**
- ‏אין צורך ב-i18n key — ‏ה-crumbs הם שמות תיקיות (data), ‏לא מחרוזות UI.
- ‏⚠️ edge-case (‏אביגיל): ‏בנתיב השורש `/`, `breadcrumbs = "/".split("/").filter(Boolean) = []` — ‏אין crumbs כלל (לא buttons ולא `/`). ‏זו ההתנהגות הקיימת (גם היום spans ריקים) ‏ו**‏תקינה** — ‏אין מה לנווט מעל השורש. ‏אל תוסיף טיפול מיוחד.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני (linux-gui): / (connect) → ‏לחץ על כפתור התיקייה (folder-btn) → ‏ה-dialog נפתח.
#   ‏ה-breadcrumb: ‏רווח סימטרי סביב כל /. ‏לחץ על "projects" → ‏מנווט ל-/home/user/projects.
```

### Commit 3 — כפתור "טען סשנים אחרונים" ‏לרוחב מלא (approach: manual)

> ‏מטרה: ‏בתמונת המשתמשת הכפתור צמוד-שמאל וקטן. ‏הרצוי: ‏מיושר לרוחב הטופס (כמו שאר השדות).

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/connect/SessionPicker.svelte` — ‏CSS של `.load-btn` (שורות 92-102).

**‏פרטי מימוש**:
- ‏שורה 101: ‏הסר `align-self: flex-start;` ‏(זה מה שמצמיד את הכפתור לשמאל ומקטין אותו).
- ‏הוסף `width: 100%;` ‏ל-`.load-btn` (‏כדי שימלא את רוחב ה-`.session-picker` ‏שהוא `flex-direction: column`).
- ‏שקול `text-align: center;` ‏לכפתור מלא-רוחב (‏הטקסט באמצע). **‏אופציונלי** — ‏לשיקול ויזואלי.
- ‏אין שינוי ב-markup, ‏רק CSS.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# ‏ידני (linux-gui): / (connect) → ‏כפתור "טען סשנים אחרונים" ‏ממלא את רוחב הטופס
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm --filter @drive-coding/frontend typecheck` |
| 2 | build נקי | `pnpm --filter @drive-coding/frontend build` |
| 3 | lint:i18n עובר | `pnpm lint:i18n` |
| 4 | ‏כפתור שליחה = ‏אייקון בלבד, ‏שמאלה | linux-gui: /chat?mock=greeting → ‏טאב הקלדה → ‏אין מילה "שלח", ‏האייקון מצביע שמאלה |
| 5 | ‏יציאה הימני ביותר | /chat → sidebar/sheet → ‏כפתור log-out אדום הוא הימני |
| 6 | breadcrumb רווח סימטרי | folder dialog → ‏רווח שווה משני צדי כל / |
| 7 | breadcrumb לוחיץ | ‏לחיצה על crumb אמצעי → ‏מנווט לאותו עומק |
| 8 | ‏entries עדיין לוחיצים (regression) | ‏לחיצה על שורת תיקייה ברשימה → ‏עדיין נכנס אליה (navigateTo, ‏לא נגעת) |
| 9 | load-btn מלא-רוחב | / → ‏הכפתור ממלא רוחב |
| 10 | mobile + desktop | screenshot של ‏שני viewports (footer + sidebar/sheet) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏מחיקת `record.send` מהקטלוג בטעות (orphan-hunting) | i18n | ‏ה-key עדיין בשימוש ב-`aria-label` → ‏**‏אל תמחק** מהקטלוג. ‏רק הטקסט הנראה הוסר. |
| ‏היפוך אייקון משפיע גם על mode "record" (MicLarge) | scaleX | ‏השינוי הוא ב-TypeArea בלבד (SendIcon). MicLarge לא נגעת. ‏אין spillover. |
| ‏breadcrumb button שובר את ה-flow האופקי (יורד שורה) | CSS | ‏ה-container `whitespace-nowrap`; ‏אם button block → ‏הוסף `class="inline"`. ‏בדוק ויזואלית (DoD#6/7). |
| ‏סדר כפתורים — ‏העברת בלוק שוברת handler | refactor | ‏מעבירים בלוק שלם (כולל onclick/aria/class). ‏typecheck + ‏בדיקה ויזואלית (DoD#5). |
| Hardcoded Hebrew | learnings | ‏אין מחרוזת חדשה. breadcrumb crumbs = data. ‏pre-commit hook חוסם בכל מקרה. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → ‏אין חדשות. ✅
> 2. Reactivity gotchas → ‏אין $effect/$state חדש. ✅
> 3. OneCLI placeholder → ‏לא רלוונטי (FE-only). ✅

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏היפוך ה-SendIcon ‏עם scaleX ‏נראה שגוי/מוזר ויזואלית (‏אולי עדיף אייקון אחר כמו `ArrowLeft`?) — ‏עצור והצג screenshot.
- ‏breadcrumb buttons שוברים את הפריסה ‏ולא מסתדרים בשורה גם עם `inline`.
- ‏Brief סותר את עצמו / ‏אתה רוצה לסטות מ-approach.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| Pure UI/CSS, ‏אין IO | -2 |
| ‏אין state machine / async | 0 |
| ‏אין protocol / streaming | 0 |
| ‏מספר קבצים (4 ב-package אחד) | +1 (base) |
| ‏שינוי markup קל ב-component קיים (breadcrumb) | +1 |
| ‏בסיס glue/UI | +2 (base) |

**Score**: 2 / 10

**Tier**: 0-3 → `calev` (verifier-slice-light) ‏בלבד. ‏אין verifier-phase.

**‏Verifier-phase**: ‏אין.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏היפוך SendIcon — scaleX(-1) ‏או החלפה ל-icon אחר (ArrowLeft)? | scaleX(-1) ‏על SendIcon הקיים (‏שומר על מטוס הנייר) | ❌ |
| 2 | ‏רווח breadcrumb — `mx-1` ‏או `px-1` ‏על ה-/? | `mx-1` (margin סימטרי) | ❌ |
| 3 | ‏load-btn — ‏גם `text-align:center`? | ‏כן (כפתור מלא-רוחב מאוזן) | ❌ |
| 4 | ‏"לחיצה על שם תיקייה" בבקשה — ‏breadcrumb ‏או entries? | ‏שניהם: entries כבר עובד (navigateTo); ‏מוסיפים breadcrumb לוחיץ | ❌ (‏הוכרע) |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- ...
