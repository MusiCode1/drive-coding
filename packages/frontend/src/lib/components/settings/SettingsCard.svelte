<script lang="ts">
/**
 * SettingsCard — כרטיס wrapper עם כותרת uppercase + body.
 * לפי מוקאפ redesign-vnext: rounded-2xl border p-4 mb-4.
 *
 * ─── settings-redesign (redesign-3) ───
 */

interface Props {
  title: string
  children?: import("svelte").Snippet
}

const { title, children }: Props = $props()
</script>

<div
  class="rounded-2xl border p-4 mb-4 flex flex-col gap-4"
  style="background:var(--bg-elev); border-color:var(--border)"
>
  <div class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-muted)">
    {title}
  </div>
  {@render children?.()}
</div>
