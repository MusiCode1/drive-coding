import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const vmDir = fileURLToPath(new URL(".", import.meta.url))

const SESSION_SCOPED = new Set([
  // session-scoped-state.svelte.ts
  "title",
  "titleManual",
  "userNotes",
  "sessionFields",
  "availableCommands",
  "planStore",
  "contextUsage",
  "quota",
  "quotaLoading",
  // AgentSession holder
  "#session",
])

const AGENT_SCOPED = new Set(["turnStalled"])

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

describe("agent-session $state classification gate", () => {
  const agentFields = extractStateFields(`${vmDir}/agent-session.svelte.ts`)
  const scopeFields = extractStateFields(`${vmDir}/session-scoped-state.svelte.ts`)
  const allFields = [...agentFields, ...scopeFields]

  it("every $state field is classified", () => {
    const pending = allFields.filter((name) => !SESSION_SCOPED.has(name) && !AGENT_SCOPED.has(name))
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
        "sessions",
        "sessionsError",
        "sessionsLoading",
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

/** Measured after C1 on this slice — 22 fields remain unscoped in AgentSession. */
const PENDING_CAP = 22
