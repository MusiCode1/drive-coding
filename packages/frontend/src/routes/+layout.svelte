<script lang="ts">
let { children } = $props()
</script>

{@render children?.()}

<style>
  /* ── Design Tokens — Dark Mode (Slice 7) ───────────────────────────────── */
  /* Ported from v1 index.html:8-27. §9.6 "High contrast, large text."       */
  :global(:root) {
    color-scheme: dark;
    --bg: #0f1115;
    --bg-elev: #161922;
    --fg: #e6e6e6;
    --fg-dim: #a0a0a0;
    --muted: #6a6a6a;
    --accent: #4f8cff;
    --accent-hi: #6ba1ff;
    --recording: #ff4f4f;
    --thinking: #ffaa33;
    --speaking: #4fff8a;
    --bubble-user: #2a3550;
    --bubble-agent: #1d2230;
    --border: #2a2f3a;
    --tool-bg: #1a1f2a;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    margin: 0;
    height: 100dvh;
    overflow: hidden;
  }

  :global(body) {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--fg);
    display: flex;
    flex-direction: column;
  }

  /* ── Animations (Slice 7) — defined at :global level so they work in child components ── */
  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(255, 79, 79, 0.6);
    }
    50% {
      box-shadow: 0 0 0 18px rgba(255, 79, 79, 0);
    }
  }

  @keyframes rotate-slow {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes flash-fast {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  @keyframes pulse-dot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
