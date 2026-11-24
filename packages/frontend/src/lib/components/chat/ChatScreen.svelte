<script lang="ts">
/**
 * ChatScreen — UI משותף ל-/chat ול-/chat/[cliKind]/[sessionId].
 * redesign-4: RecordFooter מחליף ChatInput.
 */
import { onMount } from "svelte"
import ChatBubbles from "$lib/components/chat/ChatBubbles.svelte"
import ChatSessionStatus from "$lib/components/chat/ChatSessionStatus.svelte"
// edge-merge 25/08: PlaybackControls + voiceMode הגיעו מ-acp-playback על +page.svelte,
// בעוד session-url חילץ את הדף ל-ChatScreen. מיזוג "take theirs" היה מוחק את שניהם
// בשקט — ר' הערת ה-mic-toggle למטה.
import RecordFooter from "$lib/components/chat/RecordFooter.svelte"
import AppShell from "$lib/components/layout/AppShell.svelte"
import SessionMemoPad from "$lib/components/session/SessionMemoPad.svelte"
import { getBubblePlayer, getCues, getMic, getSession, getVoiceMode } from "$lib/context"
import { btChatAction, PROBE_CUE_GAP_MS } from "$lib/engines/bt-chat-actions.js"
import {
  type BtCommand,
  BtRemoteEngine,
  buttonForKeyCode,
  TICK_INTERVAL_MS,
} from "$lib/engines/bt-remote.js"

const session = getSession()
const mic = getMic()
const voiceMode = getVoiceMode()
const bubblePlayer = getBubblePlayer()
const cues = getCues()

// redesign-fix: disconnect עבר ל-SessionOptionsPanel (אין יותר onDisconnect prop)

onMount(() => {
  // ─── שלט BT (D-pad) — חיווט קדמי, 2026-08-22 ───
  // ערוץ KEY בלבד ⇒ עובד רק כשהטאב בחזית והמסך דלוק. המדידה של 21/08
  // הוכיחה שזה לא דורש חימוש ולא לולאת-אודיו.
  // מיפוי: קדימה=הקלט/שלח (toggle) · אחורה=בטל · מרכז=עצור הקראה.
  //
  // 🔴 חריגה מכוונת מחוק-זהב #3 (`packages/frontend/AGENTS.md`) — לפי תקדים
  //    `SessionOptionsPanel.svelte`: component שקורא goto, מחזיק $effect/onMount
  //    ומניע VMs. כאן: מאזיני window · polling · ייבוא **ויצירת** engine
  //    (`new BtRemoteEngine()`) · הפעלת cues · תקציב >50 שורות ב-<script>.
  //    למה כאן: השלט הוא **קלט גלובלי** שאינו שייך לאף entity — הוא
  //    מתרגם מקשים לפעולות על שלושה VMs (Mic · BubblePlayer · Cues).
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
        // edge-merge 25/08: acp-playback החליף `mic.toggle()` ב-`voiceMode.startTalking()`
        // (מיקרופון-טהור עם barge-in). השינוי בוצע על +page.svelte לפני שהדף חולץ לכאן.
        void voiceMode.startTalking()
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
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("keyup", onKey, true)
    clearInterval(btTick)
  }
})
</script>

{#if session.status !== "idle"}
  <AppShell>
    <ChatBubbles />

    <ChatSessionStatus />

    <!-- slice session-memo-pad: ממו הסשן צף מעל הצ'אט (מצומצם כברירת מחדל). -->
    {#snippet overlay()}
      <SessionMemoPad />
    {/snippet}

    {#snippet footer()}
      <RecordFooter />
    {/snippet}
  </AppShell>
{/if}
