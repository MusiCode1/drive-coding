<script lang="ts">
/**
 * PermissionRequestBlock — בקשת הרשאה חיה מהסוכן, inline בצ'אט (סגנון ToolBubble, לא modal).
 *
 * מוצג ע"י ChatBubbles כש-session.pendingPermission לא-null (מחוץ ל-Virtualizer,
 * אחרי הרשימה — כמו PlanChecklist/StatusBubble). props בלבד — לא ניגש ל-session ישירות,
 * כדי שיהיה rendered גם ע"י slice B (elicitation) שישכפל את הדפוס עם פרופס שונים.
 *
 * טקסט הפעולה/כלי (params.toolCall) מגיע מהסוכן — מוצג as-is. רק תוויות-הכפתורים דרך t().
 *
 * ─── slice-permission-ui-basic Commit 3 ───
 */

import Avatar from "$lib/components/chat/Avatar.svelte"
import { getI18n } from "$lib/context"
import {
  defaultPermissionOptionId,
  mapPermissionOptions,
  type PermissionParams,
} from "$lib/types/permission"

let {
  params,
  onResolve,
  onCancel,
}: {
  params: PermissionParams
  onResolve: (optionId: string) => void
  onCancel: () => void
} = $props()

const t = getI18n().t

const options = $derived(mapPermissionOptions(params))
const defaultOptionId = $derived(defaultPermissionOptionId(options))
// toolCall.title/toolCallId — כמו-שהם מהסוכן (as-is, לא מתורגם)
const toolTitle = $derived(params.toolCall.title ?? params.toolCall.toolCallId)

const LABEL_KEY = {
  allow_once: "permission.allowOnce",
  allow_always: "permission.allowAlways",
  reject_once: "permission.reject",
  reject_always: "permission.reject",
} as const

function isReject(kind: string): boolean {
  return kind.startsWith("reject")
}

// disabled אחרי קליק ראשון — מונע double-submit בזמן שה-VM מאפס את pendingPermission
// (ה-block יורד מהעץ ברגע ש-#resolvePendingPermission רץ; זה גשר-הגנה קצר).
let submitting = $state(false)

function handleSelect(optionId: string): void {
  if (submitting) return
  submitting = true
  onResolve(optionId)
}

function handleCancel(): void {
  if (submitting) return
  submitting = true
  onCancel()
}
</script>

<div class="flex gap-2 self-end max-w-[78%] min-w-0 items-end flex-row-reverse pb-5">
  <Avatar kind="tool" />

  <div class="permission-block" role="alertdialog" aria-live="assertive">
    <div class="header">
      <span class="title">{t("permission.title")}</span>
      <button
        class="close-btn"
        onclick={handleCancel}
        disabled={submitting}
        aria-label={t("permission.reject")}
      >
        ✕
      </button>
    </div>

    <div class="tool-name" dir="auto">{toolTitle}</div>

    <div class="status">{t("permission.pending")}</div>

    <div class="actions">
      {#each options as opt (opt.optionId)}
        <button
          class="btn"
          class:allow={!isReject(opt.kind)}
          class:reject={isReject(opt.kind)}
          class:is-default={opt.optionId === defaultOptionId}
          disabled={submitting}
          onclick={() => handleSelect(opt.optionId)}
        >
          {t(LABEL_KEY[opt.kind])}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .permission-block {
    border-radius: 0.75rem;
    border: 1px solid var(--accent);
    background: var(--bg-card);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    flex: 1;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--accent-hi, var(--accent));
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
  }
  .close-btn:hover:not(:disabled) {
    background: var(--bg);
  }
  .close-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tool-name {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--fg-dim);
    word-break: break-word;
  }

  .status {
    font-size: 0.72rem;
    opacity: 0.65;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }

  .btn {
    border-radius: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.allow {
    border-color: var(--accent);
    color: var(--accent-hi, var(--accent));
  }
  .btn.allow.is-default {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .btn.reject {
    border-color: var(--recording);
    color: var(--recording);
  }
</style>
