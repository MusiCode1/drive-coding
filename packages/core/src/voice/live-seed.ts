/**
 * live-seed.ts — build conversation seed from bubbles snapshot (pure, no IO).
 *
 * Slice: live-context, Commit 0.
 * Caller wraps each turn in role:"user" before silent context injection.
 */

export type LiveSeedBubble = {
  kind: "user" | "assistant" | "tool" | "status"
  text: string
  turnIndex: number
}

export type LiveSeedLabels = {
  toolRan: (name: string) => string
  toolFailed: (name: string) => string
  permissionPending: string
  agentRunning: string
  agentIdle: string
}

export type LiveSeedInput = {
  bubbles: readonly LiveSeedBubble[]
  turnState: "idle" | "running" | "awaiting-permission"
  pendingPermission: { toolName: string } | null
  lastUserMessage: string | null
  /** Default 4 (§F.6 range 3–5). */
  maxTurns?: number
  maxChars?: number
}

export type LiveSeed = {
  /** Ready for injection. Caller wraps in role:"user". */
  turns: readonly { text: string }[]
  charCount: number
}

const DEFAULT_MAX_TURNS = 4

function bubbleToText(bubble: LiveSeedBubble, labels: LiveSeedLabels): string {
  switch (bubble.kind) {
    case "user":
    case "assistant":
      return bubble.text
    case "tool": {
      const raw = bubble.text.trim()
      if (raw.startsWith("!")) {
        return labels.toolFailed(raw.slice(1).trim())
      }
      return labels.toolRan(raw)
    }
    case "status":
      return bubble.text
  }
}

function turnStateLine(
  turnState: LiveSeedInput["turnState"],
  labels: LiveSeedLabels,
): string | null {
  switch (turnState) {
    case "idle":
      return labels.agentIdle
    case "running":
      return labels.agentRunning
    case "awaiting-permission":
      return labels.permissionPending
  }
}

function totalChars(turns: readonly { text: string }[]): number {
  return turns.reduce((sum, t) => sum + t.text.length, 0)
}

export function buildLiveSeed(input: LiveSeedInput, labels: LiveSeedLabels): LiveSeed {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS

  let turns: { text: string }[] = input.bubbles.map((b) => ({
    text: bubbleToText(b, labels),
  }))

  const lastBubble = input.bubbles[input.bubbles.length - 1]
  const lastUserInBubbles = lastBubble?.kind === "user" ? lastBubble.text : undefined
  if (
    input.lastUserMessage !== null &&
    input.lastUserMessage.length > 0 &&
    input.lastUserMessage !== lastUserInBubbles
  ) {
    turns.push({ text: input.lastUserMessage })
  }

  const stateLine = turnStateLine(input.turnState, labels)
  if (stateLine !== null && input.turnState !== "idle") {
    turns.push({ text: stateLine })
  }

  if (turns.length > maxTurns) {
    turns = turns.slice(turns.length - maxTurns)
  }

  if (input.maxChars !== undefined && input.maxChars >= 0) {
    while (turns.length > 1 && totalChars(turns) > input.maxChars) {
      turns.shift()
    }
    const lone = turns[0]
    if (turns.length === 1 && lone !== undefined && lone.text.length > input.maxChars) {
      turns = [{ text: lone.text.slice(-input.maxChars) }]
    }
  }

  return { turns, charCount: totalChars(turns) }
}
