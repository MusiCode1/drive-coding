import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const vmDir = fileURLToPath(new URL(".", import.meta.url))

const SESSION_SCOPED = new Set([
  "title",
  "titleManual",
  "userNotes",
  "sessionFields",
  "availableCommands",
  "planStore",
  "contextUsage",
  "quota",
  "quotaLoading",
])

const AGENT_SCOPED = new Set(["#errorScope"])

const TURN_WATCH_SCOPED = new Set(["stalled"])

const TRANSCRIPT_SCOPED = new Set(["#content", "#displaySnapshot", "#processingTarget"])

const CONNECTION_SCOPED = new Set(["sessions", "loading", "error"])

function extractStateFields(path: string): string[] {
  const text = readFileSync(path, "utf8")
  const re = /^\s*(#?[a-zA-Z][a-zA-Z0-9_]*)\s*=\s*\$state/gm
  const names: string[] = []
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) names.push(m[1])
  }
  return names
}

function pendingIn(file: string, classified: Set<string>): string[] {
  return extractStateFields(`${vmDir}/${file}`).filter((n) => !classified.has(n))
}

describe("agent-session $state classification gate", () => {
  const PENDING_UI_SCOPED = new Set(["pendingPermission", "pendingElicitation"])

  const pending = [
    ...pendingIn(
      "agent-session.svelte.ts",
      new Set([...AGENT_SCOPED, "#session", "sessionsCache"]),
    ),
    ...pendingIn("local-turn-watch-owner.svelte.ts", TURN_WATCH_SCOPED),
    ...pendingIn("pending-ui-scope.svelte.ts", PENDING_UI_SCOPED),
    ...pendingIn("session-scoped-state.svelte.ts", SESSION_SCOPED),
    ...pendingIn("sessions-cache-scope.svelte.ts", CONNECTION_SCOPED),
    ...pendingIn("transcript-scope.svelte.ts", TRANSCRIPT_SCOPED),
  ]

  it("every $state field is classified", () => {
    expect(pending.sort()).toEqual(
      [
        "#cliKind",
        "agentId",
        "authMethods",
        "configOptions",
        "cwd",
        "historyEpoch",
        "isLoadingHistory",
        "lastUserMessage",
        "models",
        "modes",
        "reconnectAttempt",
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

/** C2 transcript ownership + pending-ui-scope; 15 fields remain on AgentSession. */
const PENDING_CAP = 15
