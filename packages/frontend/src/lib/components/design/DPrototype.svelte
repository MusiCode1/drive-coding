<script lang="ts">
/** DPrototype — renders the clickable mock; all state and transitions live in ProtoFlow. */
import { untrack } from "svelte"
import type { DesignLang } from "./content"
import DChat from "./DChat.svelte"
import DConnect from "./DConnect.svelte"
import DOverlay from "./DOverlay.svelte"
import DSettings from "./DSettings.svelte"
import DUsage from "./DUsage.svelte"
import { ProtoFlow } from "./proto-flow.svelte"

let { lang = "he", palette = "ember" }: { lang?: DesignLang; palette?: string } = $props()
const f = new ProtoFlow(untrack(() => lang))
</script>

<div class="proto dv2" data-palette={palette} dir={f.lang === "he" ? "rtl" : "ltr"} lang={f.lang}>
  <div class="screen">
    {#if f.screen === "connect"}
      <DConnect content={f.content} state={f.connectView} cli={f.cli} cwd={f.cwd} on={f.connectOn} />
    {:else if f.screen === "chat"}
      <DChat
        content={f.content}
        state={f.chatState}
        tab={f.tab}
        panelOpen={f.panelOpen}
        muted={f.muted}
        userText={f.userText}
        cli={f.sessionCli}
        folder={f.sessionFolder}
        on={f.chatOn}
        panelOn={f.panelOn}
      />
    {:else if f.screen === "settings"}
      <DSettings content={f.content} {palette} on={f.settingsOn} />
    {:else}
      <DUsage content={f.content} on={f.usageOn} />
    {/if}
  </div>
  {#if f.popup}
    <DOverlay content={f.content} kind={f.popup} on={f.overlayOn} />
  {/if}
</div>

<style>
  .proto { position: relative; block-size: 100dvh; overflow: hidden; }
  .screen { block-size: 100%; overflow: auto; }
</style>
