import type { MessageKey } from "@drive-coding/core/i18n"
import type { FailedPrompt, failedPromptStore } from "$lib/adapters/failed-prompt-store"
import type { RecordTarget, RecordTargetSource } from "$lib/engines/pending-capture-wiring"
import {
  buildPrompt,
  hasPromptContent,
  parsePromptOwner,
  promptPayload,
} from "$lib/engines/prompt-payload"
import type { PromptDispatchOutcome } from "$lib/session/prompt-dispatch"
import type { SessionView } from "$lib/session/session-view"
import { type GuidanceAuthMethod, readGuidanceAuthMethods } from "$lib/util/auth-guidance"
import type { AgentSession, TurnState } from "./agent-session.svelte"
import { formatAcpError } from "./format-acp-error"

export type LegacyPromptOptions = {
  recordingId?: string
  attachments?: { mimeType: string; dataBase64: string }[]
}

export async function sendLegacyPrompt(
  session: Pick<AgentSession, "status" | "lastUserMessage" | "error">,
  view: SessionView | null,
  setTurnState: (state: TurnState) => void,
  text: string,
  opts?: LegacyPromptOptions,
): Promise<void> {
  if (session.status !== "connected" || !view) return
  const payload = promptPayload(text, opts?.attachments, opts?.recordingId)
  if (!hasPromptContent(payload)) return

  session.lastUserMessage = text
  const { content, meta } = buildPrompt(payload)
  setTurnState("waiting")
  try {
    await view.prompt(content, meta)
  } catch (err) {
    setTurnState("idle")
    session.error = `prompt failed: ${formatAcpError(err)}`
  }
}

type ClaimedPromptPort = {
  targets: RecordTargetSource
  store: Pick<typeof failedPromptStore, "load" | "settle">
  now(): number
  onDispatch(text: string): void
  report(owner: string, error: MessageKey): void
  refresh(target: RecordTarget): Promise<void>
  invalidate(): void
  showGuidance(owner: string, attemptId: string, methods: ReadonlyArray<GuidanceAuthMethod>): void
}

export async function deliverClaimedPrompt(
  target: RecordTarget,
  record: FailedPrompt,
  port: ClaimedPromptPort,
): Promise<void> {
  const { targets, store, now, onDispatch, report, refresh, invalidate, showGuidance } = port
  const { owner, payload, claimUntil = 0 } = record
  if (claimUntil <= now()) return
  const { sessionId } = parsePromptOwner(owner)
  const { content, meta } = buildPrompt(payload)
  let outcome: PromptDispatchOutcome = { kind: "not-started" }
  try {
    if (targets.isCurrent(target) && target.view.promptTo) {
      let current: FailedPrompt | undefined
      try {
        current = await store.load(owner)
      } catch {
        report(owner, "chat.prompt.storageError")
        return
      }
      if (current?.attemptId !== record.attemptId || current.version !== record.version) return
      if (claimUntil <= now()) return
      if (targets.isCurrent(target)) {
        outcome = await target.view.promptTo(sessionId, content, meta)
      }
    }
  } catch {
    outcome = { kind: "unknown" }
  }
  if (outcome.kind === "accepted" && targets.isCurrent(target)) onDispatch(payload.text)
  try {
    if (targets.current()?.ownerKey === owner) invalidate()
    if (outcome.kind === "rejected") {
      const { reason, retryable } = outcome
      const authMethods = reason === "auth-required" ? outcome.authMethods : undefined
      if (await store.settle(record, { delivery: "rejected", reason, retryable })) {
        showGuidance(owner, record.attemptId, readGuidanceAuthMethods(authMethods))
      }
    } else {
      await store.settle(record, { delivery: outcome.kind })
    }
  } catch {
    report(owner, "chat.prompt.storageError")
  } finally {
    const active = targets.current()
    if (active?.ownerKey === owner) void refresh(active)
  }
}

type PromptRecoveryView = {
  targets: RecordTargetSource
  refresh(target?: RecordTarget | null): Promise<void>
  report(owner: string, error?: MessageKey): void
  dispose(): void
}

export function watchPromptRecovery(
  prompts: PromptRecoveryView,
  subscribeDeleted: (listener: (owner: string, failed: boolean) => void) => () => void,
  refreshSources: () => void,
  onDeleted: (owner: string) => void,
): () => void {
  const focus = () => {
    void prompts.refresh()
    refreshSources()
  }
  const visible = () => {
    if (document.visibilityState === "visible") focus()
  }
  const unsubscribe = subscribeDeleted((owner, failed) => {
    prompts.report(owner, failed ? "chat.prompt.storageError" : undefined)
    if (failed) return
    onDeleted(owner)
    const active = prompts.targets.current()
    if (active?.ownerKey === owner) void prompts.refresh(active)
  })
  window.addEventListener("focus", focus)
  document.addEventListener("visibilitychange", visible)
  return () => {
    window.removeEventListener("focus", focus)
    document.removeEventListener("visibilitychange", visible)
    unsubscribe()
    prompts.dispose()
  }
}
