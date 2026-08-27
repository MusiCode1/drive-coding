<script lang="ts">
/**
 * ToolKindIcon — per-kind Lucide icon for tool bubble summary (tool-render-fidelity).
 */
import TerminalIcon from "@lucide/svelte/icons/terminal"
import FileTextIcon from "@lucide/svelte/icons/file-text"
import FilePenIcon from "@lucide/svelte/icons/file-pen"
import SearchIcon from "@lucide/svelte/icons/search"
import WrenchIcon from "@lucide/svelte/icons/wrench"
import GlobeIcon from "@lucide/svelte/icons/globe"
import BrainIcon from "@lucide/svelte/icons/brain"
import Trash2Icon from "@lucide/svelte/icons/trash-2"
import ArrowRightLeftIcon from "@lucide/svelte/icons/arrow-right-left"
import ToggleLeftIcon from "@lucide/svelte/icons/toggle-left"
import type { Component } from "svelte"

let { kind }: { kind?: string } = $props()

const KIND_ICONS: Record<string, Component<{ size?: number; strokeWidth?: number }>> = {
  execute: TerminalIcon,
  read: FileTextIcon,
  edit: FilePenIcon,
  search: SearchIcon,
  other: WrenchIcon,
  fetch: GlobeIcon,
  think: BrainIcon,
  delete: Trash2Icon,
  move: ArrowRightLeftIcon,
  switch_mode: ToggleLeftIcon,
}

const Icon = $derived(KIND_ICONS[kind ?? ""] ?? WrenchIcon)
</script>

<span class="tool-kind-icon" aria-hidden="true">
  <Icon size={14} strokeWidth={1.75} />
</span>

<style>
  .tool-kind-icon {
    display: inline-flex;
    shrink: 0;
    color: var(--fg-dim);
  }
</style>
