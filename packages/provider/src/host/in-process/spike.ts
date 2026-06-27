/**
 * spike.ts — in-process host POC for ClaudeAcpAgent
 *
 * Purpose: validate empirically that ClaudeAcpAgent can be hosted in-process
 * (instead of spawn-binary) and that we get ownership of AgentSideConnection → ext channel.
 *
 * Approach: Two candidate paths, in order.
 *   Path 1 — AgentApp.connect(ClientApp) from sdk@1.0.0 (built-in in-process, no transport)
 *   Path 2 — Duplex AnyMessage streams (in-memory pipe at the SDK message level)
 *
 * DoD constraint: initialize/handshake ONLY. No session/prompt (zero inference/tokens).
 *
 * @see docs/plans/slice-C3-spike-inprocess-host.md
 */

import { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import { agent, client, methods } from "acp-sdk-v1"
import type { AgentContext } from "acp-sdk-v1"

// ---------------------------------------------------------------------------
// Shared: client-side AcpClient adapter over AgentContext (mirrors acp-agent.js:255)
// ---------------------------------------------------------------------------

/**
 * Bridges ClaudeAcpAgent's AcpClient interface over the AgentContext
 * exposed by sdk@1.0.0 AgentApp.connect(). Mirrors the internal
 * ClientConnection class in acp-agent.js:255 that runAcp() uses.
 */
function makeAcpClientFromCtx(ctx: AgentContext) {
  return {
    sessionUpdate: (params: unknown) =>
      ctx.notify(methods.client.session.update, params as never),
    requestPermission: (params: unknown, signal?: AbortSignal) =>
      ctx.request(methods.client.session.requestPermission, params as never, {
        cancellationSignal: signal,
      }),
    readTextFile: (params: unknown) =>
      ctx.request(methods.client.fs.readTextFile, params as never),
    writeTextFile: (params: unknown) =>
      ctx.request(methods.client.fs.writeTextFile, params as never),
    unstable_createElicitation: (params: unknown, signal?: AbortSignal) =>
      ctx.request(methods.client.elicitation.create, params as never, {
        cancellationSignal: signal,
      }),
    unstable_completeElicitation: (params: unknown) =>
      ctx.notify(methods.client.elicitation.complete, params as never),
    extNotification: (method: string, params: Record<string, unknown>) =>
      ctx.notify(method, params as never),
  }
}

// ---------------------------------------------------------------------------
// PATH 1 — AgentApp.connect(ClientApp) [in-process, no transport]
// ---------------------------------------------------------------------------

async function tryPath1(): Promise<{
  ok: boolean
  result?: unknown
  error?: string
  extResult?: unknown
}> {
  console.log("[path-1] Trying AgentApp.connect(ClientApp) — sdk@1.0.0 in-process...")

  try {
    // Build AgentApp with same handlers as runAcp() but no connect(stream) yet
    let claudeAgent: ClaudeAcpAgent | undefined

    const agentApp = agent({ name: "claude-code-acp-spike-p1" })
      .onRequest(methods.agent.initialize, (ctx) => {
        if (!claudeAgent) throw new Error("claudeAgent not set yet")
        return claudeAgent.initialize(ctx.params)
      })
      .onRequest(methods.agent.session.new, (ctx) => {
        if (!claudeAgent) throw new Error("claudeAgent not set yet")
        return claudeAgent.newSession(ctx.params)
      })
      // ext: custom method to prove ext channel works
      .onRequest(
        "ext/spike/ping",
        { parse: (p: unknown) => p as { message: string } },
        (ctx) => {
          return { pong: ctx.params.message, ts: Date.now() }
        },
      )

    // Build ClientApp with handlers for client-side requests.
    // In a real host, these handle requestPermission, fs, etc.
    const clientApp = client({ name: "drive-coding-host-p1" })
      .onRequest(methods.client.session.requestPermission, (_ctx) => {
        // Cancel any permission request in POC — never reached during initialize
        return { outcome: { outcome: "cancelled" as const } }
      })
      .onNotification(methods.client.session.update, (_ctx) => {
        // No-op in initialize POC
      })
      .onRequest(methods.client.fs.readTextFile, (_ctx) => {
        return { content: "" }
      })
      .onRequest(methods.client.fs.writeTextFile, (_ctx) => {
        return {}
      })

    // Connect in-process — no transport, no IO
    const connection = agentApp.connect(clientApp)

    // Assign claudeAgent BEFORE any message processing (same as runAcp pattern)
    claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(connection.client))

    // Now drive the client side: connect ClientApp back to AgentApp
    let initResult: unknown
    let extResult: unknown

    await clientApp.connectWith(agentApp, async (ctx) => {
      // Initialize — handshake only, no session/prompt
      initResult = await ctx.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "drive-coding-spike", version: "0.0.0" },
      })

      // ext POC: call custom method to prove ext channel
      try {
        extResult = await ctx.request("ext/spike/ping", { message: "hello-from-spike" })
      } catch (e) {
        extResult = { error: String(e) }
      }
    })

    // Close the agent connection
    connection.close()

    return { ok: true, result: initResult, extResult }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ---------------------------------------------------------------------------
// PATH 2 — Duplex AnyMessage streams (in-memory, sdk@1.0.0 message level)
// ---------------------------------------------------------------------------

async function tryPath2(): Promise<{
  ok: boolean
  result?: unknown
  error?: string
  extResult?: unknown
}> {
  console.log("[path-2] Trying duplex AnyMessage streams (in-memory pipe)...")

  try {
    // Create two TransformStreams for the bidirectional pipe
    // agentToClient: agent writes here, client reads here
    // clientToAgent: client writes here, agent reads here
    const agentToClient = new TransformStream<unknown, unknown>()
    const clientToAgent = new TransformStream<unknown, unknown>()

    // Agent stream: reads from clientToAgent, writes to agentToClient
    const agentStream = {
      readable: clientToAgent.readable as ReadableStream<never>,
      writable: agentToClient.writable as WritableStream<never>,
    }
    // Client stream: reads from agentToClient, writes to clientToAgent
    const clientStream = {
      readable: agentToClient.readable as ReadableStream<never>,
      writable: clientToAgent.writable as WritableStream<never>,
    }

    let claudeAgent: ClaudeAcpAgent | undefined

    // Build AgentApp with same handlers pattern
    const agentApp = agent({ name: "claude-code-acp-spike-p2" })
      .onRequest(methods.agent.initialize, (ctx) => {
        if (!claudeAgent) throw new Error("claudeAgent not set yet")
        return claudeAgent.initialize(ctx.params)
      })
      .onRequest(methods.agent.session.new, (ctx) => {
        if (!claudeAgent) throw new Error("claudeAgent not set yet")
        return claudeAgent.newSession(ctx.params)
      })
      // ext: custom method to prove ext channel works
      .onRequest(
        "ext/spike/ping",
        { parse: (p: unknown) => p as { message: string } },
        (ctx) => {
          return { pong: ctx.params.message, ts: Date.now() }
        },
      )

    const clientApp = client({ name: "drive-coding-host-p2" })
      .onRequest(methods.client.session.requestPermission, (_ctx) => {
        return { outcome: { outcome: "cancelled" as const } }
      })
      .onNotification(methods.client.session.update, (_ctx) => {})
      .onRequest(methods.client.fs.readTextFile, (_ctx) => {
        return { content: "" }
      })
      .onRequest(methods.client.fs.writeTextFile, (_ctx) => {
        return {}
      })

    // Connect over streams
    const agentConnection = agentApp.connect(agentStream)
    claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(agentConnection.client))

    let initResult: unknown
    let extResult: unknown

    // Drive client side over the other stream
    await clientApp.connectWith(clientStream, async (ctx) => {
      initResult = await ctx.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "drive-coding-spike-p2", version: "0.0.0" },
      })

      try {
        extResult = await ctx.request("ext/spike/ping", { message: "hello-from-spike-p2" })
      } catch (e) {
        extResult = { error: String(e) }
      }
    })

    agentConnection.close()

    return { ok: true, result: initResult, extResult }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== C3-spike: in-process host POC ===")
  console.log("Goal: validate ClaudeAcpAgent can be hosted in-process (initialize only)")
  console.log("")

  // Try Path 1 first
  const p1 = await tryPath1()

  if (p1.ok) {
    console.log("")
    console.log("[path-1] SUCCESS")
    console.log("[path-1] initialize result:")
    console.log(JSON.stringify(p1.result, null, 2))
    console.log("[path-1] ext/spike/ping result:")
    console.log(JSON.stringify(p1.extResult, null, 2))
    console.log("")
    console.log("VERDICT: GO — Path 1 (AgentApp.connect(ClientApp)) works in-process")
    console.log("Frame: agentCapabilities._meta.claudeCode =",
      (p1.result as { agentCapabilities?: { _meta?: { claudeCode?: unknown } } })
        ?.agentCapabilities?._meta?.claudeCode)
    return
  }

  console.log(`[path-1] FAILED: ${p1.error}`)
  console.log("Trying Path 2 (duplex AnyMessage streams)...")
  console.log("")

  const p2 = await tryPath2()

  if (p2.ok) {
    console.log("")
    console.log("[path-2] SUCCESS")
    console.log("[path-2] initialize result:")
    console.log(JSON.stringify(p2.result, null, 2))
    console.log("[path-2] ext/spike/ping result:")
    console.log(JSON.stringify(p2.extResult, null, 2))
    console.log("")
    console.log("VERDICT: GO — Path 2 (duplex streams) works in-process")
    console.log("Frame: agentCapabilities._meta.claudeCode =",
      (p2.result as { agentCapabilities?: { _meta?: { claudeCode?: unknown } } })
        ?.agentCapabilities?._meta?.claudeCode)
    return
  }

  console.log(`[path-2] FAILED: ${p2.error}`)
  console.log("")
  console.log("VERDICT: NO-GO — All paths failed. See errors above.")
  console.log("Path 1 error:", p1.error)
  console.log("Path 2 error:", p2.error)
  process.exitCode = 1
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exitCode = 1
})
