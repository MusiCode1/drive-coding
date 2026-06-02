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

// ─── DEV-only: טעינה ישירה דרך URL — /chat?mock=<name> (חוסך את ה-picker) ───
// עובר דרך אותו loadSession (flow C), כך שאין נתיב טעינה שונה.
// location.search ישירות (זמין מיד ב-SPA — בלי תלות ב-$page store timing).
const mockName =
  import.meta.env.DEV && typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("mock")
    : null

// הגנה סינכרונית (guard): רענון / ניווט ישיר ללא חיבור פעיל → מעבר לדף הבית.
if (session.status === "idle") {
  if (mockName) {
    void session.loadSession({ sessionId: `mock:${mockName}`, cwd: "/mock", cliKind: "opencode" })
  } else {
    goto("/", { replaceState: true })
  }
}
// redesign-fix: disconnect עבר ל-SessionOptionsPanel (אין יותר onDisconnect prop)
</script>

{#if session.status !== "idle"}
  <AppShell>
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

    {#snippet footer()}
      <RecordFooter />
    {/snippet}
  </AppShell>
{/if}
