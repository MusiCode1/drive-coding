<script lang="ts">
import { goto } from "$app/navigation"
import { getSession } from "$lib/context"
import ChatHeader from "$lib/components/chat/ChatHeader.svelte"
import AgentOptionsPanel from "$lib/components/chat/AgentOptionsPanel.svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import ChatInput from "$lib/components/chat/ChatInput.svelte"

const session = getSession()

// הגנה סינכרונית (guard): רענון / ניווט ישיר ללא חיבור פעיל → מעבר לדף הבית.
// רץ במהלך הגדרת הקומפוננטה לפני שמרונדר markup כלשהו, לכן אין ריצוד (flicker).
// (ההגדרה csr=false ב-+layout.ts → גוף הסקריפט רץ רק בדפדפן).
if (session.status === "idle") {
  goto("/", { replaceState: true })
}

function onDisconnect() {
  session.detach()
  goto("/")
}
</script>

{#if session.status !== "idle"}
<div class="chat-page">
  <ChatHeader {onDisconnect} />
  <AgentOptionsPanel />
  <ChatBubbles />

  {#if session.error}
    <div class="error" role="alert">{session.error}</div>
  {/if}

  <ChatInput />
</div>
{/if}

<style>
  .chat-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  .error {
    margin: 0 1rem;
    padding: 0.75rem;
    background: rgba(255, 79, 79, 0.1);
    border: 1px solid rgba(255, 79, 79, 0.3);
    border-radius: 8px;
    color: var(--recording);
    font-size: 0.85rem;
  }
</style>
