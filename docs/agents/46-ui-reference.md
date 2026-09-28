---
id: ui-reference
title: UI reference — screens and controls
summary: Where settings and session controls live in the drive-coding web app, with on-screen labels an agent can quote back to the user.
read_when:
  - The user is asking where a setting lives or what a button on the screen does
  - You need to explain navigation between connect, chat, settings, and usage without opening frontend code
  - The user describes what they see and you must map it to the correct screen or control
tags: [ui]
surface: [ui]
stability: transitional
routes: []
docs_version: 1.2.0
updated: 2026-09-28
---

# UI reference

This page maps **what the user sees** in the drive-coding PWA. Labels below are the
**English** strings observed in the UI; the app is translated and copy may differ when
the user picks another **Interface language** (on Connect or in Settings).

The bare `/chat` route (no CLI or session id) is a thin guard that sends the user home
when no session is active — not a fifth main screen.

## Connect (`/`)

**When the user is here:** starting a new CLI session, reopening a recent folder, or
checking whether agents are already running on the machine.

**What you see**

- Title **Drive Coding** and subtitle **Connect to a CLI agent**.
- **Active processes** — heading with a **Refresh** control (↺). A **Machine load**
  status line summarizes host memory and CPU (wording varies; treat as live telemetry,
  not a promise of exact values). Either a list of running agent rows or **No active
  processes**.
- **Recent folders** — collapsible list ( **Refresh**, **Collapse** / expand ). Each row
  shows the CLI display name, a short folder label, a relative time, and actions such as
  **Remove from list**. Tapping a row reconnects that folder/session context.
- **Interface language** — opens a picker (observed value: **English**).
- **CLI** — picker with **Refresh**; shows the selected provider (observed: **OpenCode**).
- **Working directory** — text field (shows a path placeholder until filled), plus
  **Browse…** and **Show recent folders**.
- Primary **Connect** button at the bottom.

**State notes:** Active-process count and machine-load numbers change continuously; describe
the section, not a specific reading from one visit.

## Chat (`/chat/<cliKind>/<sessionId>`)

**When the user is here:** conversing with an agent, switching models/modes, or managing
the current session alongside message history.

**Header (banner)**

- **Menu** on wide layouts (opens navigation affordances tied to the shell).
- App title **drive-coding**.
- While a session runs: a short working-directory label beside **Connected**, and
  **Session budget** (shows a percentage while context is tracked).

**Message area (center)**

- User messages and agent replies as stacked bubbles with **Copy** on user text; agent
  bubbles may offer **Expand** and **Copy** (observed after a short text reply).

**Footer / input dock (contentinfo)**

- Mode switches: **Record**, **Type**, **Live**, **Hidden** (one is pressed at a time;
  observed **Type** after choosing text entry on desktop, **Record** default on mobile
  width).
- **Microphone** and status such as **Microphone access is not granted yet. Tap to allow
  when prompted.** (headless/automation browsers stay in this idle mic state — behavior
  during an actual recording was **not** observed here.)
- In **Type** mode: **Add image**, **Dictate**, combobox **Type a prompt…**, **Send**,
  **Stop run** (enabled/disabled depends on turn state).

**Side panel (session chrome)** — on desktop width, a **Collapse panel** handle and:

- **Machine load** (same family as Connect).
- **Title** text field.
- **Fields** (observed empty: **No fields**).
- Session lifecycle: **Shut the process down completely**, **Leave — keep running**,
  **Unmute audio**, **Settings**.
- **Display** toggles: **Clean reading**, **Show thoughts by default**, **Show tools by
  default**.
- **Running on** — CLI name (observed: **OpenCode**).
- **Agent options**
  - **Session Mode** button (observed: **build**) plus a help control titled **The default
    agent. Executes tools based on configured permissions.**
  - **Model** button (observed: **OpenCode Zen/Big Pickle**).
- **Project system prompt** — multiline field with helper **Appended to the agent's default
  instructions. Takes effect from the next session.** Provider may show **This provider does
  not support a project system prompt.**
- **Sessions** list — **Refresh**, **Search titles…**, **All sessions**, **＋ New session**,
  and historical session rows with **Copy session ID**.

On **mobile width**, the same panel content sits behind **Drag to open** instead of staying
visible; the header **Menu** button may be absent in favor of that drag affordance.

## Settings (`/settings`)

**When the user is here:** changing language, theme, voice/TTS, chat defaults, transport,
or inspecting token/TTS status for the backend.

**Main column**

- Heading **Settings**.
- **Interface language** (picker; observed **English**).
- **Theme** (observed **🔥 Ember**).
- **Voice & Speech**
  - **TTS provider** (observed **ElevenLabs**).
  - **TTS Voice** / **Voice** (may show **Loading voices…** until voices load; a specific
    voice id may appear once loaded).
  - Switches: **Speak model thoughts**, **Narrate tool actions**, **Translate thoughts to
    Hebrew** (observed on). **Car mode (Play on Bluetooth = record)** may appear **disabled**.
- **TTS Status** — action button (observed **Loading…** while fetching), **ElevenLabs quota**,
  **Usage (total since startup)** with **ElevenLabs** / **Gemini** rows (may show **—** while
  loading).
- **Context token usage** — **Refresh**, per-session rows (truncated ids with compaction
  summaries), link **View usage by CLI** → `/usage`.
- **Screen** — **Keep screen on** switch (observed on).
- **Notifications** — **Notify when tab is hidden**.
- **Chat display** switches: **Show thoughts by default**, **Show tools by default**,
  **Clean reading**, **Session memo pad**, **Load remote images automatically — your browser
  will fetch any URL the agent emits, which can expose you**, **Enter sends message**.
- **Backend URL** — text field with helper **Leave empty in dev mode. In production
  (Cloudflare) enter the full BE URL.**
- **Session transport** — picker (observed **HTTP**).
- Footer **Version: v0.40.1 (b550ac6a)** (semver + build id shown in-app).
- **Reset** and **Save & Open**.

**Side panel on `/settings` and `/usage`:** the same session sidebar chrome as Chat may
appear at desktop width ( **Collapse panel**, session list stub when no chat session is
focused — observed **No sessions** and disabled **＋ New session** ). Mobile uses **Drag to
open** for that panel.

## Usage (`/usage`)

**When the user is here:** comparing token/context usage and TTS totals **by CLI**, linked
from Settings.

- Heading **Usage by CLI** with a **Loading…** refresh/status control until data arrives.
- **TTS Status** block (same shape as Settings: quota + **Usage (total since startup)**).
- **Context usage by CLI** — may read **Loading…** until breakdown rows populate.

Same session side panel / **Drag to open** behavior as Settings.

## Answering common questions

| User question (examples) | Screen | Control / label |
|---|---|---|
| Where do I switch the model? | Chat | Side panel → **Agent options** → **Model** |
| Where is session / permission mode? | Chat | Side panel → **Agent options** → **Session Mode** |
| Where do I change language? | Settings or Connect | **Interface language** |
| Where is dark mode / colors? | Settings | **Theme** |
| Why is speech off or which voice? | Settings | **Voice & Speech** → **TTS provider**, **TTS Voice**, related switches |
| Where is token / context usage? | Settings | **Context token usage**; detail by CLI → **View usage by CLI** (**Usage** screen) |
| How do I type instead of voice? | Chat | Footer → **Type**, then **Type a prompt…** |
| How do I start from a recent project? | Connect | **Recent folders** row for that CLI + folder |
| How do I pick CLI or folder for new session? | Connect | **CLI**, **Working directory**, **Connect** |

## What this page does not cover

- Descriptions match the **application build shown in Settings** (observed **Version:
  v0.40.1 (b550ac6a)** at documentation time), not the `docs_version` of this markdown
  bundle.
- **Route paths** on this page (`/`, `/chat/...`, `/settings`, `/usage`) are pinned by an
  automated coupling test; **control descriptions are not** — labels can change between
  releases without failing that test.
- Internal test routes (`/bt-test`, `/wake-word-test`, `/playlist-nav-chrome-test`) are
  intentionally omitted.
- Controls that depend on state (recording in progress, turn running, quotas loaded, desktop
  vs mobile layout) are labeled **state-dependent** above; this page does not guarantee
  every switch is visible in every state.
