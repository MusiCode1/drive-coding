# C3-spike — In-Process Host POC: Findings

**Date:** 2026-06-28
**Spike:** slice-C3-spike-inprocess-host
**Verdict:** GO

---

## Summary

`ClaudeAcpAgent` can be hosted in-process using sdk@1.0.0's built-in
`AgentApp.connect(ClientApp)` API. The initialize handshake succeeds, returning
`agentCapabilities` with `_meta.claudeCode`, and a custom extension method
(`ext/spike/ping`) routes correctly — proving the ext channel is open.

---

## Path Tried

### Path 1 — `AgentApp.connect(ClientApp)` (sdk@1.0.0 in-process)

**Result: SUCCESS** (did not need to fall back to paths 2 or c)

The sdk@1.0.0 `AgentApp` and `ClientApp` builders connect directly in-process
with no transport, no IO, and no spawned process. The connection is synchronous
at the connect level; requests are dispatched via JavaScript microtasks.

**Key implementation pattern:**

```ts
// Build AgentApp with same handlers as runAcp()
let claudeAgent: ClaudeAcpAgent | undefined
const agentApp = agent({ name: "claude-code-acp" })
  .onRequest(methods.agent.initialize, (ctx) => claudeAgent!.initialize(ctx.params))
  // ... other method handlers
  .onRequest("ext/spike/ping", { parse: (p) => p as { message: string } }, (ctx) => ({
    pong: ctx.params.message, ts: Date.now()
  }))

const clientApp = client({ name: "drive-coding-host" })
  .onRequest(methods.client.session.requestPermission, (_ctx) => ({
    outcome: { outcome: "cancelled" as const }
  }))
  // ... other client-side handlers

// In-process connect — no transport
const connection = agentApp.connect(clientApp)

// IMPORTANT: Assign before any messages process (same pattern as runAcp())
claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(connection.client))

// Drive from client side
await clientApp.connectWith(agentApp, async (ctx) => {
  const result = await ctx.request(methods.agent.initialize, { ... })
})
```

**Captured frames:**

Initialize response:
```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "_meta": { "claudeCode": { "promptQueueing": true } },
    "promptCapabilities": { "image": true, "embeddedContext": true },
    "mcpCapabilities": { "http": true, "sse": true },
    "loadSession": true,
    "sessionCapabilities": {
      "additionalDirectories": {}, "close": {}, "delete": {},
      "fork": {}, "list": {}, "resume": {}
    }
  },
  "agentInfo": {
    "name": "@agentclientprotocol/claude-agent-acp",
    "title": "Claude Agent",
    "version": "0.52.0"
  },
  "authMethods": []
}
```

ext/spike/ping response:
```json
{ "pong": "hello-from-spike", "ts": 1782601475902 }
```

---

## Key Technical Findings

### 1. Two-SDK-major interop: works as expected

The `ClaudeAcpAgent` (claude-agent-acp@0.52 / sdk@1.0.0) accepts a
`ClientConnection` adapter that implements the `AcpClient` interface. This
adapter bridges the `AgentContext` (sdk@1.0.0) to the 8 methods that
`ClaudeAcpAgent` needs. The adapter is ~20 lines and mirrors `acp-agent.js:255`
exactly.

### 2. `ClientConnection` adapter is simple and stable

The adapter (see `spike.ts::makeAcpClientFromCtx`) only needs:
- `sessionUpdate` → `ctx.notify(methods.client.session.update, ...)`
- `requestPermission` → `ctx.request(methods.client.session.requestPermission, ...)`
- `readTextFile` → `ctx.request(methods.client.fs.readTextFile, ...)`
- `writeTextFile` → `ctx.request(methods.client.fs.writeTextFile, ...)`
- `unstable_createElicitation` / `unstable_completeElicitation`
- `extNotification` → `ctx.notify(method, ...)`

No reflection, no private internals. Type-safe against `AcpClient` interface.

### 3. Ext channel works out of the box

Custom extension methods registered with `.onRequest("ext/...", parser, handler)`
route correctly. The `ext/spike/ping` method returned the expected response
with zero configuration. No `-32601` (Method Not Found) error.

### 4. initialize requires no auth/env/tokens

`ClaudeAcpAgent.initialize()` returns synchronously (modulo async construction).
It reads env vars for auth-method hints (`NO_BROWSER`, `SSH_CONNECTION`) but
does not perform any auth check itself — it just reports available auth methods.
`authMethods: []` when no terminal-auth flags set and no SSH environment.

### 5. devDep alias required for sdk@1.0.0

Provider already depends on `@agentclientprotocol/sdk@0.21.1`. The `agent()`
and `client()` functions exist only in sdk@1.0.0. A pnpm devDep alias
(`"acp-sdk-v1": "npm:@agentclientprotocol/sdk@1.0.0"`) was added to
`packages/provider/package.json` — the alias is devDep-only, so it does not
appear in the published package.

### 6. `AgentApp.connect(ClientApp)` is the recommended in-process path

From `sdk@1.0.0/dist/acp.d.ts:572`:
> "This is useful for tests and in-process examples that do not need a transport."

The duplicate-stream path (path 2) was not needed — path 1 is cleaner.

---

## Pre-rejected paths (confirmed pre-flight findings valid)

- **Path (a):** `connection.client` is `AgentContext` (request/notify only),
  not a full `AcpClient` → cannot use directly. Confirmed.
- **Path (b):** `ClientConnection` is not exported from claude-agent-acp.
  Confirmed in `acp-agent.js:255` — class is unexported.

---

## Recommendation for C3 (full host implementation)

1. Use `AgentApp.connect(ClientApp)` as the transport layer.
2. The `makeAcpClientFromCtx(connection.client)` adapter is the bridge to
   `ClaudeAcpAgent`. Promote it from spike to `packages/provider/src/host/in-process/client-bridge.ts`.
3. Ext handlers register with `.onRequest("ext/<method>", parser, handler)` on
   the `AgentApp` instance — fully additive, zero changes to `ClaudeAcpAgent`.
4. The `ClientApp` handles client-side requests (`requestPermission`, `fs/*`,
   `elicitation/*`) — these are the hooks for the permission UI (future F-track).
5. No `session/prompt` touches `ClaudeAcpAgent` directly; the ACP wire handles it.

---

## DoD verification

| # | Check | Result |
|---|-------|--------|
| 1 | typecheck provider | PASS — `pnpm --filter @drive-coding/provider typecheck` |
| 2 | POC runs + prints initialize | PASS — `agentCapabilities._meta.claudeCode` non-empty |
| 3 | findings-doc GO/NO-GO | PASS — GO (this document) |
| 4 | ext-POC documented | PASS — `ext/spike/ping` returned `{ pong, ts }`, no -32601 |
| 5 | additive — zero live file | PASS — only `packages/provider/` + `docs/` + `pnpm-lock` |
| 6 | zero `session/prompt` | PASS — grep confirms no prompt in spike.ts |
