<!--
  pending-capture-banner-harness — mounts PendingCaptureBanner for DOM assertions.
-->
<script lang="ts">
  import type { MessageKey } from "@drive-coding/core/i18n"
  import PendingCaptureBanner from "../PendingCaptureBanner.svelte"

  let {
    error = null as MessageKey | null,
    canRetry = false,
    restored = false,
  }: {
    error?: MessageKey | null
    canRetry?: boolean
    restored?: boolean
  } = $props()

  const t = (key: MessageKey) => key
</script>

<PendingCaptureBanner
  {error}
  {canRetry}
  {restored}
  onRetry={() => {}}
  onDismiss={() => {}}
  {t}
/>
