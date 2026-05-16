<script lang="ts">
// Slice 8 ייתן את ה-settings האמיתיים (provider catalog, voices, language).
// כרגע placeholder כדי שלא יהיה 404 מה-⚙ ב-header.
</script>

<main>
  <header>
    <a href="/" class="back">← חזרה לדשבורד</a>
    <h1>הגדרות</h1>
  </header>

  <section class="placeholder">
    <p>הגדרות עוד לא זמינות.</p>
    <p class="hint">דף ההגדרות יוטמע ב-Slice 8 — provider catalog (STT/TTS/translator), בחירת קולות, ניהול מפתחות.</p>
  </section>
</main>

<style>
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--fg, #e6e6e6);
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .back {
    color: var(--fg-dim, #a0a0a0);
    text-decoration: none;
    font-size: 0.9rem;
  }
  .back:hover {
    color: var(--accent-hi, #6ba1ff);
  }
  .placeholder {
    background: var(--bg-elev, #161922);
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 12px;
    padding: 2rem;
  }
  .placeholder p {
    margin: 0 0 0.5rem;
  }
  .hint {
    color: var(--fg-dim, #a0a0a0);
    font-size: 0.9rem;
  }
</style>
