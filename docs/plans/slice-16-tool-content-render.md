# Slice 16 — Tool Call Content Rendering (ACP-faithful) — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר
> **‏Complexity**: 5/10 (verifier: light)
> **‏תלות**: slice 4 (ToolBubble, ToolCall type, tool handlers) — merged ל-dev ב-`aa0b73a`
> **‏מתבסס על**: `docs/plans/README.md`, `docs/plans/EXECUTOR_DISPATCH.md`, `packages/frontend/AGENTS.md`, ACP schema (`@agentclientprotocol/sdk` types.gen.d.ts)

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate ל-sub-agent מסוג executor. ‏רק verifier-slice-light בסוף. ‏ראה `EXECUTOR_DISPATCH.md §0`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-16-tool-content -b slice-16-tool-content dev
cd .worktrees/slice-16-tool-content
pnpm install
pnpm hooks:install
```

‏Base: dev tip `aa0b73a` (אחרי merge של slice 4 + 15).

‏**‏הערה קריטית על ה-base** (אומת ע"י plan-verifier): ‏ב-dev יש כרגע 2 תיקונים **uncommitted** ש-Tama עשתה ידנית — הם ב-working tree של dev אבל **‏לא ב-HEAD `aa0b73a`**:
‏1. `app.css` — select dark theming (לא רלוונטי ל-slice הזה).
‏2. `agent-session.svelte.ts` — `args: update.rawInput` merge ב-`#handleToolCallUpdate` + הוספת `rawInput?` לפרמטרים שלו.

‏מכיוון שה-worktree נגזר מ-`aa0b73a` (HEAD), **התיקונים האלה לא יהיו ב-base שלך**. לכן: ב-Commit 1 כאן **חובה** להוסיף בעצמך גם את ה-`rawInput?` לפרמטרים של `#handleToolCallUpdate` וגם את `...(update.rawInput !== undefined && { args: update.rawInput })` ל-merge. ‏אל תניח שהם קיימים — ‏בדוק עם `grep "rawInput" packages/frontend/src/lib/view-models/agent-session.svelte.ts` ‏אחרי יצירת ה-worktree; ‏אם חסר — ‏הוסף.

### Ports

| מה | פקודה |
|---|---|
‏| BE | `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts` (4000 אם פנוי, אחרת 4001/4002 — §EXECUTOR_DISPATCH 2) |
‏| FE | `BE_PORT=<port> pnpm --filter @drive-coding/frontend-v2 dev` |

‏**חובה**: BE דרך OneCLI (agent `voice-acp`) — אחרת tool calls שמריצים פקודות עדיין יעבדו (זה ACP דרך WS), אבל narrate/TTS ייכשל 401. ‏לבדיקת ה-slice הזה: ‏צריך agent חי ששולח tool calls אמיתיים.

### Browser

‏Chrome מקומי דרך ה-tunnel הקיים (`https://your-app.nue.tuns.sh`) **‏או** Vite local. ‏הבדיקה הקריטית: ‏לחבר ל-opencode, ‏לבקש "‏הרץ פקודה X" + "‏ערוך קובץ Y", ‏לראות שה-content מוצג נכון (לא JSON גולמי).

### OneCLI agent

‏שם: `voice-acp` (ID `3f08d584-4da0-4cb4-87b4-9611ae0fa9c0`). ‏מזריק ElevenLabs + Google. ‏שימוש: `onecli run --agent voice-acp -- <cmd>`.

### Reading list

‏**must-read (~‎15 ‏דק'):**

‏1. `packages/frontend/AGENTS.md` — ‏5 חוקי הזהב (component=leaf, util layer).
‏2. `packages/frontend/src/lib/types/bubble.ts` — **‏כל הקובץ (76 שורות)**. ה-`ToolCall` type (שורות 53-66) הוא מה שמרחיבים.
‏3. `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` — **‏כל הקובץ (207 שורות)**. ה-rendering הנוכחי: שורות 65-78 (details panel), `formatResult` (26-33).
‏4. `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#handleToolCall` (310-342), `#handleToolCallUpdate` (344-368). **‏שים לב**: ה-update type cast ב-`#onSessionUpdate` (266-280) צריך גם הוא להכיל את השדות החדשים.
‏5. ACP schema — `node_modules/.pnpm/@agentclientprotocol+sdk@0.21.1_zod@4.4.3/node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts`:
   ‏- `ToolCall` (4885-4930), `ToolCallUpdate` (4994-5045)
   ‏- `ToolCallContent` (4939-4945): union של `{type:"content", content: ContentBlock}` | `{type:"diff", ...Diff}` | `{type:"terminal", ...Terminal}`
   ‏- `ContentBlock` (838-848): `text`/`image`/`audio`/`resource_link`/`resource`
   ‏- `Diff` (1201-1224): `{path, oldText?, newText}`
   ‏- `Terminal` (4727-4739): `{terminalId}`
   ‏- `ToolCallLocation` (4958-4977): `{path, line?}`
   ‏- `TextContent` (4816+): `{type:"text", text, annotations?}`

‏**reference:**

‏- `packages/frontend/src/lib/util/markdown.ts` — ‏דוגמה ל-util pure עם טסטים (slice 4)
‏- `packages/core/src/i18n/keys.ts:57-64` — ‏ה-keys הקיימים `chat.tool.*` (status/args/result/loading_narration)
‏- `packages/frontend/src/lib/view-models/speaker.svelte.ts:343-347` — `ToolCallForNarrate` ‏משתמש ב-`tc.kind`/`tc.title`/`tc.name`. **‏אסור לשבור** את השדות האלה.

---

## §1 — מטרה

‏אחרי slice 16: ‏כשסוכן ACP (opencode) ‏שולח tool call, ‏ה-ToolBubble ‏מציג את ה-input וה-output **‏בצורה קריאה לפי סכימת ACP**, ‏לא JSON גולמי עם `\n` literals.

‏החוויה:
‏- ‏פקודת shell (`{command, description}`) → ‏input מוצג כ-`$ date && df -h /`.
‏- ‏פלט terminal → ‏טקסט עם שורות אמיתיות.
‏- ‏עריכת קובץ → ‏diff (path + old/new).
‏- ‏ACP `content[]` (text/diff) ‏מוצג מפורמט; `locations` ‏מוצג כרשימת קבצים.
‏- ‏כל מבנה לא-מזוהה → JSON יפה (fallback — "‏להציג הכל", ‏אבל קריא).

‏ה-rawInput/rawOutput הגולמי **‏עדיין נגיש** ב-section "raw" מתקפל, ‏כדי לא לאבד מידע.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| `ToolCall` type: ‏הוספת `content?`, `locations?` | ✅ | Commit 1 |
‏| ‏לכידת `content`/`locations` ב-`#handleToolCall` + `#handleToolCallUpdate` (merge) | ✅ | Commit 1 |
‏| ‏וידוא `rawInput` merge ב-update handler (אם לא כבר ב-base) | ✅ | Commit 1 |
‏| `util/tool-format.ts` — ‏פונקציות pure לפרמוט input/content/locations + טסטים | ✅ | Commit 2 |
‏| ‏ToolBubble: ‏שימוש ב-tool-format לרינדור input/content/locations/raw | ✅ | Commit 3 |
‏| ‏diff rendering (path + old/new, ‏צבע +/-) | ✅ | Commit 3 |
‏| ‏i18n keys חדשים (raw toggle, locations, diff, terminal) | ✅ | ‏פר commit |
‏| ‏image/audio/resource content blocks — ‏rendering מלא | ❌ | ‏future (הצג placeholder "[image]" + raw) |
‏| ‏terminal live-streaming (TerminalOutputRequest) | ❌ | ‏future — ‏רק נציין terminalId |
‏| ‏follow-along (locations → ‏פתיחת קובץ) | ❌ | ‏future — ‏רק תצוגה |
‏| ‏שינוי narrate / Speaker | ❌ | ‏לא נוגעים — ‏`name`/`kind`/`title` נשמרים |

---

## §3 — Architecture

```
‏ACP notification (tool_call / tool_call_update)
  ↓ agent-session.svelte.ts (#handleToolCall / #handleToolCallUpdate)
  ↓   ‏ממפה ל-ToolCall { ...שדות קיימים, content?, locations? }
  ↓
ToolBubble.svelte (component, leaf)
  ↓   ‏קורא ל-util/tool-format.ts (pure)
  ↓
util/tool-format.ts:
  - formatToolInput(rawInput): { kind: "command", command } | { kind: "json", json }
  - formatToolContent(content[]): Array<{type:"text"|"diff"|"terminal"|"other", ...}>
  - formatLocations(locations[]): string[]   // "path:line"
  - prettyJson(value): string   // JSON.stringify(…, 2) עם guard
```

‏**שכבות (golden rules)**: ‏ה-formatting הוא pure logic → `util/`. ‏ToolBubble נשאר leaf component שקורא ל-util ומרנדר. ‏אין fetch/state חדש.

‏**ToolCall type אחרי (bubble.ts)**:

```ts
// ACP ToolCallContent (subset we render) — see types.gen.d.ts 4939
export type ToolContentText = { type: "text"; text: string }
export type ToolContentDiff = { type: "diff"; path: string; oldText?: string; newText: string }
export type ToolContentTerminal = { type: "terminal"; terminalId: string }
export type ToolContentOther = { type: "other"; raw: unknown }  // image/audio/resource/unknown
export type ToolContent = ToolContentText | ToolContentDiff | ToolContentTerminal | ToolContentOther

export type ToolLocation = { path: string; line?: number }

export type ToolCall = {
  toolCallId: string
  name: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  title?: string
  narration?: string
  kind?: string
  result?: unknown
  // ─── slice 16 (ACP content) ───
  content?: ToolContent[]
  locations?: ToolLocation[]
}
```

---

## §4 — Commits

### Commit 1 — Capture ACP content + locations (approach: integration)

‏**מטרה**: ‏הרחבת `ToolCall` type ולכידת `content`/`locations` ‏מה-notification. ‏אין rendering עדיין.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/types/bubble.ts` | ‏הוסף `ToolContent*` types + `ToolLocation` + שדות `content?`/`locations?` ל-`ToolCall` (לפי §3) |
‏| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏(a) **‏הרחב את ה-update type cast ב-`#onSessionUpdate` (שורות 266-277)** — ‏הוסף `content?: unknown[] \| null` ו-`locations?: unknown[] \| null` ל-shape (אחרת `update.content`/`update.locations` ב-handlers יזרקו `Property does not exist`). (b) הוסף helper `#mapToolContent(raw: unknown): ToolContent[]` + `#mapLocations(raw: unknown): ToolLocation[]`. (c) ב-`#handleToolCall` + `#handleToolCallUpdate` — מפה ומזג `content`/`locations`. (d) **‏חובה**: הוסף `rawInput?: unknown` לפרמטרים של `#handleToolCallUpdate` + `args: update.rawInput` ל-merge (ראה §0 — לא ב-base) |

‏**`#mapToolContent` skeleton** (מתרגם ACP `ToolCallContent[]` → ‏ה-`ToolContent[]` ‏הפנימי):

```ts
#mapToolContent(raw: unknown): ToolContent[] {
  if (!Array.isArray(raw)) return []
  const out: ToolContent[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const t = (item as { type?: string }).type
    if (t === "content") {
      // { type:"content", content: ContentBlock }
      const cb = (item as { content?: { type?: string; text?: string } }).content
      if (cb?.type === "text" && typeof cb.text === "string") {
        out.push({ type: "text", text: cb.text })
      } else {
        out.push({ type: "other", raw: item })  // image/audio/resource — future
      }
    } else if (t === "diff") {
      const d = item as { path?: string; oldText?: string | null; newText?: string }
      if (typeof d.path === "string" && typeof d.newText === "string") {
        out.push({ type: "diff", path: d.path, oldText: d.oldText ?? undefined, newText: d.newText })
      } else {
        out.push({ type: "other", raw: item })
      }
    } else if (t === "terminal") {
      const term = item as { terminalId?: string }
      if (typeof term.terminalId === "string") {
        out.push({ type: "terminal", terminalId: term.terminalId })
      } else {
        out.push({ type: "other", raw: item })
      }
    } else {
      out.push({ type: "other", raw: item })
    }
  }
  return out
}
```

‏**מיזוג ב-handlers**: ב-`#handleToolCall` הוסף `content: update.content != null ? this.#mapToolContent(update.content) : undefined` ו-`locations` בדומה (‏שים לב `!= null` — ‏לוכד גם `undefined` וגם `null`).

‏ב-`#handleToolCallUpdate` (object-spread merge הקיים) הוסף — **‏שים לב לטיפול ב-null**: ACP מגדיר `content`/`locations` ב-`ToolCallUpdate` כ-`Array | null`, ‏כאשר `null` ‏משמעו "‏אפס/מחק". ‏לכן השתמש ב-`!== undefined` ‏כתנאי הספרד (‏כדי שגם `null` ייכנס למיזוג), ‏אבל ‏מפה `null → undefined`:
```ts
...(update.content !== undefined && {
  content: update.content === null ? undefined : this.#mapToolContent(update.content),
}),
...(update.locations !== undefined && {
  locations: update.locations === null ? undefined : this.#mapLocations(update.locations),
}),
...(update.rawInput !== undefined && { args: update.rawInput }),   // ‏חובה — לא ב-base (§0)
```
‏(`#mapToolContent` ‏עצמו כבר עמיד ל-non-array דרך `if (!Array.isArray(raw)) return []`, ‏אבל ‏אנחנו רוצים `undefined` ‏ולא `[]` ‏כשמוחקים — ‏לכן ה-guard המפורש ל-`null` כאן.)

‏**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
# ‏אין rendering — רק type + capture. אין UI לבדוק עדיין.
```

‏**DoD**:
‏- [ ] `bubble.ts` עם ה-types החדשים, typecheck נקי
‏- [ ] handlers ממזגים content/locations/rawInput
‏- [ ] אין שבירה של narrate (tc.name/kind/title עדיין קיימים)

---

### Commit 2 — `util/tool-format.ts` + tests (approach: TDD)

‏**מטרה**: ‏פונקציות pure שממירות ToolCall fields ל-renderable structures. **‏TDD — ‏input/output ידועים**.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/frontend/src/lib/util/tool-format.ts` | ‏פונקציות pure (skeleton למטה) |
‏| `packages/frontend/src/lib/util/tool-format.test.ts` | ‏~‎12-15 tests |

‏**API skeleton**:

```ts
import type { ToolContent, ToolLocation } from "$lib/types/bubble"

export type FormattedInput =
  | { kind: "command"; command: string }
  | { kind: "json"; json: string }
  | { kind: "empty" }

/**
 * opencode/bash tools send rawInput = { command, description? }.
 * Returns "command" variant when a string `command` field exists,
 * "empty" for {}/null/undefined, else pretty JSON.
 */
export function formatToolInput(rawInput: unknown): FormattedInput

/** JSON.stringify(value, null, 2) with a fallback to String(value) on cycles. */
export function prettyJson(value: unknown): string

/** "path:line" or just "path" when no line. */
export function formatLocation(loc: ToolLocation): string
```

‏**Tests (TDD — ‏red first)**:

```ts
describe("formatToolInput", () => {
  it("{ command, description } → command variant with command string", ...)
  it("{ command } only → command variant", ...)
  it("{} → empty", ...)
  it("undefined → empty", ...)
  it("null → empty", ...)
  it("{ foo: 1 } (no command) → json variant, pretty-printed", ...)
  it("command non-string (e.g. number) → json variant", ...)
  it("string rawInput → json variant (stringified)", ...)
})

describe("prettyJson", () => {
  it("object → 2-space indented", ...)
  it("string → quoted JSON string", ...)
  it("circular ref → falls back to String(), no throw", ...)
})

describe("formatLocation", () => {
  it("{ path, line } → 'path:line'", ...)
  it("{ path } → 'path'", ...)
})
```

‏**גוטשה — circular ref**: `prettyJson` ‏חייב try/catch סביב `JSON.stringify` (rawOutput ‏עלול להכיל circular). ‏ב-catch → `String(value)`.

‏**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 test tool-format
pnpm --filter @drive-coding/frontend-v2 typecheck
```

‏**DoD**:
‏- [ ] ~‎12-15 tests, ‏כולם ירוקים
‏- [ ] typecheck נקי

---

### Commit 3 — ToolBubble rendering + i18n (approach: manual)

‏**מטרה**: ‏ToolBubble ‏מרנדר input/content/locations/raw ‏לפי tool-format. **‏בדיקה ידנית ב-browser מול opencode חי**.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` | ‏החלף את ה-`details` panel (65-78) לרינדור מובנה (skeleton למטה). השתמש ב-`formatToolInput`/`prettyJson`/`formatLocation`. הסר את `formatResult` המקומי (26-33) — מוחלף ב-`prettyJson` או content rendering |
‏| `packages/core/src/i18n/keys.ts` | ‏הוסף keys: `chat.tool.raw`, `chat.tool.locations`, `chat.tool.diff.added`, `chat.tool.diff.removed`, `chat.tool.terminal`, `chat.tool.content` (תחת ה-section הקיים `// ─── tool-bubble ─── (slice 4)` ב-57) |
‏| `packages/core/src/i18n/catalogs/he.ts` | ‏ערכים בעברית |
‏| `packages/core/src/i18n/catalogs/en.ts` | ‏ערכים באנגלית |

‏**ToolBubble — ‏ב-`<script>`** (לא `{@const}` ‏ב-markup — ‏ראה Risk #1):

```ts
import { formatToolInput, prettyJson, formatLocation } from "$lib/util/tool-format"
// tc כבר $derived (שורה 23). input נגזר ממנו:
const input = $derived(formatToolInput(tc.args))
```

‏**ToolBubble details skeleton** (expanded section — ‏משתמש ב-`input` ה-`$derived`, ‏לא `{@const}`):

```svelte
{#if expanded}
  <div class="details" dir="ltr" role="presentation" onclick={(e) => e.stopPropagation()}>
    <!-- INPUT -->
    {#if input.kind === "command"}
      <div class="section">
        <div class="section-label">{t("chat.tool.args")}</div>
        <pre class="cmd">$ {input.command}</pre>
      </div>
    {:else if input.kind === "json"}
      <div class="section">
        <div class="section-label">{t("chat.tool.args")}</div>
        <pre>{input.json}</pre>
      </div>
    {/if}

    <!-- LOCATIONS -->
    {#if tc.locations && tc.locations.length > 0}
      <div class="section">
        <div class="section-label">{t("chat.tool.locations")}</div>
        <ul class="locations">
          {#each tc.locations as loc}<li>{formatLocation(loc)}</li>{/each}
        </ul>
      </div>
    {/if}

    <!-- CONTENT (ACP canonical) -->
    {#if tc.content && tc.content.length > 0}
      <div class="section">
        <div class="section-label">{t("chat.tool.content")}</div>
        {#each tc.content as c}
          {#if c.type === "text"}
            <pre>{c.text}</pre>
          {:else if c.type === "diff"}
            <div class="diff">
              <div class="diff-path">{c.path}</div>
              {#if c.oldText}<pre class="removed">{c.oldText}</pre>{/if}
              <pre class="added">{c.newText}</pre>
            </div>
          {:else if c.type === "terminal"}
            <div class="terminal-ref">{t("chat.tool.terminal")}: {c.terminalId}</div>
          {:else}
            <pre>{prettyJson(c.raw)}</pre>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- RAW OUTPUT (collapsible fallback — always available) -->
    {#if tc.result !== undefined}
      <details class="raw-output">
        <summary>{t("chat.tool.raw")}</summary>
        <pre>{prettyJson(tc.result)}</pre>
      </details>
    {/if}
  </div>
{/if}
```

‏**גוטשה — `{@const}` ב-Svelte 5 (תוקן בהתאם — ‏אל תשתמש ב-`{@const}` כאן)**: `{@const}` ‏חוקי ‏רק ‏כ-ילד **ישיר** של block (`{#if}`/`{#each}`/`{#snippet}`/`<Component>`) — **‏לא** ‏ילד ישיר של `<div>` רגיל. ‏לכן ה-skeleton ‏מגדיר את `input` כ-`$derived` ב-`<script>` (‏מעל), ‏ולא ב-markup. ‏עבור `formatLocation`/`prettyJson` ‏בתוך `{#each}` — ‏קריאה ‏ישירה ‏ב-expression (`{formatLocation(loc)}`) ‏מותרת ‏ותקינה.

‏**הערה על raw**: ‏גם אם יש `content`, ‏ה-`tc.result` (rawOutput) ‏מוצג ב-`<details>` מתקפל. ‏אם **‏אין** content (כמו opencode bash שמחזיר רק rawOutput) — ‏ה-raw הוא המקור היחיד ‏ועדיין נגיש. **‏שקול**: ‏אם אין content אבל יש rawOutput.output (string) — ‏הצג אותו ישירות כ-text. ‏זו ‏החלטה לוקאלית — ‏אם בוחר בזה, ‏תעד ב-commit.

‏**i18n keys (he / en)**:
```
chat.tool.raw       → "פלט גולמי" / "Raw output"
chat.tool.locations → "קבצים" / "Files"
chat.tool.content   → "תוכן" / "Content"
chat.tool.terminal  → "טרמינל" / "Terminal"
chat.tool.diff.added   → "נוסף" / "Added"     (אם משתמשים ב-label; אחרת דלג)
chat.tool.diff.removed → "הוסר" / "Removed"
```

‏**CSS**: ‏הוסף `.cmd` (מונוספייס, ‏אולי ירקרק), `.diff .added` (רקע ירוק שקוף), `.diff .removed` (רקע אדום שקוף), `.locations`, `.raw-output summary` (cursor pointer). ‏השתמש ב-CSS vars הקיימים (`--speaking`, `--recording`, `--bg-base`).

‏**Verification (ידני — ‏browser מול opencode חי)**:
```bash
# BE + FE רצים. ‏בדפדפן:
# 1. ‏חבר ל-opencode, ‏בקש "‏הרץ: date && df -h /"
#    → input מוצג "$ date && df -h /", ‏פלט קריא (לא {"output":...})
# 2. ‏בקש "‏ערוך קובץ X הוסף שורה" → diff מוצג (path + added/removed)
# 3. ‏בקש "‏קרא קובץ Y" → content/locations מוצגים
# 4. ‏לחץ "‏פלט גולמי" → ‏rawOutput JSON נפתח
# 5. ‏tool call ‏לא מזוהה → JSON יפה, ‏לא קריסה
```

‏**DoD**:
‏- [ ] פקודת shell: input = `$ cmd`, ‏פלט קריא
‏- [ ] diff מוצג (אם הסוכן שולח diff content)
‏- [ ] locations מוצג (אם נשלח)
‏- [ ] raw output נגיש ב-details
‏- [ ] מבנה לא מזוהה → JSON יפה, ‏לא קריסה
‏- [ ] lint:i18n נקי (אין מחרוזת עברית בקוד)

---

### Commit 4 — walkthrough + status (approach: none)

‏- `docs/walkthrough.md` — ‏רשומה: slice 16 tool content rendering.
‏- ‏עדכן status ה-brief הזה ל-"‏הושלם".
‏- ‏(אם יש `packages/frontend/docs/slices.md` עם רשומת slice 16 — ‏עדכן; ‏אם לא — ‏דלג).

---

## §5 — DoD (כולל)

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | typecheck FE | ‏אוטומטי |
‏| 2 | tests (כולל ~‎12-15 חדשים ל-tool-format) | ‏אוטומטי |
‏| 3 | lint:i18n | ‏אוטומטי |
‏| 4 | build FE | ‏אוטומטי |
‏| 5 | פקודת shell — input `$ cmd` + פלט קריא | ‏ידני browser |
‏| 6 | diff content מוצג | ‏ידני (אם הסוכן שולח) |
‏| 7 | locations מוצג | ‏ידני |
‏| 8 | raw output ב-details מתקפל | ‏ידני |
‏| 9 | מבנה לא מזוהה → JSON, ‏לא קריסה | ‏ידני |
‏| 10 | narrate עדיין עובד (narration מופיע) | ‏ידני |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | `{@const}` ‏לא חוקי במיקום שבחרנו | Svelte 5 | ‏אם autofixer/compiler מתלונן — ‏הוצא ל-`$derived` ב-`<script>`. ‏ראה גוטשה ב-Commit 3 |
‏| 2 | Svelte 5 reactivity: ‏content מגיע ב-update אחרי שה-bubble כבר רונדר | learnings 2026-05-16 | ‏ה-handlers כבר מחליפים את ה-bubble object כולו (`this.bubbles[idx] = {...}`) — ‏reactivity מובטחת. ‏אל תמיר ל-in-place mutation |
‏| 3 | ‏מחרוזת עברית בקוד (pre-commit hook חוסם) | convention | ‏כל label דרך `t(key)`. ‏ה-`$ ` prefix ב-command הוא ASCII — OK |
‏| 4 | circular ref ב-rawOutput → `JSON.stringify` throws | general | `prettyJson` ‏עם try/catch (Commit 2) |
‏| 5 | ‏שבירת narrate: ‏אם משנים `name`/`kind`/`title` | slice 4 | ‏לא נוגעים בשדות האלה. ‏רק מוסיפים `content`/`locations` |
‏| 6 | ‏diff בלי oldText (קובץ חדש) | ACP Diff.oldText nullable | ‏skeleton כבר עוטף `{#if c.oldText}` |
‏| 7 | ‏content ריק `[]` נשלח → section ריק | edge | ‏`{#if tc.content && tc.content.length > 0}` |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:
‏1. ‏`{@const}` + `$derived` ‏שניהם לא עובדים למיקום ה-content rendering (בעיית Svelte 5 עמוקה)
‏2. ‏opencode שולח content במבנה ‏שלא תואם ל-ACP schema שקראנו (למשל nested אחרת) — ‏צרף דוגמת raw notification ל-Tama
‏3. ‏narrate נשבר אחרי השינוי (לא אמור — ‏אבל אם כן, ‏עצור)

‏אחרת: ‏החלט והמשך, ‏תעד ב-commit.

---

## §8 — Complexity score: 5/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏commits (4) | +1 |
‏| ‏שכבות (type + VM handler + util + component) | +1 |
‏| ‏ACP schema mapping (content union — 4 ‏סוגים) | +2 |
‏| ‏diff/terminal rendering | +1 |
‏| ‏סה"כ | **5** |

‏**Verifier**: `verifier-slice-light` בסוף (score < 8). ‏ה-brief לverifier:
```
‏בדוק slice 16 ב-branch slice-16-tool-content, worktree .worktrees/slice-16-tool-content.
‏Brief: docs/plans/slice-16-tool-content-render.md. Base: aa0b73a.
‏בדוק DoD §5. ‏הרץ tool-format tests + typecheck + build. ‏חבר ל-opencode (BE על port X),
‏בקש פקודת shell + עריכת קובץ, ‏ודא input "$ cmd" + פלט קריא + diff + raw מתקפל.
‏GO / NEEDS REVISION.
```

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | ‏אם אין `content` אבל יש `rawOutput.output` (string) — ‏להציג אותו כ-text ישירות? | ‏כן — ‏אם `rawOutput` הוא `{output: string}`, ‏הצג את `output` כ-text. ‏אחרת raw JSON. ‏(שקול ב-Commit 3, ‏תעד) | ❌ |
‏| 2 | `image`/`audio` content — ‏placeholder או raw? | ‏placeholder `[image]`/`[audio]` + raw ב-details. ‏rendering מלא = future | ❌ |
‏| 3 | ‏האם להציג `kind` ‏כאייקון? | ‏לא בסיבוב הזה — ‏רק טקסט title הקיים. ‏אייקונים = future | ❌ |
‏| 4 | ‏diff ‏עם syntax highlighting? | ‏לא — ‏רק רקע ירוק/אדום על השורות. highlighting = future | ❌ |

---

## §10 — מה הלאה

‏אחרי merge: future slices ‏יכולים להוסיף image/audio rendering, terminal live-streaming (TerminalOutputRequest), follow-along על locations, ‏ו-syntax highlighting ל-diff.
