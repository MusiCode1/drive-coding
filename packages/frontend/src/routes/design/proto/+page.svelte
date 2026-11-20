<script lang="ts">
/**
 * /design/proto — clickable prototype of the redesign (branch design/unslop-mocks).
 * Intentional route-shell exception (like /bt-test): not linked from the app, synthetic data only.
 * Query: lang, palette.
 */
import { page } from "$app/state"
import "$lib/components/design/tokens.css"
import type { DesignLang } from "$lib/components/design/content"
import DPrototype from "$lib/components/design/DPrototype.svelte"

const q = $derived(page.url.searchParams)
const lang = $derived((q.get("lang") === "en" ? "en" : "he") as DesignLang)
const palette = $derived(q.get("palette") ?? "ember")
</script>

{#key `${lang}-${palette}`}
  <DPrototype {lang} {palette} />
{/key}
