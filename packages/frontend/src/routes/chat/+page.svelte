<script lang="ts">
/**
 * /chat — route דק. redesign-4: RecordFooter מחליף ChatInput.
 */
import { goto } from "$app/navigation"
import { getSession } from "$lib/context"
import AppShell from "$lib/components/layout/AppShell.svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import RecordFooter from "$lib/components/chat/RecordFooter.svelte"

const session = getSession()

// הגנה סינכרונית (guard): רענון / ניווט ישיר ללא חיבור פעיל → מעבר לדף הבית.
if (session.status === "idle") {
  goto("/", { replaceState: true })
}

function onDisconnect() {
  session.detach()
  goto("/")
}
</script>

{#if session.status !== "idle"}
  <AppShell {onDisconnect}>
    <ChatBubbles />

    {#if session.error}
      <div
        class="mx-4 my-2 px-3 py-3 rounded-lg text-sm"
        style="background:rgba(255,79,79,0.1); border:1px solid rgba(255,79,79,0.3); color:var(--recording)"
        role="alert"
      >
        {session.error}
      </div>
    {/if}

    <RecordFooter />
  </AppShell>
{/if}
