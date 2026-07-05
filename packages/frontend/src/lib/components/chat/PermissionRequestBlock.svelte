<script lang="ts">
/**
 * PermissionRequestBlock — בקשת-הרשאה inline בצ'אט (slice-permission-ui-client-shell, Commit 2).
 *
 * client shell בלבד: מרונדר מ-session.pendingPermission (ראה ChatBubbles.svelte,
 * מחוץ ל-<Virtualizer>, ליד <StatusBubble/>). אין חיבור חי ל-ACP בסלייס הזה.
 *
 * עיצוב קרוב ל-ToolBubble (border restrained, status, title, details) — לא card
 * בתוך card, לא modal.
 *
 * גישור-חתימה: onSelect/onCancel מצפים ל-(requestId, optionId)/(requestId) —
 * ה-handler הפנימי מגשר מקליק-כפתור (option) ל-קריאה עם request.id.
 */

import XIcon from "@lucide/svelte/icons/x"
import { getI18n } from "$lib/context"
import type { PermissionOptionView, PermissionRequestState } from "$lib/types/permission"
import { prettyJson } from "$lib/util/tool-format"

interface Props {
  request: PermissionRequestState
  onSelect: (requestId: string, optionId: string) => void
  onCancel: (requestId: string) => void
}

const { request, onSelect, onCancel }: Props = $props()
const t = getI18n().t

/** i18n key לפי kind — משמש aria-label/title (הטקסט הנראה תמיד option.name מה-agent). */
const KIND_KEY: Record<string, Parameters<typeof t>[0]> = {
  allow_once: "permission.allowOnce",
  allow_always: "permission.allowAlways",
  reject_once: "permission.rejectOnce",
  reject_always: "permission.rejectAlways",
}

function kindLabel(kind: string): string {
  const key = KIND_KEY[kind]
  return t(key ?? "permission.unknownOption")
}

/** kind לא-מוכר → neutral (§4 Commit 2 UI requirements). */
function kindClass(kind: string): string {
  if (kind === "allow_once" || kind === "allow_always") return "kind-allow"
  if (kind === "reject_once" || kind === "reject_always") return "kind-reject"
  return "kind-neutral"
}

const isPending = $derived(request.status === "pending")

const statusKey = $derived(
  request.status === "pending"
    ? ("permission.pending" as const)
    : request.status === "resolved"
      ? ("permission.resolved" as const)
      : ("permission.cancelled" as const),
)

const rawJson = $derived(prettyJson(request.raw))

function handleSelect(option: PermissionOptionView): void {
  if (!isPending) return
  // גישור: ה-VM מצפה ל-(requestId, optionId), לא ל-Event של הכפתור.
  onSelect(request.id, option.optionId)
}

function handleCancel(): void {
  if (!isPending) return
  onCancel(request.id)
}
</script>

<div class="flex self-end max-w-[78%] min-w-0 permission-wrap">
  <div
    class="rounded-xl border overflow-hidden text-[13px] flex-1 min-w-0"
    style="background:var(--bg-card); border-color:var(--border)"
  >
    <!-- header: status + title + cancel -->
    <div class="flex items-center gap-2 px-3 py-2">
      <span class="size-2 rounded-full shrink-0 status-{request.status}" aria-hidden="true"></span>
      <div class="flex-1 min-w-0">
        <div class="truncate font-medium" style="color:var(--fg-dim)" dir="auto">
          {request.raw.toolCall.title ?? t("permission.title")}
        </div>
        <div class="text-[11px] opacity-70">{t(statusKey)}</div>
      </div>
      {#if isPending}
        <button
          type="button"
          class="cancel-btn"
          onclick={handleCancel}
          aria-label={t("permission.cancelled")}
          title={t("permission.cancelled")}
        >
          <XIcon size={14} strokeWidth={2} />
        </button>
      {/if}
    </div>

    <!-- options -->
    <div class="flex flex-wrap gap-2 px-3 pb-3">
      {#each request.options as option (option.optionId)}
        <button
          type="button"
          class="option-btn {kindClass(option.kind)}"
          class:selected={request.selectedOptionId === option.optionId}
          disabled={!isPending}
          aria-pressed={request.selectedOptionId === option.optionId}
          title={kindLabel(option.kind)}
          onclick={() => handleSelect(option)}
        >
          {option.name}
        </button>
      {/each}
    </div>

    <!-- details: raw params, closed by default -->
    <details class="details-section border-t" style="border-color:var(--border)">
      <summary class="section-label px-3 py-1.5 cursor-pointer select-none">
        {t("permission.details")}
      </summary>
      <pre class="raw px-3 pb-2" dir="ltr">{rawJson}</pre>
    </details>
  </div>
</div>

<style>
  .permission-wrap {
    align-self: flex-end;
  }

  .status-pending {
    background: #f97316;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .status-resolved {
    background: #22c55e;
  }
  .status-cancelled {
    background: var(--fg-dim, #888);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    list-style: none;
  }

  .cancel-btn {
    display: grid;
    place-items: center;
    min-width: 40px;
    min-height: 40px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-dim);
    cursor: pointer;
    flex-shrink: 0;
  }
  .cancel-btn:hover {
    background: var(--bg-elev);
    border-color: var(--border);
  }

  .option-btn {
    min-height: 40px;
    min-width: 40px;
    padding: 0 0.85rem;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--fg-dim);
  }
  .option-btn:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .option-btn.selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .option-btn.kind-allow {
    border-color: color-mix(in srgb, #22c55e 45%, var(--border));
    color: #22c55e;
  }
  .option-btn.kind-reject {
    border-color: color-mix(in srgb, #ef4444 45%, var(--border));
    color: #ef4444;
  }
  .option-btn.kind-neutral {
    border-color: var(--border);
  }

  .raw {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    max-height: 260px;
    overflow-y: auto;
  }

  .details-section summary::-webkit-details-marker {
    display: none;
  }
</style>
