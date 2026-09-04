<script lang="ts">
/**
 * PendingCaptureBanner — shared banner for voice errors + pending capture retry.
 * (slice voice-pending-persistence; mic-permission-indication: show error without canRetry)
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

/** Permission / notFound / generic have error but no blob — still must show. */
const showBanner = $derived(restored || error !== null)
const showActions = $derived(canRetry || error !== null || restored)
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
    {#if showActions}
      <div class="flex gap-2 justify-center mt-1">
        {#if canRetry}
          <button
            type="button"
            class="px-2 py-0.5 rounded text-[11px] font-medium border"
            style="border-color:var(--recording); color:var(--recording)"
            onclick={onRetry}
          >
            {t("pendingCapture.retry")}
          </button>
        {/if}
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
