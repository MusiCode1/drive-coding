/**
 * composer-draft.svelte.ts — shared composer text draft for TypeArea.
 * (slice dictate-to-input, C1)
 */

import { appendDictation as appendDictationEngine } from "../engines/append-dictation"

export class ComposerDraft {
  text = $state("")

  setText(value: string): void {
    this.text = value
  }

  appendDictation(chunk: string): void {
    this.text = appendDictationEngine(this.text, chunk)
  }

  clear(): void {
    this.text = ""
  }
}
