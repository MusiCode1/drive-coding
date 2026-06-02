<script lang="ts">
  /**
   * /wake-word-test — route בדיקה standalone לתשתית wake-word.
   *
   * הערה: VM נוצר כאן ישירות (לא דרך +layout.svelte) — חריג מכוון מחוק זהב #1.
   * זה route בדיקה מבודד שלא חלק מה-app shell. ה-VM מת עם ה-route.
   *
   * Consumer: רק route זה.
   */
  import { onMount } from "svelte"
  import { WakeWordVM } from "$lib/view-models/wake-word.svelte.js"
  import VoiceOrb from "$lib/components/VoiceOrb.svelte"

  const BASE_ASSET_URL = "/wake-word/models"
  const KEYWORDS = ["hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"]

  const vm = new WakeWordVM({
    keywords: KEYWORDS,
    baseAssetUrl: BASE_ASSET_URL,
  })

  let status = $state("loading models...")
  let clips: { url: string; label: string }[] = $state([])

  onMount(async () => {
    try {
      await vm.load()
      status = "ready — tap the orb to listen"
    } catch (err) {
      status = `model load failed: ${err instanceof Error ? err.message : String(err)}`
    }
  })

  // מעקב אחרי שינוי mode לעדכון status
  $effect(() => {
    if (vm.mode === "off") {
      status = vm.lastError ? `error: ${vm.lastError}` : "off — tap the orb to listen"
    } else if (vm.mode === "listening") {
      status = 'listening — say "hey jarvis" or another keyword'
    } else if (vm.mode === "recording") {
      status = "recording — say the wake word again to stop"
    }
  })
</script>

<svelte:head>
  <title>Wake Word Test</title>
</svelte:head>

<main>
  <h1>Voice Orb — Wake Word Test</h1>
  <p class="sub">
    Grey = off &middot; Blue = listening &middot; Red = recording &middot; brighter = louder &middot; flash = detection<br />
    Keywords: hey jarvis &middot; alexa &middot; hey mycroft &middot; hey rhasspy
  </p>

  <div class="status">{status}</div>

  <div class="orb-stage">
    <VoiceOrb {vm} />
  </div>

  {#if clips.length > 0}
    <section class="clips">
      <h3>Recordings</h3>
      {#each clips as clip}
        <div class="clip">
          <p>{clip.label}</p>
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio controls src={clip.url}></audio>
          <a href={clip.url} download="capture.wav">download</a>
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    background: #0d1117;
    color: #e6edf3;
    font-family: system-ui, sans-serif;
  }

  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem 1rem;
    min-height: 100vh;
  }

  h1 {
    font-size: 1.3rem;
    margin: 0;
  }

  .sub {
    opacity: 0.6;
    font-size: 0.85rem;
    margin-top: -1rem;
    text-align: center;
  }

  .status {
    font-size: 0.9rem;
    opacity: 0.85;
    min-height: 1.2em;
  }

  .orb-stage {
    width: 300px;
    height: 300px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clips {
    width: min(40rem, 92vw);
    padding: 1rem;
    border: 1px solid #30363d;
    border-radius: 0.6rem;
  }

  .clips h3 {
    margin-top: 0;
    font-size: 1rem;
  }

  .clip {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.4rem;
  }

  .clip p {
    margin: 0 0 0.3rem;
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .clip a {
    color: #60a5fa;
    margin-inline-start: 0.5rem;
    font-size: 0.8rem;
  }
</style>
