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
import { getResponsive, getSession, getI18n } from "$lib/context"
import AppHeader from "./AppHeader.svelte"
import Sidebar from "./Sidebar.svelte"
import BottomSheet from "./BottomSheet.svelte"
// ─── redesign-6: modals ───
import FolderPickerDialog from "$lib/components/modals/FolderPickerDialog.svelte"
import SessionsDialog from "$lib/components/modals/SessionsDialog.svelte"
// ─── redesign-7: smart-scroll ───
import ArrowDownIcon from "@lucide/svelte/icons/arrow-down"

let { children, onDisconnect }: {
  children: import("svelte").Snippet
  onDisconnect?: () => void
} = $props()

const responsive = getResponsive()
const session = getSession()
const t = getI18n().t

// scroll node — ה-AppShell הוא owner (חוק זהב #4)
let scrollEl = $state<HTMLElement | null>(null)

// ─── redesign-7: smart-scroll state ───
const SCROLL_THRESHOLD = 50 // px מהתחתית = "בתחתית"
let isAtBottom = $state(true)
let hasNewBelow = $state(false)

function checkIsAtBottom(): boolean {
  if (!scrollEl) return true
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < SCROLL_THRESHOLD
}

function onScroll() {
  isAtBottom = checkIsAtBottom()
  if (isAtBottom) hasNewBelow = false
}

function jumpToBottom() {
  if (!scrollEl) return
  scrollEl.scrollTop = scrollEl.scrollHeight
  isAtBottom = true
  hasNewBelow = false
}

/**
 * Smart auto-scroll (redesign-7) — מחליף את ה-auto-scroll הבלתי-מותנה.
 * רק אם המשתמש בתחתית → נצמד. אחרת → hasNewBelow=true.
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
    if (!scrollEl) return
    if (isAtBottom) {
      scrollEl.scrollTop = scrollEl.scrollHeight
    } else {
      hasNewBelow = true
    }
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
        onscroll={onScroll}
      >
        <!-- max-w-2xl: בועות צרות ממורכזות (fix A2a — קריאות בדסקטופ) -->
        <div class="flex flex-col gap-5 max-w-2xl mx-auto w-full">
          {@render children()}
        </div>
      </div>

      <!-- redesign-7: כפתור JumpDown (צף, מוצג כש-!בתחתית + יש תוכן חדש) -->
      {#if !isAtBottom && hasNewBelow}
        <button
          class="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium shadow-lg"
          style="background:var(--accent); color:white"
          onclick={jumpToBottom}
          aria-label={t("chat.jumpDown")}
          title={t("chat.jumpDown")}
        >
          <ArrowDownIcon size={14} strokeWidth={2.5} />
          {t("chat.jumpDown")}
        </button>
      {/if}
    </div>
  </div>

  <!-- BottomSheet (מובייל בלבד) -->
  {#if responsive.isMobile}
    <BottomSheet />
  {/if}

  <!-- redesign-6: modals (מרונדרים פעם אחת ב-AppShell) -->
  <FolderPickerDialog />
  <SessionsDialog />
</div>
