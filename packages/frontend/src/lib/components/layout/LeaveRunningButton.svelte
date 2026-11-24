<script lang="ts">
import LogOutIcon from "@lucide/svelte/icons/log-out"
import { goto } from "$app/navigation"
import { getI18n, getSession } from "$lib/context"

const t = getI18n().t
const session = getSession()

function onLeaveRunning() {
  session.leaveRunning()
  goto("/")
}
</script>

<!-- leave-running (לא הורג) — ניטרלי, icon-only -->
<button
  class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
  style="border-color:var(--border); color:var(--fg-dim)"
  onclick={onLeaveRunning}
  aria-label={t("session.leaveRunning")}
  title={t("session.leaveRunning")}
>
  <LogOutIcon size={16} strokeWidth={1.75} />
</button>
