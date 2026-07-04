/**
 * extract-prompt-caps.ts — חילוץ promptCapabilities מ-frame תגובת initialize.
 *
 * זיהוי מבני (לא לפי method): frame של initialize response הוא JSON-RPC result
 * עם `result.agentCapabilities.promptCapabilities`. notifications מכילים `method`;
 * error frames מכילים `error`. כל אחד מהם → undefined (מתעלם).
 *
 * ⚠️ אין נגיעה בקוד המתאם @agentclientprotocol/* — זהו tap פסיבי בלבד.
 * ר' §10 ב-brief: כיוון-עתיד הוא hooks רשמיים במתאם; עד אז — tap על `parsed`.
 */

/** תוצאת חילוץ מ-promptCapabilities של frame ה-initialize response. */
export interface PromptCaps {
  /** האם הספק תומך בקלט תמונה. false = לא תומך או לא הוגדר. */
  image: boolean
}

/**
 * extractPromptCaps — מחלץ { image } מ-parsed frame של initialize response.
 *
 * מחזיר PromptCaps אם זה frame initialize response מלא
 * (responseKind==="result" + agentCapabilities.promptCapabilities קיים).
 * מחזיר undefined לכל שאר ה-frames (notifications/errors/partial results).
 *
 * @param parsed - האובייקט המפוענח מ-decodeWireLine (parsed field) — unknown.
 * @returns PromptCaps | undefined
 */
export function extractPromptCaps(parsed: unknown): PromptCaps | undefined {
  if (parsed === null || parsed === undefined) return undefined
  if (typeof parsed !== "object") return undefined

  const o = parsed as Record<string, unknown>

  // notification frames have a method field — not a result
  if ("method" in o) return undefined

  // error frames have an error field — not a result
  if ("error" in o) return undefined

  // must be a result frame
  if (!("result" in o)) return undefined

  const result = o.result as Record<string, unknown> | undefined
  if (result === null || typeof result !== "object") return undefined

  // agentCapabilities must be present — this is the initialize response signature
  if (!("agentCapabilities" in result)) return undefined

  const agentCaps = result.agentCapabilities as Record<string, unknown> | undefined
  if (agentCaps === null || typeof agentCaps !== "object") return undefined

  const promptCaps = agentCaps.promptCapabilities as Record<string, unknown> | undefined

  // promptCapabilities missing → still an init response, but no image info → image: false (safe)
  if (promptCaps === null || typeof promptCaps !== "object") {
    return { image: false }
  }

  return {
    image: promptCaps.image === true,
  }
}
