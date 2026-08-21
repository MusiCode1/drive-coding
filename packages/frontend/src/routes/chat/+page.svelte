<script lang="ts">
/**
 * /chat — route דק. redesign-4: RecordFooter מחליף ChatInput.
 */
import { onMount } from "svelte"
import { goto } from "$app/navigation"
import AuthGuidance from "$lib/components/AuthGuidance.svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import RecordFooter from "$lib/components/chat/RecordFooter.svelte"
import AppShell from "$lib/components/layout/AppShell.svelte"
import DisconnectBanner from "$lib/components/session/DisconnectBanner.svelte"
import { getI18n, getSession, getMic, getBubblePlayer, getCues } from "$lib/context"
import { BtRemoteEngine, TICK_INTERVAL_MS, buttonForKeyCode } from "$lib/engines/bt-remote.js"

const session = getSession()
const mic = getMic()
const bubblePlayer = getBubblePlayer()
const cues = getCues()
const i18n = getI18n()
const t = i18n.t

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
    if (session.status === "connected" && session.turnState !== "idle" && !session.bypassActive) {
      e.preventDefault()   // מפעיל dialog גנרי של הדפדפן
      e.returnValue = ""   // נדרש לדפדפנים ישנים
    }
  }
  window.addEventListener("beforeunload", onBeforeUnload)

  // ─── שלט BT (D-pad) — חיווט קדמי ידני, 2026-08-22 ───
  // ⚠️ זמני ובכוונה מחוץ למסלול-הסלייסים: המשתמש ביקש שימוש חי בנסיעה,
  //    "גם אם יהיו באגים". ערוץ KEY בלבד ⇒ עובד רק כשהטאב בחזית והמסך דלוק.
  //    המדידה של 21/08 הוכיחה שזה לא דורש חימוש ולא לולאת-אודיו.
  //    מיפוי: קדימה=הקלט/שלח (toggle) · אחורה=בטל · מרכז=עצור הקראה.
  const bt = new BtRemoteEngine()

  function runCommand(cmd: { button: string; gesture: string }) {
    if (cmd.gesture === "hold") {
      // בדיקת-שמע בנהיגה: האם החזקה נקלטת על קדימה/אחורה, ולא רק על המרכז.
      // אין פעולה — רק צליל, כדי שאפשר יהיה לענות על זה בלי להסתכל במסך.
      // עולה גליסנדו = קדימה · יורד = אחורה · המרכז שותק (כבר נמדד).
      if (cmd.button === "next") cues.play("thinking")
      else if (cmd.button === "prev") cues.play("speaking")
      return
    }
    if (cmd.button === "next") void mic.toggle()
    else if (cmd.button === "prev") mic.cancel()
    else if (cmd.button === "center") bubblePlayer.stop()
  }

  function onKey(e: KeyboardEvent) {
    if (buttonForKeyCode(e.code) === null) return
    e.preventDefault() // שלא ינגן/ידלג בנגן ברירת-המחדל של הדפדפן
    const cmd = bt.ingestKey({
      type: e.type === "keydown" ? "down" : "up",
      code: e.code,
      at: e.timeStamp,
    })
    if (cmd) runCommand(cmd)
  }

  window.addEventListener("keydown", onKey, true)
  window.addEventListener("keyup", onKey, true)
  const btTick = setInterval(() => {
    for (const cmd of bt.tick(performance.now())) runCommand(cmd)
  }, TICK_INTERVAL_MS)

  return () => {
    window.removeEventListener("beforeunload", onBeforeUnload)
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("keyup", onKey, true)
    clearInterval(btTick)
  }
})
</script>

{#if session.status !== "idle"}
  <AppShell>
    <ChatBubbles />

    <DisconnectBanner />

    {#if session.error}
      <div
        class="mx-4 my-2 ps-3 pe-2 py-3 rounded-lg text-sm flex items-start gap-2"
        style="background:rgba(255,79,79,0.1); border:1px solid rgba(255,79,79,0.3); color:var(--recording)"
        role="alert"
      >
        <!-- bugs/44: dir="auto" — ההודעה באנגלית, וה-shell ב-RTL יישר אותה לימין. -->
        <span class="flex-1 min-w-0 break-words" dir="auto">{session.error}</span>
        <!-- bugs/44: אין מנקה אוטומטי ב-HTTP (המנקה היחיד תלוי ב-WS onClose),
             ולכן שגיאה חולפת נשארת לנצח. סגירה ידנית = הקלה, לא תיקון-שורש. -->
        <button
          type="button"
          class="shrink-0 px-1 leading-none opacity-70 hover:opacity-100 cursor-pointer"
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          onclick={() => {
            session.error = null
          }}
        >
          ✕
        </button>
      </div>
      <!-- slice auth-guidance: הדרכת-אימות ספציפית-ל-CLI (מתחת ל-error, רק כשיש authMethods) -->
      <AuthGuidance cliKind={session.cliKind} authMethods={session.authMethods} />
    {/if}

    {#snippet footer()}
      <RecordFooter />
    {/snippet}
  </AppShell>
{/if}
