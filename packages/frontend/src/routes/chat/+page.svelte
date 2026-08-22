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
import { BtRemoteEngine, TICK_INTERVAL_MS, buttonForKeyCode, type BtCommand } from "$lib/engines/bt-remote.js"
import { btChatAction, PROBE_CUE_GAP_MS } from "$lib/engines/bt-chat-actions.js"

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

  // ─── שלט BT (D-pad) — חיווט קדמי, 2026-08-22 ───
  // ערוץ KEY בלבד ⇒ עובד רק כשהטאב בחזית והמסך דלוק. המדידה של 21/08
  // הוכיחה שזה לא דורש חימוש ולא לולאת-אודיו.
  // מיפוי: קדימה=הקלט/שלח (toggle) · אחורה=בטל · מרכז=עצור הקראה.
  //
  // 🔴 חריגה מכוונת מחוק-זהב #1 (`packages/frontend/AGENTS.md`) בארבעה סעיפים:
  //    מאזיני window · polling · ייבוא **ויצירת** engine ל-route (`new BtRemoteEngine()`)
  //    · הפעלת cues מה-route.
  //    (הערה: מאזין `beforeunload` שמעליו הוא הפרה **קודמת** של אותו חוק,
  //     מ-slice leave-running-background — לא נספרת כאן.)
  //    ובנוסף — חריגה חמישית: תקציב 150 השורות.
  //    למה כאן ולא ב-VM: השלט הוא **קלט גלובלי** שאינו שייך לאף entity — הוא
  //    מתרגם מקשים לפעולות על שלושה VMs שונים (Mic · BubblePlayer · Cues).
  //    תקדים לחריגה **מוצהרת** יש ב-`/bt-test` וב-`/wake-word-test`, אבל
  //    ⚠️ **הסיבה שם שונה**: הם routes אבחון standalone; זה route-מוצר.
  //    Follow-up: אם החיווט יורחב מעבר לצ'אט — מקומו ב-VM ייעודי.
  const bt = new BtRemoteEngine()

  // המיפוי עצמו חי ב-`bt-chat-actions.ts` (טהור ובר-בדיקה) — כאן רק ביצוע.
  // ⚠️ ההחזקות הן **מכשיר-מדידה זמני**, לא פיצ'ר: הן עונות על השאלה אם ההחזקה
  //    נקלטת על קדימה/אחורה. ביפ **כפול** כי ביפ יחיד זהה לצליל שהאפליקציה
  //    מנגנת מעצמה. 🔴 דורש שההשתקה תהיה כבויה — אחרת המדידה שקטה ומטעה.
  function runCommand(cmd: BtCommand) {
    const action = btChatAction(cmd)
    switch (action.kind) {
      case "mic-toggle":
        // ללא await במכוון: toggle() ממתין לתעתיק+שליחה, ו-await כאן היה
        // מסדר לחיצת-ביטול שתגיע באמצע מאחורי התעתיק. תרחיש אמיתי בנהיגה.
        void mic.toggle()
        break
      case "mic-cancel":
        mic.cancel()
        break
      case "playback-stop":
        bubblePlayer.stop()
        break
      case "probe-cue":
        for (let i = 0; i < action.repeat; i++) {
          setTimeout(() => cues.play(action.cue), i * PROBE_CUE_GAP_MS)
        }
        break
      case "none":
        break
    }
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
