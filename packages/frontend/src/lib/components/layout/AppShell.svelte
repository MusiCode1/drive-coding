<script lang="ts">
/**
 * AppShell — shell עיצובי אחיד ל-/chat ו-/settings.
 *
 * מחזיק:
 *   - AppHeader (header צף)
 *   - Sidebar (דסקטופ) | BottomSheet (מובייל) לפי ResponsiveVM
 *   - scroll node (.chat-scroll) + batched follow (slice chat-virtualization)
 *   - chat-fade overlay (gradient בתחתית)
 *   - content slot (max-w-2xl ממורכז)
 *
 * scroll ownership (אביגיל #2): overflow-y-auto + bind:this **כאן בלבד**.
 *
 * ─── redesign-2 ───
 * ─── slice chat-virtualization: batched follow + user-intent + turn-boundary ─── (Commits 2+3)
 *
 * follow logic:
 *   - isAtBottom ממדדי virtua handle (לא scrollEl.scrollHeight — לא מהימן תחת windowing)
 *   - jumpToBottom: handle.scrollToIndex(last, {align:'end'}) — virtua-native, anti-jump
 *   - ResizeObserver על wrapper → shouldFollowJump → קפיצה batched (לא רציפה)
 *   - following=false כשמשתמש גולל למעלה (wheel/touchstart/keydown); true כשחוזר לתחתית
 *   - noteUserIntent: מסופק ל-bridge → ToolBubble/ThoughtBubble קוראים על toggle
 *   - turn-boundary: בועת user חדשה → following=true + קפיצה (גובר על hold)
 */

// ─── redesign-7: smart-scroll ───
import ArrowDownIcon from "@lucide/svelte/icons/arrow-down"
// ─── content-viewer ─── (slice content-viewer)
import ContentViewerDialog from "$lib/components/modals/ContentViewerDialog.svelte"
// ─── redesign-6: modals (SessionsDialog הוסר ב-slice sessions-inline — סשנים עכשיו inline) ───
import FolderPickerDialog from "$lib/components/modals/FolderPickerDialog.svelte"
// ─── ui-session-polish: loading spinner modal ───
import LoadingModal from "$lib/components/modals/LoadingModal.svelte"
import {
  getAudioPlaylist,
  getChatScroll,
  getI18n,
  getModelStatus,
  getResponsive,
  getSession,
  getUiShell,
} from "$lib/context"
import type { Bubble } from "$lib/types/bubble"
import { stableBubbleKey } from "$lib/util/bubble-key"
import { shouldShowPlaybackDock } from "$lib/util/playback-dock-visibility"
import { computeScrollEdges, shouldFollowJump } from "$lib/util/scroll-follow"
import AppHeader from "./AppHeader.svelte"
import BottomSheet from "./BottomSheet.svelte"
import Sidebar from "./Sidebar.svelte"

let {
  children,
  footer,
}: {
  children: import("svelte").Snippet
  footer?: import("svelte").Snippet
} = $props()

const responsive = getResponsive()
const session = getSession()
const modelStatus = getModelStatus()
const playlist = getAudioPlaylist()
const uiShell = getUiShell()
const t = getI18n().t

/** control-dock: האם רצועת הבקרה מוצגת ( mirrors PlaybackControls showDock ). */
const ribbonVisible = $derived(
  shouldShowPlaybackDock({
    inputMode: uiShell.inputMode,
    playlistItemCount: playlist.items.length,
    isRunActive: modelStatus.isRunActive,
  }),
)

// scroll node — ה-AppShell הוא owner (חוק זהב #4)
let scrollEl = $state<HTMLElement | null>(null)

// chat-scroll bridge — כתיבת scrollEl + noteUserIntent
const chatScroll = getChatScroll()
$effect(() => {
  chatScroll.scrollEl = scrollEl
})

// ─── batched follow state (slice chat-virtualization) ───
let following = $state(true) // true = עוקב אחרי תחתית; false = hold
let lastJumpAt = 0 // timestamp הקפיצה התוכניתית האחרונה

// ─── user-intent window (Commit 3) ───
// userIntentUntil: timestamp עד מתי scroll ידני תקף (600ms אחרי אחרון)
let userIntentUntil = 0

function hasUserIntent(): boolean {
  return performance.now() < userIntentUntil
}

function markUserIntent(): void {
  userIntentUntil = performance.now() + 600
}

/**
 * noteUserIntent — מסופק ל-bridge → ToolBubble/ThoughtBubble קוראים על toggle.
 * פתיחת/קיפול בועה = user-intent = hold (user רוצה לקרוא, לא לעקוב).
 * מוטציה של following נשארת כאן (חוק זהב #4).
 */
function noteUserIntent(): void {
  markUserIntent()
  following = false
}

// חשיפה ל-bridge (additive — noteUserIntent?: () => void)
$effect(() => {
  chatScroll.noteUserIntent = noteUserIntent
  return () => {
    chatScroll.noteUserIntent = undefined
  }
})

// isAtBottom — נגזר ממדדי virtua handle (לא DOM גולמי)
let isAtBottom = $state(true)
// hasNewBelow — מופיע כשיש תוכן חדש מתחת ואנחנו לא בתחתית
let hasNewBelow = $state(false)

// lineHeight — נמדד פעם אחת מה-scrollEl (fallback 24px אם "normal")
let lineHeight = 24

function getLineHeight(): number {
  if (!scrollEl) return 24
  const computed = getComputedStyle(scrollEl).lineHeight
  if (computed === "normal") return 24
  const parsed = parseFloat(computed)
  return isNaN(parsed) ? 24 : parsed
}

/**
 * checkEdges — קורא מדדים מ-handle ומעדכן isAtBottom.
 * handle ממדדי virtua (getScrollOffset/Size/ViewportSize) — מהימן תחת windowing.
 */
function checkEdges(): void {
  const handle = chatScroll.handle
  if (!handle) {
    // fallback אם handle עדיין לא מחובר
    if (scrollEl) {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
      isAtBottom = dist < 50
    }
    return
  }
  const edges = computeScrollEdges({
    scrollOffset: handle.getScrollOffset(),
    scrollSize: handle.getScrollSize(),
    viewportSize: handle.getViewportSize(),
  })
  isAtBottom = edges.atBottom
}

/**
 * jumpToBottom — קופץ לתחתית המוחלטת.
 * שימוש ב-scrollToIndex(last, {align:'end'}) של virtua — לא scrollTop=scrollHeight.
 * virtua מחשב נכון גם לitems שטרם נמדדו (anti-jump בזמן stream).
 */
function jumpToBottom(): void {
  const handle = chatScroll.handle
  const len = session.renderBubbles.length
  if (handle && len > 0) {
    handle.scrollToIndex(len - 1, { align: "end" })
  } else if (scrollEl) {
    scrollEl.scrollTop = scrollEl.scrollHeight
  }
  lastJumpAt = performance.now()
  isAtBottom = true
  hasNewBelow = false
  following = true
}

/**
 * maybeJump — בודק batched conditions ומקפיץ אם צריך.
 * נקרא מ-ResizeObserver ומ-$effect על bubbles.
 * לא מקפיץ ישירות — שואל shouldFollowJump (פונקציה טהורה).
 */
function maybeJump(): void {
  const handle = chatScroll.handle
  if (!handle) return

  const scrollSize = handle.getScrollSize()
  const scrollOffset = handle.getScrollOffset()
  const viewportSize = handle.getViewportSize()
  const distanceBelow = scrollSize - (scrollOffset + viewportSize)

  checkEdges()

  if (
    shouldFollowJump({
      following,
      distanceBelow,
      lineHeight,
      now: performance.now(),
      lastJumpAt,
    })
  ) {
    jumpToBottom()
  } else if (!isAtBottom && following) {
    hasNewBelow = true
  }
}

/**
 * onScroll — handler ל-scroll event.
 * scroll תוכניתי (scrollToIndex) לא שובר follow — מסוננת לפי userIntent.
 * scroll ידני מכבה following; חזרה לתחתית ידנית מדליקה.
 */
function onScroll(): void {
  checkEdges()
  if (isAtBottom) {
    hasNewBelow = false
    // חזרה לתחתית ידנית → הפעל follow מחדש
    if (!following) following = true
  } else {
    // scroll ידני (יש user intent window) → כבה follow
    if (hasUserIntent()) {
      following = false
      hasNewBelow = true
    }
  }
}

// ResizeObserver על wrapper — מזין את לולאת ה-batched
let resizeObs: ResizeObserver | null = null

$effect(() => {
  const el = scrollEl
  if (!el) return

  lineHeight = getLineHeight()

  resizeObs = new ResizeObserver(() => {
    maybeJump()
  })
  const contentEl = el.firstElementChild as HTMLElement | null
  if (contentEl) resizeObs.observe(contentEl)

  // ─── user-intent listeners (Commit 3) ───
  // wheel/touchstart/keydown → markUserIntent → scroll ידני מזוהה
  const onWheel = () => markUserIntent()
  const onTouchStart = () => markUserIntent()
  const onKeyDown = (e: KeyboardEvent) => {
    const intentKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]
    if (intentKeys.includes(e.key)) markUserIntent()
  }

  el.addEventListener("wheel", onWheel, { passive: true })
  el.addEventListener("touchstart", onTouchStart, { passive: true })
  el.addEventListener("keydown", onKeyDown, { passive: true })

  return () => {
    resizeObs?.disconnect()
    resizeObs = null
    el.removeEventListener("wheel", onWheel)
    el.removeEventListener("touchstart", onTouchStart)
    el.removeEventListener("keydown", onKeyDown)
  }
})

// $effect על session.renderBubbles — floor-tail edge: מבטיח שאחרי שה-stream שוקט
// (ResizeObserver יורה שוב), הקפיצה האחרונה תסתיים
// (renderBubbles — לא bubbles: בזמן warm-reconnect replay התצוגה קפואה, ה-effect לא צריך
// להגיב ל-rebuild הנסתר, slice reconnect-bubble-merge)
$effect(() => {
  const _bubbleCount = session.renderBubbles.length
  const last = session.renderBubbles[session.renderBubbles.length - 1]
  const _segCount = last !== undefined && last.kind !== "tool" ? last.segments.length : 0
  const _lastSegLen =
    last !== undefined && last.kind !== "tool"
      ? (last.segments[last.segments.length - 1]?.text.length ?? 0)
      : 0
  const _statusPhase = modelStatus.phase
  void _bubbleCount
  void _segCount
  void _lastSegLen
  void _statusPhase

  const timer = setTimeout(() => {
    maybeJump()
  }, 320)

  return () => clearTimeout(timer)
})

// control-dock commit 0: הופעת/היעלמות הרצועה מקצרת את viewport הגלילה.
// maybeJump() לא מספיק (סף 72px > גובה הרצועה 56px; sentinelMargin 48 < 56 ⇒ JumpDown שגוי).
// jumpToBottom() מותנה ב-following, אחרי שהפריסה התייצבה (תקדים: setTimeout 320ms).
$effect(() => {
  void ribbonVisible

  const ribbonFollowTimer = setTimeout(() => {
    if (following) jumpToBottom()
  }, 320)

  return () => clearTimeout(ribbonFollowTimer)
})

// ─── turn-boundary (Commit 3) ───
// בועת user חדשה → force-follow ON + קפיצה (גובר על hold)
// slice reconnect-bubble-merge: מפתח-הזיהוי עבר מ-.id ל-stableBubbleKey (ids מתחדשים
// ב-reveal של warm-reconnect → .id היה חוטף משתמש-שגלל-למעלה לתחתית, DoD#7).
let lastSeenUserBubbleKey = ""
let lastSeenUserBubbleId = ""
let wasReconnectReplay = false
$effect(() => {
  // מצא את הbועה האחרונה עם kind==="user" (renderBubbles — קפוא בזמן warm-reconnect replay)
  let lastUserBubble: Bubble | undefined
  for (let i = session.renderBubbles.length - 1; i >= 0; i--) {
    const b = session.renderBubbles[i]
    if (b !== undefined && b.kind === "user") {
      lastUserBubble = b
      break
    }
  }
  const key = lastUserBubble ? stableBubbleKey(lastUserBubble, session.renderBubbles) : ""

  // ─── reveal-guard ספציפי-ל-reconnect (אביגיל r2/r3) ───
  // במעבר isReconnectReplay: true→false (רגע ה-reveal של warm-reconnect בלבד) — רק
  // re-seed את המפתח, בלי following=true/jumpToBottom(). לא isLoadingHistory — הוא true
  // גם בטעינה-ראשונית/switchSession ששם דווקא רוצים לקפוץ (DoD#8); רק isReconnectReplay
  // מבחין ב-warm-reconnect. ממוקם לפני ה-`if (!lastUserBubble) return` כדי שגם reveal של
  // תור-סוכן-בלבד (אין בועת-user) יעשה re-seed.
  const isReplay = session.isReconnectReplay
  if (wasReconnectReplay && !isReplay) {
    wasReconnectReplay = isReplay
    lastSeenUserBubbleKey = key
    lastSeenUserBubbleId = lastUserBubble?.id ?? ""
    return
  }
  wasReconnectReplay = isReplay

  if (!lastUserBubble) return
  if (key === lastSeenUserBubbleKey) return
  // אותה בועה, רק נחתם messageId (user:i:<uuid> → user:m:<id>) — לא תור חדש, לא לקפוץ.
  if (lastUserBubble.id === lastSeenUserBubbleId) {
    lastSeenUserBubbleKey = key
    return
  }

  // בועת user חדשה — force-follow
  lastSeenUserBubbleKey = key
  lastSeenUserBubbleId = lastUserBubble.id
  following = true
  jumpToBottom()
})
</script>

<div class="relative flex flex-col h-[100dvh] w-full mx-auto overflow-hidden" style="background:var(--bg)">
  <!-- AppHeader (absolute top) -->
  <AppHeader />

  <!-- גוף: sidebar (דסקטופ) + תוכן -->
  <div class="flex flex-row flex-1 min-h-0">
    {#if !responsive.isMobile}
      <Sidebar />
    {/if}

    <!-- עמודת תוכן (min-w-0: מונע מ-flex item לגלוש מעבר לרוחב המסך — תיקון mic-card גולש) -->
    <div class="relative flex flex-col flex-1 min-w-0 min-h-0">
      <!-- אזור הגלילה עטוף ב-wrapper relative.flex-1 כדי שה-chat-fade ימוקם
           בתחתיתו (bottom-0) — כלומר בדיוק בגבול שבין ההודעות ל-footer.
           ה-wrapper מסתיים איפה שה-footer (sibling shrink-0) מתחיל, ולכן ה-fade
           נצמד אוטומטית מעל ה-footer גם אם גובה ה-footer משתנה (מוקאפ 477-481). -->
      <div class="relative flex-1 min-h-0">
        <!-- scroll area — owner של ה-scroll (חוק זהב #4) -->
        <div
          bind:this={scrollEl}
          class="chat-scroll h-full overflow-y-auto px-4 pt-20 pb-10"
          onscroll={onScroll}
        >
          <!-- max-w-2xl: בועות צרות ממורכזות (fix A2a — קריאות בדסקטופ) -->
          <!-- gap-5 הוסר — spacing עבר ל-pb-5 פר-item (נמדד כחלק מגובה virtua item) -->
          <div class="flex flex-col max-w-2xl mx-auto w-full">
            {@render children()}
          </div>
        </div>

        <!-- chat-fade: overlay gradient בתחתית אזור הגלילה (הודעות "נמסות"
             לפני ה-footer). אחרי ה-scroll כדי לשבת מעליו (z) ולא להיחתך. -->
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 z-10"
          style="height:72px; background:linear-gradient(to top, var(--bg), transparent)"
        ></div>

        <!-- redesign-7: כפתור JumpDown (צף, מוצג כש-!בתחתית + יש תוכן חדש) -->
        {#if !isAtBottom && hasNewBelow}
          <button
            class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium shadow-lg"
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

      <!-- footer slot — sibling של ה-scroll (shrink-0), מעוגן בתחתית העמודה.
           (תיקון layout: ה-RecordFooter היה בתוך children ולכן נגלל; כעת הוא
           אח של chat-scroll כמו במוקאפ ChatColumn — footer shrink-0 בתחתית.) -->
      {@render footer?.()}
    </div>
  </div>

  <!-- BottomSheet (מובייל בלבד) -->
  {#if responsive.isMobile}
    <BottomSheet />
  {/if}

  <!-- redesign-6: modals (SessionsDialog הוסר ב-slice sessions-inline) -->
  <FolderPickerDialog />
  <!-- content-viewer (slice content-viewer) -->
  <ContentViewerDialog />
  <!-- ui-session-polish: loading spinner during session connect or history render -->
  <LoadingModal open={session.status === "connecting" || session.isLoadingHistory} />
</div>
