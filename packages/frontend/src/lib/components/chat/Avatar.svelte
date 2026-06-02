<script lang="ts">
/**
 * Avatar — אווטאר Lucide לפי kind (C3).
 *
 * kind → צבע/רקע + אייקון (מוקאפ avatarCfg 1136-1147):
 *   user    → User  icon, accent-soft bg
 *   agent   → Sparkles icon, accent-soft bg
 *   thought → Brain icon, thinking-soft bg
 *   tool    → Wrench icon, accent-soft bg
 *
 * ─── redesign-5 (C3) ───
 */
import UserIcon from "@lucide/svelte/icons/user"
import SparklesIcon from "@lucide/svelte/icons/sparkles"
import BrainIcon from "@lucide/svelte/icons/brain"
import WrenchIcon from "@lucide/svelte/icons/wrench"

type AvatarKind = "user" | "agent" | "thought" | "tool"

interface Props {
  kind: AvatarKind
}

const { kind }: Props = $props()

const BG: Record<AvatarKind, string> = {
  user:    "color-mix(in srgb, var(--accent) 18%, transparent)",
  agent:   "color-mix(in srgb, var(--accent) 22%, transparent)",
  thought: "color-mix(in srgb, var(--thinking) 15%, transparent)",
  tool:    "color-mix(in srgb, var(--accent) 15%, transparent)",
}

const FG: Record<AvatarKind, string> = {
  user:    "var(--accent-hi)",
  agent:   "var(--accent-hi)",
  thought: "var(--thinking)",
  tool:    "var(--accent-hi)",
}
</script>

<span
  class="avatar shrink-0 size-7 grid place-items-center rounded-full"
  style="background:{BG[kind]}; color:{FG[kind]}"
>
  {#if kind === "user"}
    <UserIcon size={15} strokeWidth={1.75} />
  {:else if kind === "agent"}
    <SparklesIcon size={15} strokeWidth={1.75} />
  {:else if kind === "thought"}
    <BrainIcon size={15} strokeWidth={1.75} />
  {:else if kind === "tool"}
    <WrenchIcon size={15} strokeWidth={1.75} />
  {/if}
</span>
