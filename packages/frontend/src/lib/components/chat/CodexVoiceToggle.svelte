<script lang="ts">
/**
 * CodexVoiceToggle — start/stop Codex's own voice front-end for a Codex session (slice codex-voice-poc).
 * Floating button + a caption line; Codex's delegated turns appear in the chat as usual.
 */
import MicIcon from "@lucide/svelte/icons/mic"
import MicOffIcon from "@lucide/svelte/icons/mic-off"
import { getI18n, getSession } from "$lib/context"
import { codexVoice } from "$lib/view-models/codex-voice.svelte.js"

const session = getSession()
const t = getI18n().t

function toggle() {
  if (codexVoice.active) return void codexVoice.stop()
  const agentId = session.agentId
  const sessionId = session.sessionId
  if (!agentId || !sessionId) return
  void codexVoice.start({
    agentId,
    sessionId,
    prompt: t("codexVoice.prompt"),
    currentSessionId: () => session.sessionId,
    pendingPermission: () =>
      session.pendingPermission ? (session.pendingPermission.params.toolCall?.title ?? "") : null,
    permissionSpeech: t("codexVoice.permissionSpeech"),
  })
}

const caption = $derived(
  codexVoice.status === "connecting"
    ? t("codexVoice.connecting")
    : codexVoice.status === "error"
      ? `${t("codexVoice.error")} ${codexVoice.error ?? ""}`
      : codexVoice.lastAssistant ||
        codexVoice.lastUser ||
        (codexVoice.status === "live" ? t("codexVoice.live") : ""),
)
</script>

{#if session.cliKind === "codex"}
  <div class="codex-voice fixed bottom-24 end-4 z-40 flex flex-col items-end gap-2" dir="auto">
    {#if caption}
      <p class="max-w-xs rounded-lg px-3 py-2 text-sm shadow" style="background:var(--surface); color:var(--fg)">
        {caption}
      </p>
    {/if}
    <button
      type="button"
      class="flex h-14 w-14 items-center justify-center rounded-full border-none shadow-lg"
      style:background={codexVoice.active ? "var(--recording)" : "var(--accent)"}
      style="color:#fff"
      onclick={toggle}
      aria-pressed={codexVoice.active}
      aria-label={codexVoice.active ? t("codexVoice.stop") : t("codexVoice.start")}
      title={codexVoice.active ? t("codexVoice.stop") : t("codexVoice.start")}
    >
      {#if codexVoice.active}<MicOffIcon size={26} />{:else}<MicIcon size={26} />{/if}
    </button>
  </div>
{/if}
