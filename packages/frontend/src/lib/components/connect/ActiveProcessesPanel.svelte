<script lang="ts">
/**
 * ActiveProcessesPanel — ווידג'ט "תהליכים פעילים" בטופס החיבור.
 *
 * מציג את כל ה-agents החיים בצד-השרת עם 3 פעולות לכל שורה:
 * Pin (נעיצה), Reconnect (חיבור מחדש), Kill (הריגה עם אישור).
 *
 * slice: active-agents-widget
 */
import type { AgentPublic } from "@drive-coding/core"
import { getActiveAgents, getI18n } from "$lib/context"

interface Props {
  onReconnect: (agent: AgentPublic) => void
}

const { onReconnect }: Props = $props()

const activeAgents = getActiveAgents()
const i18n = getI18n()
const t = i18n.t

// אישור kill — מזהה ה-agent שמחכה לאישור שנייה
let confirmingId = $state<string | null>(null)
let confirmTimer = $state<ReturnType<typeof setTimeout> | null>(null)

function formatDate(iso: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

/** שם התיקייה האחרונה בנתיב (basename) — להצגה בולטת בשורה העליונה. */
function folderName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "")
  const name = trimmed.split("/").pop()
  return name || cwd
}

function statusColor(status: AgentPublic["status"]): string {
  switch (status) {
    case "ready":
      return "var(--accent)"
    case "busy":
      return "var(--accent)"
    case "starting":
      return "var(--fg-muted, var(--fg-dim))"
    case "crashed":
    case "closed":
      return "var(--recording)"
    default:
      return "var(--fg-dim)"
  }
}

function handleKill(id: string) {
  if (confirmingId === id) {
    // לחיצה שנייה — בצע
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer)
      confirmTimer = null
    }
    confirmingId = null
    void activeAgents.kill(id)
  } else {
    // לחיצה ראשונה — בקש אישור
    if (confirmTimer !== null) clearTimeout(confirmTimer)
    confirmingId = id
    confirmTimer = setTimeout(() => {
      confirmingId = null
      confirmTimer = null
    }, 3000)
  }
}

function isReconnectDisabled(agent: AgentPublic): boolean {
  return !agent.acpSessionId || agent.attached === true
}
</script>

<section class="active-panel">
  <div class="panel-header">
    <span class="panel-title">{t("connect.agents.title")}</span>
    <button
      type="button"
      class="refresh-btn"
      disabled={activeAgents.loading}
      onclick={() => void activeAgents.refresh()}
      title={t("connect.agents.refresh")}
      aria-label={t("connect.agents.refresh")}
    >
      ↺
    </button>
  </div>

  {#if activeAgents.agents.length === 0}
    <div class="empty-state">
      {t("connect.agents.empty")}
    </div>
  {:else}
    <ul class="agent-list">
      {#each activeAgents.agents as agent (agent.id)}
        <li class="agent-row">
          <div class="agent-top">
            <div class="agent-info">
              <span class="status-dot" style="background:{statusColor(agent.status)}"></span>
              <span class="cli-badge">{agent.cliKind}</span>
              <span class="folder-name" title={agent.cwd}><bdi>{folderName(agent.cwd)}</bdi></span>
            </div>

            <div class="agent-actions">
            <!-- Pin / Unpin -->
            <button
              type="button"
              class="action-btn pin-btn"
              class:pinned={agent.persistent}
              onclick={() => void activeAgents.setPersistent(agent.id, !agent.persistent)}
              title={agent.persistent ? t("connect.agents.unpin") : t("connect.agents.pin")}
              aria-label={agent.persistent ? t("connect.agents.unpin") : t("connect.agents.pin")}
            >
              {agent.persistent ? "📌" : "📎"}
            </button>

            <!-- Reconnect -->
            <button
              type="button"
              class="action-btn reconnect-btn"
              disabled={isReconnectDisabled(agent)}
              onclick={() => onReconnect(agent)}
              title={isReconnectDisabled(agent) ? t("connect.agents.inUse") : t("connect.agents.reconnect")}
              aria-label={t("connect.agents.reconnect")}
            >
              {t("connect.agents.reconnect")}
            </button>

            <!-- Kill -->
            <button
              type="button"
              class="action-btn kill-btn"
              class:confirming={confirmingId === agent.id}
              onclick={() => handleKill(agent.id)}
              title={t("connect.agents.kill")}
              aria-label={t("connect.agents.kill")}
            >
              {confirmingId === agent.id
                ? t("connect.agents.killConfirm")
                : t("connect.agents.kill")}
            </button>
            </div>
          </div>

          <div class="agent-meta">
            <span class="cwd-full" title={agent.cwd}><bdi>{agent.cwd}</bdi></span>
            <span class="meta-sep">·</span>
            {#if agent.busy}
              <span class="busy-indicator" aria-label={t("connect.agents.working")}>
                <span class="busy-dot"></span>
                <span class="busy-label">{t("connect.agents.working")}</span>
              </span>
              <span class="meta-sep">·</span>
            {/if}
            {#if agent.acpSessionId}
              <span class="session-id">{agent.acpSessionId.slice(0, 8)}</span>
              <span class="meta-sep">·</span>
            {/if}
            <span class="created-at">{formatDate(agent.createdAt)}</span>
            {#if agent.pid}
              <span class="meta-sep">·</span>
              <span class="pid">pid: {agent.pid}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .active-panel {
    margin-bottom: 1.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .refresh-btn {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
    margin-top: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .empty-state {
    padding: 0.8rem 0.9rem;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .agent-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .agent-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  .agent-row:last-child {
    border-bottom: none;
  }

  .agent-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .agent-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
    font-size: 0.82rem;
  }

  .agent-meta {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--fg-dim);
  }

  /* הנתיב (.cwd-full) הוא היחיד שמתקצר; שאר המטא (תאריך/pid/סשן)
     נשארים בגודלם באותה שורה. */
  .agent-meta > :not(.cwd-full) {
    flex-shrink: 0;
  }

  .meta-sep {
    color: var(--fg-dim);
    opacity: 0.5;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cli-badge {
    background: var(--border);
    color: var(--fg);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  /* שם התיקייה (basename) — בולט בשורה העליונה */
  .folder-name {
    color: var(--fg);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
  }

  /* הנתיב המלא — בשורת המטא התחתונה. קיצוץ מתחילת הנתיב: בסיס rtl
     ממקם את ה-ellipsis בהתחלה כך שזנב הנתיב תמיד נראה; ה-<bdi> שומר
     על סדר ה-LTR התקין של הנתיב עצמו. */
  .cwd-full {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
    direction: rtl;
    text-align: left;
  }

  .folder-name > :global(bdi),
  .cwd-full > :global(bdi) {
    direction: ltr;
  }

  .session-id {
    font-family: monospace;
    direction: ltr;
  }

  .created-at {
    direction: ltr;
  }

  .pid {
    direction: ltr;
  }

  .agent-actions {
    display: flex;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    font-size: 0.78rem;
    cursor: pointer;
    color: var(--fg-dim);
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    margin-top: 0;
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .pin-btn.pinned {
    color: var(--accent);
    border-color: var(--accent);
  }

  .kill-btn {
    color: var(--recording);
    border-color: rgba(255, 79, 79, 0.3);
  }

  .kill-btn:hover:not(:disabled) {
    background: rgba(255, 79, 79, 0.1);
    border-color: var(--recording);
    color: var(--recording);
  }

  .kill-btn.confirming {
    background: rgba(255, 79, 79, 0.15);
    border-color: var(--recording);
    color: var(--recording);
    font-weight: 600;
  }

  /* ─── busy indicator ─── (slice agent-busy-indicator) */
  .busy-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--accent);
  }

  .busy-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: busy-pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  .busy-label {
    font-size: 0.72rem;
    font-weight: 500;
  }

  @keyframes busy-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.75); }
  }
</style>
