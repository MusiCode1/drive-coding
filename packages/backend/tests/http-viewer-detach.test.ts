/** Real spawned ACP → provider → SessionHost → registry → HTTP SSE/reply. */
import { fileURLToPath } from "node:url"
import { invalidateCache, stopWatching } from "@drive-coding/provider/config"
import type { WireFrame } from "@drive-coding/provider/connection"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { registerConnectionRoute } from "../src/session-host/http/connection.js"
import { registerSessionHostHttp } from "../src/session-host/http/index.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"

type Kind = "permission" | "elicitation"
const fixture = fileURLToPath(new URL("./fixtures/http-viewer-detach-acp.mjs", import.meta.url))
const cleanups: Array<() => Promise<void>> = []
const resultFor = (kind: Kind) =>
  kind === "permission"
    ? { outcome: { outcome: "selected", optionId: "allow" } }
    : { action: "accept", content: { answer: "yes" } }
const pause = () => new Promise((resolve) => setTimeout(resolve, 30))

async function setup(kind: Kind, legacy = false) {
  vi.stubEnv("CLI_SPECS_FILE", "/tmp/no-viewer-detach-cli-specs.jsonc")
  vi.stubEnv("CLI_SPECS_JSON", JSON.stringify({ cursor: { bin: "node", args: [fixture] } }))
  vi.stubEnv("AGENT_SIDECAR", "")
  invalidateCache()
  const connections = createConnectionRegistry()
  const agents = createInMemoryAgentRegistry()
  const agent = await agents.create({ cliKind: "cursor", cwd: "/tmp" })
  const registry = createAgentSessionRegistry({ connectionRegistry: connections })
  const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = []
  cleanups.push(async () => {
    registry.stop()
    registry.unregisterHost(agent.id)
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})))
    await registryHost?.dispose()
    const pid = connections.getRuntimeInfo(agent.id)?.pid
    await connections.close(agent.id)
    expect(connections.listHttpConnectionIds(agent.id)).toEqual([])
    expect(registry.getHost(agent.id)).toBeUndefined()
    if (pid) await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
  })
  let registryHost: ReturnType<typeof registry.getHost>
  const conn = await connections.connect(agent.id, "cursor", {
    cwd: "/tmp",
    shapeEnv: (_kind, env) => ({
      ...env,
      DC_FIXTURE_PENDING_KIND: kind,
      DC_FIXTURE_LEGACY_METHODS: legacy ? "1" : "0",
    }),
  })
  const frames: WireFrame[] = []
  const unsub = conn.onFrame((frame) => frames.push(frame))
  cleanups.push(async () => {
    unsub()
  })
  const hostResult = await registry.getOrCreateHost(agent.id)
  if (!hostResult.ok) throw new Error(hostResult.reason)
  registryHost = hostResult.entry.host
  const host = registryHost
  const app = new Hono()
  registerSessionHostHttp(app, {
    agentSessionRegistry: registry,
    connectionRegistry: connections,
    agentRegistry: agents,
  })
  registerConnectionRoute(app, connections)
  setSelfBaseUrlForTests("http://127.0.0.1:4055")
  const request = (path: string, init?: RequestInit) =>
    app.request(`/api/agents/${agent.id}${path}`, init)
  async function viewer(id: string) {
    const response = await request("/events", { headers: { "Acp-Connection-Id": id } })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    readers.push(reader)
    let text = ""
    return {
      reader,
      get text() {
        return text
      },
      async until(fragment: string) {
        await vi.waitFor(
          async () => {
            if (text.includes(fragment)) return
            const next = await reader.read()
            if (next.done) throw new Error(`SSE closed before ${fragment}: ${text}`)
            text += new TextDecoder().decode(next.value)
            expect(text).toContain(fragment)
          },
          { timeout: 3000 },
        )
      },
    }
  }
  const prompt = () =>
    request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "session/prompt",
        params: { sessionId: host.state.sessionId, content: "wait for input" },
      }),
    })
  const reply = (viewerId: string, requestId: number) =>
    request("/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Acp-Connection-Id": viewerId },
      body: JSON.stringify({ kind, requestId, result: resultFor(kind) }),
    })
  return { connections, registry, agent, conn, host, frames, request, viewer, prompt, reply }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  setSelfBaseUrlForTests(undefined)
  vi.unstubAllEnvs()
  invalidateCache()
  stopWatching()
})

describe("HTTP viewer detach with a real ACP process", () => {
  // Negative wire control: the previously committed method names must actually
  // not enter the pending handler. Unknown extension methods return {} here.
  it.each(["permission", "elicitation"] as const)(
    "legacy %s wire method does not create pending",
    async (kind) => {
      const t = await setup(kind, true)
      expect((await t.prompt()).status).toBe(202)
      await vi.waitFor(() =>
        expect(
          t.frames.some(
            (f) => f.dir === "out" && f.raw.includes('"id":7001') && f.raw.includes('"result":{}'),
          ),
        ).toBe(true),
      )
      expect(t.host.state.pending[kind]).toBeNull()
      expect(t.frames.filter((f) => f.dir === "in" && f.raw.includes('"stopReason"'))).toHaveLength(
        0,
      )
    },
  )

  for (const lastViewer of [false, true]) {
    it.each(["permission", "elicitation"] as const)(
      `${lastViewer ? "last A detaches, C reconnects" : "A+B, A detaches, B continues"}: %s survives and completes once`,
      async (kind) => {
        const t = await setup(kind)
        const pid = t.connections.getRuntimeInfo(t.agent.id)?.pid
        expect(pid).toBeGreaterThan(0)
        process.kill(pid!, 0)
        const a = await t.viewer("viewer-a")
        await a.until("event: snapshot")
        const b = lastViewer ? undefined : await t.viewer("viewer-b")
        if (b) await b.until("event: snapshot")
        expect((await t.prompt()).status).toBe(202)
        await vi.waitFor(() => expect(t.host.state.pending[kind]).not.toBeNull())
        const pending = t.host.state.pending[kind]!
        await a.until(`"requestId":${pending.requestId}`)
        if (b) await b.until(`"requestId":${pending.requestId}`)
        expect(
          t.connections
            .listHttpConnectionIds(t.agent.id)
            .map((r) => r.connectionId)
            .sort(),
        ).toEqual(lastViewer ? ["viewer-a"] : ["viewer-a", "viewer-b"])
        // A response for another request cannot settle the held prompt.
        t.conn.wire.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 99999, result: resultFor(kind) })}\n`,
        )
        await pause()
        expect(t.host.state.pending[kind]).toBe(pending)
        t.conn.wire.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 7001, result: { wrong: true } })}\n`,
        )
        await pause()
        expect(t.host.state.pending[kind]).toBe(pending)
        const hostIdentity = JSON.parse(
          a.text
            .split("\n")
            .find((line) => line.startsWith("data: "))!
            .slice(6),
        ) as { hostIncarnation: string; sessionId: string }
        expect(hostIdentity.hostIncarnation).toBeTypeOf("string")
        const beforeDetach = a.text
        await a.reader.cancel()
        expect(await a.reader.read()).toEqual({ done: true, value: undefined })
        expect(
          (
            await t.request("/connection", {
              method: "DELETE",
              headers: { "Acp-Connection-Id": "viewer-a" },
            })
          ).status,
        ).toBe(204)
        await vi.waitFor(() =>
          expect(
            t.connections.listHttpConnectionIds(t.agent.id).map((r) => r.connectionId),
          ).toEqual(lastViewer ? [] : ["viewer-b"]),
        )
        expect(t.registry.getHost(t.agent.id)).toBe(t.host)
        expect(t.connections.getRuntimeInfo(t.agent.id)?.pid).toBe(pid)
        process.kill(pid!, 0)
        expect(t.host.state.pending[kind]).toBe(pending)
        expect(t.host.state.turnState).not.toBe("idle")
        expect(
          t.frames.filter((f) => f.dir === "in" && f.raw.includes('"stopReason"')),
        ).toHaveLength(0)
        const answeringViewer = b ?? (await t.viewer("viewer-c"))
        if (!b) await answeringViewer.until(`"requestId":${pending.requestId}`)
        expect(answeringViewer.text).toContain(hostIdentity.hostIncarnation)
        expect(answeringViewer.text).toContain(hostIdentity.sessionId)
        expect(t.host.state.pending[kind]).toBe(pending)
        const id = b ? "viewer-b" : "viewer-c"
        expect((await t.reply(id, pending.requestId)).status).toBe(200)
        await answeringViewer.until("done:")
        await vi.waitFor(() => expect(t.host.state.turnState).toBe("idle"))
        expect(t.host.state.pending[kind]).toBeNull()
        const requestFrame = t.frames.find(
          (f) =>
            f.dir === "in" &&
            f.raw.includes(
              kind === "permission"
                ? '"method":"session/request_permission"'
                : '"method":"elicitation/create"',
            ),
        )!
        const wireId = (JSON.parse(requestFrame.raw) as { id: number }).id
        const wireReplies = t.frames.filter(
          (f) => f.dir === "out" && (JSON.parse(f.raw) as { id?: number }).id === wireId,
        )
        expect(wireReplies).toHaveLength(2)
        expect(JSON.parse(wireReplies[0]!.raw)).toMatchObject({ result: { wrong: true } })
        expect(JSON.parse(wireReplies[1]!.raw)).toMatchObject({ result: resultFor(kind) })
        const completions = () =>
          t.frames.filter((f) => f.dir === "in" && f.raw.includes('"stopReason"'))
        expect(completions()).toHaveLength(1)
        // The fixture acknowledges the exact response, from its actual PID.
        expect(answeringViewer.text).toContain(`pid=${pid}`)
        expect(answeringViewer.text).toContain("completions=1")
        await t.reply(id, pending.requestId)
        await pause()
        expect(completions()).toHaveLength(1)
        expect(
          t.frames.filter(
            (f) =>
              f.dir === "in" &&
              (JSON.parse(f.raw) as { id?: number }).id === wireId &&
              !f.raw.includes('"method"'),
          ),
        ).toEqual([])
        expect(a.text).toBe(beforeDetach)
        expect(await a.reader.read()).toEqual({ done: true, value: undefined })
        expect(t.registry.getHost(t.agent.id)).toBe(t.host)
      },
    )
  }
})
