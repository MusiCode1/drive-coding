<script lang="ts">
/**
 * TypeArea — textarea + שליחה (מצב הקלדה ב-RecordFooter).
 *
 * לוגיקת onSubmit: מ-ChatInput הישן (trim + sendPrompt + clear; Enter=שלח, Shift+Enter=שורה).
 * ChatInput נמחק ב-C4; TypeArea מחליף אותו.
 *
 * ─── record-footer (redesign-4) ───
 */
import SendIcon from "@lucide/svelte/icons/send"
import { getI18n, getSession } from "$lib/context"

const session = getSession()
const t = getI18n().t

let promptText = $state("")

const isDisabled = $derived(
  session.status !== "connected" && session.status !== "thinking"
)

function onSubmit(e?: SubmitEvent) {
  e?.preventDefault()
  const text = promptText.trim()
  if (!text || isDisabled) return
  session.sendPrompt(text)
  promptText = ""
}
</script>

<form
  onsubmit={onSubmit}
  class="flex gap-2 items-end w-full"
>
  <textarea
    bind:value={promptText}
    placeholder={t("record.placeholder")}
    rows={2}
    disabled={isDisabled}
    class="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none border"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
    onkeydown={(e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    }}
  ></textarea>

  <button
    type="submit"
    disabled={!promptText.trim() || isDisabled}
    class="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 shrink-0"
    style="background:var(--accent); color:white"
    aria-label={t("record.send")}
  >
    <SendIcon size={16} strokeWidth={2} style="transform:scaleX(-1)" />
  </button>
</form>
