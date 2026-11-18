<script lang="ts">
import { getI18n } from "$lib/context"

let { expiresAtMs }: { expiresAtMs: number } = $props()

const t = getI18n().t

let seconds = $state(0)

$effect(() => {
  const tick = () => {
    seconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000))
  }
  tick()
  const id = setInterval(tick, 250)
  return () => clearInterval(id)
})
</script>

<span class="countdown" dir="auto">
  {t("scopePrompt.expiresIn")} {seconds} {t("scopePrompt.seconds")}
</span>

<style>
  .countdown {
    color: var(--fg);
    font-size: 0.78rem;
    line-height: 1.35;
  }
</style>
