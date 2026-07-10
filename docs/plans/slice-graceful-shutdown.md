# Slice: `graceful-shutdown-basic`

## Summary
Add SIGTERM/SIGINT handlers to cleanly close HTTP + WebSocket servers before exit, preventing stuck port handles in the kernel (address: port 4000 tקוע בקרנל).

## Motivation
BE crashes leave port 4000 in CLOSE_WAIT state (kernel handle leak). Without graceful shutdown, child processes stall, port never releases, and restart requires machine reboot.

## Scope
- Add `process.on("SIGTERM"/SIGINT")` listeners in `packages/backend/src/server.ts`
- Close httpServer + agentWss + echoWss in parallel
- Log each stage
- Timeout-safe: Promise.all with per-handler timeout (5s max)

## DoD
- [ ] Port 4000 releases immediately after `kill -TERM <pid>`
- [ ] Logs show "All servers closed, exiting"
- [ ] No hanging processes (netstat clean)
- [ ] Integration test: spawn + wait 1s + SIGTERM → verify exit code 0

## Testing Strategy
**mode: manual** — need real system SIGTERM signal. No unit mock can test this reliably.

## Files Changed
- `packages/backend/src/server.ts` — +30 lines (listeners + close logic)

## Base
`dev`

## Depends On
None

## Complexity
2/light
