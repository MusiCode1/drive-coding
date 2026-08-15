<!--
  SystemPromptWarning.test.svelte — fixture לבדיקת DOM של אזהרת systemPrompt.
  מייצג בדיוק את הבלוק שב-SessionOptionsPanel.svelte:485-488.
  משמש ב-session-options-panel.systemprompt-warning.test.svelte.ts.
-->
<script lang="ts">
  import type { NormalizedCapabilities } from "@drive-coding/provider/types"

  let {
    capabilities,
  }: {
    capabilities: NormalizedCapabilities | null
  } = $props()
</script>

{#if capabilities !== null && !capabilities.systemPrompt}
  <div data-testid="sp-warning" style="color:var(--accent)">
    This provider does not support a project system prompt.
  </div>
{/if}
