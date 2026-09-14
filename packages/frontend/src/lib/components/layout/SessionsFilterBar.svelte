<script lang="ts">
/**
 * SessionsFilterBar — search + cwd scope toggle for the inline sessions list.
 * Props only; parent owns query state and persisted cwd-only preference.
 */
import FolderIcon from "@lucide/svelte/icons/folder"
import FoldersIcon from "@lucide/svelte/icons/folders"
import { getI18n } from "$lib/context"

interface Props {
  query: string
  onQueryChange: (value: string) => void
  currentCwdOnly: boolean
  onCurrentCwdOnlyChange: (value: boolean) => void
}

const { query, onQueryChange, currentCwdOnly, onCurrentCwdOnlyChange }: Props = $props()
const t = getI18n().t

const filterLabel = $derived(
  currentCwdOnly ? t("sidebar.sessionsFilterCwd") : t("sidebar.sessionsFilterAll"),
)
</script>

<div class="flex items-center gap-2 px-1 shrink-0">
  <input
    type="search"
    class="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[13px] outline-none border"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
    dir="auto"
    value={query}
    placeholder={t("sidebar.sessionsSearch")}
    aria-label={t("sidebar.sessionsSearch")}
    oninput={(e) => onQueryChange((e.currentTarget as HTMLInputElement).value)}
  />
  <button
    type="button"
    class="size-8 grid place-items-center rounded-lg shrink-0 border"
    style={currentCwdOnly
      ? "background:var(--accent-soft); border-color:var(--accent); color:var(--accent)"
      : "background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"}
    aria-pressed={currentCwdOnly}
    title={filterLabel}
    aria-label={filterLabel}
    onclick={() => onCurrentCwdOnlyChange(!currentCwdOnly)}
  >
    {#if currentCwdOnly}
      <FolderIcon size={15} strokeWidth={2} />
    {:else}
      <FoldersIcon size={15} strokeWidth={2} />
    {/if}
  </button>
</div>
