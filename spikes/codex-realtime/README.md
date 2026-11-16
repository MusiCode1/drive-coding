# Spike: Codex realtime voice over ACP

Throwaway measurement code — not product code, not for merge.
Findings are recorded in the project's planning notes.

Question: can drive-coding use Codex's built-in voice front-end (`thread/realtime/*` in `codex app-server`)
while still talking ACP to `codex-acp`, plus extensions?

## Topology

```
browser (RTCPeerConnection + data channel "oai-events")
   │  SDP offer / answer
voice-acp-server.mjs ── ACP ──> codex-acp ──(CODEX_PATH=fake-codex.mjs)──┐
   └── app-server client: thread/resume + thread/realtime/start ──────────┴─> shared `codex app-server --listen ws://127.0.0.1:47811`
```

`fake-codex.mjs` stands in for the `codex` binary so that the adapter's app-server is the shared one,
which lets a second client start realtime on the adapter's own thread without modifying the adapter.

## Files

| File | Purpose |
|---|---|
| `fake-codex.mjs` | `codex app-server` → stdio bridged to the shared ws server; other subcommands run the real binary |
| `spike1-delegation-over-acp.mjs` | Headless attempt (text instead of voice). Result: without a live WebRTC peer the voice model never acts; the session closes with `transport_closed` after ~40s |
| `voice-acp-server.mjs` + `voice-acp.html` | Browser run of both spikes; every ACP update, app-server notification and data-channel event is logged |
| `rpc.mjs`, `wsrpc.mjs`, `fake-sdp.mjs` | Minimal JSON-lines / WebSocket clients and a dummy offer |

## Run

```bash
codex app-server --listen ws://127.0.0.1:47811          # in tmux
PORT=47921 TOKEN=$(openssl rand -hex 12) node voice-acp-server.mjs
# expose 47921 over HTTPS (getUserMedia needs a secure context), open /<TOKEN>/
```
