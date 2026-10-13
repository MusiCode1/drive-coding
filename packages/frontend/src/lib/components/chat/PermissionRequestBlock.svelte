<script lang="ts">
/**
 * PermissionRequestBlock — בקשת הרשאה חיה מהסוכן, inline בצ'אט (סגנון ToolBubble, לא modal).
 *
 * מוצג ע"י ChatBubbles כש-session.pendingPermission לא-null (מחוץ ל-Virtualizer,
 * אחרי הרשימה — כמו PlanChecklist/StatusBubble). props בלבד — לא ניגש ל-session ישירות,
 * כדי שיהיה rendered גם ע"י slice B (elicitation) שישכפל את הדפוס עם פרופס שונים.
 *
 * טקסט הפעולה/כלי (params.toolCall) מגיע מהסוכן — מוצג as-is. רק תוויות-הכפתורים דרך t().
 * Scope escalation (`toolCallId` prefix `scope-` + `_meta`) is ours — translated; see readScopePromptDetail.
 *
 * ─── slice-permission-ui-basic Commit 3 ───
 */

import Avatar from "$lib/components/chat/Avatar.svelte"
import PermissionDetailRows from "$lib/components/chat/PermissionDetailRows.svelte"
import PermissionPromptChrome from "$lib/components/chat/PermissionPromptChrome.svelte"
import { getI18n } from "$lib/context"
import type { PermissionParams } from "$lib/types/permission"
import { readScopePromptDetail, scopeDetailRows } from "$lib/types/scope-prompt-view"

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

const scopeDetail = $derived(readScopePromptDetail(params))
const scopeRows = $derived(scopeDetail ? scopeDetailRows(scopeDetail, t) : [])
const headerTitle = $derived(
  scopeDetail ? t("scopePrompt.title") : t("permission.title"),
)
// toolCall.title/toolCallId — כמו-שהם מהסוכן (as-is, לא מתורגם) כשאין scope detail
const toolTitle = $derived(params.toolCall.title ?? params.toolCall.toolCallId)

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

  <PermissionPromptChrome
    {headerTitle}
    {params}
    {submitting}
    onResolve={handleSelect}
    onCancel={handleCancel}
  >
    {#snippet body()}
      {#if scopeDetail}
        <PermissionDetailRows rows={scopeRows} />
      {:else}
        <div class="tool-name" dir="auto">{toolTitle}</div>
      {/if}
    {/snippet}
  </PermissionPromptChrome>
</div>

<style>
  .tool-name {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--fg-dim);
    word-break: break-word;
  }
</style>
