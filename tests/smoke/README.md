# Smoke tests

End-to-end tests that exercise BE + FE + OneCLI gateway with real browser
(Playwright headless Chromium).

## Why a separate folder

Playwright includes browser binaries (~100 MB). We deliberately keep this
outside the pnpm workspace so a regular `pnpm install` stays fast. Install
separately when you actually want to run smoke tests.

## Setup (one-time per machine)

```bash
cd tests/smoke
npm install
npx playwright install chromium-headless-shell
```

## Running

Pre-condition: BE + FE must be running locally.

```bash
# Terminal 1 — BE (REQUIRES OneCLI, see root AGENTS.md → "Backend MUST run through OneCLI")
cd packages/backend
onecli run --agent voice-acp -- bun --watch src/server.ts

# Terminal 2 — FE
pnpm --filter @drive-coding/frontend-v2 dev

# Terminal 3 — smoke
cd tests/smoke
node chat-roundtrip.mjs
```

Exit 0 = pass, exit 1 = fail (with reason).

## Output formats

The script prints human-readable output AND a single structured line
prefixed with `RESULT: ` for parseability:

```
=== Bubbles ===
  [user] Me / שלום
  [thought] ...
...
✓ SMOKE PASSED
RESULT: {"ok":true,"bubbles":[...],"proxy":{...},"console":{...}}
```

To extract just the structured result:
```bash
node chat-roundtrip.mjs 2>&1 | grep "^RESULT: " | sed 's/^RESULT: //' | jq .
```

The `result` shape:
```ts
{
  ok: boolean
  feUrl: string
  prompt: string
  cli: string
  bubbles: { kind: string; text: string }[]
  proxy: {
    requests: number
    errors: number
    errorDetails: { status: number; url: string }[]
    cacheHits: number
    cacheMisses: number
    cacheOther: number
  }
  console: {
    errors: number
    warnings: number
    errorDetails: string[]   // first 5
    warningDetails: string[] // first 5
  }
  failures: string[]
}
```

## Environment overrides

| var | default | meaning |
|-----|---------|---------|
| `FE_URL` | `http://localhost:5173` | Where the FE is reachable |
| `CWD` | `/home/user/projects/voice-acp/dev` | cwd to connect to |
| `CLI` | `opencode` | Which CLI agent to spawn |
| `PROMPT` | `שלום` | What to send |
| `HEADED` | unset | Set to `1` to show the browser window |

## Tests

### `chat-roundtrip.mjs`

Connect form → /chat → send prompt → wait for response → assert:

- ✓ User bubble with the prompt text
- ✓ At least one agent message bubble
- ✓ TTS request fired (`/proxy/elevenlabs/v1/text-to-speech/.../stream`)
- ✓ No proxy errors (4xx / 5xx — this catches OneCLI credential issues)
- ✓ No browser console errors
- ✓ No page errors

What it does NOT verify:
- Actual audio playback (headless Chrome blocks autoplay; not worth the
  flag-juggling for now)
- Mic input (slice 3)

## Future tests

Candidates for `tests/smoke/`:

- `voice-roundtrip.mjs` — slice 3: record → STT → response → TTS
- `replay.mjs` — slice 10: load a saved session → replay audio
- `disconnect-reconnect.mjs` — connection lifecycle, Bug D1 regression check
