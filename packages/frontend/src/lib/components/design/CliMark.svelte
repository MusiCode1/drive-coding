<script lang="ts">
/** The CLI's own logo (served from static/logos/cli), sized for inline use. */
let { name, size = 16 }: { name: string; size?: number } = $props()
const FILES: Record<string, string> = {
  "Claude Code": "claude",
  Codex: "codex",
  Cursor: "cursor",
  "Gemini CLI": "gemini",
  OpenCode: "opencode",
}
const file = $derived(FILES[name])
</script>

{#if file}<img class="cli-mark" src="/logos/cli/{file}.svg" alt="" width={size} height={size} />{/if}

<style>
  .cli-mark { flex-shrink: 0; display: inline-block; vertical-align: middle; border-radius: 4px; }
</style>
