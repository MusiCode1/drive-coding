<script lang="ts">
/**
 * StatusBubble — בועת סטטוס transient (לא ב-session.bubbles).
 *
 * מראה מה המודל עושה כרגע לפי ModelStatus.phase.
 * phase === null → לא מרנדר (בלוק {#if}).
 *
 * ─── slice model-status-control-replay ───
 */
import { getI18n, getModelStatus } from "$lib/context"

const modelStatus = getModelStatus()
const t = getI18n().t

const phaseKey: Record<NonNullable<typeof modelStatus.phase>, string> = {
  waiting: "modelStatus.waiting",
  thinking: "modelStatus.thinking",
  responding: "modelStatus.responding",
  "calling-tool": "modelStatus.callingTool",
  "pending-tts": "modelStatus.pendingTts",
  speaking: "modelStatus.speaking",
}
</script>

{#if modelStatus.phase !== null}
  <div class="status-bubble" aria-live="polite" aria-atomic="true">
    <span class="dot-wave" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
    <span class="label">{t(phaseKey[modelStatus.phase] as any)}</span>
  </div>
{/if}

<style>
  .status-bubble {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 18px 18px 18px 4px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    font-size: 0.85rem;
    align-self: flex-start;
    max-width: fit-content;
  }

  .dot-wave {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .dot-wave span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: wave 1.2s ease-in-out infinite;
  }

  .dot-wave span:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dot-wave span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes wave {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }

  .label {
    direction: rtl;
  }
</style>
