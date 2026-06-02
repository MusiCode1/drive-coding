<script lang="ts">
/**
 * SettingToggle — שורת toggle (Switch + label) עם עיצוב Settings.
 * משתמש ב-Switch wrapper מ-components/ui.
 *
 * ─── settings-redesign (redesign-3) ───
 */
import Switch from "$lib/components/ui/Switch.svelte"

interface Props {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}

const { label, checked, onCheckedChange, disabled = false }: Props = $props()
</script>

<label
  class="flex items-center justify-between py-3 cursor-pointer"
  style="border-top:1px solid var(--border)"
  class:opacity-40={disabled}
  class:pointer-events-none={disabled}
>
  <span class="text-sm" style="color:var(--fg)">{label}</span>
  <Switch {checked} {onCheckedChange} {disabled} />
</label>
