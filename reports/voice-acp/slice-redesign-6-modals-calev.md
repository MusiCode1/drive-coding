---
project: "voice-acp"
slice: "slice-redesign-6-modals"
verifier: "calev"
date: "2026-06-02"
mode: "light"
verdict: "NO-GO"
dod_items:
  - "typecheck/build/test/i18n נקיים"
  - "FolderPicker עובד: פתח → נווט (up/into) → breadcrumb מתעדכן → בחר → setLastCwd"
  - "FolderPicker security: נתיב מחוץ ל-allowedBase → 403 + graceful error"
  - "Sessions עובד: פתח → רשימה נטענת → רענן → בחר סשן → loadSession + goto chat"
  - "Bits Dialog a11y: Esc סוגר, click-outside סוגר, focus-trap (Tab נשאר בפנים)"
  - "מובייל: Dialogs נוחים למגע"
  - "פתיחה מכל הנקודות: sidebar + sheet + /settings"
  - "אין שינוי BE"
  - "ModalsVM: open/close דרך VM"
spot_check: "FolderPickerDialog נפתח מ-Settings Browse וגם מ-Sidebar — אבל entries ריקות לנצח (onOpenChange לא נורה בעת פתיחה programmatic)"
findings:
  - id: 1
    severity: "blocker"
    category: "cross-store-null"
    summary: "onOpenChange לא נורה כש-modals.folderOpen/$sessionsOpen משתנה externally — loadFolder/loadSessions לא נקראים אף פעם"
    source_brief: "DoD item 2 + DoD item 4"
    source_code: "FolderPickerDialog.svelte:48, SessionsDialog.svelte:40"
    cost_estimate: "30min — add $effect(() => { if (modals.folderOpen) loadFolder(currentPath) }) in each component"
  - id: 2
    severity: "minor"
    category: "spec-drift"
    summary: "click-outside לא סוגר Dialog — Bits Dialog לא מגדיר interactOutside; DoD אמר 'click-outside סוגר'"
    source_brief: "DoD item 5"
    source_code: "FolderPickerDialog.svelte:68, SessionsDialog.svelte:60"
    cost_estimate: "10min — add interactOutside prop or dismiss on backdrop click"
---

# slice-redesign-6-modals — Verification Report (Light)

> **תאריך:** 2026-06-02
> **Tier:** light
> **Commit:** 92ecf2d

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 6/9 |
| Happy path עובד | ❌ |
| Bugs חדשים | 1 blocker + 1 minor |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck/build/test/i18n נקיים | ✅ | אליעזר דיווח + 447 tests pass |
| 2 | FolderPicker עובד (browse → entries) | ❌ | Dialog נפתח אבל entries תמיד ריקות — loadFolder לא נקרא |
| 3 | FolderPicker security: 403 graceful | ✅ | `curl /api/fs/browse?path=/etc/shadow` → `{"error":"access denied"}`; browseFolder זורק Error ו-template מציג שגיאה |
| 4 | Sessions עובד (רשימה נטענת) | ❌ | Dialog נפתח עם "אין סשנים" לנצח — listSessionsForCwd לא נקרא |
| 5a | Bits Dialog a11y: Esc סוגר | ✅ | בדוק ב-FolderPicker + Sessions — שניהם נסגרים ב-Escape |
| 5b | Bits Dialog a11y: click-outside סוגר | ⚠️ | Overlay (z-40) מתחת ל-Content (z-50); Bits Dialog לא מגדיר interactOutside — click-outside לא סוגר |
| 5c | Bits Dialog a11y: focus-trap (Tab) | ✅ | Tab מחזר בין Refresh → Close → New session → Refresh בתוך dialog בלבד |
| 6 | מובייל: Dialogs נוחים | ⓘ | לא נבדק — אין מכשיר מובייל בסביבה; גדלי כפתורים (py-3.5) נראים תקינים בקוד |
| 7 | פתיחה מכל הנקודות | ✅ | Settings "Browse…" פותח FolderPickerDialog; Sidebar "Refresh"+"New session" פותחים SessionsDialog |
| 8 | אין שינוי BE | ✅ | `git diff packages/backend --name-only` ריק |
| 9 | ModalsVM open/close דרך VM | ✅ | ModalsVM.sessionsOpen/folderOpen $state, openSessions/openFolder/close* methods — context + layout |

## Happy path

**FolderPicker flow**: פתיחה דרך Settings "Browse…" → Dialog נפתח עם breadcrumb `home /user` + כפתור ".." + "Choose this folder". `entries[]` ריק לנצח. `loadFolder` לא מופעל כי `onOpenChange` לא נורה בפתיחה programmatic.

**Evidence מעמיקה**: `window.performance.getEntries()` הראה **0 קריאות** ל-`/api/fs/browse` אחרי פתיחת dialog (בדיקה ישירה דרך `fetch('/api/fs/browse?path=/home/user')` מ-browser → מחזיר 67 dirs; ה-BE עובד; הבעיה בקומפוננטה בלבד).

**Sessions flow**: פתיחה דרך Sidebar "Refresh" → Dialog עם כותרת "Recent sessions" + "No sessions" + "＋ New session". Esc סוגר ✅, focus-trap ✅.

❌ **נשבר ב-step 1**: שתי ה-dialogs נפתחות אך אינן טוענות נתונים.

## Bugs חדשים שלא ברשימה

(אין — שני ה-findings הם DoD items ישירים)

---

## ניתוח שורש הבאג (לאליעזר)

### Blocker #1: `onOpenChange` לא נורה בפתיחה programmatic

**הקוד הבעייתי** ב-`FolderPickerDialog.svelte`:
```svelte
function onOpenChange(open: boolean) {
  modals.folderOpen = open
  if (open) void loadFolder(currentPath)   ← נורה רק מ-Bits Dialog עצמו
}

<BitsDialog.Root open={modals.folderOpen} {onOpenChange}>
```

**הבעיה**: ב-Bits UI controlled mode, `onOpenChange` נורה רק כש-**Bits Dialog עצמו** מבקש לשנות state (למשל: Esc, לחיצה על X). כשהורה משנה `open` externally (דרך `modals.openFolder()` → `folderOpen = true`), Bits **לא** קורא ל-`onOpenChange`. לכן `loadFolder` לא נורה.

**תיקון**: `$effect` שצופה ב-state ישירות:
```svelte
$effect(() => {
  if (modals.folderOpen) void loadFolder(currentPath)
})
```
ואז `onOpenChange` ישמש רק לסנכרון close (כשBits סוגר):
```svelte
function onOpenChange(open: boolean) {
  modals.folderOpen = open
}
```

אותו תיקון ב-`SessionsDialog.svelte` עם `modals.sessionsOpen`.

### Minor #2: click-outside לא סוגר

`BitsDialog.Content` מוגדר עם `class="fixed inset-0 z-50"` — ממלא את כל המסך. לחיצה "מחוץ" לקופסה הפנימית עדיין נוחתת על ה-Content ולא על ה-Overlay (z-40).

**תיקון**: הוסף `interactOutside` prop על `BitsDialog.Content`:
```svelte
<BitsDialog.Content
  onInteractOutside={() => modals.closeFolder()}
  ...
>
```
או תוסף `closeOnInteractOutside` prop אם הגרסה תומכת.
