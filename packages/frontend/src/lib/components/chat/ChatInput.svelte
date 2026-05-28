<script lang="ts">
import { getI18n, getSession } from "$lib/context"

const session = getSession()
const t = getI18n().t

let promptText = $state("")

function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  const text = promptText.trim()
  if (!text) return
  session.sendPrompt(text)
  promptText = ""
}

const isDisabled = $derived(
  session.status !== "connected" && session.status !== "thinking",
)
</script>

<form onsubmit={onSubmit}>
  <textarea
    bind:value={promptText}
    placeholder={t("chat.prompt.placeholder")}
    rows="2"
    disabled={isDisabled}
    onkeydown={(e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSubmit(e as unknown as SubmitEvent)
      }
    }}
  ></textarea>
  <button
    type="submit"
    disabled={!promptText.trim() || isDisabled}
  >
    {t("chat.send")}
  </button>
</form>

<style>
  form {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  textarea {
    flex: 1;
    padding: 0.6rem 0.8rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--fg);
    resize: none;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  textarea:disabled {
    opacity: 0.5;
  }

  button {
    padding: 0 1.2rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hi);
  }

  button:disabled {
    background: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
  }
</style>
