---
id: render-contract
title: Render contract — what your output can display
summary: What the drive-coding UI renders from agent output, and what it will not render.
read_when:
  - You are about to emit a file link, an image or a diagram
  - Your output rendered as plain text and you expected something richer
tags: [render, output, ui]
surface: [http, mcp]
stability: stable
docs_version: 1.2.0
updated: 2026-09-28
---

# Render contract

The chat UI renders markdown-rich content with a **strict allowlist**. This page is
**expanded from `packages/backend/src/prompts/surface/display.ts`**; that file is the
Tier-2 summary (three rules an agent must not miss) and this is its Tier-3 reference.

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
