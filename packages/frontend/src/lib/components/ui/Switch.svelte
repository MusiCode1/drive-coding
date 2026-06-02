<script lang="ts">
/**
 * Switch — עטיפת Bits UI Switch עם סגנון הפרויקט.
 *
 * שימוש:
 *   <Switch bind:checked={myBool} disabled={false} />
 *
 * ─── settings-redesign (redesign-3) ───
 */
import { Switch as BitsSwitch } from "bits-ui"

interface Props {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
}

const { checked = false, onCheckedChange, disabled = false }: Props = $props()
</script>

<BitsSwitch.Root
  {checked}
  {disabled}
  {onCheckedChange}
  class="toggle {checked ? 'on' : ''} {disabled ? 'opacity-40 cursor-not-allowed' : ''}"
>
  <BitsSwitch.Thumb />
</BitsSwitch.Root>
