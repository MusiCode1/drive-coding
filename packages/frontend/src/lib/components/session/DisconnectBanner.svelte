<script lang="ts">
/**
 * DisconnectBanner — באנר ניתוק מבוסס-presence בלבד (slice liveness C4).
 * נפרד מ-session.error — לא מוחק crashReason וכו'.
 */
import { getI18n, getPresencePoller } from "$lib/context"

const i18n = getI18n()
const t = i18n.t
const poller = getPresencePoller()
</script>

{#if poller.banner === "reconnecting"}
  <div
    class="disconnect-banner"
    role="status"
    aria-live="polite"
  >
    {t("session.reconnecting")}
  </div>
{:else if poller.banner === "cloudflare"}
  <div
    class="disconnect-banner"
    role="alert"
  >
    <span>{t("session.cloudflareBlocked")}</span>
    <button type="button" class="refresh-btn" onclick={() => { void poller.refreshPage() }}>
      {t("session.cloudflareRefresh")}
    </button>
  </div>
{/if}

<style>
  .disconnect-banner {
    margin: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    background: rgba(255, 165, 0, 0.12);
    border: 1px solid rgba(255, 165, 0, 0.35);
    color: var(--fg, inherit);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .refresh-btn {
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255, 165, 0, 0.5);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: rgba(255, 165, 0, 0.15);
  }
</style>
