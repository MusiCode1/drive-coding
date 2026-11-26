<script lang="ts">
import type { Snippet } from "svelte"
import { getI18n, getResponsive, getSettings } from "$lib/context"
import type { AgentListView } from "$lib/view-models/settings-persistence"

const { children }: { children: Snippet<[AgentListView]> } = $props()
const settings = getSettings()
const responsive = getResponsive()
const { t } = getI18n()
const view = $derived(settings.getAgentListView(responsive.isMobile))
</script>

<div class="mode-toggle" role="group" aria-label={t("connect.agents.tree.view")}>
  <button type="button" aria-pressed={view === "tree"} onclick={() => settings.setAgentListView("tree")}>
    {t("connect.agents.tree.viewTree")}
  </button>
  <button type="button" aria-pressed={view === "flat"} onclick={() => settings.setAgentListView("flat")}>
    {t("connect.agents.tree.viewFlat")}
  </button>
</div>
{@render children(view)}

<style>
  .mode-toggle {
    display: flex;
    gap: 0.35rem;
    padding: 0.45rem 0.9rem;
  }

  button {
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.2rem 0.55rem;
    color: var(--fg-dim);
    font-size: 0.75rem;
  }

  button[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--fg);
  }
</style>
