# Slice redesign-6 — Modals: Sessions + Folder Picker — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 7/10 (verifier: light)
> **תלות**: depends_on: [redesign-1, redesign-2, redesign-3]
> **base**: branch הקצה הנוכחי של השרשרת (בד"כ slice-redesign-5-bubbles)

> **למה תלוי ב-3**: redesign-6 משתמש ב-component-lib (Bits Dialog) שהוכרע ב-redesign-3, וב-Select/
> ui-wrappers שנוצרו שם. בשרשרת סדרתית ה-base הוא הקצה (אחרי 5), שכבר כולל את 3.

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** AppShell/SessionOptionsPanel (redesign-2),
> Bits ui-wrappers (redesign-3) טרם קיימים ב-dev. ה-base = ה-branch הקודם בשרשרת (כולל 1-5), **לא dev**.
> אם 1-3 טרם בוצעו → עצור. **הערה**: `/api/fs/browse` ו-`listSessionsForCwd` קיימים — תקפים כבר עכשיו.

### Worktree (שרשור)
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-6-modals -b slice-redesign-6-modals <branch-של-הקודם>
cd .worktrees/slice-redesign-6-modals
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- **BE חובה** (sessions = listSessionsForCwd דרך ACP; folder = `/api/fs/browse`): OneCLI BE.
- Chrome מקומי + בדיקת מובייל (Sheet). שם package: `@drive-coding/frontend-v2`.

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext-mockup.html` — `SessionsScreen` (652-697, E1: רשימה+רענן+כרטיסים),
  `FolderPicker` (699-733, E2: breadcrumb+רשימת תיקיות+up+בחר).
- `dev/docs/decisions/voice-acp.md` — entry "redesign-3" (איזה component-lib נבחר — Bits Dialog).
- Bits UI Dialog docs (Svelte 5) — דרך Context7.
- `adapters/sessions.ts` — `listSessionsForCwd(cwd, cliKind)` → `SessionInfo[]`. **קיים.**
- BE `/api/fs/browse?path=` (http-history.ts:115) — מחזיר `{path, entries:[{name,isDir}]}`. **קיים, מאובטח.**
- `components/connect/SessionPicker.svelte` — formatDate + לוגיקת select קיימת (reuse formatDate).
- `routes/+page.svelte` — connect flow (loadSessions, selectedSessionId, session.loadSession).

**reference**: `components/layout/SessionOptionsPanel.svelte` (redesign-2/3) — לחבר את ה-modals אליו.

---

## §1 — מטרה

שני ה-modals של המוקאפ: (E1) פופ-אפ "סשנים אחרונים" — Dialog/Sheet עם רשימת סשנים, כרטיסים נוחים,
כפתור רענון; (E2) folder picker — Dialog עם breadcrump, רשימת תיקיות, ניווט up, וכפתור "בחר תיקייה זו".
שניהם נפתחים מ-SessionOptionsPanel (sidebar/sheet) ומ-/settings. נבנים על ה-component-lib (Bits Dialog)
שהוכרע ב-redesign-3 — focus-trap, Esc, click-outside, scroll-lock מטופלים על-ידיו.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| E1: SessionsDialog — רשימה + רענן + כרטיסים + בחירה | ✅ | כאן |
| E2: FolderPickerDialog — breadcrumb + רשימה + up + בחר | ✅ | כאן |
| חיווט: SessionsDialog ל-listSessionsForCwd + session.loadSession | ✅ | כאן |
| חיווט: FolderPicker ל-`/api/fs/browse` + setLastCwd | ✅ | כאן |
| Bits Dialog (focus-trap/Esc/click-outside) — או fallback | ✅ | כאן |
| פתיחה מ-SessionOptionsPanel (sessions list "..." / folder "בחר") | ✅ | כאן |
| **שינוי BE** (`/api/fs/browse` כבר קיים) | ❌ | — |
| **רשימת סשנים inline ב-sidebar** (לא modal) | 🟡 | ה-sidebar מציג preview קצר; "הצג הכל" פותח Dialog. או הכל ב-Dialog — §9 |
| connect route (`/`) redesign | ❌ | נשאר; ה-modals זמינים גם מתוכו אם רלוונטי (אופציונלי) |

> **קו אדום**: `/api/fs/browse` ו-`listSessionsForCwd` קיימים ועובדים. **אל תיגע ב-BE.** רק FE.

---

## §3 — Architecture diagram

```
adapters/fs-browse.ts            ← חדש (adapter ל-GET /api/fs/browse — מחזיר {path, entries})
components/modals/
  SessionsDialog.svelte          ← חדש (E1: Bits Dialog, רשימת SessionInfo, רענן, בחירה)
  FolderPickerDialog.svelte      ← חדש (E2: Bits Dialog, fs-browse, breadcrumb, up, בחר)
  SessionCard.svelte             ← חדש (כרטיס סשן — מוקאפ 293-301)
view-models/modals.svelte.ts     ← חדש? (ModalsVM: sessionsOpen/folderOpen $state) — או local? §3 הערה
components/layout/SessionOptionsPanel.svelte  ← משתנה: כפתורי "סשנים"/"בחר תיקייה" פותחים Dialogs
components/settings/SettingsScreen.svelte     ← משתנה: כפתור "בחר…" פותח FolderPickerDialog
context.ts / +layout.svelte      ← additive אם ModalsVM
i18n/keys.ts                     ← additive (folder/sessions modal labels)
```

> **שאלת VM**: open/close state של modals — entity? **גבולי.** אם רק SessionOptionsPanel פותח →
> local $state בו. אבל אם גם /settings פותח folder וגם sidebar → **ModalsVM singleton** (חוצה
> components). **הכרעה: ModalsVM** (folderOpen/sessionsOpen + open/close methods) — כי הפותחים
> מרובים (sidebar, sheet, settings). זה entity של UI-state גלובלי כמו UiShellVM. ✓

---

## §4 — Commits

### Commit 1 — fs-browse adapter + ModalsVM (approach: manual)
**קבצים חדשים**:
- `adapters/fs-browse.ts`:
```ts
export type FsEntry = { name: string; isDir: boolean }
export type FsBrowseResult = { path: string; entries: FsEntry[] }
export async function browseFolder(path: string): Promise<FsBrowseResult> {
  const res = await fetch(beUrl(`/api/fs/browse?path=${encodeURIComponent(path)}`))
  if (!res.ok) throw new Error(`browse failed: ${res.status}`)
  return res.json() as Promise<FsBrowseResult>
}
```
- `view-models/modals.svelte.ts`:
```ts
export class ModalsVM {
  sessionsOpen = $state(false)
  folderOpen = $state(false)
  openSessions(): void { this.sessionsOpen = true }
  openFolder(): void { this.folderOpen = true }
  // (close דרך bind מ-Bits Dialog onOpenChange)
}
```
**additive**: context (setModals/getModals), +layout (new ModalsVM + setModals).
**Verification**: `typecheck`. (אם בוחרים local state במקום VM — דווח ועדכן §3.)

### Commit 2 — FolderPickerDialog (E2) (approach: manual)
**קובץ חדש**: `FolderPickerDialog.svelte` (מוקאפ 699-733) — Bits Dialog. state: `currentPath`,
`entries` (מ-browseFolder). breadcrumb (split path), כפתור up (parent), רשימת תיקיות (isDir בלבד
לניווט), "בחר תיקייה זו" → `settings.setLastCwd(currentPath)` + close. אייקונים Lucide (Folder, ArrowUp).
**Verification**: `typecheck` + `lint:i18n` + ידני: פתח → נווט תיקיות → בחר → cwd מתעדכן.

### Commit 3 — SessionsDialog (E1) (approach: manual)
**קבצים חדשים**: `SessionsDialog.svelte` + `SessionCard.svelte` (מוקאפ 652-697, 293-301) — Bits Dialog.
state: `sessions` (מ-listSessionsForCwd), loading, error. כפתור רענן → reload. כרטיס → `session.loadSession`
+ goto("/chat") + close. "סשן חדש" → close + reset. reuse `formatDate` מ-SessionPicker.
**Verification**: `typecheck` + `lint:i18n` + ידני: פתח → רשימת סשנים → רענן → בחר → טוען סשן.

### Commit 4 — חיווט מ-panels (approach: manual)
`SessionOptionsPanel.svelte` — כפתור "בחר תיקייה" → `modals.openFolder()`; אזור סשנים →
preview + "הצג הכל"/הכפתורים → `modals.openSessions()`. רנדר את שני ה-Dialogs (פעם אחת, ברמת AppShell
או SessionOptionsPanel). `SettingsScreen.svelte` — כפתור "בחר…" → `modals.openFolder()`.
**מחיקה (חוק זהב #5)**: אם SessionPicker הישן כבר לא בשימוש ב-`/` (connect עדיין משתמש בו?) — **בדוק**;
אם connect עדיין צריך אותו, השאר. אל תמחק אם יש consumer.
**Verification**: `typecheck/build/test/lint:i18n` + ידני מלא: שני ה-modals נפתחים מכל הנקודות.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | 4 פקודות |
| FolderPicker עובד | פתח → נווט (up/into) → breadcrumb מתעדכן → בחר → setLastCwd |
| FolderPicker security | נתיב מחוץ ל-allowedBase → 403 (BE קיים מטפל); FE מציג שגיאה גרייספול |
| Sessions עובד | פתח → רשימה נטענת → רענן → בחר סשן → loadSession + goto chat |
| Bits Dialog a11y | Esc סוגר, click-outside סוגר, focus-trap (Tab נשאר בפנים), focus חוזר לכפתור |
| מובייל | Dialogs נוחים למגע (כרטיסים גדולים) |
| פתיחה מכל הנקודות | sidebar, sheet, /settings — כולם פותחים את ה-modals הנכונים |
| אין שינוי BE | `git diff packages/backend` ריק |
| ModalsVM | open/close דרך VM (או local מתועד) |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| Bits Dialog RTL / portal issues | component-lib | בדוק RTL מוקדם. אם Dialog שובר RTL → custom modal (focus-trap ידני) — אבל זה בדיוק מה ש-Bits אמור לפתור. escalation אם נשבר. |
| path traversal דרך FE | T6 (code-review) | ה-BE `/api/fs/browse` כבר מאובטח (allowedBase, realpath, 403). FE רק קורא — אל תעקוף. |
| browseFolder beUrl | be-url.ts | השתמש ב-`beUrl()` (לא fetch ישיר) — תומך ב-cross-origin/proxy. |
| מחיקת SessionPicker שוברת connect | חוק זהב #5 | בדוק אם `/` עדיין משתמש בו. אל תמחק אם יש consumer. |
| Hardcoded Hebrew | hook | t(key). |
| sessions טעינה איטית (300-700ms) | sessions.ts comment | הצג spinner תמיד לפני (כמו SessionPicker היום). |

---

## §7 — Escalation triggers
- Bits Dialog שובר RTL/portal באופן שדורש hacks > 30 שורות → custom modal, דווח.
- צריך שינוי ב-`/api/fs/browse` או ב-`listSessionsForCwd` (BE) → עצור (אמורים להספיק).
- path traversal — אם מתפתים לעקוף את ה-allowedBase של BE → עצור (T6).

## §8 — Complexity score
**7/10 → light.** commits 4, שכבות: 2 modals + adapter + ModalsVM (+1), Bits Dialog (+1),
2 אינטגרציות (fs-browse + listSessions, קיימות) (+1... כל אחת), חיווט מרובה-נקודות (+2). ≈7.
runtime: a11y של Dialog + flows (folder nav, session load) — light. אם Bits Dialog RTL מתעכב → phase.

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | sessions — inline preview ב-sidebar + Dialog "הצג הכל", או הכל ב-Dialog? | preview קצר ב-sidebar + Dialog מלא | ❌ |
| 2 | ModalsVM או local state? | ModalsVM (פותחים מרובים) | ❌ (הוכרע) |
| 3 | FolderPicker — Dialog (דסקטופ) + Sheet (מובייל), או Dialog תמיד? | Dialog תמיד (Bits Dialog responsive); אם צריך Sheet במובייל — בהמשך | ❌ |
| 4 | SessionPicker הישן — מחק? | רק אם `/` לא משתמש בו; בדוק consumer | ❌ |
