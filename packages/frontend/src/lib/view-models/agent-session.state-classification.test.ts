import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createInitialSessionState } from "@drive-coding/core/session"
import { describe, expect, it } from "vitest"
import { syncViewTurnError } from "./agent-session-view-sync"

const vmDir = fileURLToPath(new URL(".", import.meta.url))

const SESSION_SCOPED = new Set([
  "title",
  "titleManual",
  "availableCommands",
  "planStore",
  "contextUsage",
  "quota",
  "quotaLoading",
])

// #capabilities: the provider's capabilities — per agent, reset on a new connection
// (slice codex-voice-poc made it $state so consumers react when they arrive).
const AGENT_SCOPED = new Set(["turnStalled", "#capabilities", "agentNotes", "agentFields"])

// The active deletion notice intentionally survives detach so Home can show it.
const POST_DELETE_NOTICE = "promptCleanupFailed"
const CONNECTION_SCOPED = new Set(["sessions", "loading", "error"])

function extractStateFields(path: string): string[] {
  const text = readFileSync(path, "utf8")
  const re = /^\s*(#?[a-zA-Z][a-zA-Z0-9_]*)\s*=\s*\$state/gm
  return [...text.matchAll(re)].map((match) => match[1]).filter((name) => name !== undefined)
}

function pendingIn(file: string, classified: Set<string>): string[] {
  return extractStateFields(`${vmDir}/${file}`).filter((n) => !classified.has(n))
}

describe("agent-session $state classification gate", () => {
  const pending = [
    ...pendingIn(
      "agent-session.svelte.ts",
      new Set([...AGENT_SCOPED, "#session", "#sessionId", "sessionsCache", POST_DELETE_NOTICE]),
    ),
    ...pendingIn("session-scoped-state.svelte.ts", SESSION_SCOPED),
    ...pendingIn("sessions-cache-scope.svelte.ts", CONNECTION_SCOPED),
  ]

  it("every $state field is classified", () => {
    expect(pending.sort()).toEqual(
      [
        "#cliKind",
        "agentId",
        "authMethods",
        "bubbles",
        "configOptions",
        "cwd",
        "error",
        "historyEpoch",
        "isLoadingHistory",
        "lastUserMessage",
        "models",
        "modes",
        "pendingElicitation",
        "pendingPermission",
        "sessionState",
        "status",
        "turnState",
      ].sort(),
    )
    expect(PENDING_CAP).toBeGreaterThanOrEqual(pending.length)
  })

  it("PENDING only shrinks", () => {
    expect(PENDING_CAP).toBeLessThanOrEqual(23)
  })
})

/** Measured after sessions-cache-scope C2 — 19 fields remain unscoped in AgentSession holders. */
const PENDING_CAP = 19

it("clears an obsolete turn marker while preserving a distinct current banner", () => {
  const state = createInitialSessionState({ sessionId: "fixture" })
  const error = { error: null as string | null }
  let marker = syncViewTurnError(
    error,
    {
      ...state,
      lastTurnError: { message: "refusal", at: 1 },
    },
    null,
  )
  expect(marker).toBe("prompt failed: refusal")
  error.error = "different connection error"
  marker = syncViewTurnError(error, state, marker)
  expect(error.error).toBe("different connection error")
  expect(marker).toBeNull()
  error.error = "prompt failed: refusal"
  expect(error.error === marker).toBe(false)
})
