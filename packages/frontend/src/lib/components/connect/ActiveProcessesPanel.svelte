<script lang="ts">
/**
 * ActiveProcessesPanel — ווידג'ט "תהליכים פעילים" בטופס החיבור.
 *
 * מציג את כל ה-agents החיים בצד-השרת עם 2 פעולות לכל שורה:
 * Reconnect (חיבור מחדש עם אייקון תקע), Kill (הריגה עם אייקון פח + אישור 2-לחיצות).
 *
 * slice: active-processes-icons
 */
import type { AgentPublic, MachineStats } from "@drive-coding/core"
import PlugIcon from "@lucide/svelte/icons/plug"
import Trash2Icon from "@lucide/svelte/icons/trash-2"
import { Popover } from "bits-ui"
import { hasConnectionRing, reconnectState } from "$lib/adapters/reconnect-state"
import { getMachineStats } from "$lib/adapters/system-api"
import CliBadge from "$lib/components/ui/CliBadge.svelte"
import { getActiveAgents, getCliAvailability, getI18n, getSettings } from "$lib/context"
import { formatRelativeTime } from "$lib/util/formatting"
import { basename } from "$lib/util/path"
import { resizeDrag } from "$lib/util/resize-drag"
import MachineStatsBar from "./MachineStatsBar.svelte"

interface Props {
  onReconnect: (agent: AgentPublic) => void
}

const { onReconnect }: Props = $props()

const activeAgents = getActiveAgents()
const i18n = getI18n()
const t = i18n.t
const settings = getSettings()
// slice cli-branding (Commit 3): הרכיב חסר-props ל-displayName של ה-CLI, לכן צורך
// את cliAvailability בעצמו (אין "מלמעלה" להעביר prop — ר' brief §4 C3).
const cliAvailability = getCliAvailability()

let dragHeight = $state<number | null>(null)
let handleEl = $state<HTMLDivElement | null>(null)

// אישור kill — מזהה ה-agent שמחכה לאישור שנייה
let confirmingId = $state<string | null>(null)
let confirmTimer = $state<ReturnType<typeof setTimeout> | null>(null)

// אישור takeover — state נפרד מ-confirmingId (של Kill), אחרת קליק-Kill
// וקליק-takeover על אותו agent.id מתנגשים (slice reconnect-ws-takeover Commit 2).
let takeoverConfirmingId = $state<string | null>(null)
let takeoverConfirmTimer = $state<ReturnType<typeof setTimeout> | null>(null)

// מדדי-מכונה (RAM/CPU) — poll קיים 12s, בית ב-MachineStatsBar (slice be-machine-stats)
let machine = $state<MachineStats | null>(null)

function refreshMachine() {
  getMachineStats()
    .then((m) => {
      machine = m
    })
    .catch(() => {
      // כישלון שקט — המחוון פשוט לא יתעדכן; לא לשבור את הפאנל
    })
}

// C12: auto-refresh כל ~12s; לא מרענן אם הפאנל מוסתר (document.hidden)
$effect(() => {
  void refreshMachine() // fetch ראשוני מיידי ב-mount
  const interval = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return
    void activeAgents.refresh()
    void refreshMachine()
  }, 12_000)
  return () => clearInterval(interval)
})

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

// מבטל מצב-אישור Kill (טיימר + state) — משמש גם ע"י handleKill (לחיצה שנייה /
// לחיצה ראשונה על מחרוזת חדשה) וגם ע"י onOpenChange של ה-Popover (סגירה חיצונית:
// Escape / קליק מחוץ לתוסף — bits-ui, ראה תיעוד ה-tooltip-portal למטה).
function cancelKillConfirm() {
  if (confirmTimer !== null) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
  confirmingId = null
}

function handleKill(id: string) {
  if (confirmingId === id) {
    // לחיצה שנייה — בצע
    cancelKillConfirm()
    void activeAgents.kill(id)
  } else {
    // לחיצה ראשונה — בקש אישור (פותח את ה-tooltip המרחף, ר' Popover.Root למטה)
    if (confirmTimer !== null) clearTimeout(confirmTimer)
    confirmingId = id
    confirmTimer = setTimeout(cancelKillConfirm, 3000)
  }
}

// מבטל מצב-אישור takeover — מקביל ל-cancelKillConfirm, state נפרד (ר' הערה
// בהגדרת takeoverConfirmingId למעלה).
function cancelTakeoverConfirm() {
  if (takeoverConfirmTimer !== null) {
    clearTimeout(takeoverConfirmTimer)
    takeoverConfirmTimer = null
  }
  takeoverConfirmingId = null
}

// לחיצה על כפתור ה-Reconnect — דפוס 2-קליקים ל-takeover (עקבי ויזואלית עם ה-Kill
// שלמעלה, אבל state-אישור נפרד: takeoverConfirmingId, לא confirmingId).
function handleReconnectClick(agent: AgentPublic) {
  const state = reconnectState(agent)
  if (state === "disabled") return
  if (state === "reconnect") {
    onReconnect(agent)
    return
  }
  // state === "takeover"
  if (takeoverConfirmingId === agent.id) {
    // לחיצה שנייה — בצע את ה-takeover
    cancelTakeoverConfirm()
    onReconnect(agent)
  } else {
    // לחיצה ראשונה — בקש אישור
    if (takeoverConfirmTimer !== null) clearTimeout(takeoverConfirmTimer)
    takeoverConfirmingId = agent.id
    takeoverConfirmTimer = setTimeout(cancelTakeoverConfirm, 3000)
  }
}

// a11y ל-status-dot — ממד-חיבור נפרד ממצב-התהליך (הצבע). slice
// reconnect-ws-takeover Commit 3 (3b): טבעת סביב ה-dot כש-attached===true,
// בלי לגעת בצבע (שנשאר agent.status). ראה hasConnectionRing.
function connectionTitle(agent: AgentPublic): string {
  return hasConnectionRing(agent) ? t("connect.agents.connected") : t("connect.agents.disconnected")
}

// title 3-דרכי: disabled (אין סשן) / takeover (בשימוש, ממתין ל-2-קליקים) / reconnect רגיל.
function reconnectTitle(agent: AgentPublic): string {
  const state = reconnectState(agent)
  if (state === "disabled") return t("connect.agents.noSession")
  if (state === "takeover") {
    return takeoverConfirmingId === agent.id
      ? t("connect.agents.takeOverConfirm")
      : t("connect.agents.takeOver")
  }
  return t("connect.agents.reconnect")
}
</script>

<section class="active-panel">
  <div class="panel-header">
    <span class="panel-title">
      {t("connect.agents.title")}{activeAgents.agents.length > 0 ? ` (${activeAgents.agents.length})` : ""}
    </span>
    <button
      type="button"
      class="refresh-btn"
      disabled={activeAgents.loading}
      onclick={() => { void activeAgents.refresh(); void refreshMachine() }}
      title={t("connect.agents.refresh")}
      aria-label={t("connect.agents.refresh")}
    >
      ↺
    </button>
  </div>

  <MachineStatsBar stats={machine} />

  {#if activeAgents.agents.length === 0}
    <div class="empty-state">
      {t("connect.agents.empty")}
    </div>
  {:else}
    <ul
      class="agent-list chat-scroll"
      style="max-height: {dragHeight ?? settings.activePanelHeight}px"
    >
      {#each activeAgents.agents as agent (agent.id)}
        <li class="agent-row">
          <div class="agent-top">
            <div class="agent-info">
              <span
                class="status-dot"
                class:attached={hasConnectionRing(agent)}
                style="background:{statusColor(agent.status)}"
                title={connectionTitle(agent)}
                aria-label={connectionTitle(agent)}
              ></span>
              <CliBadge id={agent.cliKind} displayName={cliAvailability.details[agent.cliKind]?.displayName} logo={cliAvailability.details[agent.cliKind]?.logo} variant="badge" />
              <span class="folder-name" title={agent.cwd}><bdi>{basename(agent.cwd)}</bdi></span>
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

            <div class="agent-actions">
            <!-- Reconnect / Take over — tooltip מרחף מעל הכפתור, מרונדר ב-
                 Popover.Portal (bits-ui) כדי לא להיחתך ע"י .agent-list{overflow-y:auto}
                 (slice reconnect-ws-takeover Commit 3, 3a redo 2026-07-23: היה
                 inline-expand, הוחזר ל-tooltip מרחף לפי החלטת-משתמשת, הפעם דרך
                 portal — תקדים: SessionBudgetMeter.svelte). ה-Popover.Root נשלט
                 לגמרי ע"י takeoverConfirmingId (לא bind:open) — הקליק עצמו מנוהל
                 ע"י handleReconnectClick (מכונת ה-2-קליקים); ה-onclick על ה-<button>
                 (בתוך snippet child, אחרי הפריסה של props) דורס את ה-toggle
                 הפנימי של bits כדי שלא יתנגש. onOpenChange מטפל רק בסגירה חיצונית
                 (Escape / קליק מחוץ). -->
            <Popover.Root
              open={takeoverConfirmingId === agent.id}
              onOpenChange={(next) => { if (!next && takeoverConfirmingId === agent.id) cancelTakeoverConfirm() }}
            >
              <Popover.Trigger>
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    class="action-btn icon-btn reconnect-btn"
                    class:confirming={takeoverConfirmingId === agent.id}
                    disabled={reconnectState(agent) === "disabled"}
                    onclick={() => handleReconnectClick(agent)}
                    title={reconnectTitle(agent)}
                    aria-label={reconnectTitle(agent)}
                  >
                    <PlugIcon size={16} strokeWidth={1.75} />
                  </button>
                {/snippet}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  sideOffset={5}
                  trapFocus={false}
                  dir={i18n.dir}
                  class="takeover-confirm-tip"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <span role="status">{t("connect.agents.takeOverConfirm")}</span>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            <!-- Kill — אותו דפוס tooltip-portal כמו למעלה, state נפרד (confirmingId). -->
            <Popover.Root
              open={confirmingId === agent.id}
              onOpenChange={(next) => { if (!next && confirmingId === agent.id) cancelKillConfirm() }}
            >
              <Popover.Trigger>
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    class="action-btn icon-btn kill-btn"
                    class:confirming={confirmingId === agent.id}
                    onclick={() => handleKill(agent.id)}
                    title={confirmingId === agent.id ? t("connect.agents.killConfirm") : t("connect.agents.kill")}
                    aria-label={confirmingId === agent.id ? t("connect.agents.killConfirm") : t("connect.agents.kill")}
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
                  <span role="status">{t("connect.agents.killConfirm")}</span>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            </div>
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
        </li>
      {/each}
    </ul>
    <div
      class="resize-handle"
      bind:this={handleEl}
      use:resizeDrag={{
        getStart: () => settings.activePanelHeight,
        onMove: (px) => {
          dragHeight = px
          handleEl?.scrollIntoView({ block: "nearest" })
        },
        onEnd: (px) => {
          settings.setActivePanelHeight(px)
          dragHeight = null
        },
      }}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("connect.panel.resizeHandle")}
    ></div>
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
    overflow-y: auto;
  }

  /* ידית גרירה לשינוי גובה — slice connect-panel-resize */
  .resize-handle {
    height: 10px;
    cursor: ns-resize;
    touch-action: none;
    position: relative;
  }

  .resize-handle::after {
    content: "";
    position: absolute;
    inset-inline: 40%;
    top: 50%;
    height: 3px;
    transform: translateY(-50%);
    border-radius: 2px;
    /* גלוי-תמיד (לא hover-only) — במובייל אין hover */
    background: var(--border-str);
    transition: background 0.15s;
  }

  .resize-handle:hover::after,
  .resize-handle:active::after {
    background: var(--accent);
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

  /* takeover 2-click confirm — עיצוב עקבי ל-.kill-btn.confirming, צבע accent
     (לא danger-red) כי זו לא פעולה הרסנית. */
  .reconnect-btn.confirming {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
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

  /* tooltip מרחף (kill/takeover 2-click confirm) — מרונדר ע"י Popover.Content
     (bits-ui) בתוך Popover.Portal, כלומר ב-DOM מחוץ ל-ActiveProcessesPanel.svelte
     (ולכן מחוץ ל-.agent-list{overflow-y:auto} החותך). :global() נדרש כי הקלאס
     הזה מיושם על אלמנט שנוצר בקומפוננטה אחרת (popover-content.svelte של bits-ui),
     לא נכתב ישירות ב-template של הקובץ הזה — סקופ ה-CSS הרגיל של Svelte לא
     תופס אותו (slice reconnect-ws-takeover Commit 3, 3a redo 2026-07-23).
     המיקום מעל הכפתור מנוהל ע"י floating-ui (side="top" ב-Popover.Content) —
     אין עוד position:absolute/bottom ידני כמו בגרסה הקודמת (לפני Commit 3). */
  :global(.takeover-confirm-tip) {
    background: var(--accent);
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
