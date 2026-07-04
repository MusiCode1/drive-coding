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

interface Props {
  session: SessionInfo
  isActive?: boolean
  onSelect: () => void
}

const { session, isActive = false, onSelect }: Props = $props()
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
    <div class="flex-1 min-w-0">
      <div class="text-sm font-medium line-clamp-2">{session.title || session.sessionId.slice(0, 8)}</div>
      <div class="text-xs truncate" style="color:var(--fg-dim)">
        {session.cwd} · {formatDate(session.updatedAt)}
      </div>
    </div>
  </button>
  <button
    class="absolute top-2 inline-end-2 p-1.5 rounded-lg opacity-70 hover:opacity-100"
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
</div>
