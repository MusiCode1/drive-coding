<script lang="ts">
/**
 * SessionCard — כרטיס סשן ב-SessionsDialog (מוקאפ 293-301, 664-695).
 *
 * ─── redesign-6 ───
 */
import type { SessionInfo } from "$lib/adapters/sessions"

interface Props {
  session: SessionInfo
  isActive?: boolean
  onSelect: () => void
}

const { session, isActive = false, onSelect }: Props = $props()

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
</script>

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
    <div class="text-sm font-medium truncate">{session.title || session.sessionId.slice(0, 8)}</div>
    <div class="text-xs truncate" style="color:var(--fg-dim)">
      {session.cwd} · {formatDate(session.updatedAt)}
    </div>
  </div>
</button>
