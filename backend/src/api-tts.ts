/**
 * `POST /api/tts` handler — body validation + delegate to TTS.
 *
 * Body: `{ text: string, voiceId?: string }` → `{ data: <base64 MP3> }`.
 * Used by the frontend for lazy playback of historical message bubbles.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-7..HTTP-9).
 */

export type TtsResult =
  | { ok: true; body: { data: string } }
  | { ok: false; status: number; body: { error: string } };

export interface TtsDeps {
  /** Convert text → base64 MP3 (cached). */
  textToSpeech(text: string, voiceId?: string): Promise<string>;
}

/**
 * Parses + validates the body, then delegates to deps.textToSpeech.
 *
 * Returns a structured result (no Response objects) for testability.
 */
export async function handleApiTts(
  bodyJson: () => Promise<unknown>,
  deps: TtsDeps,
): Promise<TtsResult> {
  let body: { text?: string; voiceId?: string };
  try {
    body = (await bodyJson()) as { text?: string; voiceId?: string };
  } catch {
    return { ok: false, status: 400, body: { error: "JSON לא תקין" } };
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return { ok: false, status: 400, body: { error: "חסר text" } };
  }
  try {
    const data = await deps.textToSpeech(text, body.voiceId);
    return { ok: true, body: { data } };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      body: { error: String((e as Error).message ?? e) },
    };
  }
}
