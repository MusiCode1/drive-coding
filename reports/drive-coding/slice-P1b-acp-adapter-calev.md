---
project: "drive-coding"
slice: "slice-P1b-acp-adapter"
verifier: "calev"
date: "2026-06-13"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck + build exit 0"
  - "mapAcpNotification all variants covered with fixture-wrapped updates"
  - "tool_call collapse + mapStatus undefined->pending"
  - "AcpProviderSession lifecycle via mock transport"
  - "sendPrompt returns PromptAck immediately; turn.end emitted on resolve with isError"
  - "exports from core/index (classifyToolKind, mapAcpNotification, AcpProviderSession, mapAcpCapabilities)"
  - "scope — no frontend/agent-session touched"
  - "mapAcpCapabilities from client.capabilities (SDK AgentCapabilities), not ports"
  - "vitest core 0 fail"
spot_check: "sendPrompt non-blocking: ack returned before turn resolves — confirmed via test pattern (no flush before ack)"
findings: []
---

# slice-P1b-acp-adapter — Verification Report (Light)

> **תאריך:** 2026-06-13
> **Tier:** light
> **Commit:** b9f911f (HEAD, walkthrough docs) / 0a91f44 (last code commit)
> **Worktree:** D:\UserProjects\AI\drive-coding\.worktrees\slice-P1b-acp-adapter

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 9/9 |
| Happy path עובד | yes |
| Bugs חדשים | 0 |

---

## Build / Typecheck / Tests

```
pnpm -F @drive-coding/core typecheck  → exit 0 (no output = clean)
pnpm -F @drive-coding/core build      → exit 0 (no output = clean)
pnpm vitest run --project @drive-coding/core
  Test Files  24 passed (24)
       Tests  289 passed (289)
    Duration  5.13s
```

---

## DoD Items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck + build exit 0 | yes | tsc --noEmit + tsc --build: both silent (exit 0) |
| 2 | mapAcpNotification — כל variant | yes | map-acp-notification.test.ts: tool_call, tool_call_update, agent_message_chunk, agent_thought_chunk, plan->plan.update, usage_update->usage, available_commands_update->raw, user_message_chunk->raw, unknown->raw — all in describe blocks, fixtures wrapped `{ update: up }` |
| 3 | tool_call collapse + mapStatus undefined->pending | yes | test "mapStatus: status חסר -> 'pending'": synthetic `{sessionUpdate:"tool_call", toolCallId:"t1", kind:"read"}` (no status) -> ev.status === "pending" confirmed |
| 4 | AcpProviderSession lifecycle — start/sendPrompt/cancel/stop/onEvent | yes | acp-provider.test.ts: startSession() helper drives mock transport; cancel -> session/cancel frame; stop -> transport.onClose fired |
| 5 | sendPrompt returns PromptAck immediately; turn.end{turnId,stopReason,isError} on resolve | yes | test "מחזיר PromptAck מיד": `await session.sendPrompt("hello")` returns before any turn response injected; separate test injects stopReason "end_turn" -> `{type:"turn.end", turnId:ack.turnId, stopReason:"end_turn", isError:false}`; "refusal" -> isError:true |
| 6 | exports from core/index | yes | index.ts lines 8-10: `export * from "./provider/acp-provider"`, `export * from "./provider/map-acp-notification"`, `export * from "./provider/tool-kind"` — all value exports (not `export type *`) |
| 7 | scope — no frontend/agent-session | yes | `git diff --stat slice-P1a-provider-abstraction -- packages/frontend/ packages/backend/` → empty (no output). Total diff: 7 files, all in packages/core/** + docs/ |
| 8 | mapAcpCapabilities from client.capabilities (AgentCapabilities), not ports | yes | acp-provider.ts:31 `mapAcpCapabilities(caps: AgentCapabilities)` — imports AgentCapabilities from "@agentclientprotocol/sdk". Caps applied: loadSession, sessionCapabilities.{resume,list,close}, promptCapabilities.image, mcpCapabilities |
| 9 | vitest core 0 fail | yes | 289 passed, 0 failed across 24 test files |

---

## Happy Path

`sendPrompt` non-blocking flow:
1. `AcpProviderSession.start()` — drives initialize + session/new via MockAcpTransport; emits `session.ready{sessionId, capabilities}`.
2. `sendPrompt("hello")` — returns `{turnId, status:"running"}` immediately (no turn response yet injected).
3. MockAcpTransport receives session/prompt frame; `makeResult(id, {stopReason:"end_turn"})` injected.
4. `turn.end{turnId, stopReason:"end_turn", isError:false}` emitted to handler.

yes — full async lifecycle confirmed by acp-provider.test.ts (runs in vitest, 289/289 pass).

---

## Bugs חדשים שלא ברשימה

אין.

---

## הערות

- `available_commands_update` ו-`user_message_chunk` מנותבים ל-`default:` (raw) — תקין לפי DoD §5 #2 וה-switch ב-map-acp-notification.ts:63.
- `mapContent` מממש גם diff/terminal (מעבר ל-MVP text-only שתואר ב-§9 #3) — bonus, לא blocker.
- `unsubscribe` test מאמת שה-handler המוחלף לא מקבל events — lifecycle clean.
- Scope diff: 846 שורות תוספת, 0 מחיקה, אפס נגיעה ב-frontend.
