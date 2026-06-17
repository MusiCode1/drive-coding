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

  // C11: disabled כשאין sessions (אבל תמיד מוצג)
  const selectDisabled = $derived(sessions.length === 0 || loading)
</script>

<!-- C11: כפתור refresh (↺) + label+select תמיד מוצגים -->
<div class="session-picker">
  <!-- שורת טעינה ראשונה: כפתור טעינה ראשוני -->
  <button
    type="button"
    class="load-btn"
    disabled={!cwd.trim() || loading}
    onclick={onload}
  >
    {loading ? t("sessions.loading") : t("sessions.loadButton")}
  </button>

  <!-- label+select תמיד מוצגים; disabled כשאין sessions -->
  <div class="session-row">
    <!-- ↺ refresh — בתחילת השורה (inline-start) -->
    <button
      type="button"
      class="refresh-btn"
      disabled={loading}
      onclick={onload}
      aria-label={t("sessions.refresh")}
      title={t("sessions.refresh")}
    >
      ↺
    </button>
    <label class="session-label">
      <span>{t("sessions.label")}</span>
      <Select
        value={selectedSessionId ?? ""}
        options={sessionOptions}
        title={t("sessions.label")}
        ariaLabel={t("sessions.label")}
        disabled={selectDisabled}
        onchange={(v) => onselect(v === "" ? null : v)}
      />
    </label>
  </div>

  {#if error !== null}
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
    width: 100%;
    text-align: center;
  }

  .load-btn:hover:not(:disabled) {
    background: var(--border);
  }

  .load-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .session-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .refresh-btn {
    flex-shrink: 0;
    padding: 0.3rem 0.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
    align-self: flex-end;
    /* מיישר עם תחתית ה-select */
    padding-block: 0.45rem;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .session-label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
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
