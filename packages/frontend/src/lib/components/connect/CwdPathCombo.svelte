<script lang="ts">
/**
 * CwdPathCombo — cwd input + recent-paths dropdown (slice cwd-path-combo).
 *
 * Decisions (§3א, locked):
 * - Opens on input focus only when value is empty; otherwise arrow only.
 * - Selection fills value only — does not connect (connect stays on submit button).
 * - Popover/Dialog pattern from Select.svelte; search box lives inside the menu (§3ב).
 *
 * Arrow placement: end of row (after input, visually adjacent to typed path).
 * Search box: top of menu (receives focus on open — conventional filter UX).
 */

import ChevronDownIcon from "@lucide/svelte/icons/chevron-down"
import FolderIcon from "@lucide/svelte/icons/folder"
import { Dialog, Popover } from "bits-ui"
import type { RecentProject } from "$lib/adapters/recent-projects"
import CwdPathComboRow from "$lib/components/connect/CwdPathComboRow.svelte"
import {
  applyMenuSearchQuery,
  applyPathSelection,
  openFromArrow,
  shouldOpenOnFocus,
} from "$lib/components/connect/cwd-path-combo-logic"
import { getI18n, getRecentProjects, getResponsive } from "$lib/context"
import { filterPaths } from "$lib/util/filter-paths"

/** Max rows when search query is empty (§8 — adjust with visual check). */
const DISPLAY_LIMIT = 20

interface Props {
  value?: string
  placeholder?: string
  disabled?: boolean
  /** Controls `.cwd-row` dir — folder button uses order:-1 for RTL/LTR parity. */
  isRtl?: boolean
  onFolderPick?: () => void
  folderLabel?: string
}

let {
  value = $bindable(""),
  placeholder = "",
  disabled = false,
  isRtl = false,
  onFolderPick,
  folderLabel = "",
}: Props = $props()

const responsive = getResponsive()
const recent = getRecentProjects()
const i18n = getI18n()
const t = i18n.t

let open = $state(false)
let query = $state("")
let rowEl = $state<HTMLDivElement | null>(null)
let rowWidth = $state(0)

$effect(() => {
  const el = rowEl
  if (!el) return
  const sync = () => {
    rowWidth = el.clientWidth
  }
  sync()
  const ro = new ResizeObserver(sync)
  ro.observe(el)
  return () => ro.disconnect()
})

const filtered = $derived(filterPaths(recent.projects, query, DISPLAY_LIMIT))

function onInputFocus() {
  if (shouldOpenOnFocus(value)) {
    const next = openFromArrow()
    query = next.query
    open = next.open
  }
}

function onArrowOpen() {
  const next = openFromArrow()
  query = next.query
  open = next.open
}

function onSearchInput(e: Event) {
  const next = applyMenuSearchQuery({ query, open }, (e.currentTarget as HTMLInputElement).value)
  query = next.query
}

function pick(project: RecentProject) {
  const result = applyPathSelection(project.cwd)
  value = result.value
  query = result.state.query
  open = result.state.open
}
</script>

<!-- bind:this on row — Popover content width tracks full row, not arrow trigger (§2ג, §4). -->
<div class="cwd-row" dir={isRtl ? "rtl" : "ltr"} bind:this={rowEl}>
  <input
    type="text"
    bind:value
    {placeholder}
    dir="ltr"
    {disabled}
    onfocus={onInputFocus}
  />
  <button
    type="button"
    class="folder-btn"
    style="order: -1"
    onclick={() => onFolderPick?.()}
    {disabled}
    aria-label={folderLabel}
    title={folderLabel}
  >
    <FolderIcon size={18} strokeWidth={1.75} />
  </button>

  {#if responsive.isMobile}
    <button
      type="button"
      class="combo-arrow"
      {disabled}
      aria-label={t("connect.cwd.combo.toggle")}
      aria-expanded={open}
      onclick={onArrowOpen}
    >
      <ChevronDownIcon size={18} strokeWidth={1.75} />
    </button>

    <Dialog.Root bind:open>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm max-h-[70dvh] flex flex-col rounded-2xl border shadow-xl overflow-hidden"
          style="background:var(--bg-elev); border-color:var(--border)"
        >
          <div class="flex flex-col min-h-0">
            <div class="combo-search-wrap">
              <input
                type="search"
                class="combo-search"
                value={query}
                oninput={onSearchInput}
                placeholder={t("connect.cwd.combo.searchPlaceholder")}
                dir="ltr"
              />
            </div>
            {@render menuBody()}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {:else}
    <Popover.Root bind:open>
      <Popover.Trigger
        class="combo-arrow"
        {disabled}
        aria-label={t("connect.cwd.combo.toggle")}
        onclick={() => {
          query = ""
        }}
      >
        <ChevronDownIcon size={18} strokeWidth={1.75} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          class="z-50 max-h-[60dvh] min-w-[16rem] max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden combo-popover-content"
          style="background:var(--bg-elev); border-color:var(--border); width:{rowWidth}px"
        >
          <div class="combo-search-wrap">
            <input
              type="search"
              class="combo-search"
              value={query}
              oninput={onSearchInput}
              placeholder={t("connect.cwd.combo.searchPlaceholder")}
              dir="ltr"
            />
          </div>
          {@render menuBody()}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  {/if}
</div>

{#snippet menuBody()}
  <div class="combo-list chat-scroll">
    {#if recent.error}
      <div class="combo-status">{t("connect.cwd.combo.loadError")}</div>
    {:else if recent.loading && recent.projects.length === 0}
      <div class="combo-status">…</div>
    {:else if filtered.length === 0}
      <div class="combo-status">{t("connect.cwd.combo.empty")}</div>
    {:else}
      {#each filtered as project (project.cwd)}
        <CwdPathComboRow {project} onPick={pick} />
      {/each}
    {/if}
  </div>
{/snippet}

<style>
  /* Moved from +page.svelte — scoped here so the cwd input keeps its visual identity (§4 Commit 1). */
  .cwd-row {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }

  .cwd-row input {
    flex: 1;
    min-width: 0;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg);
  }

  .cwd-row input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  .cwd-row .folder-btn {
    align-self: stretch;
  }

  .folder-btn {
    flex-shrink: 0;
    margin-top: 0;
    display: grid;
    place-items: center;
    padding: 0 0.7rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg-dim);
    cursor: pointer;
  }

  .folder-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .folder-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .combo-arrow {
    flex-shrink: 0;
    margin-top: 0;
    display: grid;
    place-items: center;
    padding: 0 0.55rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg-dim);
    cursor: pointer;
  }

  .combo-arrow:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .combo-arrow:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .combo-search-wrap {
    padding: 0.5rem 0.5rem 0;
    flex-shrink: 0;
  }

  .combo-search {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.65rem;
    font-size: 0.875rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--fg);
  }

  .combo-search:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  .combo-list {
    overflow-y: auto;
    padding: 0.25rem 0.5rem 0.5rem;
    max-height: min(50dvh, 20rem);
  }

  .combo-status {
    padding: 0.75rem 0.5rem;
    font-size: 0.85rem;
    color: var(--fg-dim);
    text-align: center;
  }

</style>
