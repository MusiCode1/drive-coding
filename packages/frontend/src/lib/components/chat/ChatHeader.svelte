<script lang="ts">
import { getI18n, getSession, getSpeaker } from "$lib/context"

const session = getSession()
const speaker = getSpeaker()
const t = getI18n().t

let { onDisconnect }: { onDisconnect: () => void } = $props()
</script>

<header>
  <div class="meta">
    <span class="status status-{session.status}">{session.status}</span>
    <span class="cwd" dir="ltr">{session.cwd ?? ""}</span>
  </div>
  <label class="audio-toggle" title={t("chat.audioToggle")}>
    <input
      type="checkbox"
      checked={speaker.enabled}
      onchange={() => speaker.toggle()}
    />
    <span>{t("chat.audioToggle")}</span>
  </label>
  <button class="disconnect" onclick={onDisconnect}>{t("chat.disconnect")}</button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .status {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: ui-monospace, monospace;
  }
  .status-idle,
  .status-error {
    background: rgba(255, 79, 79, 0.15);
    color: var(--recording);
  }
  .status-connecting,
  .status-thinking {
    background: rgba(255, 170, 51, 0.15);
    color: #ffaa33;
  }
  .status-connected {
    background: rgba(79, 255, 138, 0.15);
    color: var(--speaking);
  }

  .cwd {
    font-size: 0.8rem;
    color: var(--fg-dim);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-inline-start: auto;
    margin-inline-end: 0.75rem;
    color: var(--fg-dim);
    font-size: 0.8rem;
    user-select: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .audio-toggle input {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .disconnect {
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .disconnect:hover {
    color: var(--recording);
    border-color: var(--recording);
  }
</style>
