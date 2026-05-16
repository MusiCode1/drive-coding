const SENTENCE_END_RE = /([.!?:,])\s+/g

export function splitIntoSentences(buffer: string): {
  sentences: string[]
  remaining: string
} {
  const sentences: string[] = []
  let lastIdx = 0

  // reset regex state (global regex retains lastIndex between calls)
  SENTENCE_END_RE.lastIndex = 0

  for (;;) {
    const match = SENTENCE_END_RE.exec(buffer)
    if (match === null) break
    const endIdx = match.index + match[0].length
    const sentence = buffer.slice(lastIdx, endIdx).trim()
    if (sentence.length > 0) sentences.push(sentence)
    lastIdx = endIdx
  }

  return { sentences, remaining: buffer.slice(lastIdx) }
}
