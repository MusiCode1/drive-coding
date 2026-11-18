<script lang="ts">
/**
 * elicitation-dialog-harness.svelte — mount harness for ElicitationDialog component tests.
 *
 * ─── slice/elicitation-options-visible (Commit 0) ───
 */

import { setI18n } from "$lib/context"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { ElicitationParams } from "$lib/types/elicitation"
import ElicitationDialog from "../ElicitationDialog.svelte"

let {
  params,
  onResolve = () => {},
  onDecline = () => {},
  onCancel = () => {},
}: {
  params: ElicitationParams
  onResolve?: (content: Record<string, string | number | boolean>) => void
  onDecline?: () => void
  onCancel?: () => void
} = $props()

setI18n({ t: (key: string) => key } as unknown as I18nVM)
</script>

<ElicitationDialog {params} {onResolve} {onDecline} {onCancel} />
