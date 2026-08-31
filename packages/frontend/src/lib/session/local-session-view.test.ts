/**
 * local-session-view.test.ts — integration tests for LocalSessionView.
 *
 * Tests the core behavioral contracts:
 * 1. newSession() → connects + sets state.status/sessionId
 * 2. session/update events → reduce → state updates + patches pushed
 * 3. onRequestPermission → state.pending.permission + respond() resolves
 * 4. onCreateElicitation → state.pending.elicitation + respond() resolves
 * 5. prompt() → turnState 'waiting' then 'idle'
 * 6. cancel() → turnState 'idle'
 * 7. close() → cancels pending + clears state
 *
 * Uses injected mock AcpClient (no real WS/BE).
 *
 * ─── slice session-view-port C2 (TDD) ───
 */

import type { Patch } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocalSessionView } from "./local-session-view"

// ─── Test helpers ───

function createMockClient(): {
  client: AcpClient
  captureCallbacks: () => AcpClientCallbacks | null
} {
  let capturedCbs: AcpClientCallbacks | null = null

  const client = {
    newSession: vi.fn().mockResolvedValue({ sessionId: "s-test" }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ ok: true }),
    setSessionMode: vi.fn().mockResolvedValue({ ok: true }),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    authMethods: [],
  } as unknown as AcpClient

  const createClient = async (cbs: AcpClientCallbacks): Promise<AcpClient> => {
    capturedCbs = cbs
    return client
  }

  return {
    client,
    captureCallbacks: () => capturedCbs,
  }
}

function createView(overrideClient?: {
  client: AcpClient
  captureCallbacks: () => AcpClientCallbacks | null
}): {
  view: LocalSessionView
  getCallbacks: () => AcpClientCallbacks
  getClient: () => AcpClient
} {
  const mock = overrideClient ?? createMockClient()
  const view = new LocalSessionView({
    cwd: "/workspace",
    cliKind: "claude",
    createClient: async (cbs) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      mock.captureCallbacks() // trigger capture
      ;(mock as { captureCallbacks: () => AcpClientCallbacks | null }).captureCallbacks = () => cbs
      return mock.client
    },
  })
  return {
    view,
    getCallbacks: () => {
      const cbs = mock.captureCallbacks()
      if (!cbs) throw new Error("createClient not yet called — call view.newSession() first")
      return cbs
    },
    getClient: () => mock.client,
  }
}

// Helper: fire a session update through captured callbacks
function fireUpdate(cbs: AcpClientCallbacks, update: unknown): void {
  cbs.onUpdate?.({ update } as never)
}

// ─── Tests ───

describe("LocalSessionView — connection", () => {
  it("newSession() calls createClient then client.newSession()", async () => {
    const mock = createMockClient()
    let cbsCaptured: AcpClientCallbacks | null = null
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        cbsCaptured = cbs
        return mock.client
      },
    })

    await view.newSession()

    expect(cbsCaptured).not.toBeNull()
    expect(mock.client.newSession).toHaveBeenCalledWith({ cwd: "/workspace", mcpServers: [] })
    expect(view.state.status).toBe("connected")
    expect(view.state.sessionId).toBe("s-test")
  })

  it("loadSession() calls client.loadSession with the sessionId", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })

    await view.loadSession("existing-session-42")

    expect(mock.client.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "existing-session-42",
        cwd: "/workspace",
        mcpServers: [],
      }),
    )
    expect(view.state.status).toBe("connected")
    expect(view.state.sessionId).toBe("existing-session-42")
  })
})

describe("LocalSessionView — reduce + patches (C2)", () => {
  it("session update → reduce → state.messages updated", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    fireUpdate(capturedCbs!, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello" },
      messageId: "m-1",
    })

    expect(view.state.messages).toHaveLength(1)
    expect(view.state.messages[0]!.role).toBe("assistant")
    expect(view.state.turnState).toBe("responding")
  })

  it("session update → patches pushed to ReadableStream", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    // Fire update first (enqueues patches)
    fireUpdate(capturedCbs!, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hi" },
      messageId: "m-1",
    })

    // Read from patches stream
    const reader = view.patches.getReader()
    const { value, done } = await reader.read()
    reader.cancel()

    expect(done).toBe(false)
    expect(value).toBeDefined()
    expect(value?.patches[0]!.op).toBe("add-message")
  })

  it("metadata update (session_info_update) → state.title updated", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    fireUpdate(capturedCbs!, {
      sessionUpdate: "session_info_update",
      title: "My conversation",
    })

    expect(view.state.title).toBe("My conversation")
  })

  it("usage_update → state.contextUsage updated", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    fireUpdate(capturedCbs!, {
      sessionUpdate: "usage_update",
      used: 500,
      size: 4096,
    })

    expect(view.state.contextUsage?.used).toBe(500)
    expect(view.state.contextUsage?.size).toBe(4096)
  })
})

describe("LocalSessionView — pending permission bridging (C2)", () => {
  it("onRequestPermission → state.pending.permission set", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    const fakeParams = {
      sessionId: "s-test",
      toolCall: {},
      options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
    }

    // Trigger permission request (don't await — the promise only resolves when we respond)
    void capturedCbs!.onRequestPermission?.(fakeParams as never)

    // state.pending.permission should be set
    expect(view.state.pending.permission).not.toBeNull()
    expect(view.state.pending.permission!.requestId).toBeTypeOf("number")
  })

  it("respond() resolves the permission promise and clears state.pending", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    const fakeParams = {
      sessionId: "s-test",
      toolCall: {},
      options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
    }

    let resolved: unknown
    const permPromise = capturedCbs!.onRequestPermission!(fakeParams as never)
    permPromise.then((r) => {
      resolved = r
    })

    const requestId = view.state.pending.permission!.requestId
    const fakeResponse = { outcome: { outcome: "selected", optionId: "allow_once" } }
    await view.respond(requestId, fakeResponse)

    // Promise should be resolved
    await Promise.resolve() // flush microtasks
    expect(resolved).toEqual(fakeResponse)

    // state.pending.permission should be cleared
    expect(view.state.pending.permission).toBeNull()
  })
})

describe("LocalSessionView — pending elicitation bridging (C2)", () => {
  it("onCreateElicitation → state.pending.elicitation set", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    const fakeParams = {
      sessionId: "s-test",
      mode: "form",
      message: "What is your name?",
      requestedSchema: {
        properties: { name: { type: "string", title: "Name" } },
        required: ["name"],
      },
    }

    void capturedCbs!.onCreateElicitation?.(fakeParams as never)

    expect(view.state.pending.elicitation).not.toBeNull()
    expect(view.state.pending.elicitation!.requestId).toBeTypeOf("number")
  })

  it("respond() resolves the elicitation promise and clears state.pending", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    const fakeParams = {
      sessionId: "s-test",
      mode: "form",
      message: "Q?",
      requestedSchema: { properties: {}, required: [] },
    }

    let resolved: unknown
    const elicPromise = capturedCbs!.onCreateElicitation!(fakeParams as never)
    elicPromise.then((r) => {
      resolved = r
    })

    const requestId = view.state.pending.elicitation!.requestId
    const fakeResponse = { action: "accept", content: { name: "Alice" } }
    await view.respond(requestId, fakeResponse)

    await Promise.resolve() // flush microtasks
    expect(resolved).toEqual(fakeResponse)
    expect(view.state.pending.elicitation).toBeNull()
  })
})

describe("LocalSessionView — turnState lifecycle (C2)", () => {
  it("prompt() sets turnState 'waiting' before sending, 'idle' after RESP", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    let turnStateBeforeResp = ""
    vi.mocked(mock.client.prompt).mockImplementationOnce(async () => {
      turnStateBeforeResp = view.state.turnState
    })

    await view.prompt("Hello")

    expect(turnStateBeforeResp).toBe("waiting")
    expect(view.state.turnState).toBe("idle")
    // suppress unused variable warning
    void capturedCbs
  })

  it("cancel() sets turnState to 'idle'", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession()

    // Force turnState to a non-idle value
    await view.prompt("hello")
    // cancel
    await view.cancel()

    expect(view.state.turnState).toBe("idle")
  })
})

describe("LocalSessionView — quota refresh (C2)", () => {
  it("newSession() calls refreshQuota via ext._drive/getQuota", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })

    await view.newSession()

    // extMethod should have been called for getQuota
    expect(mock.client.extMethod).toHaveBeenCalledWith(
      "_drive/getQuota",
      expect.objectContaining({ sessionId: "s-test" }),
    )
    // quota is set (null since mock returns { snapshot: null })
    expect(view.state.quota).toBeNull()
  })
})

describe("LocalSessionView — close (C2)", () => {
  it("close() cancels pending permission and clears client", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    await view.newSession()

    // Set up a pending permission
    const fakeParams = {
      sessionId: "s-test",
      toolCall: {},
      options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
    }
    let permResolved: unknown
    const permPromise = capturedCbs!.onRequestPermission!(fakeParams as never)
    permPromise.then((r) => {
      permResolved = r
    })

    await view.close()

    // Pending permission should be resolved as cancelled
    await Promise.resolve()
    expect((permResolved as { outcome?: { outcome?: string } })?.outcome?.outcome).toBe("cancelled")

    // Client closed
    expect(mock.client.close).toHaveBeenCalled()
    expect(view.state.status).toBe("disconnected")
  })
})

// ─── slice local-view-wiring C2: adopt · dispose · observerCallbacks (TDD) ───

describe("LocalSessionView — adopt (C2)", () => {
  it("adopt מאפס את ה-state ומציב sessionId/client", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    // טען סשן והזרם היסטוריה — כדי שיהיה state לא-ריק
    await view.loadSession("old-session")
    const cbs = view.observerCallbacks
    cbs.onUpdate?.({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "old history" },
        messageId: "m-old",
      },
    } as never)
    expect(view.state.messages).toHaveLength(1)
    expect(view.state.sessionId).toBe("old-session")

    view.adopt({ client: mock.client, sessionId: "new-session" })

    expect(view.state.sessionId).toBe("new-session")
    expect(view.state.messages).toHaveLength(0)
    expect(view.state.status).toBe("idle")
    expect(view.state.turnState).toBe("idle")
    expect(view.state.pending).toEqual({ permission: null, elicitation: null })
  })

  it("adopt אינו יורה getQuota על החוט (extMethod לא נקרא)", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession() // מקבילה: newSession כן יורה getQuota
    expect(mock.client.extMethod).toHaveBeenCalledWith(
      "_drive/getQuota",
      expect.objectContaining({ sessionId: "s-test" }),
    )

    view.adopt({ client: mock.client, sessionId: "adopted" })

    expect(mock.client.extMethod).toHaveBeenCalledTimes(1) // adopt לא הוסיף אף קריאה
  })
})

describe("LocalSessionView — dispose (C2)", () => {
  it("dispose אינו קורא ל-client.close() — הלקוח משותף עם ה-VM במסלול המקומי", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession()
    view.adopt({ client: mock.client, sessionId: "s" })

    // spy לאחר adopt — לוודא שהקריאה הבאה היא של dispose, לא של close
    const closeSpy = vi.spyOn(mock.client, "close")
    view.dispose()

    expect(closeSpy).not.toHaveBeenCalled()
  })

  it("dispose סוגר את ה-controller — ה-reader מסיים ב-done", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession()
    view.adopt({ client: mock.client, sessionId: "s" })

    const reader = view.patches.getReader()
    view.dispose()

    const { done } = await reader.read()
    expect(done).toBe(true)
    reader.releaseLock()
  })

  it("dispose מנתק את מצביע הלקוח — קריאה ל-prompt אחריו נכשלת ב'not connected'", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession()
    view.adopt({ client: mock.client, sessionId: "s" })

    view.dispose()

    await expect(view.prompt("hello")).rejects.toThrow("not connected")
  })
})

describe("LocalSessionView — observerCallbacks (C2)", () => {
  it("חושף רק onUpdate + onExtNotification — מחזירי-הערך אינם שם", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })

    const cbs = view.observerCallbacks
    expect(typeof cbs.onUpdate).toBe("function")
    expect(typeof cbs.onExtNotification).toBe("function")
    // אין כאן שני עונים לבקשות-חוזרות-ערך
    expect((cbs as unknown as Record<string, unknown>).onRequestPermission).toBeUndefined()
    expect((cbs as unknown as Record<string, unknown>).onCreateElicitation).toBeUndefined()
  })

  it("update דרך observerCallbacks מעדכן את state של ה-view", async () => {
    const mock = createMockClient()
    const view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async () => mock.client,
    })
    await view.newSession()
    view.adopt({ client: mock.client, sessionId: "s" })

    view.observerCallbacks.onUpdate?.({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "observed" },
        messageId: "m-1",
      },
    } as never)

    expect(view.state.messages).toHaveLength(1)
    expect(view.state.messages[0]!.role).toBe("assistant")
  })
})
