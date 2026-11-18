<script lang="ts">
/**
 * StatusBubble — בועת-סטטוס transient (חיווי בלבד).
 *
 * מציגה את ה-phase הנוכחי של המודל (waiting/thinking/responding/calling-tool/pending-tts/speaking).
 * אינה חלק מ-session.bubbles — מופיעה מעל הרשימה בזמן אמת.
 * phase === null → לא מרנדרת דבר.
 *
 * control-dock: בקרת השמעה עברה ל-footer (אח של RecordFooter).
 *
 * ─── msr-v2 / B1-controls-ui ───
 */
import { getI18n, getModelStatus, getSession } from "$lib/context"
import type { ModelPhase } from "$lib/view-models/derived/model-status.svelte"

const modelStatus = getModelStatus()
const session = getSession()
const t = getI18n().t

const phaseKey: Record<NonNullable<ModelPhase>, Parameters<typeof t>[0]> = {
  waiting:       "modelStatus.waiting",
  thinking:      "modelStatus.thinking",
  responding:    "modelStatus.responding",
  "calling-tool": "modelStatus.callingTool",
  "pending-tts":  "modelStatus.pendingTts",
  speaking:      "modelStatus.speaking",
}

// slice drop-a5-watchdog (25/08): חיווי `turnInterrupted` הוסר יחד עם ה-watchdog
// שהדליק אותו. הוא לא סימן תקלה אמיתית — הוא נדלק על תור בריא, כי ב-HTTP
// השעון של A5 לא התאפס כלל (kick חי רק ב-`#onSessionUpdate` = מסלול WS).
// זיהוי תור-ששקע נשאר ב-`engines/turn-watchdog.ts`, שמתריע ואינו קוטע.
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
    align-self: flex-end; /* בצד הסוכן (כמו MessageBubble self-end) — הסטטוס מייצג את המודל */
  }

  .status-bubble--interrupted {
    border-color: var(--recording, #e53e3e);
    color: var(--recording, #e53e3e);
    animation: fade-out 4s ease-out forwards;
  }

  @keyframes fade-out {
    0%   { opacity: 1; }
    70%  { opacity: 1; }
    100% { opacity: 0; }
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
