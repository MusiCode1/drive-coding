/**
 * פיצול חוצץ טקסט (אולי חלקי) ל"משפטים" שלמים, יחד עם שארית גוררת
 * (`remaining`). מיועד עבור תהליכי עיבוד רציפים (streaming TTS pipelines):
 *
 *   const { sentences, remaining } = splitIntoSentences(buffer, opts)
 *   for (const s of sentences) enqueueForTts(s)
 *   // שמור את ה-`remaining` והוסף אותו למקטע הנכנס הבא:
 *   buffer = remaining + nextChunk
 *
 * משתמש ב-`Intl.Segmenter` (גבולות משפט ICU) ולא בביטויים רגולריים (regex) ארעיים.
 * זה אומר שקיצורים כמו ".Dr", כתובות URL המכילות "3.14", וסימנים כמו ":" / ","
 * אינם נחשבים כגבולות של משפטים.
 *
 * מקטעים גולמיים קצרים (< minChars) ממוזגים אל תוך המקטע הבא בתוך
 * אותה הפסקה. ארוכים מדי (> maxChars) מפוצלים בכוח בגבולות המילים.
 */

export type SplitOptions = {
  /** ברירת מחדל 20. מקטעים גולמיים קצרים מזה ממוזגים אל תוך המקטע הבא. */
  minChars?: number
  /** ברירת מחדל 200. מקטעים גולמיים ארוכים מזה מפוצלים בגבולות מילים. */
  maxChars?: number
  /** ברירת מחדל "he". האזור (Locale) המועבר ל-`Intl.Segmenter`. */
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

  // TTS-only: תווי-כיווניות נחוצים לתצוגה (הבועות מרונדרות מ-bubble.segments המקוריים),
  // אך משבשים את TERMINATOR_RE ומנפחים את ספירת-maxChars. הסרתם כאן בטוחה — הטקסט זורם רק ל-TTS.
  // טווח: LRM/RLM (200E/200F) + embeddings (202A-202E) + isolates (2066-2069). לא ניקוד.
  buffer = buffer.replace(/[‎‏‪-‮⁦-⁩]/g, "")

  if (buffer.length === 0) return { sentences: [], remaining: "" }

  const sentenceSegmenter = new Intl.Segmenter(locale, { granularity: "sentence" })
  const paragraphs = buffer.split(/\n{2,}/)
  const isMulti = paragraphs.length > 1

  // מקטעים שלמים שנאספו עבור כל פסקה. הפסקה האחרונה יכולה גם לפלוט `remaining`.
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

      if (isLastPara && isLastSeg) {
        // הפסקה האחרונה עדיין בזרימה (אין \n\n אחריה) — מטפלים בה כמו פסקה-בודדת:
        // מחייבים את המקטע האחרון רק אם יש לו סמן סיום.
        // אחרת מוחזק כ-`remaining`, מה שמונע חיתוך-אמצע-מילה.
        // פסקאות שאינן-אחרונות (בוגרות ע"י \n\n) מחויבות במלואן;
        // הפסקה האחרונה עוד בזרימה → זנבה הלא-מסתיים מוחזק כ-remaining
        // (מונע חיתוך-אמצע-מילה).
        if (TERMINATOR_RE.test(seg)) {
          completed.push(seg)
        } else {
          remaining = seg
        }
      } else {
        // מקטעים שאינם-אחרונים של הפסקה האחרונה, או כל מקטע בפסקאות בוגרות
        // (שיש \n\n אחריהן) — מחויבים במלואם.
        completed.push(seg)
      }
    }
    perParagraph.push(completed)
  }

  const final: string[] = []
  for (const paraSegs of perParagraph) {
    const trimmed = paraSegs.map((s) => s.trim()).filter((s) => s.length > 0)

    // מיזוג מקטעים גולמיים קצרים לתוך המקטע הבא אחריהם, **אך ורק באותה פסקה**.
    // שבירות פסקה גוברות על כלל המיזוג.
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

  // הסרת הרווחים המובילים מהשארית (remaining) כדי שהדטרמיניזם של ההזרמה יישמר:
  // כל רווח מוביל הוא שארית של הגבול שכבר נבלעה על ידי המשפט
  // שנפלט קודם לכן.
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
      // התחל את המקטע החדש ללא הרווחים המובילים
      cur = w.replace(/^\s+/, "")
    } else {
      cur += w
    }
  }
  if (cur.trim().length > 0) chunks.push(cur.trim())
  return chunks
}
