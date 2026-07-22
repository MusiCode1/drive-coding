<script lang="ts">
/**
 * SessionCard — כרטיס סשן ב-SessionsDialog (מוקאפ 293-301, 664-695).
 *
 * ─── redesign-6 ───
 * ─── ui-session-polish: כפתור העתקת-מזהה-סשן (fix3) ───
 */
import type { SessionInfo } from "$lib/adapters/sessions"
import { getI18n } from "$lib/context"
import { copyToClipboard } from "$lib/util/clipboard"
import CopyIcon from "@lucide/svelte/icons/copy"
import CheckIcon from "@lucide/svelte/icons/check"
// ─── slice session-delete ───
import Trash2Icon from "@lucide/svelte/icons/trash-2"

interface Props {
  session: SessionInfo
  isActive?: boolean
  onSelect: () => void
  // ─── slice session-delete: אופציונלי — לא מופיע אם לא סופק (gate ב-SessionOptionsPanel) ───
  onDelete?: (sessionId: string) => void
}

const { session, isActive = false, onSelect, onDelete }: Props = $props()
const t = getI18n().t

function formatDate(iso: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

let copied = $state(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function handleCopy(e: MouseEvent) {
  e.stopPropagation()  // מונע הפעלת onSelect של הכרטיס
  const ok = await copyToClipboard(session.sessionId)
  if (ok) {
    copied = true
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
      copyTimer = null
    }, 2000)
  }
}

// ─── slice session-delete: אישור 2-קליקים — עקבי עם ActiveProcessesPanel kill (:70-88) ───
let confirmingDelete = $state(false)
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null

function handleDelete(e: MouseEvent) {
  e.stopPropagation()  // מונע הפעלת onSelect של הכרטיס
  if (confirmingDelete) {
    // לחיצה שנייה — בצע
    if (deleteConfirmTimer !== null) {
      clearTimeout(deleteConfirmTimer)
      deleteConfirmTimer = null
    }
    confirmingDelete = false
    onDelete?.(session.sessionId)
  } else {
    // לחיצה ראשונה — בקש אישור
    if (deleteConfirmTimer !== null) clearTimeout(deleteConfirmTimer)
    confirmingDelete = true
    deleteConfirmTimer = setTimeout(() => {
      confirmingDelete = false
      deleteConfirmTimer = null
    }, 3000)
  }
}
</script>

<div class="relative">
  <button
    class="text-start rounded-2xl border p-3.5 flex items-center gap-3 w-full"
    style={isActive
      ? "background:var(--accent-soft); border-color:var(--accent)"
      : "background:var(--bg-elev); border-color:var(--border)"}
    onclick={onSelect}
  >
    <span
      class="size-2.5 rounded-full shrink-0"
      style={isActive
        ? "background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)"
        : "background:var(--fg-muted)"}
    ></span>
    <div class="flex-1 min-w-0 pe-16">
      <div class="text-sm font-medium line-clamp-2">{session.title || session.sessionId.slice(0, 8)}</div>
      <div class="text-xs truncate" style="color:var(--fg-dim)">
        {session.cwd} · {formatDate(session.updatedAt)}
      </div>
    </div>
  </button>
  <!-- ─── slice session-delete: קיבוץ actions (העתק + מחק) לשורה אחת באותו עוגן end-2,
       למניעת חפיפה — כפתור-מחק שני מוחלט באותו slot היה מתנגש עם העתק-מזהה הקיים ─── -->
  <div class="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
    <button
      class="p-1.5 rounded-lg opacity-70 hover:opacity-100"
      aria-label={copied ? t("bubble.copied") : t("session.copyId")}
      title={copied ? t("bubble.copied") : t("session.copyId")}
      onclick={handleCopy}
    >
      {#if copied}
        <CheckIcon size={14} />
      {:else}
        <CopyIcon size={14} />
      {/if}
    </button>
    {#if onDelete}
      <div class="relative">
        <button
          class="p-1.5 rounded-lg opacity-70 hover:opacity-100"
          style={confirmingDelete ? "color:var(--recording); opacity:1" : ""}
          aria-label={confirmingDelete ? t("session.deleteConfirm") : t("session.delete")}
          title={confirmingDelete ? t("session.deleteConfirm") : t("session.delete")}
          onclick={handleDelete}
        >
          <Trash2Icon size={14} />
        </button>
        {#if confirmingDelete}
          <span
            role="status"
            class="absolute bottom-full end-0 mb-1 px-1.5 py-0.5 rounded whitespace-nowrap text-[11px] font-semibold pointer-events-none"
            style="background:var(--recording); color:#fff"
          >
            {t("session.deleteConfirm")}
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>
