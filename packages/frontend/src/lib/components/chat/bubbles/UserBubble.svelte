<script lang="ts">
/**
 * UserBubble — בועת משתמש (C4).
 *
 * עיצוב מוקאפ 249-255: self-start, avatar user, bubble-user token.
 * flex gap-2 self-start items-end.
 *
 * ─── redesign-5 (C4) ───
 */
import type { UserBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"
import Avatar from "$lib/components/chat/Avatar.svelte"
import { joinSegmentText } from "./bubble-rendering"

let { bubble }: { bubble: UserBubble } = $props()
const t = getI18n().t
</script>

<div class="flex gap-2 self-start max-w-[85%] min-w-0 items-end">
  <Avatar kind="user" />
  <div
    class="px-3.5 py-2.5 rounded-2xl rounded-es-sm text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0"
    style="background:var(--bubble-user)"
    dir="auto"
  >
    {joinSegmentText(bubble.segments)}
    <!-- כופה ריאקטיביות -->
    <span class="hidden">{bubble.segments.length}</span>
  </div>
</div>

<style>
  .hidden { display: none; }
</style>
