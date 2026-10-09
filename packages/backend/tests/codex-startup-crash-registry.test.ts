/**
 * codex-startup-crash-registry.test.ts — buffered codex startup crash through connection-registry.
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("../../provider/src/connection/codex-acp-startup.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../provider/src/connection/codex-acp-startup.js")>()
  return {
    ...actual,
    startCodexAcp(deps: Parameters<typeof actual.startCodexAcp>[0]) {
      // Sync failure during connect (before conn.onCrash) — same ordering as startAcpServer throw
      // while crashListeners are still empty; registry subscribes after connect resolves.
      deps.onStartupError(new SyntaxError("JSON Parse error"))
    },
  }
})

describe("connection-registry + codex startup crash", () => {
  it("onCrash runs after map.set and cleanup removes the entry", async () => {
    const { createConnectionRegistry } = await import("../src/acp/connection-registry.js")
    const reg = createConnectionRegistry()
    let crashSeen = 0
    reg.onCrash(() => {
      crashSeen++
    })

    await reg.connect("agent-codex-startup-crash", "codex", { cwd: "/tmp" })

    await vi.waitFor(() => expect(crashSeen).toBe(1))
    expect(reg.get("agent-codex-startup-crash")).toBeUndefined()
  })
})
