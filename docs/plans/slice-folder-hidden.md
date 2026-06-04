# Slice folder-hidden — checkbox "הצג תיקיות מוסתרות" בבורר התיקיות — ‏תוכנית

> **‏תאריך**: 2026-06-03
> **‏סטטוס**: הושלם (2026-06-03)
> **Complexity**: 3/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `e87389d`

---

## §0 — Pre-flight

> ‏slice שמוסיף checkbox "הצג תיקיות מוסתרות" ל-FolderPickerDialog. ‏הסינון נעשה ב-**BE**
> ‏(`http-history.ts`, `HIDDEN_PREFIXES`), ‏אז זה נוגע ב-3 שכבות: BE endpoint (param חדש
> ‏`showHidden`), adapter (`fs-browse.ts`), ‏ו-FE component. ‏יש טסטים קיימים ל-endpoint.

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev (`e87389d`).

> ‏⚠️ ‏נגיעה משותפת אפשרית עם `slice-ui-polish-1` (‏שניהם נוגעים ב-`FolderPickerDialog.svelte`).
> ‏ui-polish-1 ‏נוגע ב-**breadcrumb** (שורות 99-111); ‏slice זה נוגע ב-**header/checkbox** ‏וב-`loadFolder`.
> ‏אם ui-polish-1 ‏כבר מוזג ל-dev — ‏אין התנגשות (בנה על ה-tip המעודכן). ‏אם רצים במקביל —
> ‏מרדכי ימזג לפי סדר; ‏ההתנגשות מינורית (אזורים שונים בקובץ). ‏ברירת מחדל: ‏base = dev הנוכחי.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-folder-hidden -b slice-folder-hidden dev
cd .worktrees/slice-folder-hidden
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000).
  ‏(‏ה-endpoint `/api/fs/browse` ‏לא דורש proxy/OneCLI לעצמו, ‏אבל ה-BE כולו רץ דרך OneCLI — ‏ראה AGENTS.md.)
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned).
- ‏Tests BE: `pnpm --filter @drive-coding/backend test` — ‏יש describe קיים `GET /api/fs/browse` ‏ב-`packages/backend/tests/http-history.test.ts:121`.
- ‏Typecheck: `pnpm --filter @drive-coding/backend typecheck && pnpm --filter @drive-coding/frontend typecheck`.
- ‏lint:i18n: `pnpm lint:i18n`.

### Browser

‏linux-gui Chrome :9222 profile voice-acp: `playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
‏⚠️ ‏תמיד `-s=vacp`.
‏הבדיקה: ‏פתח `/`, ‏לחץ על כפתור התיקייה → ‏ה-dialog. ‏נווט לתיקייה עם `.git`/`node_modules` ‏(למשל שורש הפרויקט). ‏ללא סימון — ‏הן מוסתרות; ‏עם סימון — ‏מופיעות.

### Reading list

**must-read** (‏לפני שמתחילים):
- ‏`packages/backend/src/delivery/http-history.ts` — ‏ה-endpoint `/api/fs/browse` (שורות 102-156), `HIDDEN_PREFIXES` (שורה 104), ‏ה-handler (115-156).
- ‏`packages/backend/tests/http-history.test.ts` — ‏ה-describe הקיים (שורות 119-159), ‏לחיקוי דפוס הטסט.
- ‏`packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — ‏ה-component (163 שורות, ‏קרא במלואו).
- ‏`packages/frontend/src/lib/adapters/fs-browse.ts` — ‏ה-adapter (18 שורות).

**reference** (‏בזמן עבודה):
- ‏`packages/frontend/AGENTS.md` — ‏חוקי שכבות (adapter = I/O, ‏component = leaf).

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏בבורר התיקיות יש תיבת סימון "הצג תיקיות מוסתרות". ‏כברירת מחדל היא **‏לא** ‏מסומנת —
‏תיקיות כמו `.git`, `.opencode`, `.svelte-kit`, `node_modules`, `.pnpm` ‏מוסתרות (כמו היום). ‏כשהמשתמש
‏מסמן אותה, ‏הרשימה נטענת מחדש **‏עם** ‏כל התיקיות המוסתרות. ‏ביטול הסימון מחזיר את ההסתרה. ‏הבחירה
‏היא מקומית ל-dialog (לא נשמרת) ‏ומתאפסת בכל פתיחה.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏param `showHidden` ב-`GET /api/fs/browse` | ✅ | ‏בslice הזה (BE) |
| ‏כש-`showHidden=true` → ‏מבטל את **‏כל** ‏ה-`HIDDEN_PREFIXES` | ✅ | ‏בslice הזה (החלטה: ‏מבטל הכל, ‏כולל node_modules) |
| ‏adapter `browseFolder(path, showHidden?)` | ✅ | ‏בslice הזה (FE) |
| checkbox ב-FolderPickerDialog + ‏reload בשינוי | ✅ | ‏בslice הזה |
| ‏i18n key למחרוזת ה-checkbox | ✅ | ‏בslice הזה |
| ‏שמירת ההעדפה (persisted) | ❌ | ‏לא — ‏מקומי ל-dialog, ‏מתאפס בפתיחה |
| ‏הסתרה חלקית (רק dotfiles, ‏לא node_modules) | ❌ | ‏הוכרע: ‏מבטל הכל |

---

## §3 — Architecture diagram

```
┌──────────────────────────┐
│ FolderPickerDialog.svelte│ ← ‏משתנה: + checkbox showHidden ($state)
│  showHidden: $state(false)│    + loadFolder מעביר showHidden
│  loadFolder(path,         │    + $effect/onchange → reload
│             showHidden)   │
└──────────┬───────────────┘
           │ browseFolder(path, showHidden)
           ▼
┌──────────────────────────┐
│ fs-browse.ts (adapter)   │ ← ‏משתנה: + param showHidden → query string
│  GET /api/fs/browse       │
│    ?path=X&showHidden=1   │
└──────────┬───────────────┘
           │ HTTP
           ▼
┌──────────────────────────┐
│ http-history.ts (BE)     │ ← ‏משתנה: ‏קורא query showHidden,
│  registerFsBrowseHttp     │    ‏מדלג על סינון HIDDEN_PREFIXES כש-true
└──────────────────────────┘
```

---

## §4 — Commits ‏בסדר

### Commit 0 — BE: ‏param `showHidden` ב-/api/fs/browse (approach: integration)

> ‏מטרה: ‏ה-endpoint מקבל `?showHidden=true` ‏ואז מחזיר גם תיקיות מוסתרות. ‏ברירת מחדל (חסר/false) — ‏התנהגות נוכחית.

**‏קבצים שמשתנים**:
- `packages/backend/src/delivery/http-history.ts` — ‏ה-handler של `/api/fs/browse` (שורות 115-156).

**‏פרטי מימוש**:
- ‏אחרי `const rawPath = c.req.query("path")` (שורה 116), ‏הוסף:
  ```ts
  const showHidden = c.req.query("showHidden") === "true"
  ```
- ‏ב-`.filter(...)` ‏(שורות 143-148): ‏כיום `.filter((d) => !HIDDEN_PREFIXES.some((prefix) => d.name.startsWith(prefix)))`.
  ‏שנה ל:
  ```ts
  .filter((d) => showHidden || !HIDDEN_PREFIXES.some((prefix) => d.name.startsWith(prefix)))
  ```
  ‏כלומר: ‏כש-`showHidden` → ‏לא מסנן כלום (מחזיר הכל). ‏אחרת — ‏הסינון הקיים.
- ‏**‏אבטחה לא משתנה**: ‏ה-guard של `allowedBase`/realpath (שורות 121-134) ‏נשאר כמו שהוא. `showHidden` ‏משפיע **‏רק** ‏על סינון השמות, ‏לא על האבטחה. ‏עדיין אי אפשר לצאת מ-allowedBase.
- ‏אין שינוי בצורת ה-response (`{ path, entries }`).

**Tests** (‏הוסף ל-describe הקיים `GET /api/fs/browse` ‏ב-`tests/http-history.test.ts`, ‏אחרי שורה 158):
- ‏צור `tmpdir` ‏עם תת-תיקייה רגילה (`visible`) ‏ותת-תיקייה מוסתרת (`.hidden` ‏או `node_modules`).
  ‏(‏השתמש ב-`mkdtemp`/`mkdir` ‏מ-`node:fs/promises` — ‏ראה דפוס הטסטים הקיים שמשתמש ב-`tmpdir()`.)
- ‏טסט 1: ‏ללא `showHidden` → ‏הרשימה **‏לא** ‏מכילה את `node_modules`/`.hidden`.
- ‏טסט 2: ‏עם `?showHidden=true` → ‏הרשימה **‏כן** ‏מכילה אותן.
- ‏נקה את ה-tmpdir בסוף (`rm recursive`).

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm --filter @drive-coding/backend test   # ‏הטסטים החדשים + הקיימים עוברים
# ‏ידני: curl "http://localhost:4000/api/fs/browse?path=<repo-root>&showHidden=true" | jq '.entries[].name'  ← ‏מכיל .git/node_modules
#        curl "http://localhost:4000/api/fs/browse?path=<repo-root>" | jq '.entries[].name'                  ← ‏לא מכיל
```

### Commit 1 — FE adapter: `browseFolder(path, showHidden?)` (approach: manual)

> ‏מטרה: ‏ה-adapter מעביר את הדגל ל-query string.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/fs-browse.ts` — ‏הפונקציה `browseFolder` (שורה 14).

**API skeleton** (‏החתימה החדשה):
```ts
export async function browseFolder(path: string, showHidden = false): Promise<FsBrowseResult> {
  const params = new URLSearchParams({ path })
  if (showHidden) params.set("showHidden", "true")
  const res = await fetch(beUrl(`/api/fs/browse?${params}`))
  if (!res.ok) throw new Error(`browse failed: ${res.status}`)
  return res.json() as Promise<FsBrowseResult>
}
```
- ‏param אופציונלי עם default `false` → ‏קוראים קיימים (אם יש) ‏לא נשברים. (‏הקורא היחיד הוא `FolderPickerDialog`, ‏שמשתנה ב-Commit 2.)
- ‏שמור על `encodeURIComponent` — ‏`URLSearchParams` ‏מקודד אוטומטית, ‏אז המעבר ל-`URLSearchParams` ‏תקין ‏ובטוח (‏מחליף את ה-`encodeURIComponent` ‏הידני הקודם).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
```

### Commit 2 — FE: checkbox ב-FolderPickerDialog (approach: manual)

> ‏מטרה: ‏ה-UI. checkbox ‏שמפעיל reload עם הדגל.

**‏קבצים שמשתנים**:
- `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — `$state` + ‏loadFolder + checkbox markup.
- ‏i18n: `packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts` — ‏key חדש `modal.folder.showHidden`.

**‏פרטי מימוש**:
- ‏הוסף `$state`: `let showHidden = $state(false)` ‏(ליד שאר ה-state, ‏שורות 22-26).
- ‏שנה את `loadFolder` (שורה 38) ‏להעביר את הדגל: `await browseFolder(path, showHidden)`.
- ‏ה-`$effect` ‏הקיים (שורות 29-31) ‏טוען בפתיחת dialog. ‏**‏אפס את showHidden בפתיחה** — ‏כדי שלא ידלוף בין פתיחות:
  ```ts
  $effect(() => {
    if (modals.folderOpen) {
      showHidden = false  // ‏איפוס בכל פתיחה (לפי §2: ‏מקומי, ‏מתאפס)
      void loadFolder(currentPath)
    }
  })
  ```
  ‏⚠️ ‏Svelte gotcha (memory `$effect read+write same $state`): ‏ה-effect קורא `modals.folderOpen` ‏וכותב `showHidden`+`currentPath` (state אחרים) → ‏לא לולאה. ‏אבל **‏אל תקרא** `showHidden` ‏בתוך ה-effect הזה (רק כותב), ‏אחרת תיווצר תלות. ‏ה-`loadFolder` ‏קורא showHidden — ‏זה בסדר כי הוא לא reactive-tracked בתוך effect (קריאה רגילה בפונקציה). ‏אם בכל זאת יש loop — ‏עטוף ב-`untrack`.
- ‏handler לשינוי ה-checkbox — ‏reload עם הערך החדש:
  ```ts
  function onToggleHidden() {
    showHidden = !showHidden
    void loadFolder(currentPath)
  }
  ```
  ‏(‏או `onchange` ‏על ה-input. ‏העדפה: ‏handler מפורש כדי לשלוט בסדר set→reload.)
- ‏markup — ‏הוסף את ה-checkbox ‏ב-header של ה-dialog (ליד הכותרת, ‏שורות 85-97) ‏או מעל רשימת התיקיות (לפני שורה 114). **‏העדפה**: ‏שורה דקה מתחת ל-breadcrumb (אחרי שורה 111), ‏לפני רשימת התיקיות:
  ```svelte
  <label class="mx-4 mb-1 flex items-center gap-2 text-xs shrink-0" style="color:var(--fg-dim)">
    <input type="checkbox" checked={showHidden} onchange={onToggleHidden} class="cursor-pointer" />
    {t("modal.folder.showHidden")}
  </label>
  ```
- ‏i18n key: `"modal.folder.showHidden"` — he: `"הצג תיקיות מוסתרות"`, en: `"Show hidden folders"`.
  ‏הוסף ל-`keys.ts` (union), `he.ts` (חובה), `en.ts` (placeholder/אנגלית). ‏המיקום ב-catalog — ‏ליד שאר `modal.folder.*` (שורות 93-97 ב-he.ts).
- ‏⚠️ ‏i18n lint: ‏המחרוזת "הצג תיקיות מוסתרות" ‏היא UI → ‏**‏חייבת** ‏לעבור דרך key, ‏לא hardcoded.

**Verification**:
```bash
pnpm lint:i18n
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build
# ‏ידני (linux-gui): / → ‏כפתור תיקייה → dialog → ‏נווט ל-repo root.
#   ‏ללא סימון: ‏אין .git/node_modules. ‏סמן את ה-checkbox → ‏הרשימה נטענת מחדש, ‏מופיעות.
#   ‏סגור ופתח שוב → ‏ה-checkbox מאופס (לא מסומן).
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck BE+FE נקי | `pnpm --filter @drive-coding/backend typecheck && pnpm --filter @drive-coding/frontend typecheck` |
| 2 | build FE נקי | `pnpm --filter @drive-coding/frontend build` |
| 3 | ‏טסטים BE עוברים (חדשים+קיימים) | `pnpm --filter @drive-coding/backend test` |
| 4 | lint:i18n עובר | `pnpm lint:i18n` |
| 5 | ‏BE: ‏ללא showHidden מסתיר | `curl ".../api/fs/browse?path=<root>"` → ‏אין node_modules/.git |
| 6 | ‏BE: ‏showHidden=true חושף | `curl ".../api/fs/browse?path=<root>&showHidden=true"` → ‏יש node_modules/.git |
| 7 | ‏BE: ‏אבטחה לא נפגעה | `curl ".../api/fs/browse?path=/etc&showHidden=true"` → 403 (עדיין חסום) |
| 8 | ‏FE: checkbox מציג/מסתיר | linux-gui: ‏סמן → ‏מופיעות; ‏בטל → ‏נעלמות |
| 9 | ‏FE: ‏מתאפס בפתיחה | ‏סמן, ‏סגור dialog, ‏פתח שוב → ‏לא מסומן |
| 10 | regression: ‏ניווט עדיין עובד | ‏לחיצה על תיקייה/up/pick עדיין עובדים |
| 11 | mobile + desktop | screenshot של dialog ב-2 viewports |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| showHidden ‏עוקף את אבטחת allowedBase | BE | ‏לא — `showHidden` ‏משפיע **‏רק** ‏על `.filter` ‏של שמות. ‏ה-guard (realpath+allowedBase, ‏שורות 121-134) ‏רץ קודם, ‏ללא תלות בדגל. DoD#7 ‏מאמת. |
| ‏איפוס showHidden ‏ב-$effect גורם ל-loop | Svelte memory 2026-05-16 | ‏ה-effect קורא `folderOpen` ‏בלבד, ‏כותב showHidden/currentPath (state אחר). ‏אל תקרא showHidden בתוכו. ‏אם loop → `untrack`. |
| Hardcoded Hebrew ("הצג תיקיות מוסתרות") | learnings | ‏דרך i18n key `modal.folder.showHidden`. ‏pre-commit hook חוסם. ‏ודא `pnpm hooks:install`. |
| ‏התנגשות עם slice-ui-polish-1 ב-FolderPickerDialog | parallel | ‏אזורים שונים (breadcrumb vs checkbox/loadFolder). ‏אם ui-polish מוזג קודם — bנה על tip מעודכן. ‏מרדכי ממזג בסדר. |
| ‏טסט BE ‏יוצר תיקיות זמניות שלא נמחקות | tests | ‏השתמש ב-`mkdtemp` + `rm({recursive})` ‏ב-cleanup. ‏ראה דפוס קיים. |

> ‏3 שתמיד נשכחים:
> 1. Hardcoded strings → i18n ✅
> 2. Reactivity gotchas → $effect ‏איפוס ✅
> 3. OneCLI placeholder → ‏לא רלוונטי (fs/browse ‏לא עובר proxy). ‏ה-BE כולו רץ דרך OneCLI ‏בכל מקרה.

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏ה-$effect ‏של איפוס showHidden ‏גורם ל-infinite loop למרות untrack.
- ‏ה-filter ‏ב-BE ‏לא מבדיל נכון בין dotfiles רגילים לבין HIDDEN_PREFIXES (‏שים לב: ‏ההחלטה היא "מבטל הכל" — ‏אם מתעורר ספק על node_modules, ‏ההכרעה כבר ניתנה: ‏חושף הכל).
- ‏Brief סותר את עצמו / ‏סטייה מ-approach.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏שינוי endpoint קיים (BE) + adapter + FE | +1 |
| >5 files? ‏לא (4 קבצים: BE, test, adapter, component, i18n) — ‏ב-2 packages | +1 |
| ‏integration test ל-BE | -1 |
| ‏אין state machine / streaming / protocol | 0 |
| ‏בסיס glue/IO | +2 (base) |

**Score**: 3 / 10

**Tier**: 0-3 → `calev` (verifier-slice-light) ‏בלבד. ‏אין verifier-phase.

**‏Verifier-phase**: ‏אין.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | showHidden ‏מבטל הכל ‏או רק dotfiles? | **‏מבטל הכל** (כולל node_modules) — ‏הוכרע ע"י המשתמשת | ❌ (‏הוכרע) |
| 2 | ‏מיקום ה-checkbox — header ‏או מעל הרשימה? | ‏שורה דקה מתחת ל-breadcrumb, ‏מעל הרשימה | ❌ |
| 3 | ‏לשמור את ההעדפה (persisted)? | ‏לא — ‏מקומי, ‏מתאפס בפתיחה | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- ללא סטיות מה-brief. טסט showHidden הראשוני השתמש ב-`.hidden` שלא ב-HIDDEN_PREFIXES — תוקן ל-`.git` (שכן ברשימה). ה-brief לא ציין סטייה זו כסיכון (וצדק — תיקון טריוויאלי).
