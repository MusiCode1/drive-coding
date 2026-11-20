<script lang="ts">
import type { DesignContent } from "./content"
import DChat from "./DChat.svelte"
import DConnect from "./DConnect.svelte"
import DOverlay from "./DOverlay.svelte"
import type { PopupKind } from "./proto"

let { content, state: view }: { content: DesignContent; state: string } = $props()
const onConnect = $derived(["folderPicker", "cwdCombo", "select", "langSelect"].includes(view))
</script>

<div class="pop-stage">
  <div class="behind" aria-hidden="true">
    {#if onConnect}<DConnect {content} state="default" />{:else}<DChat {content} state={view === "slash" ? "typing" : "conversation"} />{/if}
  </div>
  <DOverlay {content} kind={view as PopupKind} />
</div>

<style>
  .pop-stage { position: relative; block-size: 100dvh; overflow: hidden; }
  .behind { block-size: 100%; overflow: hidden; pointer-events: none; }
</style>
