/**
 * session-host.test.ts — TDD tests for SessionHost (C2).
 *
 * Testing: tdd (brief §C2)
 *
 * Tests:
 *   - state updates: onUpdate → reduce → state changes
 *   - patches: emitted after each state change
 *   - user message synthesis: prompt() → synthesizeUserMessage + applyUserMessage
 *   - meta passthrough: meta from prompt() stored in state message
 *   - delegates: newSession/loadSession/cancel pass through to AcpClient
 */

import { describe, expect, it, vi } from "vitest"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { SessionState, Patch } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import { createSessionHost } from "./session-host.js"

// ── helpers ──────────────────────────────────────────────────────────────────

type MockAcpClient = {
  newSession: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  conn: { sessionUpdate: ReturnType<typeof vi.fn> }
}

function makeMockAcpClient(): MockAcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "test-session-id" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "test-session-id" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    conn: {
      sessionUpdate: vi.fn(),
    },
  }
}

/** Build a minimal SessionNotification for testing */
function makeSessionUpdate(update: Record<string, unknown>): SessionNotification {
  return {
    sessionId: "test-session-id",
    update: update as SessionNotification["update"],
  }
}

/** Drain all patches currently in the stream via getReader */
async function drainPatches(host: { patches: ReadableStream<Patch> }): Promise<Patch[]> {
  const reader = host.patches.getReader()
  const patches: Patch[] = []
  // Use a race to avoid blocking forever — only read what's already enqueued
  let done = false
  while (!done) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 5),
      ),
    ])
    if (result.done) {
      done = true
    } else {
      patches.push(result.value as Patch)
    }
  }
  reader.releaseLock()
  return patches
}

// ── test factory ─────────────────────────────────────────────────────────────

async function setup(mockOverrides?: Partial<MockAcpClient>) {
  let capturedCallbacks: AcpClientCallbacks | undefined
  const mock = { ...makeMockAcpClient(), ...mockOverrides }

  const host = await createSessionHost({
    createClient: async (callbacks: AcpClientCallbacks) => {
      capturedCallbacks = callbacks
      return mock as unknown as AcpClient
    },
  })

  return {
    host,
    mock,
    get callbacks() {
      if (!capturedCallbacks) throw new Error("createClient was never called")
      return capturedCallbacks
    },
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("SessionHost", () => {
  describe("initial state", () => {
    it("starts with idle status and empty messages", async () => {
      const { host } = await setup()
      expect(host.state.status).toBe("idle")
      expect(host.state.messages).toHaveLength(0)
    })

    it("calls createClient exactly once on construction", async () => {
      let callCount = 0
      await createSessionHost({
        createClient: async (cb) => {
          callCount++
          return makeMockAcpClient() as unknown as AcpClient
        },
      })
      expect(callCount).toBe(1)
    })
  })

  describe("state updates via onUpdate", () => {
    it("processes a session_info_update → updates title in state", async () => {
      const { host, callbacks } = await setup()

      callbacks.onUpdate(makeSessionUpdate({
        sessionUpdate: "session_info_update",
        title: "My Session",
      }))

      expect(host.state.title).toBe("My Session")
    })

    it("accumulates version on each update", async () => {
      const { host, callbacks } = await setup()

      const v0 = host.state.version
      callbacks.onUpdate(makeSessionUpdate({ sessionUpdate: "session_info_update", title: "A" }))
      callbacks.onUpdate(makeSessionUpdate({ sessionUpdate: "session_info_update", title: "B" }))

      expect(host.state.version).toBe(v0 + 2)
    })

    it("produces patches for each state change", async () => {
      const { host, callbacks } = await setup()

      const patchesPending: Patch[] = []
      const reader = host.patches.getReader()

      // Simulate update
      callbacks.onUpdate(makeSessionUpdate({
        sessionUpdate: "session_info_update",
        title: "Hello",
      }))

      // Read the emitted patch
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
      ])
      reader.releaseLock()

      expect(result.done).toBe(false)
      const patch = result.value as Patch
      expect(patch.op).toBe("update-session")
      if (patch.op === "update-session") {
        expect(patch.changes.title).toBe("Hello")
      }
    })
  })

  describe("prompt() — user message synthesis + meta passthrough", () => {
    it("adds a user message to state before calling client.prompt", async () => {
      const { host, mock, callbacks } = await setup()
      // Set up a sessionId
      callbacks.onUpdate(makeSessionUpdate({ sessionUpdate: "session_info_update", title: "" }))

      await host.prompt("test-session-id", "hello world")

      expect(host.state.messages).toHaveLength(1)
      const msg = host.state.messages[0]
      expect(msg?.role).toBe("user")
      if (msg?.role === "user") {
        expect(msg.segments[0]?.text).toBe("hello world")
      }
    })

    it("passes meta to the synthesized user message", async () => {
      const { host, callbacks } = await setup()
      const meta = { agentId: "agent-123", context: "test" }

      await host.prompt("test-session-id", "test prompt", meta)

      const msg = host.state.messages[0]
      expect(msg?.meta).toEqual(meta)
    })

    it("calls client.prompt after synthesizing the user message", async () => {
      const { host, mock } = await setup()

      await host.prompt("test-session-id", "hello")

      expect(mock.prompt).toHaveBeenCalledWith("test-session-id", "hello")
    })

    it("emits an add-message patch when user message is synthesized", async () => {
      const { host } = await setup()

      const reader = host.patches.getReader()

      await host.prompt("test-session-id", "hello")

      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
      ])
      reader.releaseLock()

      expect(result.done).toBe(false)
      const patch = result.value as Patch
      expect(patch.op).toBe("add-message")
    })

    it("prompt without meta leaves meta undefined on the message", async () => {
      const { host } = await setup()

      await host.prompt("test-session-id", "no meta")

      const msg = host.state.messages[0]
      expect(msg?.meta).toBeUndefined()
    })
  })

  describe("delegate methods", () => {
    it("newSession delegates to client.newSession", async () => {
      const { host, mock } = await setup()

      await host.newSession({ cwd: "/test" })

      expect(mock.newSession).toHaveBeenCalledWith({ cwd: "/test" })
    })

    it("loadSession delegates to client.loadSession", async () => {
      const { host, mock } = await setup()

      await host.loadSession({ cwd: "/test", sessionId: "abc" })

      expect(mock.loadSession).toHaveBeenCalledWith({ cwd: "/test", sessionId: "abc" })
    })

    it("cancel delegates to client.cancel", async () => {
      const { host, mock } = await setup()

      await host.cancel("test-session-id")

      expect(mock.cancel).toHaveBeenCalledWith("test-session-id")
    })
  })

  describe("state is immutable (new reference on each update)", () => {
    it("state reference changes on each update", async () => {
      const { host, callbacks } = await setup()

      const before = host.state
      callbacks.onUpdate(makeSessionUpdate({ sessionUpdate: "session_info_update", title: "X" }))
      const after = host.state

      expect(after).not.toBe(before)
    })
  })
})
