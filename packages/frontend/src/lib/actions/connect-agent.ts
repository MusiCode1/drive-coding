import { goto } from "$app/navigation"
import { env } from "$env/dynamic/public"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { sessionPathWithTransport } from "$lib/session/session-url"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { Settings } from "$lib/view-models/settings.svelte"

export async function connectAgent(params: {
  cliKind: string
  cwd: string
  session: AgentSession
  settings: Settings
  navigate?: "push" | "replace"
}): Promise<void> {
  params.settings.setCliKind(params.cliKind)
  params.settings.setLastCwd(params.cwd)

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: params.settings.sessionTransport,
  })

  try {
    await params.session.attachRemote({
      cwd: params.cwd,
      cliKind: params.cliKind,
      systemPrompt: params.settings.getProjectPrompt(params.cwd),
      transport,
    })
  } catch (e) {
    params.session.error = formatAcpError(e)
    return
  }

  if (params.session.status === "connected") {
    await goto(sessionPathWithTransport(params.cliKind, params.session.sessionId, transport), {
      replaceState: params.navigate === "replace",
    })
  }
  // Guard throws (e.g. cannot attach) land in catch above — stay on / with session.error set.
  // Failures inside attachRemote set status="error" on the VM without throwing.
}
