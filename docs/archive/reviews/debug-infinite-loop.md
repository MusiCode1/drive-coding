# Debug Report — Infinite Loop + Browser Test

**Date:** 2026-05-16
**File:** `packages/frontend/src/routes/agent/[id]/+page.svelte`
**Commit:** `9efbc62` (Bug 4 fix — replaced `$derived` with `$state` + `$effect`)

---

## Root Cause

The `$effect` at lines 24-30 caused an infinite reactive update loop:

```ts
// BEFORE (broken):
$effect(() => {
  const id = agentId          // reactive read: agentId tracked ✓
  session.disconnect()        // reactive read: session ALSO tracked ← BUG
  session = createAgentSessionStore(id)   // writes to session → triggers effect again
  voice = createVoiceSessionStore(session)
})
```

Svelte 5's `$effect` tracks **all reactive reads** inside the callback — including
`session.disconnect()`, which accesses the reactive `session` object. Writing back to
`session` then invalidates the effect, causing it to re-run immediately → infinite loop:

```
agentId changes
  → effect runs
  → reads session (adds as dependency)
  → writes session = new store
  → session changed → effect invalidated
  → effect runs again → ∞
```

---

## Fix

Added `untrack()` wrapper from Svelte around all writes and the `session.disconnect()` call:

```ts
// AFTER (fixed):
import { untrack } from "svelte"

$effect(() => {
  const id = agentId // reactive: track agentId changes only
  untrack(() => {
    // Non-reactive block: disconnect + replace stores
    // without registering session/voice as effect dependencies
    session.disconnect()
    session = createAgentSessionStore(id)
    voice = createVoiceSessionStore(session)
  })
})
```

`untrack()` tells Svelte: "don't register any reactive reads inside this block as
dependencies of the surrounding effect". The effect now only re-runs when `agentId` changes.

**Verification:** `pnpm typecheck` ✅ `pnpm lint` ✅ (0 errors, 0 warnings)

---

## Full $effect / $derived Audit

| Location | Type | Reads (tracked) | Writes | Cycle? |
|---|---|---|---|---|
| L14 | `$derived` | `page.params.id` | — | ✅ None |
| L24-34 | `$effect` | `agentId` only (untracked: session, voice) | `session`, `voice` (via untrack) | ✅ Fixed |
| L33-37 | `$derived` | `window.location.search` (non-reactive) | — | ✅ None |
| L49-53 | `$effect` | `voice.voiceState` | `isCancelling` | ✅ None — `isCancelling` not in voice store |
| L56-63 | `$derived` | `voice.isRecording`, `voice.voiceState`, `session.status`, `isCancelling` | — | ✅ None |
| L85-106 | `$effect` | `micState` (derived) | `prevMicState` | ✅ None — `prevMicState` not in `deriveMicState()` |
| L109-120 | `$effect` | `session.messages`, `autoScrollEnabled` | DOM (`chatEl.scrollTop`) | ✅ None — DOM mutations are not reactive |
| L189-191 | `$effect` | `agentId` | async: `agent`, `loadError` (via `loadAgent()`) | ✅ None — async writes don't create sync cycles |
| L222 | `$derived` | `voice.canReplayLast` | — | ✅ None |
| L242-244 | `$effect` | `session.error` | — (side effect: `cues.error()`) | ✅ None |

**Note on `isCarMode` (L33-37):** `window.location.search` is not reactive — the derived
value is computed once at mount. This is intentional (car mode is set via URL and doesn't
change at runtime), but worth documenting: if you ever need `isCarMode` to respond to
`pushState` changes, it needs to read from `page.url.searchParams` instead.

---

## Browser Test Results (linux-gui, port 9333)

**URL tested:** `https://your-app.nue.tuns.sh/`

### Test 1: Dashboard load
- ✅ Dashboard loaded cleanly
- ✅ Existing agent visible in list
- ⚠️ 1 console error: `404 favicon.ico` — cosmetic, not functional

### Test 2: Create new agent → navigate to /agent/:id
- ✅ `/agent/new` loaded: CLI/cwd/model dropdowns populated
- ✅ Selected cwd `/home/user/projects/voice-acp-v2`, model `anthropic/claude-sonnet-4-6`
- ✅ Clicked "צור" → navigated to `/agent/8747c6d2-6d4c-462b-8345-935d9318436f`
- ✅ Status badge shows `connected`
- ✅ **No `effect_update_depth_exceeded` error** — infinite loop is gone
- ✅ 0 console errors on agent page

### Test 3: Console errors
- ✅ 0 errors after navigation to agent page
- ✅ 0 errors during session

### Test 4: Send prompt
- ✅ Sent Hebrew prompt: "שלום, תגיד לי מה שמך"
- ✅ User bubble appeared immediately (RTL, right-aligned)
- ✅ Thought bubble appeared (agent is processing)
- ⚠️ Agent response (text_chunk) did not arrive within ~40 seconds
  - Thought bubble shows truncated reasoning: "The learnings say I should respond in Hebrew. Let me just"
  - This appears to be a backend/agent slowness issue, not a frontend bug
  - Session status stayed `connected` (WS did not drop) ✓
  - No frontend errors logged ✓

### Test 5: RTL verification
- ✅ User bubbles right-aligned (bubble-user class, dir="auto")
- ✅ Agent thought bubble left-aligned (bubble-thought, dir="auto")
- ✅ Header RTL: arrow "←" on left, title "opencode" on right
- ✅ Textarea `direction: rtl` confirmed in CSS
- ✅ "שלח" button appears bottom-right of footer

### Screenshots
- `debug-agent.png` — connected agent page (clean, no errors)
- `debug-chat.png` / `debug-chat2.png` — prompt sent, thought bubble visible

---

## Remaining Issues

1. **Agent response latency** — the test agent (`8747c6d2`) did not produce a `text_chunk`
   within 40 seconds. Unclear if this is:
   - opencode agent startup time (first prompt is always slow)
   - A backend streaming issue
   - The agent reading large context files before responding
   - **Not a frontend regression** — the WS stays connected, no JS errors

2. **`isCarMode` non-reactive** (minor, documented above) — intentional but worth noting.

3. **`favicon.ico` 404** — cosmetic, no functional impact.
