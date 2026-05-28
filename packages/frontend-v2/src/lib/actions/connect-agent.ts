/**
 * connect-agent.ts — orchestrates the connect flow.
 *
 * 1. Save the form values to settings (so they persist).
 * 2. Attach the session.
 * 3. Navigate to /chat on success.
 *
 * Action (not a method on Settings or AgentSession) because it composes
 * multiple view-models + navigation — a textbook cross-layer concern.
 */

import { goto } from "$app/navigation"
import type { CliKind } from "@drive-coding/core"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export async function connectAgent(params: {
  cliKind: CliKind
  cwd: string
  session: AgentSession
  settings: Settings
}): Promise<void> {
  params.settings.setCliKind(params.cliKind)
  params.settings.setLastCwd(params.cwd)

  await params.session.attach({ cwd: params.cwd, cliKind: params.cliKind })

  if (params.session.status === "connected") {
    await goto("/chat")
  }
  // on error, the session VM already set status="error" + error message.
  // the connect page will render that — no navigation.
}
