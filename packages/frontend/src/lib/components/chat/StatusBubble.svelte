<script lang="ts">
/**
 * StatusBubble — בועת-סטטוס transient.
 *
 * מציגה את ה-phase הנוכחי של המודל (waiting/thinking/responding/calling-tool/pending-tts/speaking).
 * אינה חלק מ-session.bubbles — מופיעה מעל הרשימה בזמן אמת.
 * phase === null → לא מרנדרת דבר.
 *
 * ─── msr-v2 ───
 */
import { getI18n, getModelStatus } from "$lib/context"
import type { ModelPhase } from "$lib/view-models/derived/model-status.svelte"

const modelStatus = getModelStatus()
const t = getI18n().t

const phaseKey: Record<NonNullable<ModelPhase>, Parameters<typeof t>[0]> = {
  waiting:       "modelStatus.waiting",
  thinking:      "modelStatus.thinking",
  responding:    "modelStatus.responding",
  "calling-tool": "modelStatus.callingTool",
  "pending-tts":  "modelStatus.pendingTts",
  speaking:      "modelStatus.speaking",
}
</script>

{#if modelStatus.phase !== null}
  <div
    class="status-bubble"
    role="status"
    aria-live="polite"
  >
    <span class="dot"></span>
    <span class="label">{t(phaseKey[modelStatus.phase])}</span>
  </div>
{/if}

<style>
  .status-bubble {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.8rem;
    color: var(--fg-dim);
    background: var(--bg-card);
    border: 1px solid var(--border);
    align-self: flex-start;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }

  .label {
    white-space: nowrap;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }
</style>
