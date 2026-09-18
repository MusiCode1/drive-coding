<script lang="ts">
/** Read-only session field map from AgentSession (slice session-memory C2). */
import { getI18n, getSession } from "$lib/context"

const t = getI18n().t
const session = getSession()

const entries = $derived(Object.entries(session.sessionFields))
</script>

<label class="flex flex-col gap-1 px-1 shrink-0">
  <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
    {t("session.fieldsLabel")}
  </span>
  {#if entries.length === 0}
    <span class="text-[13px]" style="color:var(--fg-dim)">{t("session.fieldsEmpty")}</span>
  {:else}
    <ul class="flex flex-col gap-1 text-[13px] list-none m-0 p-0" style="color:var(--fg)">
      {#each entries as [key, value] (key)}
        <li><bdi>{key}</bdi>: <bdi>{value}</bdi></li>
      {/each}
    </ul>
  {/if}
</label>
