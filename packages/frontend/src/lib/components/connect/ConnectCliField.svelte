<script lang="ts">
import Loader2Icon from "@lucide/svelte/icons/loader-2"
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import CliBadge from "$lib/components/ui/CliBadge.svelte"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getCliAvailability, getI18n } from "$lib/context"
import { cliDisplayName } from "$lib/util/cli-display"

let {
  value,
  connecting,
  onChange,
  onRefresh,
}: {
  value: string
  connecting: boolean
  onChange: (kind: string) => void
  onRefresh: () => void
} = $props()

const cliAvailability = getCliAvailability()
const { t } = getI18n()
</script>

<label>
  <span class="cli-label-row">
    {t("connect.cli.label")}
    {#if cliAvailability.loading}
      <Loader2Icon size={14} class="animate-spin" style="color:var(--fg-dim)" aria-hidden="true" />
      <span class="cli-hint">{t("connect.cli.loading")}</span>
    {:else if cliAvailability.error}
      <!-- §2/§6/§9 Q3: fallback = מציג הכול + אינדיקציה חלשה (לא באנר חוסם) -->
      <span class="cli-hint">{t("connect.cli.showAll")}</span>
    {/if}
    <button
      type="button"
      class="cli-refresh-btn"
      onclick={onRefresh}
      aria-label={t("connect.cli.refresh")}
      title={t("connect.cli.refresh")}
      disabled={cliAvailability.loading}
    >
      <RefreshCwIcon size={13} strokeWidth={2} />
    </button>
  </span>
  <!-- Select.value נשאר cliKind גם אם הוא disabled ב-options (למקרה reconnect) —
       האפשרויות מגיעות מ-cliAvailability.registry (הרג'יסטרי מהשרת, מונע-שרת);
       מי שלא available מקבל disabled פר-option (§1, §4 Commit 2). -->
  <Select
    {value}
    options={cliAvailability.registry.map((k) => ({
      value: k,
      label: cliDisplayName(k, cliAvailability.details[k]?.displayName),
      disabled: !cliAvailability.available.includes(k),
      description: cliAvailability.available.includes(k)
        ? null
        : t("connect.cli.notInstalled"),
    }))}
    title={t("connect.cli.label")}
    ariaLabel={t("connect.cli.label")}
    disabled={connecting}
    onchange={onChange}
  >
    {#snippet icon(opt: SelectOption)}
      <CliBadge id={opt.value} logo={cliAvailability.details[opt.value]?.logo} variant="icon" />
    {/snippet}
  </Select>
</label>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  label > span {
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  /* slice cli-availability: ספינר-טעינה / אינדיקציית-fallback ליד תווית ה-dropdown */
  .cli-label-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .cli-hint {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--fg-dim);
  }

  /* slice cli-specs-hot-reload: refresh button next to the CLI dropdown */
  .cli-refresh-btn {
    margin-inline-start: auto;
    padding: 0;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    /* 44px hit target (mobile-parity); negative margin-block keeps the label row compact. */
    width: 44px;
    height: 44px;
    margin-block: -0.625rem;
    background: transparent;
    border-radius: 0.375rem; /* The generic button rule supplies the remaining styles. */
    color: var(--fg-dim);
  }

  .cli-refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-elev);
  }

  .cli-refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    margin-top: 0.5rem;
    padding: 0.8rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hi);
  }

  button:disabled {
    background: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
  }
</style>
