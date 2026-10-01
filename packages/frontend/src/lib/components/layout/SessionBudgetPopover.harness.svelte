<script lang="ts">
/**
 * Test harness — mounts SessionBudgetPopover with minimal context (C1 cost gate).
 */
import { setI18n, setSession } from "$lib/context"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import SessionBudgetPopover from "./SessionBudgetPopover.svelte"

const settings = new Settings()
setI18n(new I18nVM({ settings }))

const sessionStub = {
  contextUsage: { used: 100, size: 1000, cost: { amount: 0.1 } },
  supports: { usage: false },
  quotaLoading: false,
  quota: null,
} as unknown as AgentSession
setSession(sessionStub)
</script>

<SessionBudgetPopover />
