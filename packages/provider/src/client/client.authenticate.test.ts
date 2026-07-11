/**
 * client.authenticate.test.ts — TDD: generic ACP `authenticate` after `initialize`,
 * with a PREFERRED-list priority: cached_token (grok) > grok.com (grok) > cursor_login (cursor),
 * fallback to the first offered authMethod otherwise. No authenticate call when
 * authMethods is empty/missing (opencode/gemini/qoder/claude/codex must not break).
 *
 * slice-cursor-acp Commit 1 — ר' docs/plans/slice-cursor-acp.md §4 Commit 1.
 *
 * Tests (per brief, mock transport):
 *   1. authMethods: [{ id: "cached_token" }] → authenticate sent with methodId "cached_token"
 *   2. authMethods: [{ id: "cursor_login" }] → authenticate sent with methodId "cursor_login"
 *   3. authMethods: [] / missing → NO authenticate frame
 *   4. [{ id: "other_login" }] (not in PREFERRED) → fallback to first
 *   5. regression: initialize still sent with protocolVersion: 1
 *   6. opencode-regression: authenticate rejects with -32603 "not implemented" (no data.code
 *      "auth_required") → createAcpClient does NOT throw, finishes successfully.
 *   7. real auth_required: authenticate rejects with data.code === "auth_required" → throws
 *      with kind "auth_required" and closes transport.
 *   + priority ordering: PREFERRED wins over array order
 *   + resolveAuthMethodId pure-function coverage (priority + fallback + empty)
 *
 * תוקן אחרי calev phase-verification NO-GO (2026-07-11) — ר' docs/plans/slice-cursor-acp.md
 * §4 Commit 1 (🔴) ו-reports/drive-coding/cursor-acp-calev.md. opencode מכריז authMethods
 * לא-ריק אבל לא מיישם authenticate RPC בפועל — היה שובר את opencode בפועל.
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAcpClient, resolveAuthMethodId } from "./client.js"

// ─── transport double — auto-responds to "initialize" and "authenticate" ─────

type WrittenMessage = {
  jsonrpc: "2.0"
  id?: number
  method?: string
  params?: unknown
}

/**
 * In-memory AcpTransport double that behaves like a real ACP agent for the
 * two frames this slice cares about:
 *   - "initialize"   → responds with { protocolVersion, agentCapabilities, authMethods }
 *   - "authenticate" → responds with {} (success) or a JSON-RPC error (reject)
 * Any other written frame is recorded but not answered (tests here don't need it).
 */
function makeAutoRespondTransport(opts: {
  authMethods?: ReadonlyArray<{ id: string }>
  /**
   * "reject-auth-required" → error עם data.code === "auth_required" (פאטלי, כמו קודם).
   * "reject-not-implemented" → error -32603 בלי data.code === "auth_required" (מדמה opencode;
   *   לא-פאטלי אחרי התיקון).
   */
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
          // מדמה opencode חי: -32603, בלי data.code === "auth_required".
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

  return {
    transport,
    writtenMessages,
    isClosed: () => closed,
  }
}

// ─── integration: createAcpClient → authenticate round-trip ───────────────────

describe("createAcpClient — generic authenticate after initialize", () => {
  it('1. authMethods: [{id:"cached_token"}] → authenticate sent with methodId "cached_token"', async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({
      authMethods: [{ id: "cached_token" }],
    })

    await createAcpClient(transport, () => {})

    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame).toBeDefined()
    expect(authFrame?.params).toMatchObject({ methodId: "cached_token" })
  })

  it('2. authMethods: [{id:"cursor_login"}] → authenticate sent with methodId "cursor_login"', async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({
      authMethods: [{ id: "cursor_login" }],
    })

    await createAcpClient(transport, () => {})

    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame).toBeDefined()
    expect(authFrame?.params).toMatchObject({ methodId: "cursor_login" })
  })

  it("3. authMethods: [] → NO authenticate frame (regression guard, opencode/gemini/qoder/claude/codex)", async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({ authMethods: [] })

    await createAcpClient(transport, () => {})

    expect(writtenMessages.some((m) => m.method === "authenticate")).toBe(false)
  })

  it("3b. authMethods missing entirely → NO authenticate frame", async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({})

    await createAcpClient(transport, () => {})

    expect(writtenMessages.some((m) => m.method === "authenticate")).toBe(false)
  })

  it('4. [{id:"other_login"}] (not in PREFERRED) → fallback to first offered', async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({
      authMethods: [{ id: "other_login" }],
    })

    await createAcpClient(transport, () => {})

    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame).toBeDefined()
    expect(authFrame?.params).toMatchObject({ methodId: "other_login" })
  })

  it("priority ordering: PREFERRED wins over array position (cached_token before cursor_login)", async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({
      // cursor_login is FIRST in the array, but cached_token has higher PREFERRED priority.
      authMethods: [{ id: "cursor_login" }, { id: "cached_token" }],
    })

    await createAcpClient(transport, () => {})

    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame?.params).toMatchObject({ methodId: "cached_token" })
  })

  it("priority ordering: grok.com wins over cursor_login when cached_token absent", async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({
      authMethods: [{ id: "cursor_login" }, { id: "grok.com" }],
    })

    await createAcpClient(transport, () => {})

    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame?.params).toMatchObject({ methodId: "grok.com" })
  })

  it("5. regression: initialize still sent with protocolVersion: 1", async () => {
    const { transport, writtenMessages } = makeAutoRespondTransport({ authMethods: [] })

    await createAcpClient(transport, () => {})

    const initFrame = writtenMessages.find((m) => m.method === "initialize")
    expect(initFrame).toBeDefined()
    expect(initFrame?.params).toMatchObject({ protocolVersion: 1 })
  })

  it("6. opencode-regression: authenticate rejects with -32603 not-implemented (no data.code auth_required) → createAcpClient does NOT throw", async () => {
    const { transport, writtenMessages, isClosed } = makeAutoRespondTransport({
      authMethods: [{ id: "opencode-login" }],
      authenticateBehavior: "reject-not-implemented",
    })

    const client = await createAcpClient(transport, () => {})

    expect(client).toBeDefined()
    expect(isClosed()).toBe(false)
    const authFrame = writtenMessages.find((m) => m.method === "authenticate")
    expect(authFrame?.params).toMatchObject({ methodId: "opencode-login" })
  })

  it("7. real auth_required: authenticate rejects with data.code === auth_required → transport closed + error thrown with kind auth_required", async () => {
    const { transport, isClosed } = makeAutoRespondTransport({
      authMethods: [{ id: "cursor_login" }],
      authenticateBehavior: "reject-auth-required",
    })

    let caught: (Error & { kind?: string }) | undefined
    try {
      await createAcpClient(transport, () => {})
    } catch (e) {
      caught = e as Error & { kind?: string }
    }

    expect(caught).toBeDefined()
    expect(caught?.kind).toBe("auth_required")
    expect(isClosed()).toBe(true)
  })
})

// ─── unit: resolveAuthMethodId (pure function) ─────────────────────────────────

describe("resolveAuthMethodId — pure function", () => {
  it("returns undefined when authMethods is undefined", () => {
    expect(resolveAuthMethodId(undefined)).toBeUndefined()
  })

  it("returns undefined when authMethods is empty", () => {
    expect(resolveAuthMethodId([])).toBeUndefined()
  })

  it("picks cached_token first (highest priority)", () => {
    expect(
      resolveAuthMethodId([{ id: "cursor_login" }, { id: "grok.com" }, { id: "cached_token" }]),
    ).toBe("cached_token")
  })

  it("picks grok.com when cached_token absent", () => {
    expect(resolveAuthMethodId([{ id: "cursor_login" }, { id: "grok.com" }])).toBe("grok.com")
  })

  it("picks cursor_login when neither cached_token nor grok.com present", () => {
    expect(resolveAuthMethodId([{ id: "other_login" }, { id: "cursor_login" }])).toBe(
      "cursor_login",
    )
  })

  it("falls back to first offered when none match PREFERRED", () => {
    expect(resolveAuthMethodId([{ id: "xai.api_key" }, { id: "other_login" }])).toBe(
      "xai.api_key",
    )
  })
})
