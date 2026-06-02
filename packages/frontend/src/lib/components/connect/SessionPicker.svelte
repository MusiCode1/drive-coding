<script lang="ts">
  import type { CliKind } from "@drive-coding/core"
  import type { SessionInfo } from "$lib/adapters/sessions"
  import { getI18n } from "$lib/context"
  import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"

  const i18n = getI18n()
  const t = i18n.t

  type Props = {
    cwd: string
    cliKind: CliKind
    sessions: SessionInfo[]
    loading: boolean
    error: string | null
    selectedSessionId: string | null
    onload: () => Promise<void>
    onselect: (sessionId: string | null) => void
  }

  let {
    cwd,
    cliKind,
    sessions,
    loading,
    error,
    selectedSessionId,
    onload,
    onselect,
  }: Props = $props()

  function formatDate(iso: string): string {
    if (!iso) return ""
    try {
      const date = new Date(iso)
      const diff = Date.now() - date.getTime()
      const rtf = new Intl.RelativeTimeFormat("he", { numeric: "auto" })
      if (diff < 60_000) return rtf.format(-Math.round(diff / 1_000), "second")
      if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute")
      if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), "hour")
      return rtf.format(-Math.round(diff / 86_400_000), "day")
    } catch {
      return iso.slice(0, 10)
    }
  }

  // אפשרות "סשן חדש" (value="") + הסשנים הקיימים.
  const sessionOptions = $derived<SelectOption[]>([
    { value: "", label: t("sessions.startNew") },
    ...sessions.map((s) => ({
      value: s.sessionId,
      label: `${s.title || s.sessionId.slice(0, 8)} — ${formatDate(s.updatedAt)}`,
    })),
  ])
</script>

<div class="session-picker">
  <button
    type="button"
    class="load-btn"
    disabled={!cwd.trim() || loading}
    onclick={onload}
  >
    {loading ? t("sessions.loading") : t("sessions.loadButton")}
  </button>

  {#if sessions.length > 0}
    <label class="session-label">
      <span>{t("sessions.label")}</span>
      <Select
        value={selectedSessionId ?? ""}
        options={sessionOptions}
        title={t("sessions.label")}
        ariaLabel={t("sessions.label")}
        onchange={(v) => onselect(v === "" ? null : v)}
      />
    </label>
  {:else if error !== null}
    <div class="session-error" role="alert">
      {t("sessions.error")}: {error}
    </div>
  {/if}
</div>

<style>
  .session-picker {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .load-btn {
    padding: 0.55rem 0.9rem;
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s;
    align-self: flex-start;
  }

  .load-btn:hover:not(:disabled) {
    background: var(--border);
  }

  .load-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .session-label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .session-label > span {
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .session-error {
    font-size: 0.85rem;
    color: var(--recording);
    padding: 0.4rem 0.6rem;
    background: rgba(255, 79, 79, 0.08);
    border-radius: 6px;
  }
</style>
