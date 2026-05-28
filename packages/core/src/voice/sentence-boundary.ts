/**
 * Split a (possibly partial) buffer of text into "complete" sentences plus a
 * trailing `remaining` part. Designed for streaming TTS pipelines:
 *
 *   const { sentences, remaining } = splitIntoSentences(buffer, opts)
 *   for (const s of sentences) enqueueForTts(s)
 *   // keep `remaining` and prepend to the next incoming chunk:
 *   buffer = remaining + nextChunk
 *
 * Uses `Intl.Segmenter` (ICU sentence boundaries) rather than ad-hoc regex.
 * That means abbreviations like "Dr.", URLs containing "3.14", and ":" / ","
 * are NOT treated as sentence boundaries.
 *
 * Short raw segments (< minChars) are merged into the next segment within the
 * same paragraph. Long ones (> maxChars) are force-split on word boundaries.
 */

export type SplitOptions = {
  /** Default 20. Raw segments shorter than this are merged into the next one. */
  minChars?: number
  /** Default 200. Raw segments longer than this are split on word boundaries. */
  maxChars?: number
  /** Default "he". Locale passed to `Intl.Segmenter`. */
  locale?: string
}

export type SplitResult = {
  sentences: string[]
  remaining: string
}

const TERMINATOR_RE = /[.!?]\s*$|\n\s*$/

export function splitIntoSentences(buffer: string, opts: SplitOptions = {}): SplitResult {
  const minChars = opts.minChars ?? 20
  const maxChars = opts.maxChars ?? 200
  const locale = opts.locale ?? "he"

  if (buffer.length === 0) return { sentences: [], remaining: "" }

  const sentenceSegmenter = new Intl.Segmenter(locale, { granularity: "sentence" })
  const paragraphs = buffer.split(/\n{2,}/)
  const isMulti = paragraphs.length > 1

  // Per-paragraph collected complete segments. Last paragraph may also emit `remaining`.
  const perParagraph: string[][] = []
  let remaining = ""

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paragraph = paragraphs[pi] ?? ""
    if (paragraph.length === 0) {
      perParagraph.push([])
      continue
    }
    const isLastPara = pi === paragraphs.length - 1

    const segs: string[] = []
    for (const piece of sentenceSegmenter.segment(paragraph)) segs.push(piece.segment)

    const completed: string[] = []
    for (let sj = 0; sj < segs.length; sj++) {
      const isLastSeg = sj === segs.length - 1
      const seg = segs[sj] ?? ""

      if (isLastPara && isLastSeg && !isMulti) {
        // Single-paragraph buffer: only commit the final segment if it has a
        // terminator. Otherwise stash it as `remaining`.
        if (TERMINATOR_RE.test(seg)) {
          completed.push(seg)
        } else {
          remaining = seg
        }
      } else {
        // Multi-paragraph buffer commits everything (a paragraph break is a
        // strong "user committed" signal), and non-final segments of the last
        // paragraph are likewise committed.
        completed.push(seg)
      }
    }
    perParagraph.push(completed)
  }

  const final: string[] = []
  for (const paraSegs of perParagraph) {
    const trimmed = paraSegs.map((s) => s.trim()).filter((s) => s.length > 0)

    // Merge short raw segments into the following one, **within the same
    // paragraph only**. Paragraph breaks are stronger than the merge rule.
    const merged: string[] = []
    let buf: string | null = null
    for (let i = 0; i < trimmed.length; i++) {
      const s = trimmed[i] ?? ""
      const combined: string = buf === null ? s : `${buf} ${s}`
      if (combined.length < minChars && i + 1 < trimmed.length) {
        buf = combined
      } else {
        merged.push(combined)
        buf = null
      }
    }

    for (const s of merged) {
      if (s.length <= maxChars) {
        final.push(s)
      } else {
        for (const chunk of forceSplitWords(s, maxChars, locale)) final.push(chunk)
      }
    }
  }

  // Strip leading whitespace from `remaining` so streaming determinism holds:
  // any leading space is residue of the boundary that was already consumed by
  // the previously-emitted sentence.
  remaining = remaining.replace(/^\s+/, "")

  return { sentences: final, remaining }
}

function forceSplitWords(text: string, maxChars: number, locale: string): string[] {
  const wordSegmenter = new Intl.Segmenter(locale, { granularity: "word" })
  const chunks: string[] = []
  let cur = ""
  for (const piece of wordSegmenter.segment(text)) {
    const w = piece.segment
    if ((cur + w).length > maxChars && cur.trim().length > 0) {
      chunks.push(cur.trim())
      // start the new chunk without leading whitespace
      cur = w.replace(/^\s+/, "")
    } else {
      cur += w
    }
  }
  if (cur.trim().length > 0) chunks.push(cur.trim())
  return chunks
}
