# Slice chat-render-polish — תוכנית

> **תאריך**: 2026-06-24
> **סטטוס**: הושלם (אליעזר: DONE · 2026-06-24)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: אין (base: dev @ `227330a`)
> **מבנה**: brief אחד, 3 commits עצמאיים (כל commit עומד בפני עצמו → אפשר merge חלקי אם אחד מסתבך)

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slice-chat-render-polish -b slice-chat-render-polish dev
cd .worktrees/slice-chat-render-polish
pnpm install && pnpm hooks:install
```

### Run
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned — Vite מדפיס)
- Tests: `pnpm --filter @drive-coding/frontend-v2 test`
- BE (לבדיקה ידנית בצ'אט בלבד — commit 1/2): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)

### Browser
- Chrome רגיל (localhost). תצוגה בלבד — אין secure-context APIs כאן.

### OneCLI agent
- `voice-acp` — נדרש רק לבדיקה ידנית מול agent חי (מזריק ElevenLabs+Google keys). לא נדרש ל-typecheck/tests.

### Reading list
**must-read**:
- `packages/frontend/AGENTS.md` — חמשת כללי הזהב של ה-FE (במיוחד #5: אין "תאימות לאחור במקום").
- `packages/frontend/src/lib/util/markdown.ts` (69 שורות) — pipeline marked→DOMPurify + allowlist.
- `packages/frontend/src/lib/view-models/settings.svelte.ts` §הערת-ראש (שורות 1-14) — הדפוס התוספתי להוספת שדה שמור.

**reference**:
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` — נוגעים בו ב-commit 1 ו-2.
- `docs/conventions/parallel-safe-code.md` — לפני נגיעה ב-`context.ts` (לא נוגעים — getSettings כבר קיים).

---

## §1 — מטרה

שלושה שיפורי-רינדור בצ'אט, ביחידה אחת: (1) טבלאות Markdown מוצגות מעוצבות במקום להיעלם; (2) תמונה שהמודל קורא מוצגת כתמונה אמיתית במקום Base64 גולמי; (3) המשתמש יכול להגדיר ב-Settings שמחשבות יוצגו מצומצמות (מקופלות) וכלים יוצגו מורחבים (פתוחים).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| תגי טבלה ב-allowlist + `align` + CSS | ✅ | commit 0 |
| `image` content (raster + SVG) → `<img>` | ✅ | commit 1 |
| `resource` embedded blob עם `image/*` → `<img>` | ✅ | commit 1 (אותו רינדור) |
| הגדרת collapse-thoughts / expand-tools | ✅ | commit 2 |
| `audio` content → `<audio>` | ❌ | future (סוג מדיה אחר) |
| `resource_link` (`file://`) → תמונה | ❌ | future — **slice local-file-proxy** (BE proxy, כבד-אבטחה; ב-roadmap Track C) |
| `resource` text | ❌ | future (placeholder/JSON נשאר) |
| task-list checkboxes (`- [ ]`) | ❌ | future (דורש `input` tag) |
| persist של מצב פתוח/סגור per-bubble | ❌ | בכוונה — רק ה-**default** נשמר; override ידני הוא per-render |
| טבלאות/markdown ב-ThoughtBubble | ❌ | ThoughtBubble הוא טקסט-רץ בכוונה (C1) |

---

## §3 — Architecture diagram

```
util/markdown.ts         allowlist += טבלה, align            (commit 0)
types/bubble.ts          + ToolContentImage                  (commit 1)
view-models/
  settings.svelte.ts     + collapseThoughts, expandTools     (commit 2)
  agent-session.svelte.ts  #mapToolContent: image+resource   (commit 1)
i18n (core) keys+he+en   + 3 keys                            (commit 2)
components/chat/bubbles/
  MessageBubble.svelte   :global(table) CSS                  (commit 0)
  UserBubble.svelte      :global(table) CSS                  (commit 0)
  ThoughtBubble.svelte   <details open={!collapseThoughts}>  (commit 2)
  ToolBubble.svelte      table CSS (c0) · <img> (c1) · open={expandTools} (c2)
components/settings/
  SettingsScreen.svelte  כרטיס "תצוגת צ'אט" + 2 toggles      (commit 2)
```
לא נוגע ב-`context.ts` (getSettings קיים), adapters, engines, routes, backend.

---

## §4 — Commits

### Commit 0 — md-tables (approach: mixed — TDD על markdown.ts, manual על CSS)

**משתנה `packages/frontend/src/lib/util/markdown.ts`**
- ל-`ALLOWED_TAGS` (21-40) הוסף: `"table","thead","tbody","tfoot","tr","th","td","caption","colgroup","col"`
- ל-`ALLOWED_ATTR` (41) הוסף: `"align"`
- ⚠️ **אל תוסיף `style`** — marked v18 מייצר `<th align="left">` (אומת בפועל), לא `style`. הוספת `style` היא vector ל-CSS injection.

**משתנה `packages/frontend/src/lib/util/markdown.test.ts`** — הוסף:
```ts
it("renders GFM table", () => {
  const out = renderMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |")
  expect(out).toContain("<table>")
  expect(out).toContain("<th")
  expect(out).toContain("<td")
  expect(out).toContain('align="left"')
  expect(out).toContain('align="right"')
})
it("preserves Hebrew inside table cells", () => {
  const out = renderMarkdown("| שם | גיל |\n|---|---|\n| דני | 30 |")
  expect(out).toContain("שם"); expect(out).toContain("דני")
})
```

**משתנה `MessageBubble.svelte` + `UserBubble.svelte`** — בתוך `<style>` הקיים, ליד שאר ה-`:global()`:
```css
div :global(table) {
  border-collapse: collapse; margin: 0.4em 0; font-size: 0.92em;
  display: block; overflow-x: auto; max-width: 100%;
}
div :global(th), div :global(td) {
  border: 1px solid var(--border); padding: 0.3em 0.55em; text-align: start;
}
div :global(th) { background: rgba(0,0,0,0.18); font-weight: 700; }
```
> RTL: `text-align: start` (לוגי), לא `left`. ה-`align` מ-marked דורס לפי הגדרת הטבלה.

**משתנה `ToolBubble.svelte`** — אותם 3 selectors בקידומת `.tool-text-output :global(...)`, עם `font-size: 0.78rem` (עקבי עם שאר ה-tool output).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 test -- markdown   # טסטים חדשים + XSS קיימים ירוקים
pnpm --filter @drive-coding/frontend-v2 run build          # CSS לא שובר build
pnpm lint:rtl                                              # אין physical classes
```

---

### Commit 1 — tool-image render (approach: manual)

**משתנה `packages/frontend/src/lib/types/bubble.ts`** (שורות 53-57) — הוסף type ועדכן union:
```ts
export type ToolContentImage = { type: "image"; data: string; mimeType: string }
export type ToolContent =
  | ToolContentText | ToolContentDiff | ToolContentTerminal | ToolContentImage | ToolContentOther
```
> `data` = base64 **גולמי** (בלי `data:` prefix — אומת מול ACP `ImageContent`). הרינדור יבנה את ה-data-URI.
> ה-exhaustiveness של `bubble.exhaustive.ts` הוא על `Bubble["kind"]` — **לא** מושפע (kind נשאר "tool").

**משתנה `agent-session.svelte.ts` → `#mapToolContent`** (שורות 1027-1065) — בענף `t === "content"`, החלף את ה-if/else של ה-text כך שיכלול image+resource:
```ts
if (cb?.type === "text" && typeof cb.text === "string") {
  out.push({ type: "text", text: cb.text })
} else if (
  cb?.type === "image" &&
  typeof (cb as { data?: unknown }).data === "string" &&
  typeof (cb as { mimeType?: unknown }).mimeType === "string" &&
  (cb as { mimeType: string }).mimeType.startsWith("image/")
) {
  const img = cb as { data: string; mimeType: string }
  out.push({ type: "image", data: img.data, mimeType: img.mimeType })
} else if (cb?.type === "resource") {
  // EmbeddedResource: { resource: { blob, mimeType, uri } } — רק blob עם image/*
  const r = (cb as { resource?: { blob?: unknown; mimeType?: unknown } }).resource
  if (typeof r?.blob === "string" && typeof r.mimeType === "string" && r.mimeType.startsWith("image/")) {
    out.push({ type: "image", data: r.blob, mimeType: r.mimeType })
  } else {
    out.push({ type: "other", raw: item })
  }
} else {
  out.push({ type: "other", raw: item })
}
```
> כל מה שאינו תמונה תקפה → נופל ל-`other` (fallback ל-JSON נשאר — לא מאבדים מידע).

**משתנה `ToolBubble.svelte`** — ב-`{#each tc.content as c}` (שורות 89-105), הוסף ענף לפני ה-`{:else}`:
```svelte
{:else if c.type === "image"}
  <img
    class="tool-image"
    src={`data:${c.mimeType};base64,${c.data}`}
    alt={t("chat.tool.content")}
    loading="lazy"
  />
```
CSS חדש ב-`<style>`:
```css
.tool-image {
  max-width: 100%; max-height: 320px; height: auto;
  object-fit: contain; border-radius: 6px;
  border: 1px solid var(--border); display: block; margin: 0.2em 0;
}
```
> **Invariant אבטחה (תעד בהערת-קוד מעל ה-`<img>`):** תמונות מוצגות **רק** דרך `<img>`. SVG מותר כי ב-`<img>` הדפדפן מריץ scripting/external-fetch ב-secure-static-mode (מנוטרל). **אם אי-פעם עוברים לרינדור inline (`{@html}` / `<object>`) — חובה לחסום `image/svg+xml`.**

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # union ToolContent exhaustive
pnpm --filter @drive-coding/frontend-v2 test
```
ידני (BE+agent): בקש מהמודל לקרוא קובץ PNG → התמונה מוצגת, לא base64. בדוק גם SVG.

---

### Commit 2 — display-prefs (approach: manual)

**משתנה `settings.svelte.ts`** (דפוס תוספתי לפי הערת-הראש):
- `Persisted` (אחרי שורה 41): `collapseThoughts: boolean` + `expandTools: boolean`
- `DEFAULTS` (אחרי 62): `collapseThoughts: false` + `expandTools: false` — **שומר התנהגות נוכחית** (מחשבות פתוחות, כלים סגורים)
- `$state` (אחרי 120) + constructor (אחרי 140) + setters + `#persist()` (303-315) — לפי הדפוס המדויק של `screenWakeLock`:
```ts
collapseThoughts = $state<boolean>(DEFAULTS.collapseThoughts)
expandTools = $state<boolean>(DEFAULTS.expandTools)
// constructor: this.collapseThoughts = loaded.collapseThoughts; this.expandTools = loaded.expandTools
setCollapseThoughts = (v: boolean): void => { this.collapseThoughts = v; this.#persist() }
setExpandTools = (v: boolean): void => { this.expandTools = v; this.#persist() }
// #persist(): הוסף את שני השדות לאובייקט save()
```

**משתנה i18n (core)** — 3 keys חדשים:
- `keys.ts` (ליד שורות 199-200, domain מסך/settings): `"settings.chatDisplay"`, `"settings.toggle.collapseThoughts"`, `"settings.toggle.expandTools"`
- `catalogs/he.ts`: `"settings.chatDisplay": "תצוגת צ'אט"`, `"settings.toggle.collapseThoughts": "מחשבות מצומצמות כברירת מחדל"`, `"settings.toggle.expandTools": "כלים מורחבים כברירת מחדל"`
- `catalogs/en.ts`: `"Chat display"`, `"Collapse thoughts by default"`, `"Expand tools by default"`

**משתנה `SettingsScreen.svelte`** — כרטיס חדש (אחרי כרטיס "מסך", שורה 122):
```svelte
<SettingsCard title={t("settings.chatDisplay")}>
  <div class="flex flex-col">
    <SettingToggle label={t("settings.toggle.collapseThoughts")}
      checked={settings.collapseThoughts}
      onCheckedChange={(v) => settings.setCollapseThoughts(v)} />
    <SettingToggle label={t("settings.toggle.expandTools")}
      checked={settings.expandTools}
      onCheckedChange={(v) => settings.setExpandTools(v)} />
  </div>
</SettingsCard>
```
> כפתור reset (שורות 157-162): הוא **סלקטיבי** (מאפס רק toggles של דיבור, לא הכל). הוסף לו `settings.setCollapseThoughts(false)` + `settings.setExpandTools(false)` כך שאיפוס יחזיר גם את העדפות-התצוגה לברירת-המחדל.

**משתנה `ThoughtBubble.svelte`** — הוסף `import { getI18n, getSettings } from "$lib/context"` + `const settings = getSettings()`. עטוף את ה-label + content ב-`<details>`, כש-label הופך ל-`<summary>`:
```svelte
<details open={!settings.collapseThoughts}>
  <summary class="text-[11px] font-semibold not-italic opacity-70 mb-1 cursor-pointer thought-summary">
    {t("chat.bubble.thought")}
  </summary>
  <!-- ה-{#if runningText...} הקיים נשאר כפי שהוא -->
</details>
```
CSS: `.thought-summary { list-style: none; } .thought-summary::-webkit-details-marker { display: none; }`

**משתנה `ToolBubble.svelte`** — הוסף `getSettings` ל-import + `const settings = getSettings()`. שנה שורה 36:
`<details class="group">` → `<details class="group" open={settings.expandTools}>`

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm lint:i18n   # אין מחרוזות עברית בקוד — הכל t(key)
pnpm --filter @drive-coding/frontend-v2 test
```
ידני: Settings → הדלק "מחשבות מצומצמות" → חזור לצ'אט → מחשבות מקופלות. הדלק "כלים מורחבים" → כלים פתוחים. כבה → חוזר להתנהגות מקורית.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| טבלת GFM מרונדרת + XSS עדיין נחסם | `pnpm test -- markdown` ירוק (חדשים + 3 XSS קיימים) |
| `align` עובר ל-th/td | הטסט בודק `align="left"`/`align="right"` |
| תמונת PNG מהמודל מוצגת כ-`<img>` | ידני מול agent + ToolContent union typecheck נקי |
| SVG מהמודל מוצג (מתירני) | ידני |
| תוכן לא-תמונה נופל ל-JSON fallback | ביקורת קוד (`else → other`) |
| הגדרת "מחשבות מצומצמות" מקפלת thoughts | ידני Settings→Chat |
| הגדרת "כלים מורחבים" פותחת tools | ידני |
| ברירות מחדל = התנהגות נוכחית | ידני: localStorage נקי → thoughts פתוח, tools סגור |
| אין מחרוזות עברית בקוד | `pnpm lint:i18n` ירוק |
| typecheck + build נקיים | `pnpm typecheck && pnpm run build` |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| הוספת `style` ל-allowlist (CSS injection) | אבטחה | אל תוסיף `style` — רק `align`. marked מייצר align attr. |
| `text-align: left` שובר RTL | learnings RTL (`lint:rtl`) | `text-align: start`. הרץ `pnpm lint:rtl`. |
| SVG כ-XSS אם הרינדור ישתנה ל-inline | אבטחה | invariant מתועד בהערת-קוד: רק `<img>`, לעולם לא `{@html}`. |
| `mimeType` שאינו תמונה מוצג כ-`<img>` | טיפוס | תנאי `.startsWith("image/")` ב-mapping; אחרת → `other`. |
| Svelte 5: `<details open={expr}>` — אינטראקציה ידנית מול ה-default | Svelte reactivity | `open={}` (לא `bind:open`): המשתמש שולט; שינוי ה-setting מאפס ל-default החדש — זו ההתנהגות הרצויה. אל תשתמש ב-`bind:open`. |
| **snap-back ב-ToolBubble** — שורה 121 `<span class="hidden">{...}{tc.status}</span>` כופה reactivity. חשש: status update (pending→completed) באמצע turn יכפה מחדש את `open={settings.expandTools}` ויבטל קיפול ידני של המשתמש | אביגיל finding #2 (🟢) | בדוק **בפועל בדפדפן**: פתח/סגור כלי ידנית, ואז המתן ל-status update — ודא שה-open לא נכפה מחדש. אם כן נכפה: החלף ל-local `let open = $state(settings.expandTools)` per-bubble (מאותחל פעם אחת, לא binding ישיר ל-setting), ו-`<details bind:open>`. כלים *חדשים* עדיין ייפתחו/ייסגרו לפי ה-default; כלים קיימים ישמרו על מצב ידני. |
| מחרוזת עברית קשיחה בקוד | pre-commit hook | כל מחרוזת → `t(key)`. 3 ה-keys בקטלוגים. |
| שכחת עדכון `#persist()` → ההגדרה לא נשמרת | settings דפוס | ודא ששני השדות באובייקט `save()` ב-`#persist()`. |

---

## §7 — Escalation triggers — עצור ושאל את מרדכי ב-parent task אם:

- DOMPurify ממשיך למחוק טבלאות גם אחרי הוספת ה-tags (קונפיג sanitize שונה ממה שמתואר).
- ACP `image` content מגיע בצורה שונה מ-`{ data: base64, mimeType }` (למשל `data:` כבר ב-prefix, או mimeType חסר).
- `<details open={...}>` ב-Svelte 5 נלחם באינטראקציה הידנית (כופה סגירה אחרי שהמשתמש פתח, ללא שינוי setting).
- צריך לגעת ב-`context.ts` או בקובץ shared אחר מעבר למתואר.

---

## §8 — Complexity score

- commits: 3 (סביר) · שכבות חדשות: 0 (util/VM/components קיימים)
- API חיצוני: 0 · streaming/async: 0 · state-model refactor: 0 · protocol BE↔FE: 0
- נגיעה רב-קובצית קלה (8 קבצים, שינויים צנועים בכל אחד)
- **Score: 5/10 → calev mode: light**

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | כרטיס Settings נפרד ("תצוגת צ'אט") או הוספה לכרטיס קיים? | כרטיס נפרד | ❌ |
| 2 | להציג chevron/אינדיקטור פתיחה ב-summary של ThoughtBubble? | לא בהכרח (ToolBubble כבר יש ▾) — אפשר להוסיף אם זול | ❌ |
| 3 | `resource_link` עם `file://` | future — slice local-file-proxy (ב-roadmap) | ❌ |
