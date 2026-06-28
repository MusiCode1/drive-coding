# Slice — תיקון layout של פאנל "תהליכים פעילים" — תוכנית

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **תאריך**: 2026-06-16
> **סטטוס**: ✅ הושלם — commit 3e61ddf על branch slice-active-processes-layout
> **Complexity**: 2/10 (verifier: light / ויזואלי)
> **תלויות (`depends_on`)**: [] — בנוי על dev אחרי מיזוג active-agents
> **Base**: dev אחרי מיזוג `integration-active-agents`
> **Dev tip**: dev=`b2c2349` (active-agents כבר מוזג)

---

## §0 — Pre-flight

### ⚠️ הערה ל-אביגיל: בסיס האימות

הקובץ `ActiveProcessesPanel.svelte` קיים ב-`integration-active-agents` (worktree `.worktrees/slice-active-agents-widget`), **לא** ב-dev הנקי. אמת מולו.

### תלויות (חובה!)
- **מיזוג active-agents → dev** (status: ממתין). מוסיף את הקובץ `ActiveProcessesPanel.svelte`. `depends_on: []`.

### Worktree
```bash
cd D:/UserProjects/AI/drive-coding
git worktree add .worktrees/slice-active-processes-layout -b slice-active-processes-layout dev
cd .worktrees/slice-active-processes-layout
pnpm install && pnpm hooks:install
```

> 🚦 **Merge-gate**: צור את ה-worktree **רק אחרי** שמיזוג active-agents → dev הושלם (הקובץ `ActiveProcessesPanel.svelte` נכנס במיזוג). אם טרם מוזג — החלף `dev` ב-`integration-active-agents` בפקודת ה-`worktree add`.

### איך להריץ
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (Vite, port OS-assigned)
- Tests: `pnpm --filter @drive-coding/frontend-v2 test`
- כללי: `pnpm typecheck` ; `pnpm lint:i18n` ; `pnpm lint:rtl`

### Browser
Chrome רגיל. ללא מיקרופון — אין צורך ב-tunnel/HTTPS. צריך BE חי + agent אחד לפחות כדי לראות שורה בפאנל.

### Reading list
**must-read**:
1. [ActiveProcessesPanel.svelte](../../packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte) — הקובץ היחיד שמשתנה. הבעיה ב-`.agent-info` (flex-שורה-יחידה) + `.agent-actions`.

**reference**:
- [rtl-adaptation](skill) — `direction`/logical properties; לוודא שאין physical classes חדשים.

---

## §1 — מטרה

פאנל "תהליכים פעילים" כיום דוחס לשורה אופקית אחת: נקודת-סטטוס + badge + cwd + session-id + תאריך + pid + 3 כפתורים. בלוח צר הפריטים נערמים זה על זה (pid חופף עם תאריך), והתצוגה בלתי-קריאה. אחרי ה-slice: כל שורת agent קריאה ומסודרת בכל רוחב לוח, ללא חפיפות.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| layout דו-שורתי לכל agent-row (מידע ראשי + meta משני) | ✅ | ה-slice הזה |
| כפתורים ברוחב קבוע שלא נדחסים | ✅ | ה-slice הזה |
| meta משני (session-id · תאריך · pid) מעומעם וקטן | ✅ | ה-slice הזה |
| שינוי לוגיקה / VM / נתונים | ❌ | רק CSS + markup |
| busy/idle indicator | ❌ | slice-agent-busy-indicator |
| הסרת/שינוי שדות מוצגים | ❌ | מציגים את אותם הנתונים, בסידור טוב יותר |

> שינוי CSS + markup בלבד. אין נגיעה ב-`<script>` (חוץ מ-markup ב-template).

---

## §3 — Architecture diagram

```text
לפני (.agent-row = flex אחד):
  [dot][badge][cwd........][sid][date][pid] [📎][חבר מחדש][הרוג]   ← הכל בשורה, נדחס/חופף

אחרי (.agent-row = column; שתי שורות):
  שורה 1:  [dot] [badge] [cwd.....................] [📎][חבר מחדש][הרוג]
  שורה 2:        sid · 16.06 00:18 · pid:31468                       ← קטן, מעומעם, wrap
```

---

## §4 — Commits בסדר

### Commit 1 — layout דו-שורתי (approach: manual / ויזואלי)

**מבנה נוכחי** (לדיוק): `<li class="agent-row">` מכיל **שני siblings**: `<div class="agent-info">` (נקודה+badge+cwd+session-id+תאריך+pid — כולם בתוכו) ו-`<div class="agent-actions">` (3 הכפתורים). `.agent-row` הוא `display:flex` אופקי. החפיפה נובעת מכך ש-`.agent-info` דוחס 6 פריטים לשורה אחת לצד הכפתורים.

**קבצים שמשתנים**:
- [ActiveProcessesPanel.svelte](../../packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte):
  - **Markup**: הוצא את `session-id` + `created-at` + `pid` מתוך `.agent-info` לתוך `<div class="agent-meta">` חדש. עטוף את [`.agent-info` (שיישאר עם נקודה+badge+cwd) + `.agent-actions`] ב-wrapper `<div class="agent-top">`. המבנה החדש: `.agent-row` > [`.agent-top` > (`.agent-info`, `.agent-actions`)] + `.agent-meta`.
  - **CSS**:
    - `.agent-row`: שנה ל-`flex-direction: column; align-items: stretch; gap: 0.35rem`.
    - `.agent-top`: `display: flex; align-items: center; gap: 0.5rem` (שורת המידע הראשי + הכפתורים).
    - `.agent-info` נשאר `flex: 1; min-width: 0`; `.cwd` שומר `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; `.agent-actions` נשאר `flex-shrink: 0`.
    - `.agent-meta`: `display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: 0.72rem; color: var(--fg-dim)`. מפריד `·` בין פריטים או `gap` בלבד.
    - `direction: ltr` כיום נמצא **רק על `.cwd`** (לא על `.pid`). השאר אותו על `.cwd`, ובמידת הצורך הוסף `direction: ltr` ל-`.pid`/`.session-id` בשורת ה-meta המסודרת (שם הוא לא יגרום לחפיפה כי הם ב-wrap נפרד).
  - אל תשנה את ה-`<script>` או את ה-handlers.

**Verification**:
```bash
pnpm typecheck
pnpm lint:i18n
pnpm lint:rtl     # אין physical classes חדשים
pnpm --filter @drive-coding/frontend-v2 test
# ויזואלי: פתח את הפאנל עם agent אחד לפחות → אין חפיפה; שתי שורות; cwd עם ellipsis
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | typecheck + tests ירוקים | `pnpm typecheck && pnpm --filter @drive-coding/frontend-v2 test` |
| 2 | lint:i18n + lint:rtl ירוקים | `pnpm lint:i18n && pnpm lint:rtl` |
| 3 | אין חפיפת טקסט (pid/תאריך) | screenshot של שורת agent בלוח צר |
| 4 | cwd ארוך → ellipsis, לא שובר layout | screenshot עם cwd ארוך |
| 5 | כל 3 הכפתורים נראים ולחיצים | ויזואלי + לחיצה |
| 6 | Regression: Kill/Reconnect/Pin עדיין עובדים | לחיצה על כל אחד |
| 7 | RTL תקין (כיוון, יישור) | ויזואלי בעברית |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| physical CSS classes (left/right/ml/pr) | lint:rtl | השתמש ב-logical (`inset-inline`, `ms`/`me`); `pnpm lint:rtl` |
| `direction: ltr` על מיכל RTL גורם להיפוך/חפיפה | התנהגות RTL הנוכחית | החל `direction: ltr` רק על טקסט לטיני ספציפי (pid/cwd), במבנה מסודר. **הערה**: `lint:rtl` בודק physical classes בלבד — הוא **לא** תופס בעיות `direction: ltr`; האימות כאן ויזואלי |
| שבירת ellipsis של cwd | `flex`/`min-width` | שמור `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| מחרוזות עברית קשיחות | pre-commit hook | אין טקסט חדש — רק סידור קיים. אם מוסיפים מפריד, השתמש בתו `·` (לא מילה) |

> 3 שתמיד נשכחים: (1) i18n — אין טקסט חדש; (2) Svelte 5 reactivity — לא רלוונטי (markup בלבד); (3) RTL — `lint:rtl`.

---

## §7 — Escalation triggers

- כדי לתקן את ה-layout צריך לשנות לוגיקה ב-`<script>` / ב-VM — עצור (זה מעבר ל-scope).
- מתברר שצריך להסיר שדה מהתצוגה כדי שייכנס — עצור ושאל (scope אומר: אותם נתונים, סידור טוב יותר).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|---|---:|
| קובץ יחיד, CSS+markup בלבד | -1 |
| Pure presentational, אין IO/state | -2 |
| RTL surface (סיכון ידוע) | +1 |
| נטו בסיס | +4 |

**Score**: 2/10
**Tier**: `calev` mode: light — אימות ויזואלי (screenshot שני viewports) + regression על הכפתורים.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להציג pid תמיד או רק ב-hover/tooltip? | תמיד, בשורת meta קטנה | ❌ |
| 2 | מפריד `·` בין פריטי meta או gap בלבד? | `·` קל לקריאה | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- ...
