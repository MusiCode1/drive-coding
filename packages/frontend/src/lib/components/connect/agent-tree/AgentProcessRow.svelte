<script lang="ts">
import type { AgentPublic } from "@drive-coding/core"
import type { AgentTreeNode } from "@drive-coding/core/agents/agent-tree"
import PlugIcon from "@lucide/svelte/icons/plug"
import Trash2Icon from "@lucide/svelte/icons/trash-2"
import { Popover } from "bits-ui"
import { hasConnectionRing, reconnectState } from "$lib/adapters/reconnect-state"
import CliBadge from "$lib/components/ui/CliBadge.svelte"
import { getCliAvailability, getI18n } from "$lib/context"
import { formatRelativeTime } from "$lib/util/formatting"
import { basename } from "$lib/util/path"

interface Props {
  node: AgentTreeNode<AgentPublic>
  onReconnect?: (agent: AgentPublic) => void
  onKill?: (id: string) => void
  onCancelKill?: () => void
  confirming?: boolean
  onOpenBranch?: () => void
}

const { node, onReconnect, onKill, onCancelKill, confirming, onOpenBranch }: Props = $props()
const i18n = getI18n()
const t = i18n.t
const cliAvailability = getCliAvailability()
const agent = $derived(node.agent)
const connectionTitle = $derived(
  t(hasConnectionRing(agent) ? "connect.agents.connected" : "connect.agents.disconnected"),
)
const reconnectTitle = $derived(
  t(reconnectState(agent) === "disabled" ? "connect.agents.noSession" : "connect.agents.reconnect"),
)
const statusColors: Partial<Record<AgentPublic["status"], string>> = {
  ready: "var(--accent)",
  busy: "var(--accent)",
  starting: "var(--fg-muted, var(--fg-dim))",
  crashed: "var(--recording)",
  closed: "var(--recording)",
}

function formatDate(iso: string): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
</script>

{#snippet counts()}
  {node.descendantCount}
  {t(node.descendantCount === 1 ? "connect.agents.tree.descendant" : "connect.agents.tree.descendants")}
  {#if node.busyDescendantCount > 0}
    · {node.busyDescendantCount} {t("connect.agents.working")}
  {/if}
{/snippet}

  <div class="agent-row">
    <div class="agent-top">
      <div class="agent-info">
        <span
          class="status-dot"
          class:attached={hasConnectionRing(agent)}
          style:background={statusColors[agent.status] ?? "var(--fg-dim)"}
          title={connectionTitle}
          aria-label={connectionTitle}
        ></span>
        <CliBadge id={agent.cliKind} displayName={cliAvailability.details[agent.cliKind]?.displayName} logo={cliAvailability.details[agent.cliKind]?.logo} variant="badge" />
        {#if agent.roleLabel}
          <span class="role-label" title={agent.roleLabel}><bdi>{agent.roleLabel}</bdi></span>
        {/if}
        {#if agent.openedByEmail}
          <span class="opened-by" title={t("connect.agents.openedBy")}><bdi>{agent.openedByEmail}</bdi></span>
        {/if}
        <span class="folder-name" title={agent.cwd}><bdi>{basename(agent.cwd)}</bdi></span>
        {#if (agent.connectionCount ?? 0) >= 2}
          <span class="meta-sep">·</span>
          <span class="watcher-count" title={t("connect.agents.watcherCount")}>
            {agent.connectionCount} {t("connect.agents.watcherCount")}
          </span>
        {/if}
        {#if node.descendantCount > 0}
          <span class="meta-sep">·</span>
          {#if onOpenBranch}
            <button type="button" class="child-count branch-button" onclick={onOpenBranch}>
              {@render counts()}
              <span aria-hidden="true" class="chevron">›</span>
            </button>
          {:else}
            <span class="child-count">{@render counts()}</span>
          {/if}
        {/if}
        {#if agent.title}
          <span class="meta-sep">·</span>
          <span class="session-title" title={agent.title}><bdi>{agent.title}</bdi></span>
        {/if}
        {#if agent.busy}
          <span class="meta-sep">·</span>
          <span class="busy-indicator" aria-label={t("connect.agents.working")}>
            <span class="busy-dot"></span>
            <span class="busy-label">{t("connect.agents.working")}</span>
          </span>
        {/if}
        {#if agent.lastMessageAt != null}
          <span class="meta-sep">·</span>
          <span class="last-msg" title={t("connect.agents.lastMessage")}>
            {formatRelativeTime(agent.lastMessageAt, i18n.locale)}
          </span>
        {/if}
      </div>

      {#if onReconnect && onKill}
      <div class="agent-actions">
      <button
        type="button"
        class="action-btn icon-btn"
        disabled={reconnectState(agent) === "disabled"}
        onclick={() => onReconnect?.(agent)}
        title={reconnectTitle}
        aria-label={reconnectTitle}
      >
        <PlugIcon size={16} strokeWidth={1.75} />
      </button>

      <Popover.Root
        open={confirming ?? false}
        onOpenChange={(next) => { if (!next && confirming) onCancelKill?.() }}
      >
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="action-btn icon-btn kill-btn"
              class:confirming={confirming}
              onclick={() => onKill?.(agent.id)}
              title={confirming ? t("connect.agents.closeConfirm") : t("connect.agents.close")}
              aria-label={confirming ? t("connect.agents.closeConfirm") : t("connect.agents.close")}
            >
              <Trash2Icon size={16} strokeWidth={1.75} />
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            sideOffset={5}
            trapFocus={false}
            dir={i18n.dir}
            class="kill-confirm-tip"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <span role="status">{t("connect.agents.closeConfirm")}</span>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      </div>
      {/if}
    </div>

    <div class="agent-meta">
      <span class="cwd-full" title={agent.cwd}><bdi>{agent.cwd}</bdi></span>
      <span class="meta-right">
        {#if agent.acpSessionId}
          <span class="session-id">{agent.acpSessionId.slice(0, 8)}</span>
          <span class="meta-sep">·</span>
        {/if}
        <span class="created-at">{formatDate(agent.createdAt)}</span>
        {#if agent.pid}
          <span class="meta-sep">·</span>
          <span class="pid">pid: {agent.pid}</span>
        {/if}
      </span>
    </div>
  </div>

<style>
  .child-count {
    font-size: 0.72rem;
    color: var(--fg-dim);
    flex-shrink: 0;
  }

  .branch-button {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.1rem 0.35rem;
    cursor: pointer;
    color: var(--fg);
  }

  .chevron {
    display: inline-block;
  }

  .chevron:dir(rtl) {
    transform: scaleX(-1);
  }

  .agent-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.55rem 0.9rem;
  }

  .agent-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .agent-info {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
    font-size: 0.82rem;
  }

  .agent-meta {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--fg-dim);
    min-width: 0;
  }

  .meta-right {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.4rem;
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

  /* טבעת-חיבור (3b, slice reconnect-ws-takeover Commit 3) — ממד נפרד מהצבע
     (מצב-תהליך). רווח בצבע-הרקע ואז טבעת accent, כדי שהטבעת תיראה גם כש-
     הצבע עצמו כבר accent (ready/busy). */
  .status-dot.attached {
    box-shadow:
      0 0 0 2px var(--bg-elev),
      0 0 0 4px var(--accent);
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

  /* role label (slice agent-role-label) — metadata beside CliBadge, not title/displayName */
  .role-label {
    color: var(--fg-dim);
    font-size: 0.78rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-inline-size: 0;
  }

  /* opened-by email (slice session-attribution-core) — attribution beside role label */
  .opened-by {
    color: var(--fg-dim);
    font-size: 0.78rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-inline-size: 0;
  }

  /* כותרת-הסשן (slice session-title-in-process-list) — תוכן-משתמש (עברית/אנגלית/
     מעורב), ה-<bdi> ללא כפיית direction (בשונה מ-folder-name/cwd-full שהם נתיבים) —
     כיוון לפי-תוכן. */
  .session-title {
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
  }

  /* הנתיב המלא — בתוך שורת המטא, בצד שמאל (flex:1). קיצוץ מתחילת
     הנתיב: בסיס rtl ממקם את ה-ellipsis בהתחלה כך שזנב הנתיב תמיד נראה;
     ה-<bdi> שומר על סדר ה-LTR התקין של הנתיב עצמו. */
  .cwd-full {
    display: block;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    font-size: 0.72rem;
    color: var(--fg-dim);
  }

  .folder-name > :global(bdi),
  .cwd-full > :global(bdi) {
    direction: ltr;
  }

  .session-id {
    font-family: monospace;
    direction: ltr;
  }

  .last-msg {
    direction: ltr;
    flex-shrink: 0;
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

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.3rem;
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

  /* The portal keeps the confirmation visible outside the scrolling list. */
  :global(.kill-confirm-tip) {
    background: rgba(200, 40, 40, 0.88);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    padding: 0.2rem 0.45rem;
    border-radius: 5px;
    z-index: 50;
    pointer-events: none;
    animation: tip-pop 0.12s ease-out both;
  }

  /* -global- כי ה-animation מוחל דרך :global() למעלה — שם ה-keyframes חייב
     להישאר לא-מסוקפ כדי ש-Svelte לא ישנה אותו לשם מוסתר-hash שלא יתאים. */
  @keyframes -global-tip-pop {
    from { opacity: 0; transform: scale(0.85) translateY(3px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
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
