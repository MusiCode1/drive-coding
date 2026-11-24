<script lang="ts">
import AuthGuidance from "$lib/components/AuthGuidance.svelte"
import DisconnectBanner from "$lib/components/session/DisconnectBanner.svelte"
import { getI18n, getSession } from "$lib/context"

const session = getSession()
const { t } = getI18n()
</script>

<DisconnectBanner />

{#if session.error}
  <div
    class="mx-4 my-2 ps-3 pe-2 py-3 rounded-lg text-sm flex items-start gap-2"
    style="background:rgba(255,79,79,0.1); border:1px solid rgba(255,79,79,0.3); color:var(--recording)"
    role="alert"
  >
    <!-- bugs/44: dir="auto" — ההודעה באנגלית, וה-shell ב-RTL יישר אותה לימין. -->
    <span class="flex-1 min-w-0 break-words" dir="auto">{session.error}</span>
    <button
      type="button"
      class="shrink-0 px-1 leading-none opacity-70 hover:opacity-100 cursor-pointer"
      aria-label={t("chat.error.dismiss")}
      title={t("chat.error.dismiss")}
      onclick={() => {
        session.error = null
      }}
    >
      ✕
    </button>
  </div>
  <!-- slice auth-guidance: הדרכת-אימות ספציפית-ל-CLI (מתחת ל-error, רק כשיש authMethods) -->
  <AuthGuidance cliKind={session.cliKind} authMethods={session.authMethods} />
{/if}
