---
id: render-contract
title: Render contract — what your output can display
summary: What the drive-coding UI renders from agent output, and what it will not render.
read_when:
  - You are about to emit a file link, an image or a diagram
  - Your output rendered as plain text and you expected something richer
  - You send or receive a drive-coding-msg envelope and need to know what the chat UI shows
tags: [render, output, ui]
surface: [http, mcp]
stability: stable
docs_version: 1.7.1
updated: 2026-10-13
---

# Render contract

The chat UI renders markdown-rich content with a **strict allowlist**. This page is
**expanded from `packages/backend/src/prompts/surface/display.ts`**; that file is the
Tier-2 summary (three rules an agent must not miss) and this is its Tier-3 reference.

## `drive-coding-msg` v1 — what the chat UI renders

The backend may wrap inbound user prompts in **`drive-coding-msg` v1** XML (agent sends,
system events, RPC/MCP/CLI paths). Wire shape and parsing rules for **receivers** (CLI
agents) are in `session-lifecycle`. This section is the **display contract**: what the
drive-coding chat surface shows from the **text it receives** for a user bubble.

### When the UI treats text as an envelope

- Only a **whole** envelope counts: the user-visible segment must be a single
  `<drive-coding-msg …>…</drive-coding-msg>` document (optional trailing whitespace).
  Prose before/after, or XML inside a markdown code fence, stays **plain** — no badge,
  no sender decode.
- **Manual paste** of a full envelope is rendered like any other user input. There is
  **no** “verified sender” badge and **no** guarantee the named agent actually sent it;
  display follows the XML text only.

### Agent envelope (`source="agent"`)

When the whole segment parses as a valid agent message:

- **Header** — localized “message from agent” label, then **sender display name**
  (from `<name>` when present, else session metadata). Name is a **link** only when the
  live agent registry has a matching id with an open session host; empty registry or
  closed agent ⇒ plain text name, **no** link invented from XML alone.
- **`<context>`** — when present, shown in a **collapsed** `<details>` block, **plain
  text** (not Markdown). It is separate from the body; `#`, `<`, `**` in context stay
  literal characters.
- **`<body>`** — rendered as **Markdown** (same allowlist as normal user bubbles),
  including images and file links per the sections below. Agent-origin links use
  **absolute-only** resolution where applicable.
- **Show source** — expands an XML code block with syntax highlighting and horizontal
  scrolling. Its `<code>` keeps the **exact input string** (`textContent`); copy uses that
  same string. Source content stays literal, including embedded HTML and Markdown.

The UI renders **the text stored on the bubble**, not a separate wire snapshot. If replay
or transport delivers a shorter string than what left the sender (for example missing
`<context>`), the bubble reflects **that** string — do not assume charter or context
blocks match between wire and on-screen history.

### System envelope (`source="system"`)

When the whole segment parses as a valid system event:

- **Event title** and **timestamp** when encoded.
- **Structured fields** (`stopReason`, `silentMs`, nested errors, …) as **plain text**,
  not Markdown.
- **`<last-assistant-text>`** — when present, rendered as **Markdown** in a quoted
  subsection attributed to the agent’s last message; `truncated="true"` adds a visible
  truncation label, `false` or absent does not.
- **`<context>`** — same collapsed plain-text block as agent messages when present.
- **Show source** — same raw preservation as agent envelopes.

Event kinds are shown by meaning (for example turn ended vs stall suspected vs turn
error), not as generic success/failure.

### Invalid or partial XML

If the segment looks like an envelope candidate but **does not parse** (unknown version,
wrong root, mixed agent/system fields, unclosed tags, …):

- The UI keeps the **full original text** visible (neutral hint such as incomplete or
  unsupported envelope when applicable).
- **No** body Markdown pass that would hide tags; user copy equals the raw segment.

Streaming may update the **same** bubble in place; partial prefixes use this neutral
fallback until a full envelope arrives or the turn ends.

### What envelope display does **not** prove

- Rendered sender name/id is **declarative XML**, not cryptographic proof of who sent
  unless your deployment adds separate auth (out of scope here).
- Plain user text, attachments, and non-envelope chunks behave as before this contract.

## Images — recipe

Want a screenshot the user can see?

```markdown
![screenshot](./out.png)
```

- **Only** standard markdown `![alt](path)` — rendered in an isolated sanitizer pass with
  **`img` + `src/alt/title` only**.
- **Relative** paths resolve against the session **cwd**, then map to
  **`GET /api/fs/file?uri=…`** (encode the full `file://` URI).
- **`data:image/*`** inline URIs work.
- **`http(s)://`** images are **click-to-load**, not auto-fetched — prefer local files via
  the proxy.
- **`//host`**, unknown schemes, non-image **`data:`**, empty href → **inert** (source text shown).

**Raw `<img>` in HTML is stripped** — `MARKDOWN_ALLOW` never includes `img`; only fragments
built by the markdown renderer become images.

## Local files and the file proxy

Clickable file link for the user (use **`PUBLIC_BASE_URL`** when the user opens it off-machine):

```markdown
[label]({origin}/api/fs/file?uri=<encodeURIComponent(file:///absolute/path)>)
```

**Allowed extensions** (closed allowlist on the proxy — unknown → **415**, HTML **never** served):

| Group | Extensions |
|---|---|
| Text | `.md`, `.markdown`, `.txt` |
| Images | `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`, `.gif` |
| Other | `.pdf`, audio (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.webm`) |

**Size caps** (three limits):

| Case | Limit |
|---|---|
| Non-audio files | **8 MB** (`MAX_FILE_BYTES`) |
| Audio, full GET without Range | **32 MB** (`MAX_AUDIO_FULL_BYTES`) |
| Audio with HTTP Range | file cap **512 MB** (`MAX_AUDIO_FILE_BYTES`) |

Audio opens in the content viewer with a native player when linked through the proxy.

**Paths in prose** — absolute local paths may become clickable previews; relative paths are
less reliable until confirmed — prefer an explicit `/api/fs/file` link or markdown image.

## Diagrams

Fenced **` ```mermaid `** blocks render inline after **`mermaid-sanitize`** (chat bubble
enhancement path). Use for architecture / flow instead of fragile ASCII when it helps.

## Code and math

- **Code** — fenced blocks with **`hljs`**; sanitizer allows **`pre` / `code` / `span` + `class`**
  only (no `style` on code path).
- **LaTeX** — KaTeX with a dedicated allowlist; **`style` allowed only on KaTeX output**.

## BIDI

Block tags (`p`, `li`, headings, …) get **`dir="auto"`** via a DOMPurify hook. **`pre` /
`code` / `span`** stay LTR intentionally.

## resource_link / plan files

When the ACP protocol emits a **`resource_link`** block, the UI shows a **chip** that opens
the same content viewer as file links — convenient for plan artifacts the protocol surfaces.

It is **not** a substitute for an explicit markdown link when you want the user to read a
document you just wrote — prefer **`/api/fs/file`** or a markdown link you control.

## What does not work

- **Embedded audio in markdown** — no `audio` tag path in the markdown parser (0 hooks today).
- **HTML payloads** or asking the proxy to serve **`.html`** — blocked (415 / not in map).
- **Bare long paths** with no link — user may not open them.
- **Remote images** without click — they will not auto-load.

## Quick checklist

1. Screenshot → `![alt](./relative.png)` from session cwd.
2. User opens a doc → markdown link through **`/api/fs/file?uri=…`** with allowed extension.
3. Diagram → ` ```mermaid ` fence.
4. Never rely on raw `<img>` or auto-loaded `https://` images.
