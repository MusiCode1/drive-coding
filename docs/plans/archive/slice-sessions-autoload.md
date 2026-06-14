# Slice sessions-autoload — טעינת סשנים אוטומטית בטופס connect (cwd מוכר) — ‏תוכנית

> **‏תאריך**: 2026-06-03
> **‏סטטוס**: הושלם
> **Complexity**: 3/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `e87389d`

---

## §0 — Pre-flight

> ‏slice קטן: ‏בטופס החיבור (`/`), ‏אם ה-cwd ‏כבר מאוכלס מ-`settings.lastCwd` (‏המשתמש חזר
> ‏לתיקייה מוכרת), ‏לטעון את רשימת הסשנים **‏אוטומטית** ‏פעם אחת — ‏בלי שהמשתמש ילחץ "טען".
> ‏**‏קריטי**: ‏טעינת הסשנים יקרה (`listSessionsForCwd` ‏עושה spawn ‏של תהליך opencode מלא +
> ‏ACP handshake, ‏מאות ms עד שניות). ‏לכן הטעינה האוטומטית מותנית: ‏רק כשה-cwd ‏מ-lastCwd
> ‏(לא ריק, ‏לא מ-homeDir של השרת), ‏ורק פעם אחת (לא על כל הקלדה). ‏שינוי ב-`+page.svelte` ‏בלבד.

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`e87389d`).

> ‏⚠️ ‏אין חפיפת קבצים עם ui-polish-1/folder-hidden (‏הם נוגעים ב-components; ‏זה ב-`routes/+page.svelte`).

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-sessions-autoload -b slice-sessions-autoload dev
cd .worktrees/slice-sessions-autoload
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
  ‏**‏נדרש BE חי** — ‏הטעינה עושה spawn אמיתי של opencode דרך ה-WS. ‏בלי BE לא יהיו סשנים.
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned).
- ‏Typecheck: `pnpm --filter @drive-coding/frontend typecheck`.
- ‏lint:i18n: `pnpm lint:i18n`.

### Browser

‏linux-gui Chrome :9222 profile voice-acp: `playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
‏⚠️ ‏תמיד `-s=vacp`.
‏הבדיקה: ‏(1) ‏עם BE חי, ‏ודא ש-localStorage ‏מכיל `lastCwd` ‏תקין (התחבר פעם אחת לתיקייה). ‏(2) ‏טען מחדש את `/` → ‏הסשנים נטענים אוטומטית (ספינר → ‏רשימה) ‏בלי ללחוץ "טען". ‏(3) ‏נקה localStorage → ‏טען `/` → ‏**‏לא** ‏נטען אוטומטית (cwd ‏מ-homeDir, ‏לא מ-lastCwd).

### Reading list

**must-read** (‏לפני שמתחילים):
- ‏`packages/frontend/src/routes/+page.svelte` — ‏ה-route (293 שורות). ‏קריטי: `onMount` (28-41), `loadSessions` (74-88), ‏ה-state (52-55), ‏ה-`cwd`/`settings.lastCwd` (22).
- ‏`packages/frontend/src/lib/adapters/sessions.ts` — ‏`listSessionsForCwd` (שורות 36-74) + ‏ה-doc על העלות (שורות 6-9).
- ‏`packages/frontend/AGENTS.md` — ‏חוק #1: routes הם shells דקים, ‏אסור `$effect` ‏עם side effects כבדים/polling. ‏**‏שים לב**: ‏ה-onMount הקיים כבר עושה fetch — ‏אנחנו מרחיבים אותו, ‏לא מוסיפים $effect חדש.

**reference** (‏בזמן עבודה):
- ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏`lastCwd` (persisted field).

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏כשמשתמש פותח את טופס החיבור ‏וכבר עבד בעבר בתיקייה מסוימת (יש `lastCwd` ‏שמור),
‏רשימת הסשנים של אותה תיקייה **‏נטענת אוטומטית** ‏(ספינר ואז רשימה) ‏בלי שיצטרך ללחוץ "טען סשנים
‏אחרונים". ‏אם אין `lastCwd` ‏שמור (משתמש חדש, ‏או ה-cwd ‏הגיע מ-homeDir של השרת) — ‏לא נטען אוטומטית,
‏והמשתמש לוחץ ידנית כמו היום. ‏זה חוסך לחיצה במקרה הנפוץ (חזרה לפרויקט מוכר) ‏בלי לבזבז spawn יקר
‏על תיקייה לא-רלוונטית.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏טעינה אוטומטית כש-cwd מ-`lastCwd` (לא ריק, ‏לא מ-homeDir) | ✅ | ‏בslice הזה |
| ‏טעינה פעם אחת בלבד (guard) | ✅ | ‏בslice הזה |
| ‏הכפתור הידני "טען סשנים אחרונים" נשאר | ✅ | ‏בslice הזה (נשאר כ-fallback + ‏רענון) |
| ‏טעינה אוטומטית גם על cwd ריק / homeDir | ❌ | ‏לא — ‏spawn מיותר |
| ‏טעינה אוטומטית בכל שינוי/הקלדה של cwd (debounce) | ❌ | ‏אופציה (ב) שנדחתה — ‏יותר מדי spawns |
| ‏שמירת רשימת הסשנים ב-cache בין reloads | ❌ | ‏עתידי |

---

## §3 — Architecture diagram

```
+page.svelte (route)
  │
  ├─ cwd = $state(settings.lastCwd)            ← ‏קיים
  │
  ├─ onMount:                                   ← ‏משתנה (מרחיב את הקיים)
  │    fetchServerOptions() → homeDir            ← ‏קיים
  │      .then: ‏אם cwd ריק → cwd = homeDir       ← ‏קיים
  │    ‏**‏חדש**: ‏אחרי ש-cwd יציב, ‏אם cwd === lastCwd
  │             ‏(תקין, ‏לא ריק) → void loadSessions()  ‏פעם אחת
  │
  └─ loadSessions()                             ← ‏קיים (לא משתנה)
       └─ listSessionsForCwd(cwd, cliKind)       ← spawn יקר (קיים)
```

‏המהות: ‏מרחיבים את ה-`onMount` ‏הקיים. ‏לא מוסיפים `$effect` ‏חדש (כדי לא להפר את חוק ה-routes
‏הדקים ‏ולא ליצור טעינה על כל שינוי). ‏guard ‏פשוט מבטיח spawn יחיד.

---

## §4 — Commits ‏בסדר

### Commit 0 — טעינה אוטומטית מותנית ב-onMount (approach: manual)

> ‏מטרה: ‏אחרי שה-cwd ‏יציב ‏ב-onMount, ‏אם הוא מגיע מ-`lastCwd` ‏(תיקייה מוכרת) — ‏טען סשנים פעם אחת.

**‏קבצים שמשתנים**:
- `packages/frontend/src/routes/+page.svelte` — ‏ה-`onMount` ‏(שורות 28-41).

**‏המצב הקיים** (‏שורות 21-41, ‏לעיון):
```ts
let cliKind = $state<CliKind>(settings.cliKind)
let cwd = $state(settings.lastCwd)

onMount(() => {
  fetchServerOptions()
    .then((opts) => {
      if (cwd === "" || cwd === settings.lastCwd) {
        if (!settings.lastCwd && cwd === "") {
          cwd = opts.homeDir
        }
      }
    })
    .catch(() => {})
})
```

**‏פרטי מימוש**:
- ‏ה-trigger לטעינה אוטומטית: ‏**‏יש `settings.lastCwd` ‏לא-ריק** ‏(המשתמש התחבר בעבר). ‏במקרה הזה
  ‏`cwd` ‏אותחל מ-`lastCwd` (שורה 22) ‏וה-onMount ‏לא ידרוס אותו (התנאי `!settings.lastCwd` ‏שומר).
- ‏הוסף, ‏**‏אחרי** ‏ה-fetchServerOptions ‏(או במקביל — ‏לא תלוי בו), ‏טעינה מותנית. ‏הדרך הנקייה ביותר:
  ‏בתוך ה-`onMount`, ‏לפני/אחרי ה-fetch, ‏בדוק את ה-lastCwd ‏וטען:
  ```ts
  onMount(() => {
    // ‏טעינה אוטומטית של סשנים — ‏רק אם יש cwd מוכר מ-lastCwd (לא משתמש חדש).
    // ‏spawn יקר → ‏רק כשסביר שהמשתמש יחזור לאותה תיקייה. guard מבטיח פעם אחת.
    if (settings.lastCwd && cwd.trim()) {
      void loadSessions()
    }

    fetchServerOptions()
      .then((opts) => {
        if (cwd === "" || cwd === settings.lastCwd) {
          if (!settings.lastCwd && cwd === "") {
            cwd = opts.homeDir
          }
        }
      })
      .catch(() => {})
  })
  ```
- ‏**‏למה זה בטוח מבחינת guard**: `onMount` ‏רץ פעם אחת בלבד (לכל mount של ה-route). ‏אין לולאה.
  ‏אם המשתמש ינווט החוצה ובחזרה — ‏זה mount חדש, ‏טעינה חדשה — ‏וזה רצוי (נתונים טריים).
- ‏**‏למה לא `$effect`**: `$effect` ‏על `cwd` ‏היה נטען על כל הקלדה (אופציה ב' שנדחתה). `onMount`
  ‏פעם-אחת הוא בדיוק מה שצריך, ‏ועקבי עם חוק ה-routes הדקים (אין polling/side-effect מתמשך).
- ‏**‏סדר**: ‏אפשר לקרוא `loadSessions()` ‏לפני ה-fetch (כפי שלמעלה) — ‏הם בלתי-תלויים (loadSessions
  ‏משתמש ב-cwd ‏שכבר אותחל מ-lastCwd ‏בשורה 22; ‏ה-fetch ‏רק ממלא cwd ‏ריק). ‏אם המבצע מעדיף —
  ‏אפשר גם בתוך `.then` ‏אחרי שה-cwd ‏סופי, ‏אבל אז נטען רק אחרי ה-fetch (איטי יותר ל-UX). **‏העדפה**:
  ‏לקרוא `loadSessions()` ‏מוקדם (לפני fetch) ‏כי ה-cwd ‏מ-lastCwd ‏כבר תקף בשורה 22.
- ‏`loadSessions` (שורות 74-88) ‏כבר מטפל ב-loading/error/ספינר. ‏לא משנים אותו.

**Verification**:
```bash
pnpm lint:i18n
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build
# ‏ידני (linux-gui, BE חי):
#  (1) ‏התחבר פעם אחת לתיקייה תקינה → lastCwd נשמר.
#  (2) ‏חזור ל-/ (reload) → ‏הסשנים נטענים אוטומטית (ספינר→רשימה) בלי ללחוץ "טען".
#  (3) ‏ב-console: localStorage.removeItem("drive-coding-v2-settings") → reload / →
#      ‏לא נטען אוטומטית (cwd יגיע מ-homeDir, lastCwd ריק).
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm --filter @drive-coding/frontend typecheck` |
| 2 | build נקי | `pnpm --filter @drive-coding/frontend build` |
| 3 | lint:i18n עובר | `pnpm lint:i18n` |
| 4 | ‏טעינה אוטומטית כש-lastCwd קיים | linux-gui+BE: ‏התחבר פעם, reload / → ‏סשנים נטענים בלי לחיצה |
| 5 | ‏אין טעינה כשאין lastCwd | ‏נקה localStorage → reload / → ‏אין טעינה אוטומטית (אין ספינר), ‏הכפתור הידני עדיין עובד |
| 6 | spawn יחיד | ‏ב-Network/BE log: ‏רק createAgent אחד בטעינת הדף (לא לולאה/כפילות) |
| 7 | ‏הכפתור הידני עדיין עובד | ‏לחץ "טען סשנים אחרונים" → ‏טוען (גם כ-refresh אחרי האוטומטי) |
| 8 | ‏connect רגיל לא נשבר | ‏בחר תיקייה+CLI → ‏חבר → ‏עובר ל-/chat |
| 9 | mobile + desktop | screenshot של הטופס עם רשימת סשנים נטענת |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| spawn יקר על cwd לא-רלוונטי | ‏עלות listSessionsForCwd | ‏guard: ‏טוען רק כש-`settings.lastCwd` ‏לא-ריק (תיקייה שהמשתמש כבר עבד בה). ‏cwd ריק/homeDir → ‏לא טוען. DoD#5. |
| ‏טעינה כפולה (onMount + ‏לחיצה / ‏re-render) | route lifecycle | `onMount` ‏רץ פעם אחת per mount. `loadSessions` ‏מאפס `sessions=[]` ‏בכל קריאה (אין כפילות נתונים). DoD#6. |
| ‏חוק routes דקים — ‏side effect ב-route | AGENTS.md #1 | ‏זה `onMount` ‏פעם-אחת (כמו ה-fetch הקיים), ‏לא polling/listener מתמשך. ‏עקבי עם הקוד הקיים. ‏**‏לא** ‏מוסיפים `$effect` ‏על cwd (זה היה הופך ל-side-effect מתמשך). |
| ‏BE לא חי → ‏שגיאה בטעינה אוטומטית | dependency | `loadSessions` ‏כבר תופס שגיאה (try/catch, ‏שורות 81-83) ‏ומציג `sessionsError`. ‏לא שובר את הטופס. ‏המשתמש עדיין יכול להקליד cwd ‏ולחבר. |
| ‏cwd מ-lastCwd לא קיים יותר (תיקייה נמחקה) | filesystem | `listSessionsForCwd` ‏יזרוק (createAgent ‏נכשל) → `sessionsError` ‏מוצג. ‏לא קורס. ‏המשתמש משנה cwd. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → ‏אין מחרוזת חדשה. ✅
> 2. Reactivity gotchas → ‏אין $effect חדש (onMount בלבד). ✅
> 3. OneCLI placeholder → ‏ה-BE ‏צריך לרוץ דרך OneCLI ‏(spawn opencode), ‏אבל זה כבר כך; ‏אין שינוי. ✅

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏מתברר שה-`onMount` ‏רץ יותר מפעם אחת (טעינה כפולה) — ‏ייתכן בעיית lifecycle של SvelteKit SPA.
- ‏ה-spawn האוטומטי גורם לתקיעות/האטה מורגשת בטעינת הטופס — ‏שקול לדחות את ה-loadSessions
  ‏ל-`setTimeout(0)` ‏או אחרי ה-fetch (‏שלא יחסום את ה-paint הראשון).
- ‏Brief סותר את עצמו / ‏סטייה מ-approach.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏שינוי קטן ב-route קיים (onMount) | +1 |
| ‏מפעיל spawn יקר (אבל לא מוסיף קוד spawn — ‏רק trigger) | +1 |
| ‏אין state machine / streaming / protocol חדש | 0 |
| ‏קובץ אחד, package אחד | -1 |
| ‏בסיס glue | +2 (base) |

**Score**: 3 / 10

**Tier**: 0-3 → `calev` (verifier-slice-light) ‏בלבד.

**‏Verifier-phase**: ‏אין.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏לטעון לפני ה-fetch ‏או אחרי (בתוך .then)? | ‏לפני (cwd מ-lastCwd כבר תקף בשורה 22; ‏UX מהיר יותר) | ❌ |
| 2 | ‏האם להגן מ-spawn כשהמשתמש ניווט מהר החוצה? | ‏לא נדרש — `loadSessions` ‏מנקה את עצמו; spawn זמני נהרג ב-finally (deleteAgent) | ❌ |
| 3 | ‏לדחות ל-setTimeout(0) ‏שלא יחסום paint? | ‏לא בברירת מחדל; ‏אם מורגשת תקיעה → §7 escalation | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- ...
