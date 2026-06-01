<script lang="ts">
// TODO redesign-4: השורות הבאות הן proof זמני של Lucide — redesign-4 יחליף ממילא
import SettingsIcon from "@lucide/svelte/icons/settings"
import { goto } from "$app/navigation"
import { getI18n, getSettings } from "$lib/context"

const settings = getSettings()
const t = getI18n().t

let beUrlInput = $state(settings.beUrl)
let error = $state<string | undefined>(undefined)
let savedAt = $state<number | undefined>(undefined)

function handleSave() {
  const result = settings.setBeUrl(beUrlInput)
  if (result.ok) {
    error = undefined
    savedAt = Date.now()
  } else {
    error = result.error
    savedAt = undefined
  }
}

let showSaved = $derived(savedAt !== undefined && Date.now() - savedAt < 3000)
</script>

<main class="settings">
  <header>
    <button type="button" onclick={() => goto("/chat")}>← {t("settings.back")}</button>
    <!-- TODO redesign-4: proof זמני — SettingsIcon ייוחלף בעיצוב מלא -->
    <h1><SettingsIcon size={20} strokeWidth={1.75} style="vertical-align:middle;margin-inline-end:0.4em;" />{t("settings.title")}</h1>
  </header>

  <form
    onsubmit={(e) => {
      e.preventDefault()
      handleSave()
    }}
  >
    <label>
      <span class="label">{t("settings.beUrl.label")}</span>
      <input
        type="url"
        bind:value={beUrlInput}
        onblur={handleSave}
        class:invalid={error !== undefined}
        placeholder="https://my-be.example.com"
        dir="ltr"
      />
      <span class="help">{t("settings.beUrl.help")}</span>
      {#if error}
        <span class="error">{t("settings.beUrl.invalid")}: {error}</span>
      {/if}
      {#if showSaved}
        <span class="saved">{t("settings.beUrl.saved")}</span>
      {/if}
    </label>
  </form>
</main>

<style>
  .settings {
    max-width: 600px;
    margin: 2rem auto;
    padding: 1rem;
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 2rem;
  }
  h1 {
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .label {
    font-weight: 600;
  }
  input {
    padding: 0.7rem;
    font-size: 1rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: inherit;
  }
  input.invalid {
    border-color: var(--danger);
  }
  .help {
    font-size: 0.85em;
    opacity: 0.7;
  }
  .error {
    font-size: 0.85em;
    color: var(--danger);
  }
  .saved {
    font-size: 0.85em;
    color: var(--success);
  }
</style>
