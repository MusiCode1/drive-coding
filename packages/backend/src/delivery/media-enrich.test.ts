import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { Patch } from "@drive-coding/core/session"
import { patchToSessionUpdates } from "@drive-coding/core/session"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createSessionHost } from "../session-host/session-host.js"
import { createSessionHostFromConnection } from "../session-host/session-host.js"
import { createAgentWsHandler } from "./ws-agent.js"

function makeSessionUpdate(update: Record<string, unknown>): SessionNotification {
  return { sessionId: "s1", update: update as SessionNotification["update"] }
}

describe("media enrich — HTTP SessionHost", () => {
  let dir = ""
  let mp3 = ""

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("single agent_message_chunk enriches _meta before reduce", async () => {
    dir = mkdtempSync(join(tmpdir(), "media-enrich-"))
    mp3 = join(dir, "clip.mp3")
    writeFileSync(mp3, "fake")

    let capturedCallbacks: { onUpdate?: (n: SessionNotification) => void } = {}
    const host = await createSessionHost({
      createClient: async (callbacks) => {
        capturedCallbacks = callbacks
        return {
          newSession: vi.fn(),
          loadSession: vi.fn(),
          prompt: vi.fn(),
          cancel: vi.fn(),
          conn: { sessionUpdate: vi.fn() },
        } as never
      },
    })

    capturedCallbacks.onUpdate?.(
      makeSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `![clip](${mp3})` },
      }),
    )

    const msg = host.state.messages[0]
    expect(msg?.meta?.["_drive/media"]).toEqual([
      expect.objectContaining({ uri: `file://${mp3}`, mime: "audio/mpeg" }),
    ])
  })

  it("two streamed chunks enrich _meta on the closing patch", async () => {
    dir = mkdtempSync(join(tmpdir(), "media-enrich-stream-"))
    mp3 = join(dir, "preview-audio.mp3")
    writeFileSync(mp3, "fake")

    let capturedCallbacks: { onUpdate?: (n: SessionNotification) => void } = {}
    const host = await createSessionHost({
      createClient: async (callbacks) => {
        capturedCallbacks = callbacks
        return {
          newSession: vi.fn(),
          loadSession: vi.fn(),
          prompt: vi.fn(),
          cancel: vi.fn(),
          conn: { sessionUpdate: vi.fn() },
        } as never
      },
    })

    const reader = host.patches.getReader()
    const markdown = `![clip](${mp3})`
    capturedCallbacks.onUpdate?.(
      makeSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: markdown.slice(0, -"udio.mp3)".length) },
      }),
    )
    capturedCallbacks.onUpdate?.(
      makeSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "udio.mp3)" },
      }),
    )

    const first = (await reader.read()).value
    const closing = (await reader.read()).value
    expect(first).toBeDefined()
    expect(closing).toBeDefined()
    expect(closing?.op === "append-segment" || closing?.op === "add-message").toBe(true)
    const closingMeta =
      closing?.op === "append-segment"
        ? closing.meta?.["_drive/media"]
        : closing?.op === "add-message"
          ? closing.message.meta?.["_drive/media"]
          : undefined
    expect(closingMeta).toEqual([
      expect.objectContaining({ uri: `file://${mp3}`, mime: "audio/mpeg" }),
    ])
    const wire = patchToSessionUpdates(host.state, closing!)
    const wireMeta = wire[0]?._meta as Record<string, unknown> | undefined
    expect(wireMeta?.["_drive/media"]).toEqual(closingMeta)
  })
})

describe("media enrich — HTTP FromConnection sessionCwd", () => {
  it("uses cwd captured from newSession for relative paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "media-cwd-"))
    writeFileSync(join(dir, "a.mp3"), "x")

    let capturedCallbacks: { onUpdate?: (n: SessionNotification) => void } = {}
    const conn = {
      wire: { onLine: vi.fn(() => () => {}), write: vi.fn() },
      onCrash: vi.fn(() => () => {}),
      capabilities: {},
      turn: { isBusy: vi.fn(), lastActivityAt: vi.fn(), onChange: vi.fn(() => () => {}) },
      close: vi.fn(),
      pid: 1,
    } as unknown as ProviderConnection

    const host = await createSessionHostFromConnection(conn, {
      _createAcpClient: async (_t, callbacks) => {
        capturedCallbacks = callbacks
        return {
          newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
          loadSession: vi.fn(),
          prompt: vi.fn(),
          cancel: vi.fn(),
          capabilities: {},
        } as never
      },
    })

    await host.newSession({ cwd: dir })
    capturedCallbacks.onUpdate?.(
      makeSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "![c](./a.mp3)" },
      }),
    )

    expect(host.state.messages[0]?.meta?.["_drive/media"]).toEqual([
      expect.objectContaining({ uri: `file://${dir}/a.mp3`, mime: "audio/mpeg" }),
    ])
  })
})

describe("media enrich — WS onLine", () => {
  function makeMockConn() {
    const lineListeners = new Set<(line: string) => void>()
    const conn = {
      wire: {
        onLine(cb: (line: string) => void) {
          lineListeners.add(cb)
          return () => lineListeners.delete(cb)
        },
        write: vi.fn(),
      },
      capabilities: {},
      onFrame: vi.fn(() => () => {}),
      onCrash: vi.fn(() => () => {}),
      turn: { isBusy: vi.fn(), lastActivityAt: vi.fn(), onChange: vi.fn(() => () => {}) },
      close: vi.fn(),
      pid: 1,
    } as unknown as ProviderConnection
    return {
      conn,
      pushLine: (line: string) => {
        for (const cb of lineListeners) cb(line)
      },
    }
  }

  it("enriches params.update on session/update envelope, not JSON-RPC root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "media-ws-"))
    const mp3 = join(dir, "a.mp3")
    writeFileSync(mp3, "x")

    const { conn, pushLine } = makeMockConn()
    const sent: string[] = []
    const feWs = {
      send: vi.fn((data: string) => sent.push(data)),
      on: vi.fn(),
      close: vi.fn(),
      readyState: 1,
    } as unknown as WebSocket

    const connectionRegistry: ConnectionRegistry = {
      connect: vi.fn(),
      get: vi.fn(() => conn),
      getCwd: vi.fn(() => dir),
      getCharter: vi.fn(),
      consumeCharter: vi.fn(),
      getCliKind: vi.fn(),
      list: vi.fn(() => []),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      touchConnection: vi.fn(),
      clearAllConnections: vi.fn(),
      getConnectionCount: vi.fn(),
      isAttached: vi.fn(),
      getEpoch: vi.fn(),
      isOwnedByWs: vi.fn(),
      getRuntimeInfo: vi.fn(),
      getLastSeenAt: vi.fn(),
      listHttpConnectionIds: vi.fn(),
      close: vi.fn(),
      onCrash: vi.fn(() => () => {}),
      setWsSocketChecker: vi.fn(),
    }

    const { onConnect } = createAgentWsHandler({
      orchestrator: {} as never,
      connectionRegistry,
    })
    await onConnect(feWs, "agent-1")

    const envelope = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `![c](${mp3})` },
        },
      },
    }
    pushLine(JSON.stringify(envelope))

    expect(sent.length).toBeGreaterThan(0)
    const out = JSON.parse(sent[sent.length - 1]!.trim()) as {
      _meta?: unknown
      params?: { update?: { _meta?: Record<string, unknown> } }
    }
    expect(out._meta).toBeUndefined()
    const media = out.params?.update?._meta?.["_drive/media"] as Array<{ mime: string }> | undefined
    expect(media?.[0]?.mime).toBe("audio/mpeg")
  })

  it("two streamed chunks enrich params.update on the closing frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "media-ws-stream-"))
    const mp3 = join(dir, "preview-audio.mp3")
    writeFileSync(mp3, "x")

    const { conn, pushLine } = makeMockConn()
    const sent: string[] = []
    const feWs = {
      send: vi.fn((data: string) => sent.push(data)),
      on: vi.fn(),
      close: vi.fn(),
      readyState: 1,
    } as unknown as WebSocket

    const connectionRegistry: ConnectionRegistry = {
      connect: vi.fn(),
      get: vi.fn(() => conn),
      getCwd: vi.fn(() => dir),
      getCharter: vi.fn(),
      consumeCharter: vi.fn(),
      getCliKind: vi.fn(),
      list: vi.fn(() => []),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      touchConnection: vi.fn(),
      clearAllConnections: vi.fn(),
      getConnectionCount: vi.fn(),
      isAttached: vi.fn(),
      getEpoch: vi.fn(),
      isOwnedByWs: vi.fn(),
      getRuntimeInfo: vi.fn(),
      getLastSeenAt: vi.fn(),
      listHttpConnectionIds: vi.fn(),
      close: vi.fn(),
      onCrash: vi.fn(() => () => {}),
      setWsSocketChecker: vi.fn(),
    }

    const { onConnect } = createAgentWsHandler({
      orchestrator: {} as never,
      connectionRegistry,
    })
    await onConnect(feWs, "agent-1")

    const markdown = `![clip](${mp3})`
    for (const text of [markdown.slice(0, -"udio.mp3)".length), "udio.mp3)"]) {
      pushLine(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: "m1",
              content: { type: "text", text },
            },
          },
        }),
      )
    }

    await vi.waitFor(() => sent.length >= 2)
    const out = JSON.parse(sent[sent.length - 1]!.trim()) as {
      params?: { update?: { _meta?: Record<string, unknown>; content?: { text?: string } } }
    }
    const media = out.params?.update?._meta?.["_drive/media"] as Array<{ uri: string }> | undefined
    expect(media?.[0]?.uri).toBe(`file://${mp3}`)
    expect(out.params?.update?.content?.text).toBe("udio.mp3)")
  })

  it("parse failure sends original line", async () => {
    const { conn, pushLine } = makeMockConn()
    const sent: string[] = []
    const feWs = {
      send: vi.fn((data: string) => sent.push(data)),
      on: vi.fn(),
      close: vi.fn(),
      readyState: 1,
    } as unknown as WebSocket

    const connectionRegistry: ConnectionRegistry = {
      connect: vi.fn(),
      get: vi.fn(() => conn),
      getCwd: vi.fn(),
      getCharter: vi.fn(),
      consumeCharter: vi.fn(),
      getCliKind: vi.fn(),
      list: vi.fn(() => []),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      touchConnection: vi.fn(),
      clearAllConnections: vi.fn(),
      getConnectionCount: vi.fn(),
      isAttached: vi.fn(),
      getEpoch: vi.fn(),
      isOwnedByWs: vi.fn(),
      getRuntimeInfo: vi.fn(),
      getLastSeenAt: vi.fn(),
      listHttpConnectionIds: vi.fn(),
      close: vi.fn(),
      onCrash: vi.fn(() => () => {}),
      setWsSocketChecker: vi.fn(),
    }

    const { onConnect } = createAgentWsHandler({
      orchestrator: {} as never,
      connectionRegistry,
    })
    await onConnect(feWs, "agent-1")

    const bad = "{not json"
    pushLine(bad)
    expect(sent[sent.length - 1]).toBe(`${bad}\n`)
  })
})
