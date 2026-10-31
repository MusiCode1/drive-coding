import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import { createAcpClient } from "@drive-coding/provider/client"
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import type { WsConnection, WsConnectionDeps } from "./ws-connection"

export type WsLoadInput = { sessionId: string; cwd: string; cliKind: string }
export type WsLoadOptions = {
  preserveContextOnError?: boolean
  isCurrent?: () => boolean
  onCreatedAgent?: (agentId: string) => void
}
export type WsLoadHooks = {
  published(agentId: string): void
  replaying(loading: boolean): void
  loaded(): void
  connected(agentId: string): void
  failed(error: unknown): void
}

/** IO for public load and cold replay; all continuations retain this attempt. */
export async function runWsLoadAttempt(
  owner: WsConnection,
  deps: WsConnectionDeps,
  input: WsLoadInput,
  hooks: WsLoadHooks,
  options?: WsLoadOptions,
): Promise<void> {
  const attempt = owner.beginAttempt(options?.isCurrent)
  attempt.created = true
  try {
    const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
    attempt.agentId = agentId
    if (owner.discardLate(attempt)) return
    options?.onCreatedAgent?.(agentId)
    hooks.published(agentId)
    if (!options?.preserveContextOnError) owner.captureReleaseIdentity(agentId, deps.connectionId)
    const transport = owner.ownTransport(attempt, new WsAcpTransport(deps.url(agentId)))
    transport.onClose((code, reason) => {
      if (attempt.current()) deps.onClose(code, reason)
    })
    await transport.waitForOpen()
    if (owner.discardLate(attempt)) return
    const view = owner.bindLocalView()
    attempt.client = await createAcpClient(transport, owner.callbacks(view))
    if (owner.discardLate(attempt)) return
    const client = attempt.client
    owner.setClient(client)
    owner.adoptLocalView(client, input.sessionId)
    hooks.replaying(true)
    try {
      const meta = deps.sessionMeta()
      const result = await client.loadSession({
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: [],
        ...(meta && { _meta: meta }),
      })
      if (owner.discardLate(attempt)) return
      deps.captureSessionConfig(result)
    } finally {
      if (attempt.current()) hooks.replaying(false)
    }
    if (owner.discardLate(attempt)) return
    hooks.loaded()
    await notifySessionAttached(agentId, input.sessionId).catch(() => {})
    if (owner.discardLate(attempt)) return
    owner.captureReleaseIdentity(agentId, deps.connectionId)
    hooks.connected(agentId)
  } catch (error) {
    if (owner.discardLate(attempt)) return
    hooks.failed(error)
  }
}
