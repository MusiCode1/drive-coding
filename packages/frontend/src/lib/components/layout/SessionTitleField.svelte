<script lang="ts">
/** Editable session title — reads AgentSession from context (slice session-title-manual). */
import { getI18n, getSession } from "$lib/context"

const t = getI18n().t
const session = getSession()

let draft = $state("")
let synced = $state("")

$effect(() => {
  const title = session.sessionTitle
  if (title !== synced && draft !== title) {
    draft = title
    synced = title
  }
})

function commit(): void {
  session.setManualTitle(draft)
  synced = session.sessionTitle
}
</script>

<label class="flex flex-col gap-1 px-1 shrink-0">
  <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
    {t("session.titleLabel")}
  </span>
  <input
    type="text"
    class="w-full rounded-lg border px-2.5 py-2 text-[13px] min-h-11 bg-transparent"
    style="border-color:var(--border); color:var(--fg)"
    bind:value={draft}
    onblur={commit}
    onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
  />
</label>
