<script lang="ts">
/**
 * LeaveRunningButton — "השאר רץ": הכפתור, החלטת-האזהרה, ומודל-האישור.
 * חולץ מ-SessionOptionsPanel יחד עם SessionActionsRow (מס-חילוץ).
 */
import LogOutIcon from "@lucide/svelte/icons/log-out"
import { Dialog as BitsDialog } from "bits-ui"
import { goto } from "$app/navigation"
import { getI18n, getSession, getSettings } from "$lib/context"
import { shouldWarnOnLeave } from "$lib/session/should-warn-on-leave"

const t = getI18n().t
const session = getSession()
const settings = getSettings()

let confirmOpen = $state(false)
let dontShowAgain = $state(false)

function onLeaveRunning() {
  if (
    shouldWarnOnLeave({
      isRemote: session.isRemoteView,
      bypassActive: session.bypassActive,
      turnIdle: session.turnState === "idle",
      suppress: settings.suppressLeaveWarning,
    })
  ) {
    confirmOpen = true
  } else {
    doLeaveRunning()
  }
}

function doLeaveRunning() {
  if (dontShowAgain) settings.setSuppressLeaveWarning(true)
  confirmOpen = false
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

<BitsDialog.Root bind:open={confirmOpen}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
    <BitsDialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl flex flex-col gap-4"
      style="background:var(--bg-elev); border:1px solid var(--border)"
    >
      <BitsDialog.Title class="text-base font-semibold" style="color:var(--fg)">
        {t("session.leaveWarning.title")}
      </BitsDialog.Title>
      <p class="text-[13px] leading-relaxed" style="color:var(--fg-dim)">
        {t("session.leaveWarning.body")}
      </p>
      <label class="flex items-center gap-2 text-[13px]" style="color:var(--fg-dim)">
        <input type="checkbox" class="cursor-pointer" bind:checked={dontShowAgain} />
        {t("session.leaveWarning.dontShowAgain")}
      </label>
      <div class="flex gap-2 justify-end">
        <BitsDialog.Close
          class="px-3 py-2 rounded-lg text-[13px] border"
          style="border-color:var(--border); color:var(--fg-dim)"
        >
          {t("session.leaveWarning.cancel")}
        </BitsDialog.Close>
        <button
          class="px-3 py-2 rounded-lg text-[13px]"
          style="background:var(--accent); color:var(--bg)"
          onclick={doLeaveRunning}
        >
          {t("session.leaveWarning.confirm")}
        </button>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>
