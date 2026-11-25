<script lang="ts">
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import { untrack } from "svelte"
import type { SessionInfo } from "$lib/adapters/sessions"
import SessionCard from "$lib/components/modals/SessionCard.svelte"
import { getI18n } from "$lib/context"
import { filterSessions } from "$lib/util/filter-sessions"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import SessionsFilterBar from "./SessionsFilterBar.svelte"

interface Props {
  session: Pick<
    AgentSession,
    | "status"
    | "agentId"
    | "cwd"
    | "sessionsCache"
    | "supportsSessionDelete"
    | "listSessions"
    | "loadMoreSessions"
  >
  visible: boolean
  currentCwdOnly: boolean
  onCurrentCwdOnlyChange(value: boolean): void
  onSelectSession(info: SessionInfo): void
  onNewSession(): void
  onDeleteSession(id: string): void
}
const props: Props = $props()
const session = $derived(props.session)
const t = getI18n().t
let search = $state("")
const cache = $derived(session.sessionsCache)
const list = $derived(cache.sessions)
const firstPage = $derived(props.currentCwdOnly && session.cwd ? { cwd: session.cwd } : {})
const connected = $derived(session.status === "connected" && Boolean(session.agentId))
const supportsCwdFilter = $derived(Boolean(session.cwd) && (list.capabilities?.filterByCwd ?? true))
const filtered = $derived(
  filterSessions(list.items, {
    query: search,
    currentCwd: session.cwd,
    currentCwdOnly: props.currentCwdOnly && Boolean(session.cwd) && list.capabilities === null,
  }),
)
$effect(() => {
  const query = firstPage
  if (props.visible && connected) {
    untrack(() => void session.listSessions(false, query))
  }
})
</script>

<div class="flex flex-col gap-2 shrink-0">
  <div class="flex items-center justify-between px-1 shrink-0">
    <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
      {t("sidebar.sessions")}
    </span>
    <button
      type="button"
      class="size-6 grid place-items-center rounded disabled:opacity-40"
      style="color:var(--fg-dim)"
      title={t("sidebar.refresh")}
      aria-label={t("sidebar.refresh")}
      disabled={!connected}
      onclick={() => void session.listSessions(true, firstPage)}
    >
      <RefreshCwIcon size={13} strokeWidth={2} />
    </button>
  </div>

  <SessionsFilterBar
    query={search}
    onQueryChange={(value) => (search = value)}
    showCwdFilter={supportsCwdFilter}
    currentCwdOnly={props.currentCwdOnly && supportsCwdFilter}
    onCurrentCwdOnlyChange={props.onCurrentCwdOnlyChange}
  />

  <button
    type="button"
    class="shrink-0 text-start rounded-lg p-2.5 text-[13px] font-medium border border-dashed disabled:opacity-40 disabled:cursor-not-allowed"
    style="border-color:var(--border); color:var(--accent)"
    disabled={session.status !== "connected"}
    onclick={props.onNewSession}
  >
    ＋ {t("sidebar.newSession")}
  </button>

  <div class="flex flex-col gap-2" aria-busy={cache.loading}>
    {#each filtered as info (info.sessionId)}
      <SessionCard
        session={info}
        isActive={false}
        onSelect={() => props.onSelectSession(info)}
        onDelete={session.supportsSessionDelete ? props.onDeleteSession : undefined}
      />
    {/each}

    {#if cache.loading}
      <div class="text-[12px] opacity-50 px-1" role="status">{t("modal.sessions.loading")}</div>
    {:else if cache.error}
      <div class="text-[12px] px-1" style="color:var(--recording)" role="status">{t("modal.sessions.error")}: {cache.error}</div>
    {:else if list.capabilities?.list === false}
      <div class="text-[12px] opacity-50 px-1">{t("sidebar.sessionsUnsupported")}</div>
    {:else if list.items.length === 0}
      {#if list.nextCursor === undefined}
        <div class="text-[12px] opacity-50 px-1">{t("modal.sessions.empty")}</div>
      {/if}
    {:else if filtered.length === 0}
      <div class="text-[12px] opacity-50 px-1">{t("sidebar.sessionsNoMatches")}</div>
    {/if}

    {#if list.nextCursor !== undefined}
      <button
        type="button"
        class="rounded-lg py-2 px-2.5 text-[13px] border disabled:opacity-40"
        style="border-color:var(--border); color:var(--accent)"
        disabled={cache.loading || !connected}
        onclick={() => void session.loadMoreSessions()}
      >
        {t("sidebar.sessionsLoadMore")}
      </button>
    {/if}
  </div>
</div>
