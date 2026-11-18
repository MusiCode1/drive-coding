/**
 * voice-transcript.ts — splits a handoff's conversation context into speaker lines (slice codex-voice-poc).
 *
 * The context arrives as plain `user: …` / `assistant: …` lines; anything else is kept as is.
 */

export type TranscriptLine = { role: "user" | "assistant" | null; text: string }

export function transcriptLines(transcript: string | undefined): TranscriptLine[] {
  if (!transcript) return []
  return transcript
    .split("\n")
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = /^(user|assistant):\s*(.*)$/.exec(line)
      return m
        ? { role: m[1] as "user" | "assistant", text: m[2] ?? "" }
        : { role: null, text: line }
    })
}
