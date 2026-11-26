<script lang="ts">
import AuthGuidance from "$lib/components/AuthGuidance.svelte"
import DisconnectBanner from "$lib/components/session/DisconnectBanner.svelte"
import PendingCaptureBanner from "./PendingCaptureBanner.svelte"
import { getI18n, getPromptRetry, getSession } from "$lib/context"

const session = getSession()
const { t } = getI18n()
const { prompts, dictateSubmit } = getPromptRetry()
const entry = $derived(prompts.targets.current())
const failed = $derived(prompts.record)
const status = $derived(prompts.message)
const action = $derived(prompts.action)
const source = $derived(dictateSubmit.source)
const dictated = $derived(dictateSubmit.payload)
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

{#if prompts.error}
  <p class="mx-4 my-2 text-sm" style="color:var(--recording)" role="alert">{t(prompts.error)}</p>
{/if}

{#if entry && failed && status}
  {@const target = entry}
  {@const record = failed}
  <div class="mx-4 my-2 p-3 rounded-lg border text-sm break-words" style="border-color:var(--recording)" role="alert">
    <p>{t(status)}</p>
    <p dir="auto" class="whitespace-pre-wrap">{record.payload.text.trim() ? record.payload.text : t("chat.prompt.imageOnly")}</p>
    <div class="flex gap-3">
      {#if action}
        <button type="button" onclick={() => void prompts.retry(record, target)}>{t(action)}</button>
      {/if}
      {#if !prompts.claimActive}
        <button type="button" onclick={() => void prompts.dismiss(record, target)}>{t("chat.error.dismiss")}</button>
      {/if}
    </div>
  </div>
  <AuthGuidance cliKind={session.cliKind} authMethods={prompts.authMethods} />
{/if}

{#if entry && source && !dictateSubmit.busy}
  {@const target = entry}
  {@const item = source}
  {#if dictated}
    <div class="mx-4 my-2 p-3 rounded-lg border text-sm break-words" style="border-color:var(--recording)" role="alert">
      <p>{t("chat.prompt.notStarted")}</p>
      {#if dictated.text.trim() || dictated.attachments.length}
        <p dir="auto" class="whitespace-pre-wrap">{dictated.text.trim() ? dictated.text : t("chat.prompt.imageOnly")}</p>
        <button type="button" onclick={() => void dictateSubmit.resume(item, target)}>{t("chat.send")}</button>
      {/if}
      <button type="button" onclick={() => void dictateSubmit.dismiss(item, target)}>{t("chat.error.dismiss")}</button>
    </div>
  {:else}
    <PendingCaptureBanner
      error={dictateSubmit.error}
      canRetry={true}
      restored={true}
      onRetry={() => void dictateSubmit.resume(item, target)}
      onDismiss={() => void dictateSubmit.dismiss(item, target)}
      {t}
    />
  {/if}
{/if}
