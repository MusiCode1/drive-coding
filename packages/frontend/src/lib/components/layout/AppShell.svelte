<script lang="ts">
/**
 * AppShell — shell עיצובי אחיד ל-/chat ו-/settings.
 *
 * מחזיק:
 *   - AppHeader (header צף)
 *   - Sidebar (דסקטופ) | BottomSheet (מובייל) לפי ResponsiveVM
 *   - scroll node (.chat-scroll) + auto-scroll $effect (חוק זהב #4 — הועבר מ-ChatBubbles)
 *   - chat-fade overlay (gradient בתחתית)
 *   - content slot (max-w-2xl ממורכז)
 *
 * scroll ownership (אביגיל #2): overflow-y-auto + bind:this **כאן בלבד**.
 * ChatBubbles מאבד את ה-scroll שלו ב-Commit 4.
 *
 * ─── redesign-2 ───
 */
import { tick } from "svelte"
import { getResponsive, getSession } from "$lib/context"
import AppHeader from "./AppHeader.svelte"
import Sidebar from "./Sidebar.svelte"
import BottomSheet from "./BottomSheet.svelte"

let { children, onDisconnect }: {
  children: import("svelte").Snippet
  onDisconnect?: () => void
} = $props()

const responsive = getResponsive()
const session = getSession()

// scroll node — ה-AppShell הוא owner (חוק זהב #4)
let scrollEl = $state<HTMLElement | null>(null)

/**
 * Auto-scroll — הועבר מ-ChatBubbles:21-36 ככתבו.
 * קורא שלושה ערכים ריאקטיביים: bubble count, seg count, seg text length.
 * scrollEl חליפת chatEl (ChatBubbles מאבד bind:this ב-Commit 4 הזה).
 */
$effect(() => {
  const _bubbleCount = session.bubbles.length
  const last = session.bubbles[session.bubbles.length - 1]
  const _segCount =
    last !== undefined && last.kind !== "tool" ? last.segments.length : 0
  const _lastSegLen =
    last !== undefined && last.kind !== "tool"
      ? (last.segments[last.segments.length - 1]?.text.length ?? 0)
      : 0
  void _bubbleCount
  void _segCount
  void _lastSegLen
  tick().then(() => {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  })
})
</script>

<div class="relative flex flex-col h-[100dvh] w-full mx-auto overflow-hidden" style="background:var(--bg)">
  <!-- AppHeader (absolute top) -->
  <AppHeader {onDisconnect} />

  <!-- גוף: sidebar (דסקטופ) + תוכן -->
  <div class="flex flex-row flex-1 min-h-0">
    {#if !responsive.isMobile}
      <Sidebar />
    {/if}

    <!-- עמודת תוכן -->
    <div class="relative flex flex-col flex-1 min-h-0">
      <!-- chat-fade: overlay gradient בתחתית (הודעות "נמסות" לפני ה-footer) -->
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        style="height:72px; background:linear-gradient(to top, var(--bg), transparent)"
      ></div>

      <!-- scroll area — owner של ה-scroll (חוק זהב #4) -->
      <div
        bind:this={scrollEl}
        class="chat-scroll flex-1 overflow-y-auto px-4 pt-20 pb-10"
      >
        <!-- max-w-2xl: בועות צרות ממורכזות (fix A2a — קריאות בדסקטופ) -->
        <div class="flex flex-col gap-5 max-w-2xl mx-auto w-full">
          {@render children()}
        </div>
      </div>
    </div>
  </div>

  <!-- BottomSheet (מובייל בלבד) -->
  {#if responsive.isMobile}
    <BottomSheet />
  {/if}
</div>
