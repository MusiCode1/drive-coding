<script lang="ts">
/**
 * /chat — route דק. redesign-4: RecordFooter מחליף ChatInput.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import { getSession } from "$lib/context"
import AppShell from "$lib/components/layout/AppShell.svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import RecordFooter from "$lib/components/chat/RecordFooter.svelte"

const session = getSession()

// ─── DEV-only: טעינה ישירה דרך URL — /chat?mock=<name> (חוסך את ה-picker) ───
// עובר דרך אותו loadSession (flow C), כך שאין נתיב טעינה שונה.
// location.search ישירות (זמין מיד ב-SPA — בלי תלות ב-$page store timing).
// MODE !== "production": פעיל גם ב-dev server וגם ב-dev build (vite build --mode development),
// אך עדיין tree-shaken ב-production build. import.meta.env.DEV לבדו היה false בכל build.
const mockName =
  import.meta.env.MODE !== "production" && typeof location !== "undefined"
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

// ─── slice leave-running-background: beforeunload guard ───
// מזהיר כשמחובר ולא ב-bypass — הריצה עלולה להיתקע בלי FE (ACP client).
// onMount: רץ רק בדפדפן → בטוח מ-SSR (window/beforeunload לא קיימים ב-SSR).
// scope: /chat בלבד — רענון בדף-הבית/רשימה לא מזהיר.
onMount(() => {
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (session.status === "connected" && !session.bypassActive) {
      e.preventDefault()   // מפעיל dialog גנרי של הדפדפן
      e.returnValue = ""   // נדרש לדפדפנים ישנים
    }
  }
  window.addEventListener("beforeunload", onBeforeUnload)
  return () => window.removeEventListener("beforeunload", onBeforeUnload)
})
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
