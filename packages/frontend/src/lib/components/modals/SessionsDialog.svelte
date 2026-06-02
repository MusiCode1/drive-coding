<script lang="ts">
/**
 * SessionsDialog — E1: פופ-אפ סשנים אחרונים (redesign-6).
 *
 * Bits Dialog עם: רשימת SessionInfo, רענן, בחירה → loadSession + goto("/chat").
 * מוקאפ: 652-697.
 *
 * ─── redesign-6 ───
 */
import { goto } from "$app/navigation"
import { Dialog as BitsDialog } from "bits-ui"
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getSettings, getSession, getModals } from "$lib/context"
import { listSessionsForCwd } from "$lib/adapters/sessions"
import type { SessionInfo } from "$lib/adapters/sessions"
import SessionCard from "./SessionCard.svelte"

const t = getI18n().t
const settings = getSettings()
const session = getSession()
const modals = getModals()

let sessions = $state<SessionInfo[]>([])
let loading = $state(false)
let error = $state<string | null>(null)

// טעינה ב-$effect כשה-dialog נפתח (onOpenChange לא נורה בפתיחה programmatic ב-Bits controlled mode)
$effect(() => {
  if (modals.sessionsOpen) void loadSessions()
})

async function loadSessions() {
  loading = true
  error = null
  try {
    sessions = await listSessionsForCwd(settings.lastCwd, settings.cliKind)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    loading = false
  }
}

// onOpenChange רק לסנכרון close
function onOpenChange(open: boolean) {
  modals.sessionsOpen = open
}

async function selectSession(info: SessionInfo) {
  modals.closeSessions()
  await session.loadSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
  })
  await goto("/chat")
}

function newSession() {
  modals.closeSessions()
}
</script>

<BitsDialog.Root open={modals.sessionsOpen} {onOpenChange}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
    <BitsDialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
        style="background:var(--bg-elev); border:1px solid var(--border); max-height:80dvh"
      >
        <!-- header -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color:var(--border)">
          <BitsDialog.Title class="text-lg font-semibold">
            {t("modal.sessions.title")}
          </BitsDialog.Title>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border"
              style="background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"
              onclick={loadSessions}
              disabled={loading}
            >
              <RefreshCwIcon size={14} strokeWidth={2} />
              {t("modal.sessions.refresh")}
            </button>
            <BitsDialog.Close
              class="size-8 grid place-items-center rounded-lg"
              style="color:var(--fg-dim)"
              aria-label={t("modal.close")}
            >
              <XIcon size={16} strokeWidth={2} />
            </BitsDialog.Close>
          </div>
        </div>

        <!-- body -->
        <div class="flex-1 overflow-y-auto chat-scroll px-4 py-3 flex flex-col gap-2">
          {#if loading}
            <div class="text-center py-8 opacity-50 text-sm">{t("modal.sessions.loading")}</div>
          {:else if error}
            <div class="text-center py-4 text-sm" style="color:var(--recording)">{t("modal.sessions.error")}: {error}</div>
          {:else if sessions.length === 0}
            <div class="text-center py-8 opacity-50 text-sm">{t("modal.sessions.empty")}</div>
          {:else}
            {#each sessions as s (s.sessionId)}
              <SessionCard
                session={s}
                isActive={false}
                onSelect={() => selectSession(s)}
              />
            {/each}
          {/if}

          <!-- סשן חדש -->
          <button
            class="text-start rounded-2xl border-2 border-dashed p-3.5 flex items-center justify-center gap-2 text-sm font-medium mt-1"
            style="border-color:var(--border-str); color:var(--accent-hi)"
            onclick={newSession}
          >
            ＋ {t("modal.sessions.new")}
          </button>
        </div>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>
