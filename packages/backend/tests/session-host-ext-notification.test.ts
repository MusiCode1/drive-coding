/**
 * session-host-ext-notification.test.ts — ext notification channel on both SessionHost factories.
 * slice meta-passthrough Commit 4.
 */

import { describe, expect, it, vi } from "vitest"
import type { Patch } from "@drive-coding/core/session"
import { patchToSessionUpdates } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { createSessionHost } from "../src/session-host/session-host.js"

function makeMockAcpClient(): AcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "ext-test" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "ext-test" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    conn: { sessionUpdate: vi.fn() },
  } as unknown as AcpClient
}

async function drainPatches(stream: ReadableStream<Patch>): Promise<Patch[]> {
  const reader = stream.getReader()
  const patches: Patch[] = []
  let done = false
  while (!done) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 5),
      ),
    ])
    if (result.done) done = true
    else patches.push(result.value as Patch)
  }
  reader.releaseLock()
  return patches
}

describe("SessionHost — onExtNotification (meta-passthrough)", () => {
  it("routes ext notification through reduce as _drive/ext_notification opaque patch", async () => {
    let captured: AcpClientCallbacks | undefined
    const host = await createSessionHost({
      createClient: async (callbacks) => {
        captured = callbacks
        return makeMockAcpClient()
      },
    })

    expect(captured?.onExtNotification).toBeTypeOf("function")
    captured?.onExtNotification?.("_claude/sdkMessage", { type: "task_started", parentToolUseId: "x" })

    const patches = await drainPatches(host.patches)
    expect(patches).toHaveLength(1)
    expect(patches[0]?.op).toBe("opaque")

    const wire = patchToSessionUpdates(host.state, patches[0]!)
    expect(wire).toHaveLength(1)
    expect(wire[0]).toMatchObject({
      sessionUpdate: "_drive/ext_notification",
      method: "_claude/sdkMessage",
      params: { type: "task_started", parentToolUseId: "x" },
    })
  })
})
