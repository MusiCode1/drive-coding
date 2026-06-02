<script lang="ts" generics="T extends string = string">
/**
 * Select — native <select> מעוצב בסגנון הפרויקט.
 *
 * Bits UI Select דורש Portal + JS רב — fallback ל-native styled select
 * שתומך ב-RTL ופשוט יותר לשימוש. תועד ב-decisions.
 *
 * שימוש:
 *   <Select bind:value={myVal} options={[{ value: "x", label: "X" }]} />
 *
 * ─── settings-redesign (redesign-3) ───
 */

interface Option {
  value: T
  label: string
}

interface Props {
  value?: T
  options?: Option[]
  disabled?: boolean
  ariaLabel?: string
  onchange?: (value: T) => void
}

const {
  value = "" as T,
  options = [],
  disabled = false,
  ariaLabel,
  onchange,
}: Props = $props()

function handleChange(e: Event) {
  const target = e.currentTarget as HTMLSelectElement
  onchange?.(target.value as T)
}
</script>

<select
  value={value}
  {disabled}
  aria-label={ariaLabel}
  onchange={handleChange}
  class="rounded-xl px-3 py-3 text-sm outline-none border focus:border-[var(--accent)] appearance-none w-full"
  style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
>
  {#each options as opt (opt.value)}
    <option value={opt.value}>{opt.label}</option>
  {/each}
</select>
