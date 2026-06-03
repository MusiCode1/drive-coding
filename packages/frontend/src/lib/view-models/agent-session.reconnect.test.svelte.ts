/**
 * agent-session.reconnect.test.svelte.ts — unit tests לתשתית reconnect של AgentSession.
 *
 * סיומת `.test.svelte.ts` נדרשת כדי ש-vitest-svelte-preprocessor יעבד $state.
 * דפוס: settings.test.svelte.ts, wake-word.test.svelte.ts.
 *
 * Commit 0 — state + cliKind + visibility:
 *   1. reconnectAttempt ברירת מחדל = 0
 *   2. status מקבל "disconnected" (union typecheck + runtime)
 *   3. reconnectAttempt מתעדכן ל-$state
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// mock adapters שנדרשים ע"י AgentSession (נייבא מ-import עמוק)
vi.mock("../adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifySessionAttached: vi.fn(),
  listAgents: vi.fn(),
}))

vi.mock("../adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("AgentSession — reconnect state infrastructure (Commit 0)", () => {
  test("reconnectAttempt defaults to 0", () => {
    const session = new AgentSession()
    expect(session.reconnectAttempt).toBe(0)
  })

  test('status union accepts "disconnected"', () => {
    const session = new AgentSession()
    // יש לאמת שה-type מאפשר "disconnected" בزمן ריצה
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("disconnected")
    expect(session.status).toBe("disconnected")
  })

  test("reconnectAttempt can be updated", () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setReconnectAttemptForTest(3)
    expect(session.reconnectAttempt).toBe(3)
  })

  test("visibilitychange listener does not crash in node (no document)", () => {
    // וידוא שה-constructor לא זורק כשה-document לא קיים (node environment)
    expect(() => new AgentSession()).not.toThrow()
  })

  test("visibilitychange listener works when document is available", () => {
    // stub document
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
    })
    const session = new AgentSession()
    // #pageHidden צריך להיות false (document.hidden = false)
    // לא ניתן לגשת ל-private ישירות, אבל ה-constructor צריך לרוץ בלי שגיאה
    expect(session.reconnectAttempt).toBe(0)
  })
})
