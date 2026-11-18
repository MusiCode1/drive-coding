/**
 * composer-draft.svelte.ts — shared composer text draft for TypeArea.
 * (slice dictate-to-input, C1; voice-pending-persistence C1 — localStorage persist)
 */
import { appendDictation as appendDictationEngine } from "../engines/append-dictation"

const STORAGE_KEY = "dc:composer-draft"
const DEBOUNCE_MS = 300

type PersistedDraft = {
  text: string
}

function loadDraftText(): string {
  if (typeof localStorage === "undefined") return ""
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return ""
    const parsed = JSON.parse(raw) as Partial<PersistedDraft>
    return typeof parsed.text === "string" ? parsed.text : ""
  } catch {
    return ""
  }
}

function saveDraftText(text: string): void {
  if (typeof localStorage === "undefined") return
  try {
    if (text.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ text } satisfies PersistedDraft))
  } catch {
    // best-effort
  }
}

export class ComposerDraft {
  text = $state("")

  constructor() {
    this.text = loadDraftText()

    $effect(() => {
      const value = this.text
      const timer = setTimeout(() => {
        saveDraftText(value)
      }, DEBOUNCE_MS)
      return () => clearTimeout(timer)
    })
  }

  setText(value: string): void {
    this.text = value
  }

  appendDictation(chunk: string): void {
    this.text = appendDictationEngine(this.text, chunk)
  }

  clear(): void {
    this.text = ""
    saveDraftText("")
  }
}
