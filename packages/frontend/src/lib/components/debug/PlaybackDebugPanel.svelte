<script lang="ts">
/**
 * PlaybackDebugPanel — תצוגת מצב-התור, לצורך ניפוי בלבד.
 *
 * ─── slice playback-observability ───
 *
 * ⚠️ **קורא מאותו מקור כמו `__dc.playback()`** ולא מחשב לעצמו. שני מקורות
 * היו סוטים, והתצוגה — שהיא זו שמסתכלים בה כשמשהו נשבר — הייתה משקרת.
 *
 * ⚠️ **דגימה בטיימר, לא ריאקטיביות.** קריאה ל-`debugInfo()` בתוך `$derived`
 * הייתה רושמת את כל שדות ה-`$state` של הפלייליסט כתלויות של הפאנל, והוא היה
 * מרונדר-מחדש על כל chunk. פאנל-ניפוי אסור לו להשפיע על מה שהוא מודד.
 */
import { onMount } from "svelte"
import { type PlaybackDebugInfo, playbackDebugInfo } from "$lib/debug/playback-registry"

let info = $state<PlaybackDebugInfo | null>(null)
let open = $state(false)

onMount(() => {
  const t = setInterval(() => {
    info = playbackDebugInfo()
  }, 500)
  return () => clearInterval(t)
})

// 🔴 השורה שמאבחנת: cursor ששווה ל-items בזמן שיש פריטים = חונה בסוף.
const parked = $derived(
  info?.playlist != null && info.playlist.items > 0 && info.playlist.cursor >= info.playlist.items,
)
// הפער שחשף את הבאג: הוכן הרבה, נוגן מעט.
const gap = $derived(info?.sink != null ? info.sink.prepared - info.sink.played : 0)
</script>

{#if info}
  <div class="dbg" dir="ltr">
    <button class="hdr" onclick={() => (open = !open)} type="button">
      playback {open ? "▾" : "▸"}
    </button>
    {#if open}
      <div class="body">
        <div class:warn={info.playlists !== 1}>playlists: {info.playlists}</div>
        {#if info.playlist}
          <div class:warn={parked}>
            cursor: {info.playlist.cursor} / {info.playlist.items}{parked ? "  ⚠ parked" : ""}
          </div>
          <div>
            loop: {info.playlist.looping ? "live" : "stopped"} · {info.playlist.state} · {info
              .playlist.transport}
          </div>
          <div>now: {info.playlist.currentSegmentId?.slice(0, 8) ?? "—"}</div>
          <div>
            {Object.entries(info.playlist.byState)
              .map(([k, v]) => `${k}:${v}`)
              .join(" ")}
          </div>
        {/if}
        {#if info.speaker}
          <!-- ⭐ מה שמבדיל "ממתין ל-TTS" מ-"נזנח": פריט ב-reserved יכול להיות
               כל אחד מהשניים, וה-inFlight הוא ההבחנה. -->
          <div class:warn={info.speaker.inFlight === 0 && (info.playlist?.byState.reserved ?? 0) > 0}>
            awaiting TTS: {info.speaker.inFlight}/{info.speaker.lookahead} · queued {info.speaker
              .queued}
          </div>
          <!-- ⭐ מה שנשלח בפועל — מבדיל בין "לא נכנס", "דולג" ו-"נוגן ולא נשמע". -->
          {#each info.speaker.recent.slice(0, 4) as txt, i (i)}
            <div class="seg" dir="auto">· {txt}</div>
          {/each}
        {/if}
        {#if info.sink}
          <div class:warn={gap > 3}>
            sink: prepared {info.sink.prepared} · played {info.sink.played}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dbg {
    /* ⚠️ **למעלה ולא למטה.** במובייל התחתית תפוסה ע"י RecordFooter
       ורצועת-הבקרה, והפאנל היה מתחתם ובלתי-נראה — בדיוק המצב שדווח. */
    position: fixed;
    inset-block-start: 0.25rem;
    inset-inline-start: 0.25rem;
    z-index: 9999;
    font: 11px/1.35 ui-monospace, monospace;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 6px;
    max-width: 60vw;
  }
  .hdr {
    background: none;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0;
  }
  .body {
    color: var(--fg-muted);
  }
  .seg {
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 58vw;
  }
  .warn {
    color: #e5484d;
    font-weight: 600;
  }
</style>
