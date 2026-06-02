<script lang="ts">
import { goto } from "$app/navigation"
import { getSession } from "$lib/context"
import AppShell from "$lib/components/layout/AppShell.svelte"
import AgentOptionsPanel from "$lib/components/chat/AgentOptionsPanel.svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import ChatInput from "$lib/components/chat/ChatInput.svelte"

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
    <!-- AgentOptionsPanel נשאר זמנית; redesign-3 ימזג ל-SessionOptionsPanel -->
    <AgentOptionsPanel />
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

    <ChatInput />
  </AppShell>
{/if}
