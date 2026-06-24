---
project: "drive-coding"
slice: "chat-render-polish"
verifier: "calev"
date: "2026-06-24"
mode: "light"
verdict: "PARTIAL"
dod_items:
  - "markdown tests pass (GFM tables + XSS)"
  - "align attr passes to th/td"
  - "ToolContentImage type in union"
  - "mapToolContent: image+resource branch"
  - "ToolBubble renders <img> for c.type=image"
  - "settings: collapseThoughts+expandTools fields"
  - "settings: persist via #persist()"
  - "settings: setCollapseThoughts/setExpandTools setters"
  - "SettingsScreen: new card with 2 toggles + reset"
  - "ThoughtBubble: <details open={!collapseThoughts}>"
  - "ToolBubble: <details open={expandTools}>"
  - "i18n: 3 new keys in he+en catalogs"
  - "no hardcoded Hebrew in code"
  - "typecheck clean"
findings:
  - id: 1
    severity: "blocker"
    category: "reload-reconnect"
    summary: "snap-back confirmed in compiled output: f.open=a.expandTools runs inside same template_effect as tc.status update"
    source_brief: "DoD: snap-back risk §6 + §4 commit-2"
    source_code: "compiled node 3.Cx_ufE9v.js — O(b=>{f.open=a.expandTools, ut(y,1,...status...) })"
    cost_estimate: "30min"
  - id: 2
    severity: "minor"
    category: "unique"
    summary: "image/SVG render requires human visual confirmation — no browser tool available"
    source_brief: "DoD: PNG/SVG ידני"
    source_code: "ToolBubble.svelte:110-115"
    cost_estimate: "0"
---

# chat-render-polish — Verification Report (Light) — Live Re-run

> **תאריך:** 2026-06-24
> **Tier:** light
> **Commit:** d6f5585
> **סביבה:** BE single-origin PORT 4002, build טרי, tunnel חיצוני פעיל

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 12/14 |
| Happy path עובד | חלקי (ראה מטה) |
| Bugs חדשים | 1 blocker (snap-back confirmed) |

---

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | markdown tests pass — GFM tables + XSS | ✅ | `vitest run -- markdown`: 251 tests passed |
| 2 | `align="left"/"right"` עוברים ל-th/td | ✅ | test "renders GFM table" בודק זאת במפורש וירוק |
| 3 | `ToolContentImage` ב-union | ✅ | `bubble.ts:58` — type + union מלא כנדרש |
| 4 | `#mapToolContent`: ענף image + resource | ✅ | `agent-session.svelte.ts:1038-1054` — בדיוק לפי ה-brief |
| 5 | `ToolBubble` מרנדר `<img>` עם data-URI | ✅ | `ToolBubble.svelte:104-115` — branch `c.type==="image"` עם invariant תיעודי |
| 6 | settings: שדות `collapseThoughts` + `expandTools` | ✅ | `settings.svelte.ts:43-44, 67-68, 129-130, 152-153` |
| 7 | settings: `#persist()` כולל שני השדות | ✅ | שורות 340-341 — שני השדות ב-save() |
| 8 | setters `setCollapseThoughts` + `setExpandTools` | ✅ | שורות 315-322 — כל setter קורא `#persist()` |
| 9 | `SettingsScreen`: כרטיס חדש + 2 toggles + reset | ✅ | שורות 125-135, 178-179 — כרטיס + reset |
| 10 | `ThoughtBubble`: `<details open={!settings.collapseThoughts}>` | ✅ | `ThoughtBubble.svelte:39` |
| 11 | `ToolBubble`: `<details open={settings.expandTools}>` | ⚠️ | `ToolBubble.svelte:37` — קיים, אבל snap-back מאושר בקוד המקומפל |
| 12 | i18n: 3 keys ב-he + en | ✅ | `he.ts:192-194`, `en.ts:197-199` — כל 3 keys קיימים |
| 13 | אין Hebrew קשיח בקוד | ✅ | `pnpm lint:i18n` — "No hardcoded Hebrew in code" |
| 14 | typecheck + build נקיים | ✅ | typecheck: 0 errors 0 warnings; build כבר הוגש ל-PORT 4002 |

---

## Happy path

**commit 0 — טבלאות**: הטסטים ירוקים ומאמתים rendering + XSS. CSS בקוד נכון (`text-align: start`). אין browser לצלם, אבל הלוגיקה אומתה.

**commit 1 — תמונות**: הקוד מלא ונכון (mapping + render + CSS). אין יכולת להריץ agent חי ולבדוק visually.

**commit 2 — display-prefs**: settings VM, setters, SettingsScreen, ThoughtBubble — הכל מחווט. אבל ToolBubble.svelte open= יש snap-back (ראה מטה).

---

## Bugs חדשים שלא ברשימה

### ❌ Bug 1 — snap-back confirmed (blocker)

**תיאור:** ב-`ToolBubble.svelte` שורה 37, `open={settings.expandTools}` מוגדר ללא `bind:`. ה-brief ציין את הסיכון. הקוד המקומפל (`node 3.Cx_ufE9v.js`) מאשר את הבעיה:

```js
O(b=>{
  f.open=a.expandTools,
  ut(y,1,`size-2 rounded-full shrink-0 status-${c(i).status??""}`,...),
  re(y,"aria-label",b),
  W.dir=W.dir,
  R(ee,`${c(i).narration??""??""}${c(i).status??""}`)
}, [()=>r(`chat.tool.status.${c(i).status}`)])
```

`O` = `template_effect` של Svelte 5. הביטוי `f.open=a.expandTools` נמצא **באותו effect** שמתעדכן כשמשתנים `tc.status` ו-`tc.narration`. כלומר: כל פעם שה-agent מחזיר status update (pending→in_progress→completed), ה-effect רץ מחדש וכותב `f.open=a.expandTools` ישירות ל-DOM, מה שמבטל כל קיפול ידני שהמשתמש עשה באמצע ה-turn.

**המיטיגציה שה-brief הציע** (אך לא בוצעה):
```ts
// local $state מאותחל פעם אחת
let open = $state(settings.expandTools)
// <details bind:open>
```
כלים *חדשים* ייפתחו/ייסגרו לפי ה-default; כלים קיימים ישמרו מצב ידני.

**חומרה:** blocker — ההתנהגות הנוכחית לא עומדת ב-DoD "הגדרת 'כלים מורחבים' פותחת tools" מהיבט ה-UX (override ידני לא שורד turn).

---

## דורש עין אנושית (רשימה ממוקדת)

1. **תמונות (commit 1)**: האם agent חי מחזיר `image` content block? האם מוצג `<img>` ולא base64 גולמי? — דורש בדיקה ויזואלית מול agent + PNG/SVG בפועל. הקוד נכון; הניתוב מ-ACP לא נבדק חי.

2. **CSS טבלאות**: האם טבלת GFM מרונדרת נכון ב-DOM בפועל (border, RTL, overflow-x)? — דורש browser. הטסטים מאמתים רק את ה-HTML; ה-CSS rendering לא נבדק.

3. **snap-back בפועל**: לאחר תיקון ה-snap-back — לאמת ידנית שפתיחה/סגירה ידנית שורדת status update.

4. **SettingsScreen ויזואלי**: האם הכרטיס "תצוגת צ'אט" מופיע, toggles עובדים, reset מחזיר לברירת-מחדל — דורש browser.

---

## סיכום לאליעזר

עדיפות לתיקון:
1. **snap-back ב-ToolBubble** (blocker) — החלף `open={settings.expandTools}` ב-local state per-bubble:
   ```svelte
   <script>
   let open = $state(settings.expandTools)
   </script>
   <details class="group" bind:open>
   ```
   כלים חדשים ייפתחו/ייסגרו לפי setting; כלים קיימים ישמרו מצב ידני בין status updates.
