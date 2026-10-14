<script lang="ts">
import SessionScopePolicyCard from "$lib/components/layout/SessionScopePolicyCard.svelte"
import { setI18n, setSessionScopePolicy } from "$lib/context"
import { SessionScopePolicy } from "$lib/view-models/session-scope-policy.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM
setI18n(fakeI18n)

const vm = new SessionScopePolicy(() => "agent-1", () => "")
vm.loading = true
vm.confirmed = null
setSessionScopePolicy(vm)
</script>

<SessionScopePolicyCard />
