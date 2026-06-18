<script lang="ts">
/**
 * TypeArea — textarea + שליחה (מצב הקלדה ב-RecordFooter).
 *
 * לוגיקת onSubmit: מ-ChatInput הישן (trim + sendPrompt + clear).
 * ChatInput נמחק ב-C4; TypeArea מחליף אותו.
 *
 * Enter: בדסקטופ Enter=שלח, Shift+Enter=שורה חדשה. במובייל (responsive.isMobileDevice)
 * Enter = שורה חדשה רגילה, והשליחה רק דרך כפתור ה-send — כדי לא להילחם במקלדת
 * הווירטואלית. ─── ui-polish-batch-2 · Enter ───
 *
 * ─── record-footer (redesign-4) ───
 */
import SendIcon from "@lucide/svelte/icons/send"
import { getI18n, getResponsive, getSession } from "$lib/context"

const session = getSession()
const responsive = getResponsive()
const t = getI18n().t

let promptText = $state("")

const isDisabled = $derived(session.status !== "connected")

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
  class="flex gap-2 items-stretch w-full"
>
  <textarea
    bind:value={promptText}
    placeholder={t("record.placeholder")}
    rows={2}
    disabled={isDisabled}
    class="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none border"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
    onkeydown={(e) => {
      // דסקטופ בלבד: Enter שולח. במובייל Enter נופל ל-textarea (שורה חדשה).
      // !e.isComposing — לא לשלוח באמצע הקלדת IME / ניקוד.
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.isComposing &&
        !responsive.isMobileDevice
      ) {
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
