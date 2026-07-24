/**
 * gemini-directing.ts — בנאי Director's-Notes ספציפי-ל-Gemini TTS.
 *
 * עוטף req.text בפורמט ה-"Director's note" הרשמי של Gemini speech-generation
 * (ai.google.dev/gemini-api/docs/speech-generation): preamble + `# Director's note`
 * (שדות Style/Pace) + תיוג מפורש `## Transcript:`. התיוג המפורש הוא ה-mitigation
 * הרשמי נגד preamble-leak (המודל מקריא את ההנחיה בקול) ונגד דחיית PROHIBITED_CONTENT.
 *
 * ברירת-מחדל (pace=normal/undefined && tone=neutral/undefined) → מחזיר את req.text
 * כמות שהוא (אפס עטיפה, זהה להתנהגות שלפני הסלייס).
 *
 * לא מזריק inline tags (למשל [excited]) לגוף req.text — זה ימלל את פלט הסוכן.
 * השליטה בקצב/טון היא אך ורק דרך שדות ה-Director's note.
 */
import type { SpeechDirecting, SpeechPace, SpeechTone } from "@drive-coding/core/voice/tts-types"

const PACE_LABELS: Record<Exclude<SpeechPace, "normal">, string> = {
  "very-slow": "Very Slow",
  slow: "Slow",
  fast: "Fast",
  "very-fast": "Rapid Fire",
}

const TONE_LABELS: Record<Exclude<SpeechTone, "neutral">, string> = {
  calm: "Calm",
  energetic: "Energetic",
  formal: "Professional",
  casual: "Conversational",
}

export function buildGeminiDirecting(req: { text: string; directing?: SpeechDirecting }): string {
  const pace = req.directing?.pace
  const tone = req.directing?.tone

  const parts: string[] = []
  if (tone !== undefined && tone !== "neutral") {
    parts.push(`Style: ${TONE_LABELS[tone]}`)
  }
  if (pace !== undefined && pace !== "normal") {
    parts.push(`Pace: ${PACE_LABELS[pace]}`)
  }

  if (parts.length === 0) return req.text

  const noteLine = `${parts.join(". ")}.`
  return (
    "Read the following transcript based on the director's note.\n\n" +
    `# Director's note\n${noteLine}\n\n` +
    `## Transcript:\n${req.text}`
  )
}
