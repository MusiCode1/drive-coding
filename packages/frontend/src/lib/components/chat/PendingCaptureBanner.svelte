<script lang="ts">
/**
 * PendingCaptureBanner — shared retry/dismiss banner for failed voice capture.
 * (slice voice-pending-persistence)
 */
import type { MessageKey } from "@drive-coding/core/i18n"

let {
  error = null as MessageKey | null,
  canRetry = false,
  restored = false,
  onRetry,
  onDismiss,
  t,
}: {
  error?: MessageKey | null
  canRetry?: boolean
  restored?: boolean
  onRetry: () => void
  onDismiss: () => void
  t: (key: MessageKey) => string
} = $props()

const showBanner = $derived(restored || (error !== null && canRetry))
</script>

{#if showBanner}
  <div
    class="pending-capture-banner text-xs text-center w-full max-w-xs"
    style="color:var(--recording)"
    role="alert"
  >
    {#if restored}
      <p class="mb-1">{t("pendingCapture.restored")}</p>
    {/if}
    {#if error}
      <p>{t(error)}</p>
    {/if}
    {#if canRetry}
      <div class="flex gap-2 justify-center mt-1">
        <button
          type="button"
          class="px-2 py-0.5 rounded text-[11px] font-medium border"
          style="border-color:var(--recording); color:var(--recording)"
          onclick={onRetry}
        >
          {t("pendingCapture.retry")}
        </button>
        <button
          type="button"
          class="px-2 py-0.5 rounded text-[11px] font-medium border"
          style="border-color:var(--fg-muted); color:var(--fg-muted)"
          onclick={onDismiss}
        >
          {t("pendingCapture.dismiss")}
        </button>
      </div>
    {/if}
  </div>
{/if}
