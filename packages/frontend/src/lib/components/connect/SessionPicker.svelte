<script lang="ts">
  import type { CliKind } from "@drive-coding/core"
  import type { SessionInfo } from "$lib/adapters/sessions"
  import { getI18n } from "$lib/context"
  import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"

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
    ...sessions.map((s) => {
      // חיתוך ה-title אחרי 45 תווים כדי שהוא + התאריך ייכנסו ב-2 שורות
      const raw = s.title || s.sessionId.slice(0, 8)
      const title = raw.length > 45 ? `${raw.slice(0, 45)}…` : raw
      return { value: s.sessionId, label: `${title} — ${formatDate(s.updatedAt)}` }
    }),
  ])

  // C11: disabled כשאין sessions (אבל תמיד מוצג)
  const selectDisabled = $derived(sessions.length === 0 || loading)
</script>

<!-- C11: כפתור refresh + label+select תמיד מוצגים -->
<div class="session-picker">
  <!-- label+select תמיד מוצגים; disabled כשאין sessions -->
  <div class="session-row">
    <span class="session-label-text">{t("sessions.label")}</span>
    <!-- ↺ refresh + select באותה שורה, בגובה זהה (align-items:stretch) -->
    <div class="select-row">
      <!-- ↺ refresh — בתחילת השורה (inline-start) -->
      <button
        type="button"
        class="refresh-btn"
        disabled={loading || !cwd.trim()}
        onclick={onload}
        aria-label={t("sessions.refresh")}
        title={t("sessions.refresh")}
      >
        <RefreshCwIcon size={18} strokeWidth={1.75} />
      </button>
      <div class="select-wrap">
        <Select
          value={selectedSessionId ?? ""}
          options={sessionOptions}
          title={t("sessions.label")}
          ariaLabel={t("sessions.label")}
          disabled={selectDisabled}
          onchange={(v) => onselect(v === "" ? null : v)}
        />
      </div>
    </div>
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

  .session-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .session-label-text {
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .select-row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
  }

  .select-wrap {
    flex: 1;
    min-width: 0;
  }

  /* refresh-btn — זהה ל-folder-btn ב-+page.svelte (אחידות 2 הלחצנים) */
  .refresh-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    padding-inline: 0.7rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg-dim);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .session-error {
    font-size: 0.85rem;
    color: var(--recording);
    padding: 0.4rem 0.6rem;
    background: rgba(255, 79, 79, 0.08);
    border-radius: 6px;
  }
</style>
