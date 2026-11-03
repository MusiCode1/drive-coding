<script lang="ts">
/**
 * SessionResumeOffer — what the not-found screen shows when a history row exists.
 *
 * Offer only: the button navigates, it does not resume. Spawning stays on `/resume`.
 */
import type { SessionHistoryRow } from "$lib/adapters/session-history-api"
import { getI18n } from "$lib/context"

let { row, onResume }: { row: SessionHistoryRow; onResume: () => void } = $props()

const t = getI18n().t
</script>

<p class="text-sm text-[var(--fg-dim)] max-w-md">{t("sessionUrl.resume.offer")}</p>
<dl class="text-xs text-[var(--fg-dim)] flex flex-wrap justify-center gap-x-3">
  {#if row.lastTitle}
    <dd class="font-medium text-[var(--fg)]">{row.lastTitle}</dd>
  {/if}
  <dd dir="ltr">{row.cwd}</dd>
  <dd>{t("sessionUrl.resume.lastSeen")}: {new Date(row.lastSeenAt).toLocaleString()}</dd>
</dl>
<button
  type="button"
  class="px-4 py-2 rounded-lg text-sm"
  style="background:var(--accent); color:var(--bg)"
  onclick={onResume}
>
  {t("sessionUrl.resume.action")}
</button>
