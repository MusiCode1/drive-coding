<script lang="ts">
/**
 * TypeArea — textarea + שליחה (מצב הקלדה ב-RecordFooter).
 *
 * לוגיקת onSubmit: מ-ChatInput הישן (trim + sendPrompt + clear; Enter=שלח, Shift+Enter=שורה).
 * ChatInput נמחק ב-C4; TypeArea מחליף אותו.
 *
 * ─── record-footer (redesign-4) ───
 *
 * slice-image-paste (Commit 2):
 *  - tray thumbnails מעל ה-form (מחוץ ל-<form items-end>)
 *  - onpaste / ondrop / file-picker → fileToImageAttachment → tray
 *  - gating: session.supportsImageInput (kill-switch IMAGE_INPUT_ENABLED כבר ב-VM)
 */
import SendIcon from "@lucide/svelte/icons/send"
import ImagePlusIcon from "@lucide/svelte/icons/image-plus"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getSession, getSettings } from "$lib/context"
import { fileToImageAttachment, revokeAttachment, type ImageAttachment } from "$lib/engines/image-attachment"

const session = getSession()
const settings = getSettings()
const t = getI18n().t

let promptText = $state("")
let taEl = $state<HTMLTextAreaElement>()
const MAX_ROWS = 6

// ─── image-attach tray state ─── (slice-image-paste)
let attachments = $state<ImageAttachment[]>([])
let fileInputEl = $state<HTMLInputElement>()

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
  // ─── slice-image-paste Commit 4b: שכבה 2 — תמונה-בלבד מותרת ───
  if ((!text && attachments.length === 0) || isDisabled) return
  session.sendPrompt(text, { attachments })
  promptText = ""
  // ─── slice-image-paste Commit 4b: ניקוי tray ───
  attachments.forEach(revokeAttachment)
  attachments = []
}

// ─── image handlers (slice-image-paste) ─────────────────────────────────────

async function processImageFile(file: File | Blob): Promise<void> {
  try {
    const att = await fileToImageAttachment(file)
    // Svelte 5: השמה (לא mutation) לריאקטיביות
    attachments = [...attachments, att]
  } catch {
    // מימד לא-נתמך / שגיאת דחיסה — התעלמות שקטה
  }
}

function handlePaste(e: ClipboardEvent): void {
  // gating: early-return בלי preventDefault אם לא תומך
  if (!session.supportsImageInput) return

  const items = e.clipboardData?.items
  if (!items) return

  let hasImage = false
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile()
      if (file) {
        hasImage = true
        void processImageFile(file)
      }
    }
  }
  // אם יש תמונה — מנע הכנסת הנתונים הגולמיים לtextarea
  if (hasImage) e.preventDefault()
  // paste של טקסט רגיל — ממשיך כרגיל (לא preventDefault)
}

function handleDragOver(e: DragEvent): void {
  if (!session.supportsImageInput) return
  e.preventDefault()
}

function handleDrop(e: DragEvent): void {
  if (!session.supportsImageInput) return
  e.preventDefault()

  const files = e.dataTransfer?.files
  if (!files) return

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      void processImageFile(file)
    }
  }
}

function handleFileChange(e: Event): void {
  if (!session.supportsImageInput) return
  const input = e.currentTarget as HTMLInputElement
  const files = input.files
  if (!files) return

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      void processImageFile(file)
    }
  }
  // reset input כדי שאפשר לבחור אותו קובץ שוב
  input.value = ""
}

function removeAttachment(att: ImageAttachment): void {
  revokeAttachment(att)
  attachments = attachments.filter((a) => a.id !== att.id)
}

function openFilePicker(): void {
  fileInputEl?.click()
}
</script>

<!-- container אנכי: tray מעל, form מתחת (לשמר items-end בתוך ה-form) -->
<div class="flex flex-col gap-1 w-full">

  <!-- ─── attachment tray (slice-image-paste) ─── -->
  {#if attachments.length > 0}
    <div class="flex flex-wrap gap-1.5 px-1">
      {#each attachments as att (att.id)}
        <div class="relative inline-flex shrink-0">
          <img
            src={att.previewUrl}
            alt={t("attach.addImage")}
            class="h-16 w-16 rounded-lg object-cover border"
            style="border-color:var(--border)"
          />
          <button
            type="button"
            onclick={() => removeAttachment(att)}
            aria-label={t("attach.remove")}
            class="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full flex items-center justify-center"
            style="background:var(--fg-dim); color:var(--bg-card)"
          >
            <XIcon size={10} strokeWidth={2.5} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- ─── form (autogrow נשמר — items-end, taEl, MAX_ROWS, rows=1) ─── -->
  <form
    onsubmit={onSubmit}
    class="flex gap-2 items-end w-full"
    ondrop={handleDrop}
    ondragover={handleDragOver}
  >
    <!-- hidden file input -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept="image/*"
      capture
      multiple
      class="hidden"
      onchange={handleFileChange}
    />

    <!-- כפתור הוספת תמונה (גלוי רק כש-supportsImageInput) -->
    {#if session.supportsImageInput}
      <button
        type="button"
        onclick={openFilePicker}
        disabled={isDisabled}
        aria-label={t("attach.addImage")}
        title={t("attach.addImage")}
        class="shrink-0 rounded-xl p-2 flex items-center"
        style="color:var(--fg-dim)"
      >
        <ImagePlusIcon size={18} strokeWidth={1.75} />
      </button>
    {/if}

    <textarea
      bind:this={taEl}
      bind:value={promptText}
      placeholder={t("record.placeholder")}
      rows={1}
      disabled={isDisabled}
      class="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none border"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg); max-height:calc({MAX_ROWS} * 1.5em + 1.25rem); overflow-y:auto"
      onpaste={handlePaste}
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

    <!-- ─── slice-image-paste Commit 4b: שכבה 1 — disabled רק אם אין טקסט ואין תמונות ─── -->
    <button
      type="submit"
      disabled={(!promptText.trim() && attachments.length === 0) || isDisabled}
      class="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 shrink-0"
      style="background:var(--accent); color:white"
      aria-label={t("record.send")}
    >
      <SendIcon size={16} strokeWidth={2} style="transform:scaleX(-1)" />
    </button>
  </form>

</div>
