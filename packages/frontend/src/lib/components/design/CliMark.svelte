<script lang="ts">
/**
 * The CLI's own logo. Monochrome logos are drawn as a mask filled with currentColor so a black
 * logo stays visible on dark palettes (same rule as ui/CliBadge); qoder keeps its brand gradient.
 */
let { name, size = 16 }: { name: string; size?: number } = $props()
const FILES: Record<string, string> = {
  "Claude Code": "claude",
  Codex: "codex",
  Cursor: "cursor",
  "Gemini CLI": "gemini",
  OpenCode: "opencode",
  Qoder: "qoder",
}
const file = $derived(FILES[name])
const url = $derived(`/logos/cli/${file}.svg`)
</script>

{#if file === "qoder"}
  <img class="cli-mark" src={url} alt="" width={size} height={size} />
{:else if file}
  <span class="cli-mark mask" style="inline-size:{size}px; block-size:{size}px; --logo:url({url})" aria-hidden="true"></span>
{/if}

<style>
  .cli-mark { flex-shrink: 0; display: inline-block; vertical-align: middle; }
  .mask {
    background-color: currentColor;
    -webkit-mask: var(--logo) center / contain no-repeat;
    mask: var(--logo) center / contain no-repeat;
  }
</style>
