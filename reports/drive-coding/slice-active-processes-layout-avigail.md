---
project: "drive-coding"
slice: "slice-active-processes-layout"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "blocker"
    category: "missing-dependency"
    summary: "Base/worktree branches from raw dev where ActiveProcessesPanel.svelte does not exist; merge is still pending"
    source_brief: "§0 Worktree + §0 תלויות"
    source_code: "packages/frontend/src/lib/components/connect/ (dev tree — only SessionPicker.svelte present)"
    cost_estimate: "15-30min"
  - id: 2
    severity: "confusion"
    category: "naming-inconsistency"
    summary: "Brief §4 says row-1 = status-dot+cli-badge+cwd+agent-actions but agent-actions is already a sibling of agent-info at .agent-row level"
    source_brief: "§4 Commit 1 Markup"
    source_code: "packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte:104-156"
    cost_estimate: "5-10min"
  - id: 3
    severity: "confusion"
    category: "outdated-risk"
    summary: "§6 risk ties direction:ltr to lint:rtl but lint:rtl does NOT check direction:ltr — only physical Tailwind classes + physical CSS props"
    source_brief: "§6 Risks row 1+2"
    source_code: "scripts/lint-no-physical-classes.mjs:43-55"
    cost_estimate: "5min"
  - id: 4
    severity: "minor"
    category: "wrong-line-number"
    summary: "Brief states integration-active-agents tip=f5c3ce0 but actual tip is 22669a5 (file identical between them)"
    source_brief: "§0 Dev tip line"
    source_code: "git log -1 integration-active-agents = 22669a5"
    cost_estimate: "2min"
  - id: 5
    severity: "minor"
    category: "wrong-path"
    summary: "direction:ltr currently lives on .cwd only, not on .pid; brief §4 implies it exists on the meta items"
    source_brief: "§4 CSS bullet (direction:ltr על pid/cwd)"
    source_code: "packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte:268"
    cost_estimate: "2min"
---

# Plan Verification — slice-active-processes-layout

> **Brief**: docs/plans/slice-active-processes-layout.md
> **Base tip**: dev=`161bd94` ; integration-active-agents=`22669a5` (brief says `f5c3ce0` — stale)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~20-40 דק' (רובו על blocker #1)

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | **base/worktree לא תקין**. §0 מורה: `git worktree add .worktrees/slice-active-processes-layout -b slice-active-processes-layout dev`. אבל הקובץ היחיד שמשתנה — `ActiveProcessesPanel.svelte` — **לא קיים ב-dev** (תיקיית `connect/` ב-dev מכילה רק `SessionPicker.svelte`). הוא קיים רק ב-`integration-active-agents`. ה-brief מצהיר `depends_on: []` ו-`Base: dev אחרי מיזוג integration-active-agents`, אבל §0 עצמו מציין שהמיזוג **"ממתין"**. זו סתירה: או שה-merge קורה קודם, או שה-base חייב להיות `integration-active-agents` ולא `dev`, או ש-`depends_on` חייב לרשום את slice-active-agents-widget. | brief §0 (Worktree + תלויות) / `packages/frontend/src/lib/components/connect/` ב-dev | אליעזר ייצור worktree, יחפש את הקובץ, לא ימצא → 15-30 דק' עד שיבין שצריך base אחר |

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | §4 כותב "שורה 1: `status-dot` + `cli-badge` + `cwd` + `agent-actions`", כאילו `agent-actions` צריך להיכנס לתוך שורת המידע. בפועל `agent-actions` כבר אח (sibling) של `agent-info` תחת `.agent-row` (flex). הבעיה האמיתית היא צפיפות **בתוך** `.agent-info` (sid/date/pid כולם `flex-shrink:0` מתחרים עם cwd). התיאור עלול לבלבל את אליעזר לגבי מבנה ה-DOM הקיים. | brief §4 / `ActiveProcessesPanel.svelte:104-156` | מרדכי: הבהר שמבנה ה-row הקיים הוא `agent-info` (flex:1) + `agent-actions` (sibling); ה-meta יוצא מ-agent-info לשורה שנייה |
| 3 | §6 שורות 1+2 קושרות את `direction: ltr` ו-physical classes ל-`lint:rtl`. בפועל `lint:rtl` (`lint-no-physical-classes.mjs`) בודק **רק**: Tailwind physical classes + CSS `padding-left/right`, `margin-left/right`, `border-left/right`, `float`. הוא **לא** מסמן `direction: ltr`. כך שכל הדיון ב-`direction: ltr` ↔ lint:rtl מטעה — שינוי direction לא ייתפס ע"י lint. | brief §6 / `scripts/lint-no-physical-classes.mjs:43-55` | מרדכי: הבהר ש-lint:rtl לא מכסה direction; הסיכון של direction:ltr הוא ויזואלי בלבד, נבדק ב-calev |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | tip של integration-active-agents בברית = `f5c3ce0`, בפועל `22669a5`. אומת: הקובץ זהה בין שתי הנקודות (`git diff f5c3ce0..22669a5` ריק על הקובץ), ו-`f5c3ce0` הוא ancestor. לא פוגע בתוכן — רק מספר ישן. | brief §0 / `git log -1 integration-active-agents` |
| 5 | §4 רומז ש-`direction: ltr` חל על `pid/cwd`. בפועל הוא חל **רק על `.cwd`** (שורה 268); ל-`.pid`/`.created-at`/`.session-id` אין direction. | brief §4 / `ActiveProcessesPanel.svelte:268,284` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ שם package `@drive-coding/frontend-v2` — אומת ב-`packages/frontend/package.json:2`
- ✅ script `test` ל-frontend (`vitest run`) — קיים ב-`packages/frontend/package.json:11`
- ✅ `pnpm typecheck` (root: `tsc --build`), `pnpm lint:i18n`, `pnpm lint:rtl` — כולם קיימים ב-root `package.json`
- ✅ `scripts/lint-no-physical-classes.mjs` קיים (ה-target של lint:rtl)
- ✅ כל ה-classes שה-brief מזכיר קיימים: `.agent-info` (235), `.agent-actions` (290), `.cwd` (261), `.pid` (284), `.created-at` (278), `.session-id` (271), `.status-dot`, `.cli-badge`, `.agent-row` (223)
- ✅ `.agent-meta` (class חדש שה-brief מציע) — אכן לא קיים, ראוי ליצירה
- ✅ תיאור הבעיה (§1/§3): `.agent-info` הוא flex אופקי יחיד עם sid/date/pid ב-`flex-shrink:0` → חפיפה בלוח צר. מדויק.
- ✅ Scope "CSS+markup בלבד, ללא script": ה-script מכיל handlers (handleKill/formatDate/isReconnectDisabled) שאין צורך לגעת בהם — תואם
- ✅ אין physical classes קיימים בקובץ (אין pl-/pr-/ml-/mr-/padding-left וכו') — שינוי חדש לא יכניס regression אם נשמרים logical props

## Verdict

🟡 **USABLE-AFTER-FIX** — בעיה #1 (base/worktree) חוסמת אך תיקון קל למרדכי: או להמתין למיזוג integration-active-agents→dev, או לשנות base ל-`integration-active-agents` ולמלא `depends_on`. בעיות 2-3 הן הבהרות (5-10 דק'), 4-5 קוסמטיות. אין בעיה מבנית ב-brief עצמו — התיאור הטכני של ה-CSS/markup מדויק.
