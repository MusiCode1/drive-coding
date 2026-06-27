# DriveCoding — Voice Agent UI Kit

A click-through recreation of the DriveCoding PWA: the **connect** view and the
**live agent chat**, inside a phone frame, with a live switcher for all 8 themes.

## Screens

| File | Surface | Notes |
|------|---------|-------|
| `ConnectScreen.jsx` | `/` connect form | CLI + working-directory + voice pickers, connect button |
| `ChatScreen.jsx` | `/chat` live agent | fixed header (status badge), scrolling bubble list, footer mode-toggle over the 110px mic or a text composer |
| `App.jsx` | PWA shell | connect → chat state, phone frame, theme switcher |
| `index.html` | entry | mounts `App`, loads the DS bundle |

## Interactions

- **Connect** → tap *התחבר לסוכן* to enter the chat.
- **Record mode** → tapping the mic cycles the state machine (idle → recording →
  transcribing → thinking → speaking → idle) and appends bubbles.
- **Type mode** → send a message; a fake agent reply + tool call streams back.
- **Theme** → the swatch row re-themes the whole phone via `[data-palette]`.

## Composition

Everything is built from the design-system primitives (no re-implemented UI):
`MicButton`, `ChatBubble`, `ToolCall`, `StatusPill`, `Avatar`, `Badge`,
`Button`, `IconButton`, `Select`, `TextInput`, `Icon` from
`window.DriveCodingDesignSystem_a6504a`.

This is a cosmetic recreation for design work — it fakes the agent and voice
pipeline. The real product is voice-first, WebSocket-driven, and HTTPS-only
(secure-context Web Audio APIs).
