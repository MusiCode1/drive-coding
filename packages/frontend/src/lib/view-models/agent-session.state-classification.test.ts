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

const AGENT_SCOPED = new Set(["turnStalled"])

const CONNECTION_SCOPED = new Set(["sessions", "loading", "error"])

function extractStateFields(path: string): string[] {
  const text = readFileSync(path, "utf8")
  const re = /^\s*(#?[a-zA-Z][a-zA-Z0-9_]*)\s*=\s*\$state/gm
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) names.push(m[1])
  }
  return names
}

function pendingIn(file: string, classified: Set<string>): string[] {
  return extractStateFields(`${vmDir}/${file}`).filter((n) => !classified.has(n))
}

describe("agent-session $state classification gate", () => {
  const pending = [
    ...pendingIn(
      "agent-session.svelte.ts",
      new Set([...AGENT_SCOPED, "#session", "sessionsCache"]),
    ),
    ...pendingIn("session-scoped-state.svelte.ts", SESSION_SCOPED),
    ...pendingIn("sessions-cache-scope.svelte.ts", CONNECTION_SCOPED),
  ]

  it("every $state field is classified", () => {
    expect(pending.sort()).toEqual(
      [
        "#cliKind",
        "#displaySnapshot",
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

/** Measured after sessions-cache-scope C2 — 19 fields remain unscoped in AgentSession holders. */
const PENDING_CAP = 19
