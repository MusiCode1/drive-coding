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
])

const BUDGET_SCOPED = new Set(["contextUsage", "quota", "quotaLoading"])

const CONFIG_SCOPED = new Set(["configOptions", "models", "modes"])

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
    ...pendingIn("session-budget-owner.svelte.ts", BUDGET_SCOPED),
    ...pendingIn("session-config-owner.svelte.ts", CONFIG_SCOPED),
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
        "cwd",
        "historyEpoch",
        "isLoadingHistory",
        "lastUserMessage",
        "reconnectAttempt",
        "sessionState",
        "status",
        "turnState",
      ].sort(),
    )
    expect(PENDING_CAP).toBe(pending.length)
  })

  it("PENDING only shrinks", () => {
    expect(PENDING_CAP).toBeLessThanOrEqual(11)
  })

  it("budget $state lives on SessionBudgetOwner only", () => {
    const sessionScoped = readFileSync(`${vmDir}/session-scoped-state.svelte.ts`, "utf8")
    expect(sessionScoped).not.toMatch(/contextUsage\s*=\s*\$state/)
    expect(sessionScoped).not.toMatch(/quota\s*=\s*\$state/)
    expect(BUDGET_SCOPED.size).toBe(3)
  })

  it("config $state lives on SessionConfigOwner only", () => {
    const sessionScoped = readFileSync(`${vmDir}/session-scoped-state.svelte.ts`, "utf8")
    expect(sessionScoped).not.toMatch(/configOptions\s*=\s*\$state/)
    expect(sessionScoped).not.toMatch(/models\s*=\s*\$state/)
    expect(sessionScoped).not.toMatch(/modes\s*=\s*\$state/)
    expect(CONFIG_SCOPED.size).toBe(3)
  })
})

/** C2 transcript + config owner; 11 fields remain on AgentSession. */
const PENDING_CAP = 11
