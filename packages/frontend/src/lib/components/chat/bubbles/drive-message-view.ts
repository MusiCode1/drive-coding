/**
 * drive-message-view.ts — pure display model over drive-message codec (slice agent-message-envelope-ui C0).
 */
import type { AgentPublic } from "@drive-coding/core"
import type {
  DriveMessageAgent,
  DriveMessageSystem,
} from "@drive-coding/core/acp/drive-message-envelope"
import { parseDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { SessionTransport } from "$lib/session/session-transport"
import { sessionPathWithTransport } from "$lib/session/session-url"

export type DriveMessageDeps = { agents: readonly AgentPublic[]; transport: SessionTransport }

/** displayName: nonempty envelope name → nonempty roleLabel → nonempty title → 8-char id + "…". */
export type DriveMessageParty = { id: string; displayName: string; fromId: boolean; href?: string }

export type DriveMessageView =
  | { kind: "plain" }
  | { kind: "invalid"; reason: "unknown-version" | "malformed" }
  | { kind: "agent"; message: DriveMessageAgent; sender: DriveMessageParty }
  | { kind: "system"; message: DriveMessageSystem; subject: DriveMessageParty }

function hasNonemptyTrim(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`
}

function nameFromRecord(record: AgentPublic): { displayName: string; fromId: boolean } {
  if (hasNonemptyTrim(record.roleLabel)) {
    return { displayName: record.roleLabel, fromId: false }
  }
  if (hasNonemptyTrim(record.title)) {
    return { displayName: record.title, fromId: false }
  }
  return { displayName: shortId(record.id), fromId: true }
}

function hrefForAgentId(
  agentId: string,
  agents: readonly AgentPublic[],
  transport: SessionTransport,
): string | undefined {
  const rec = agents.find((a) => a.id === agentId)
  if (!rec?.acpSessionId) return undefined
  if (rec.status === "closed" || rec.status === "crashed") return undefined
  return sessionPathWithTransport(rec.cliKind, rec.acpSessionId, transport)
}

function resolveParty(
  id: string,
  envelopeName: string | undefined,
  agents: readonly AgentPublic[],
  transport: SessionTransport,
): DriveMessageParty {
  const href = hrefForAgentId(id, agents, transport)
  if (hasNonemptyTrim(envelopeName)) {
    return { id, displayName: envelopeName, fromId: false, href }
  }
  const rec = agents.find((a) => a.id === id)
  if (rec) {
    const { displayName, fromId } = nameFromRecord(rec)
    return { id, displayName, fromId, href }
  }
  return { id, displayName: shortId(id), fromId: true, href }
}

export function driveMessageView(rawText: string, deps: DriveMessageDeps): DriveMessageView {
  const parsed = parseDriveMessage(rawText)
  if (parsed.isErr()) {
    const reason = parsed.error
    if (reason === "not-envelope") return { kind: "plain" }
    if (reason === "unknown-version") return { kind: "invalid", reason: "unknown-version" }
    return { kind: "invalid", reason: "malformed" }
  }
  const message = parsed.value
  if (message.source === "agent") {
    return {
      kind: "agent",
      message,
      sender: resolveParty(message.sender.id, message.sender.name, deps.agents, deps.transport),
    }
  }
  return {
    kind: "system",
    message,
    subject: resolveParty(
      message.subjectAgent.id,
      message.subjectAgent.name,
      deps.agents,
      deps.transport,
    ),
  }
}
