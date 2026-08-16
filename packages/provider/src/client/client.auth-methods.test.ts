/**
 * client.auth-methods.test.ts — TDD: expose `client.authMethods` on the AcpClient facade
 * (captured from `initialize`), and attach `authMethods` to the auth_required error object
 * (replaces the previous hardcoded `<cli>` string — see client.ts throw-sites).
 *
 *
 * Tests (per brief):
 *   1. initResult with authMethods → client.authMethods returns them (roundtrip, incl. type field)
 *   2. authMethods empty (claude-like) → client.authMethods === []
 *   3. warm-reattach (createAttachedAcpClient) → client.authMethods === [] (no initialize call)
 *   4. throw-site 1 (initialize itself rejects auth_required) → error carries authMethods: []
 *      (initResult never assigned there — must NOT reference initResult.authMethods, TS2454)
 *   5. throw-site 2 (authenticate rejects auth_required) → error carries authMethods from initialize
 *   6. regression: non-fatal authenticate rejection (opencode -32603) still does not throw
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAcpClient, createAttachedAcpClient } from "./client.js"

// ─── transport double — auto-responds to "initialize" and "authenticate" ─────

type WrittenMessage = {
  jsonrpc: "2.0"
  id?: number
  method?: string
  params?: unknown
}

function makeTransport(opts: {
  authMethods?: ReadonlyArray<{ id: string; name: string; type?: string }>
  initializeBehavior?: "success" | "reject-auth-required"
  authenticateBehavior?: "success" | "reject-auth-required" | "reject-not-implemented"
}) {
  const writtenMessages: WrittenMessage[] = []
  const dec = new TextDecoder()
  const enc = new TextEncoder()

  let pushIn!: (obj: unknown) => void
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      pushIn = (obj) => c.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
    },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = dec.decode(chunk).trim()
      if (!text) return
      const msg = JSON.parse(text) as WrittenMessage
      writtenMessages.push(msg)

      if (msg.method === "initialize") {
        if (opts.initializeBehavior === "reject-auth-required") {
          pushIn({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32000,
              message: "auth required (mock)",
              data: { code: "auth_required" },
            },
          })
          return
        }
        pushIn({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            authMethods: opts.authMethods ?? [],
          },
        })
      } else if (msg.method === "authenticate") {
        if (opts.authenticateBehavior === "reject-auth-required") {
          pushIn({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32000,
              message: "auth failed (mock)",
              data: { code: "auth_required" },
            },
          })
        } else if (opts.authenticateBehavior === "reject-not-implemented") {
          pushIn({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32603,
              message: "Internal error",
              data: { details: "Authentication not implemented" },
            },
          })
        } else {
          pushIn({ jsonrpc: "2.0", id: msg.id, result: {} })
        }
      }
    },
  })

  let closed = false
  const transport: AcpTransport = {
    readable,
    writable,
    close() {
      closed = true
    },
    onClose(_cb) {},
  }

  return { transport, writtenMessages, isClosed: () => closed }
}

// ─── transport double — no responder (for warm-reattach: no initialize expected) ──

function makeSilentTransport() {
  const writable = new WritableStream<Uint8Array>({ write() {} })
  const readable = new ReadableStream<Uint8Array>({ start() {} })
  const transport: AcpTransport = {
    readable,
    writable,
    close() {},
    onClose(_cb) {},
  }
  return transport
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("AcpClient.authMethods — captured from initialize, exposed on facade", () => {
  it("1. initResult with authMethods → client.authMethods returns them (roundtrip incl. type)", async () => {
    const methods = [
      { id: "oauth-personal", name: "Log in with Google" },
      { id: "gemini-api-key", name: "Gemini API Key", type: "env_var" },
    ]
    const { transport } = makeTransport({ authMethods: methods })

    const client = await createAcpClient(transport, () => {})

    expect(client.authMethods).toEqual(methods)
  })

  it("2. empty authMethods (claude-like) → client.authMethods === []", async () => {
    const { transport } = makeTransport({ authMethods: [] })

    const client = await createAcpClient(transport, () => {})

    expect(client.authMethods).toEqual([])
  })

  it("3. warm-reattach (createAttachedAcpClient) → client.authMethods === [] (no initialize call)", () => {
    const transport = makeSilentTransport()

    const client = createAttachedAcpClient(transport, () => {})

    expect(client.authMethods).toEqual([])
  })

  it("4. throw-site 1: initialize itself rejects auth_required → error carries authMethods: []", async () => {
    const { transport, isClosed } = makeTransport({ initializeBehavior: "reject-auth-required" })

    let caught: (Error & { kind?: string; authMethods?: unknown }) | undefined
    try {
      await createAcpClient(transport, () => {})
    } catch (e) {
      caught = e as Error & { kind?: string; authMethods?: unknown }
    }

    expect(caught).toBeDefined()
    expect(caught?.kind).toBe("auth_required")
    expect(caught?.authMethods).toEqual([])
    expect(isClosed()).toBe(true)
  })

  it("5. throw-site 2: authenticate rejects auth_required → error carries authMethods from initialize", async () => {
    const { transport, isClosed } = makeTransport({
      authMethods: [{ id: "cursor_login", name: "Cursor" }],
      authenticateBehavior: "reject-auth-required",
    })

    let caught: (Error & { kind?: string; authMethods?: unknown }) | undefined
    try {
      await createAcpClient(transport, () => {})
    } catch (e) {
      caught = e as Error & { kind?: string; authMethods?: unknown }
    }

    expect(caught).toBeDefined()
    expect(caught?.kind).toBe("auth_required")
    expect(caught?.authMethods).toEqual([{ id: "cursor_login", name: "Cursor" }])
    expect(isClosed()).toBe(true)
  })

  it("6. regression: opencode-style non-fatal authenticate rejection still does not throw", async () => {
    const { transport } = makeTransport({
      authMethods: [{ id: "opencode-login", name: "opencode login" }],
      authenticateBehavior: "reject-not-implemented",
    })

    const client = await createAcpClient(transport, () => {})

    expect(client).toBeDefined()
    expect(client.authMethods).toEqual([{ id: "opencode-login", name: "opencode login" }])
  })
})
