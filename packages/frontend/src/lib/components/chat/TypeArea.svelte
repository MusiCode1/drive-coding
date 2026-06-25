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
import { getI18n, getSession, getSettings } from "$lib/context"

const session = getSession()
const settings = getSettings()
const t = getI18n().t

let promptText = $state("")
let taEl = $state<HTMLTextAreaElement>()
const MAX_ROWS = 6

// גדל עם התוכן עד תקרה; ה-effect רץ גם בהקלדה וגם בכיווץ פרוגרמטי (promptText="")
$effect(() => {
  promptText // dependency — re-run on every value change
  const el = taEl
  if (!el) return
  el.style.height = "auto"            // קודם מאפסים כדי שה-scrollHeight ישקף את התוכן הנוכחי
  el.style.height = `${el.scrollHeight}px`
})

const isDisabled = $derived(
  session.status !== "connected"
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
    bind:this={taEl}
    bind:value={promptText}
    placeholder={t("record.placeholder")}
    rows={1}
    disabled={isDisabled}
    class="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none border"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg); max-height:calc({MAX_ROWS} * 1.5em + 1.25rem); overflow-y:auto"
    onkeydown={(e) => {
      // Cmd/Ctrl+Enter תמיד שולח (power-user, ללא תלות בהגדרה)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        onSubmit()
        return
      }
      // Enter רגיל שולח רק כש-enterToSend פעיל; Shift+Enter תמיד שורה חדשה
      if (e.key === "Enter" && !e.shiftKey && settings.enterToSend) {
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
