<script lang="ts">
/**
 * /design/frame — renders ONE proposed screen at the real viewport size (loaded in an iframe by /design).
 * Intentional route-shell exception (like /bt-test): design mock only, not linked from the app,
 * synthetic fixtures only. Query: screen, state, lang, palette.
 */
import { page } from "$app/state"
import "$lib/components/design/tokens.css"
import { type DesignLang, type DesignScreen, designContent } from "$lib/components/design/content"
import DChat from "$lib/components/design/DChat.svelte"
import DConnect from "$lib/components/design/DConnect.svelte"
import DSettings from "$lib/components/design/DSettings.svelte"
import DUsage from "$lib/components/design/DUsage.svelte"

const q = $derived(page.url.searchParams)
const screen = $derived((q.get("screen") ?? "connect") as DesignScreen)
const state = $derived(q.get("state") ?? "default")
const lang = $derived((q.get("lang") === "en" ? "en" : "he") as DesignLang)
const palette = $derived(q.get("palette") ?? "ember")
const content = $derived(designContent(lang))
</script>

<div class="dv2 frame" data-palette={palette} dir={lang === "he" ? "rtl" : "ltr"} {lang}>
  {#if screen === "connect"}
    <DConnect {content} {state} />
  {:else if screen === "chat"}
    <DChat {content} {state} />
  {:else if screen === "panel"}
    <DChat {content} state="conversation" panelOpen />
  {:else if screen === "settings"}
    <DSettings {content} {palette} />
  {:else}
    <DUsage {content} />
  {/if}
</div>

<style>
  .frame { block-size: 100dvh; overflow: auto; }
</style>
