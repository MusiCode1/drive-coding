/**
 * map-acp-notification.test.ts — טסטים פר-variant ל-mapAcpNotification (P1b/Commit 1).
 *
 * ⚠️ fixtures ב-packages/frontend/static/fixtures/*.json הם { loadResult, updates:[...] }.
 * כל element ב-.updates הוא bare `update` object (לא SessionNotification). לכן עוטפים
 * { update: up } as SessionNotification — בדיוק כמו #loadMockSession:929. בלי העטיפה
 * n.update יהיה undefined → הכל raw.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "vitest"
import { mapAcpNotification } from "../../src/provider/map-acp-notification.js"

// ─── עזרי fixtures ────────────────────────────────────────────────
const FIXTURE_DIR = fileURLToPath(
  new URL("../../../frontend/static/fixtures/", import.meta.url),
)

function loadFixtureUpdates(name: string): unknown[] {
  const raw = readFileSync(`${FIXTURE_DIR}${name}.json`, "utf8")
  const data = JSON.parse(raw) as { updates: unknown[] }
  return data.updates
}

// עוטף bare update כ-SessionNotification (כמו #loadMockSession)
function wrap(update: unknown): SessionNotification {
  return { update } as unknown as SessionNotification
}

// מאתר את ה-update הראשון מסוג נתון בכל ה-fixtures
const ALL_FIXTURES = [
  "salary-attendance",
  "salary-prev",
  "greeting",
  "tool-spill",
  "mitm",
  "phone-tunnel",
]

function findUpdate(sessionUpdate: string): Record<string, unknown> {
  for (const name of ALL_FIXTURES) {
    for (const up of loadFixtureUpdates(name)) {
      if ((up as { sessionUpdate?: string }).sessionUpdate === sessionUpdate) {
        return up as Record<string, unknown>
      }
    }
  }
  throw new Error(`no fixture update found for sessionUpdate=${sessionUpdate}`)
}

describe("mapAcpNotification — text chunks", () => {
  test("agent_message_chunk → message.delta (assistant)", () => {
    const up = findUpdate("agent_message_chunk")
    const ev = mapAcpNotification(wrap(up))
    expect(ev).toEqual({
      type: "message.delta",
      role: "assistant",
      text: (up.content as { text: string }).text,
    })
  })

  test("agent_thought_chunk → thinking.delta", () => {
    const up = findUpdate("agent_thought_chunk")
    const ev = mapAcpNotification(wrap(up))
    expect(ev).toEqual({
      type: "thinking.delta",
      text: (up.content as { text: string }).text,
    })
  })

  test("user_message_chunk → raw (lossless replay; §9 #1)", () => {
    const up = findUpdate("user_message_chunk")
    const n = wrap(up)
    expect(mapAcpNotification(n)).toEqual({ type: "raw", provider: "acp", frame: n })
  })
})

describe("mapAcpNotification — tool calls", () => {
  test("tool_call → tool_call event (id/name/input/kind/status/locations)", () => {
    const up = findUpdate("tool_call")
    const ev = mapAcpNotification(wrap(up)) as Extract<
      ReturnType<typeof mapAcpNotification>,
      { type: "tool_call" }
    >
    expect(ev?.type).toBe("tool_call")
    expect(ev?.id).toBe(up.toolCallId)
    // name = kind ?? title ?? "tool" (1:1 מ-#handleToolCall:1017)
    expect(ev?.name).toBe(up.kind ?? up.title ?? "tool")
    expect(ev?.input).toEqual(up.rawInput ?? {})
    expect(ev?.status).toBe(up.status ?? "pending")
    expect(Array.isArray(ev?.locations)).toBe(true)
  })

  test("tool_call_update → tool_call event with status + content from update.content", () => {
    const up = findUpdate("tool_call_update")
    const ev = mapAcpNotification(wrap(up)) as Extract<
      ReturnType<typeof mapAcpNotification>,
      { type: "tool_call" }
    >
    expect(ev?.type).toBe("tool_call")
    expect(ev?.id).toBe(up.toolCallId)
    expect(ev?.status).toBe(up.status ?? "pending")
    // content מ-update.content (לא rawOutput). discriminant ACP {type:"content"} → קנוני {kind:"text"}
    if (Array.isArray(up.content) && up.content.length > 0) {
      expect(ev?.content?.[0]).toMatchObject({ kind: "text" })
    }
  })

  test("mapStatus: status חסר → 'pending' (ACP אופציונלי; P1a status חובה)", () => {
    const ev = mapAcpNotification(
      wrap({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "read" }),
    ) as Extract<ReturnType<typeof mapAcpNotification>, { type: "tool_call" }>
    expect(ev?.status).toBe("pending")
  })

  test("classifyToolKind מופעל: kind='delete' → 'edit'", () => {
    const ev = mapAcpNotification(
      wrap({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "delete", status: "pending" }),
    ) as Extract<ReturnType<typeof mapAcpNotification>, { type: "tool_call" }>
    expect(ev?.kind).toBe("edit")
  })

  test("content text mapping: {type:'content',content:{type:'text',text}} → {kind:'text',text}", () => {
    const ev = mapAcpNotification(
      wrap({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "hi" } }],
      }),
    ) as Extract<ReturnType<typeof mapAcpNotification>, { type: "tool_call" }>
    expect(ev?.content).toEqual([{ kind: "text", text: "hi" }])
  })

  test("locations mapping: {path,line} נשמר; פריט בלי path מסונן", () => {
    const ev = mapAcpNotification(
      wrap({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        status: "pending",
        kind: "read",
        locations: [{ path: "/a.ts", line: 3 }, { line: 9 }],
      }),
    ) as Extract<ReturnType<typeof mapAcpNotification>, { type: "tool_call" }>
    expect(ev?.locations).toEqual([{ path: "/a.ts", line: 3 }])
  })
})

describe("mapAcpNotification — plan / usage", () => {
  test("plan → plan.update (entry.content→title, entry.status; priority נדחה)", () => {
    const up = findUpdate("plan")
    const ev = mapAcpNotification(wrap(up)) as Extract<
      ReturnType<typeof mapAcpNotification>,
      { type: "plan.update" }
    >
    expect(ev?.type).toBe("plan.update")
    const firstEntry = (up.entries as Array<{ content: string; status: string }>)[0]
    expect(ev?.entries[0]).toEqual({ title: firstEntry.content, status: firstEntry.status })
    // priority לא נשמר (אין שדה קנוני)
    expect(ev?.entries[0]).not.toHaveProperty("priority")
  })

  test("usage_update → usage (passthrough used/size/cost; cost=object)", () => {
    const up = findUpdate("usage_update")
    const ev = mapAcpNotification(wrap(up)) as Extract<
      ReturnType<typeof mapAcpNotification>,
      { type: "usage" }
    >
    expect(ev?.type).toBe("usage")
    expect(ev?.usage).toMatchObject({ used: up.used, size: up.size, cost: up.cost })
  })
})

describe("mapAcpNotification — raw fallback", () => {
  test("available_commands_update → raw (§9 #5)", () => {
    const up = findUpdate("available_commands_update")
    const n = wrap(up)
    expect(mapAcpNotification(n)).toEqual({ type: "raw", provider: "acp", frame: n })
  })

  test("variant לא מוכר → raw", () => {
    const n = wrap({ sessionUpdate: "some_future_thing", foo: 1 })
    expect(mapAcpNotification(n)).toEqual({ type: "raw", provider: "acp", frame: n })
  })

  test("update חסר → raw (הגנתי)", () => {
    const n = { update: undefined } as unknown as SessionNotification
    expect(mapAcpNotification(n)).toEqual({ type: "raw", provider: "acp", frame: n })
  })
})
