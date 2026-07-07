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
import type { AvailableCommand } from "@agentclientprotocol/sdk"
import ImagePlusIcon from "@lucide/svelte/icons/image-plus"
import SendIcon from "@lucide/svelte/icons/send"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getSession, getSettings } from "$lib/context"
import {
  fileToImageAttachment,
  type ImageAttachment,
  revokeAttachment,
} from "$lib/engines/image-attachment"
import { applySlashSelection, matchSlashCommands } from "$lib/engines/slash-commands"
import SlashCommandMenu from "./SlashCommandMenu.svelte"

const session = getSession()
const settings = getSettings()
const t = getI18n().t

let promptText = $state("")
let taEl = $state<HTMLTextAreaElement>()
const MAX_ROWS = 6

// ─── image-attach tray state ─── (slice-image-paste)
let attachments = $state<ImageAttachment[]>([])
let fileInputEl = $state<HTMLInputElement>()

// ─── slash-command dropdown state ─── (slice-slash-commands, Commit 2)
let dismissed = $state(false)
let selectedIndex = $state(0)
const slash = $derived(matchSlashCommands(promptText, session.availableCommands))
const menuOpen = $derived(!!slash && slash.matches.length > 0 && !dismissed)

// dismissed מתאפס בכל שינוי-query (המשתמש ממשיך להקליד → פותחים מחדש)
$effect(() => {
  slash?.query // dependency
  dismissed = false
})

// selectedIndex מתאפס כשרשימת ה-matches משתנה (הדגשה תמיד מתחילה מהראשון)
$effect(() => {
  slash?.matches.length // dependency
  selectedIndex = 0
})

function acceptSlashSelection(cmd: AvailableCommand): void {
  promptText = applySlashSelection(cmd)
  dismissed = false
  taEl?.focus()
}

// ─── מיקום ה-dropdown (portal ל-body — נחתך ע"י overflow:hidden של record-pane-inner
// אם היה absolute רגיל; ר' הערת SlashCommandMenu.svelte) ─── (slice-slash-commands)
let menuRect = $state<{ top: number; left: number; width: number } | null>(null)

function updateMenuRect(): void {
  const el = taEl
  if (!el) {
    menuRect = null
    return
  }
  const r = el.getBoundingClientRect()
  menuRect = { top: r.top, left: r.left, width: r.width }
}

$effect(() => {
  if (!menuOpen) {
    menuRect = null
    return
  }
  updateMenuRect()
  window.addEventListener("resize", updateMenuRect)
  window.addEventListener("scroll", updateMenuRect, true) // capture — תופס גם גלילת אב
  return () => {
    window.removeEventListener("resize", updateMenuRect)
    window.removeEventListener("scroll", updateMenuRect, true)
  }
})

// גדל עם התוכן עד תקרה; scrollbar מופיע רק כשהתוכן חותך את ה-max-height
$effect(() => {
  promptText // dependency — re-run on every value change
  const el = taEl
  if (!el) return
  el.style.height = "auto" // קודם מאפסים כדי שה-scrollHeight ישקף את התוכן הנוכחי
  const maxH = parseFloat(getComputedStyle(el).maxHeight) // px מה-max-height ב-CSS
  const needed = el.scrollHeight
  const clamped = Number.isFinite(maxH) && needed > maxH
  el.style.height = clamped ? `${maxH}px` : `${needed}px`
  el.style.overflowY = clamped ? "auto" : "hidden" // scrollbar רק כשבאמת חתוך
})

const isDisabled = $derived(session.status !== "connected")

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

    <!-- ─── wrapper: מארח את ה-textarea (ה-dropdown עצמו portal-ל-body — ר' SlashCommandMenu.svelte) ─── -->
    <div class="flex-1">
    {#if menuOpen && slash && menuRect}
      <SlashCommandMenu
        matches={slash.matches}
        {selectedIndex}
        onselect={acceptSlashSelection}
        rect={menuRect}
      />
    {/if}
    <textarea
      bind:this={taEl}
      bind:value={promptText}
      placeholder={t("record.placeholder")}
      rows={1}
      disabled={isDisabled}
      role="combobox"
      aria-expanded={menuOpen}
      aria-controls={menuOpen ? "slash-listbox" : undefined}
      aria-activedescendant={menuOpen ? `slash-opt-${selectedIndex}` : undefined}
      class="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none border"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg); max-height:calc({MAX_ROWS} * 1.5em + 1.25rem)"
      onpaste={handlePaste}
      onkeydown={(e) => {
        // ─── slice-slash-commands: keydown-intercept לדפדוף-בתפריט ───────────
        // Cmd/Ctrl+Enter תמיד שולח — לא נבלע כאן (החרגת המקש המשולב במפורש).
        // `&& slash` נחוץ ל-narrowing: menuOpen הוא derived נפרד ולא מצמצם את slash ל-non-null.
        if (menuOpen && slash && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
          const n = slash.matches.length
          if (e.key === "ArrowDown") {
            e.preventDefault()
            selectedIndex = (selectedIndex + 1) % n
            return
          }
          if (e.key === "ArrowUp") {
            e.preventDefault()
            selectedIndex = (selectedIndex - 1 + n) % n
            return
          }
          // listbox parity (slice-slash-menu-native, Commit 1): Home/End קופצים לקצוות.
          if (e.key === "Home") {
            e.preventDefault()
            selectedIndex = 0
            return
          }
          if (e.key === "End") {
            e.preventDefault()
            selectedIndex = n - 1
            return
          }
          // Enter רגיל בוחר (לא Shift+Enter — שורה-חדשה נשמרת); Tab בוחר.
          if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
            const cmd = slash.matches[selectedIndex]
            if (cmd) {
              e.preventDefault()
              acceptSlashSelection(cmd)
              return
            }
          }
          if (e.key === "Escape") {
            e.preventDefault()
            dismissed = true
            return
          }
        }

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
    </div>

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
