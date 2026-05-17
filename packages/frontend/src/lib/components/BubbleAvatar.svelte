<script lang="ts">
/**
 * BubbleAvatar.svelte — avatar badge for bubble kinds.
 *
 * Positioned bottom-left outside the bubble (bottom: -19px; left: -36px).
 * Icons per kind:
 *   thought  → brain
 *   tool     → wrench
 *   message  → sparkles
 *   user     → user-round
 */

import type { BubbleKind } from "$lib/stores/agent-session.svelte"
import Icon from "./Icon.svelte"

interface Props {
  kind: BubbleKind
}

let { kind }: Props = $props()

const ICON_MAP: Record<BubbleKind, string> = {
  thought: "brain",
  tool: "wrench",
  message: "sparkles",
  user: "user-round",
}

let iconName = $derived(ICON_MAP[kind] ?? "circle")
</script>

<div class="bubble-avatar avatar-{kind}" aria-hidden="true">
  <Icon name={iconName} size={14} strokeWidth={1.75} />
</div>

<style>
  .bubble-avatar {
    position: absolute;
    bottom: -19px;
    left: -36px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-card);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    flex-shrink: 0;
  }

  /* Thought avatar — purple tint */
  .avatar-thought {
    background: rgba(136, 85, 255, 0.15);
    border-color: rgba(136, 85, 255, 0.4);
    color: rgba(220, 200, 255, 0.95);
  }

  /* Tool avatar — blue tint */
  .avatar-tool {
    background: rgba(79, 140, 255, 0.15);
    border-color: rgba(79, 140, 255, 0.4);
    color: rgba(180, 210, 255, 0.95);
  }

  /* Message avatar — subtle */
  .avatar-message {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--border-strong);
    color: var(--fg);
  }

  /* User avatar — teal tint */
  .avatar-user {
    background: rgba(79, 200, 200, 0.18);
    border-color: rgba(79, 200, 200, 0.45);
    color: rgba(190, 235, 235, 0.95);
  }
</style>
