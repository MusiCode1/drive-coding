<script lang="ts">
/**
 * SessionOptionsPanel — תוכן משותף DRY לסייד-בר (דסקטופ) ולBottom-Sheet (מובייל).
 *
 * סבב זה: **shell בלבד** — selects placeholder (לא מחווטים לAPI).
 * redesign-3 יחווט לאפשרויות סוכן/מודל/חשיבה ורשימת סשנים.
 *
 * ─── redesign-2 ───
 */
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import { getI18n } from "$lib/context"

const t = getI18n().t
</script>

<!-- אפשרויות סוכן -->
<div class="flex flex-col gap-2.5">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.agentOptions")}
  </div>

  <!-- סוכן — placeholder, redesign-3 יחווט -->
  <label class="flex flex-col gap-1">
    <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.agent.label")}</span>
    <!-- TODO redesign-3: wire to agent options -->
    <select
      class="rounded-lg px-2.5 py-2 text-[13px] outline-none border appearance-none"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      disabled
    >
      <option>build</option>
    </select>
  </label>

  <!-- מודל — placeholder -->
  <label class="flex flex-col gap-1">
    <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.model.label")}</span>
    <!-- TODO redesign-3: wire to model options -->
    <select
      class="rounded-lg px-2.5 py-2 text-[13px] outline-none border appearance-none"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      disabled
    >
      <option>claude-sonnet</option>
    </select>
  </label>
</div>

<!-- סשנים -->
<div class="flex flex-col gap-2 flex-1 min-h-0">
  <div class="flex items-center justify-between px-1 shrink-0">
    <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
      {t("sidebar.sessions")}
    </span>
    <!-- TODO redesign-6: wire refresh -->
    <button
      class="size-6 grid place-items-center rounded"
      style="color:var(--fg-dim)"
      title={t("sidebar.refresh")}
      aria-label={t("sidebar.refresh")}
    >
      <RefreshCwIcon size={13} strokeWidth={2} />
    </button>
  </div>

  <!-- סשן חדש -->
  <!-- TODO redesign-6: wire to create session -->
  <button
    class="shrink-0 text-start rounded-lg p-2.5 text-[13px] font-medium border border-dashed"
    style="border-color:var(--border); color:var(--accent)"
  >
    ＋ {t("sidebar.newSession")}
  </button>

  <!-- placeholder רשימת סשנים — TODO redesign-6: wire -->
  <div class="flex flex-col gap-2 overflow-y-auto chat-scroll flex-1 min-h-0 -mx-1 px-1">
    <!-- ריק בינתיים -->
  </div>
</div>
