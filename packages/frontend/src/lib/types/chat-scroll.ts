/**
 * chat-scroll.ts — טיפוס ChatScrollBridge.
 *
 * גשר דו-כיווני בין AppShell (owner ה-scroll) ל-ChatBubbles (owner ה-Virtualizer).
 * הם אחאים ב-composition, לא parent→child, לכן context bridge.
 *
 * ─── slice chat-virtualization ───
 */
import type { VirtualizerHandle } from "virtua/svelte"

/**
 * ChatScrollBridge — אובייקט $state משותף, נוצר ב-+layout, מסופק בcontext.
 *
 * - scrollEl: נכתב ע"י AppShell (bind:this הקיים)
 * - handle: נכתב ע"י ChatBubbles (bind:this על Virtualizer)
 * - noteUserIntent: מסופק ע"י AppShell; נקרא ע"י ToolBubble/ThoughtBubble על toggle
 */
export type ChatScrollBridge = {
  scrollEl: HTMLElement | null
  handle: VirtualizerHandle | null
  noteUserIntent?: () => void
}
