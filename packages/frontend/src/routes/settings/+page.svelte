<script lang="ts">
/**
 * /settings — Phase 12 settings page.
 *
 * - Voice picker (ElevenLabs voices, hard-coded MVP list)
 * - Thought voice (same or separate)
 * - Audio cues toggles
 * - Language (he only MVP)
 */
import { settingsStore } from "$lib/stores/settings-store.svelte"

// Hard-coded MVP voice list (ElevenLabs IDs)
const VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
]

const THOUGHT_VOICES = [{ id: "same", name: "אותו voice" }, ...VOICES]

type CueKey = "recordingStart" | "thinking" | "speaking" | "error"
const CUE_LABELS: Record<CueKey, string> = {
  recordingStart: "תחילת הקלטה",
  thinking: "עיבוד",
  speaking: "השמעה",
  error: "שגיאה",
}
</script>

<div class="settings-page">
  <header class="page-header">
    <a href="/" class="back-link">← דשבורד</a>
    <h1 class="page-title">הגדרות</h1>
  </header>

  <div class="settings-content">
    <!-- Voice picker -->
    <section class="setting-section">
      <h2 class="section-title">קול ראשי</h2>
      <select
        class="select-input"
        value={settingsStore.voiceId}
        onchange={(e) => settingsStore.setVoiceId((e.target as HTMLSelectElement).value)}
      >
        {#each VOICES as voice (voice.id)}
          <option value={voice.id}>{voice.name}</option>
        {/each}
      </select>
    </section>

    <!-- Thought voice -->
    <section class="setting-section">
      <h2 class="section-title">קול מחשבות</h2>
      <select
        class="select-input"
        value={settingsStore.thoughtVoiceId}
        onchange={(e) => settingsStore.setThoughtVoiceId((e.target as HTMLSelectElement).value)}
      >
        {#each THOUGHT_VOICES as voice (voice.id)}
          <option value={voice.id}>{voice.name}</option>
        {/each}
      </select>
    </section>

    <!-- Audio cues -->
    <section class="setting-section">
      <h2 class="section-title">אפקטי קול</h2>
      <div class="toggles-list">
        {#each Object.entries(CUE_LABELS) as [key, label] (key)}
          <label class="toggle-row">
            <span class="toggle-label">{label}</span>
            <input
              type="checkbox"
              class="toggle-checkbox"
              checked={settingsStore.audioCues[key as CueKey]}
              onchange={(e) =>
                settingsStore.setAudioCue(key as CueKey, (e.target as HTMLInputElement).checked)}
            />
          </label>
        {/each}
      </div>
    </section>

    <!-- Language -->
    <section class="setting-section">
      <h2 class="section-title">שפה</h2>
      <select class="select-input" value="he" disabled>
        <option value="he">עברית</option>
      </select>
      <p class="hint">שפות נוספות יתווספו בגרסאות עתידיות.</p>
    </section>

    <!-- Reset -->
    <section class="setting-section">
      <button class="reset-btn" onclick={settingsStore.reset}>איפוס לברירת מחדל</button>
    </section>
  </div>
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-link {
    color: var(--fg-dim);
    text-decoration: none;
    font-size: 0.9rem;
  }

  .back-link:hover {
    color: var(--fg);
    text-decoration: none;
  }

  .page-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-5) var(--s-4);
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
  }

  .setting-section {
    margin-bottom: var(--s-6);
  }

  .section-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 var(--s-3);
  }

  .select-input {
    width: 100%;
    padding: var(--s-3) var(--s-4);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--fg);
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .select-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  .select-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    margin: var(--s-2) 0 0;
    font-size: 0.8rem;
    color: var(--fg-muted);
  }

  /* Audio cues toggles */
  .toggles-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid var(--border);
  }

  .toggle-row:last-child {
    border-bottom: none;
  }

  .toggle-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .toggle-label {
    font-size: 0.9rem;
  }

  .toggle-checkbox {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  /* Reset button */
  .reset-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-dim);
    padding: var(--s-3) var(--s-4);
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .reset-btn:hover {
    border-color: var(--recording);
    color: var(--recording);
  }
</style>
