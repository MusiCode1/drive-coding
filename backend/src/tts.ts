/**
 * TTS — ElevenLabs (Text-to-Speech)
 *
 * שולח טקסט ל-ElevenLabs ומקבל MP3 בינארי.
 * המפתח מוזרק על-ידי OneCLI כ-`xi-api-key` header — כאן שולחים placeholder.
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

export interface TtsOptions {
  /** Voice ID של ElevenLabs. אם לא מסופק, נלקח מ-ENV `ELEVENLABS_VOICE_ID`. */
  voiceId?: string;
  /**
   * מודל ה-TTS. ברירת מחדל: `eleven_v3` — היחיד שתומך עברית כראוי.
   * v2 (multilingual) מצהיר על "תמיכה" אבל מבטא עברית מעוותת ב-API.
   */
  modelId?: string;
  /** Stability (0-1). ברירת מחדל: 0.5. */
  stability?: number;
  /** Similarity boost (0-1). ברירת מחדל: 0.75. */
  similarityBoost?: number;
}

/**
 * ממיר טקסט ל-MP3 בינארי.
 * @returns ArrayBuffer של MP3
 */
export async function textToSpeech(
  text: string,
  opts: TtsOptions = {},
): Promise<ArrayBuffer> {
  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error(
      "ELEVENLABS_VOICE_ID חסר. הגדר משתנה סביבה או העבר voiceId.",
    );
  }

  // eleven_v3 הוא היחיד שתומך עברית בצורה תקינה (לפי /v1/models)
  const modelId = opts.modelId ?? "eleven_v3";
  const stability = opts.stability ?? 0.5;
  const similarityBoost = opts.similarityBoost ?? 0.75;

  const url = `${ELEVENLABS_API_BASE}/v1/text-to-speech/${voiceId}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": "placeholder", // OneCLI מחליף בדרך
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability, similarity_boost: similarityBoost },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "<no body>");
    throw new Error(
      `ElevenLabs TTS שגיאה ${response.status}: ${errorText}`,
    );
  }

  return await response.arrayBuffer();
}

/** ממיר טקסט ל-MP3 ומחזיר base64 (לשליחה דרך JSON ב-WebSocket). */
export async function textToSpeechBase64(
  text: string,
  opts: TtsOptions = {},
): Promise<string> {
  const buf = await textToSpeech(text, opts);
  return Buffer.from(buf).toString("base64");
}

// ── Cache (in-memory) ────────────────────────────────────────────────────────

import { TtsCache } from "./tts-cache.ts";

/** Singleton cache used by both `cachedTextToSpeechBase64` and `streamCachedTextToSpeech`. */
const ttsCache = new TtsCache();

function cacheKey(text: string, opts: TtsOptions): string {
  return ttsCache.keyOf(text, opts, process.env.ELEVENLABS_VOICE_ID ?? "");
}

/**
 * גרסה ממוטשת של {@link textToSpeechBase64}.
 * כל הקריאות בפרויקט אמורות לעבור דרך כאן.
 */
export async function cachedTextToSpeechBase64(
  text: string,
  opts: TtsOptions = {},
): Promise<string> {
  const key = cacheKey(text, opts);
  const hit = ttsCache.get(key);
  if (hit !== undefined) return hit;
  const fresh = await textToSpeechBase64(text, opts);
  ttsCache.set(key, fresh);
  return fresh;
}

export function ttsCacheStats(): { entries: number; bytes: number } {
  return ttsCache.stats();
}

// ── Streaming TTS ─────────────────────────────────────────────────────────────
/**
 * Streaming: שולח טקסט ל-ElevenLabs ומקבל chunks של MP3 ככל שנוצרים.
 * עוזר להתחיל ניגון אצל הלקוח לפני שכל האודיו מוכן.
 *
 * @param onChunk - נקרא לכל chunk שמגיע (Uint8Array של bytes MP3)
 * @returns       - האודיו המלא (לצורך cache)
 */
export async function streamTextToSpeech(
  text: string,
  opts: TtsOptions,
  onChunk: (chunk: Uint8Array) => void,
): Promise<Uint8Array> {
  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID חסר");

  const modelId = opts.modelId ?? "eleven_v3";
  const stability = opts.stability ?? 0.5;
  const similarityBoost = opts.similarityBoost ?? 0.75;

  const url = `${ELEVENLABS_API_BASE}/v1/text-to-speech/${voiceId}/stream`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": "placeholder",
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability, similarity_boost: similarityBoost },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "<no body>");
    throw new Error(
      `ElevenLabs streaming TTS שגיאה ${response.status}: ${errorText}`,
    );
  }
  if (!response.body) throw new Error("תגובה ללא body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        onChunk(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // assemble לגיבוי / cache
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const full = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    full.set(c, off);
    off += c.length;
  }
  return full;
}

/**
 * Streaming + cache: אם יש hit נשלח את האודיו כ-chunk יחיד; אם miss — streaming
 * מ-ElevenLabs ושמירה ב-cache בסוף.
 */
export async function streamCachedTextToSpeech(
  text: string,
  opts: TtsOptions,
  onChunk: (chunk: Uint8Array) => void,
): Promise<Uint8Array> {
  const key = cacheKey(text, opts);
  const hit = ttsCache.get(key);
  if (hit !== undefined) {
    const bytes = new Uint8Array(Buffer.from(hit, "base64"));
    onChunk(bytes);
    return bytes;
  }
  const full = await streamTextToSpeech(text, opts, onChunk);
  ttsCache.set(key, Buffer.from(full).toString("base64"));
  return full;
}

// CLI entrypoint לבדיקה עצמאית:
//   bun src/tts.ts "טקסט לבדיקה" /tmp/out.mp3
if (import.meta.main) {
  const text = process.argv[2];
  const outPath = process.argv[3] ?? "/tmp/tts-out.mp3";

  if (!text) {
    console.error("שימוש: bun src/tts.ts \"<טקסט>\" [קובץ פלט]");
    process.exit(1);
  }

  console.log(`טקסט: ${text}`);
  console.log(`קול: ${process.env.ELEVENLABS_VOICE_ID ?? "(לא מוגדר)"}`);
  console.log(`פלט: ${outPath}`);

  try {
    const start = Date.now();
    const buf = await textToSpeech(text);
    const elapsed = Date.now() - start;
    await Bun.write(outPath, buf);
    console.log(
      `הקובץ נשמר (${buf.byteLength} bytes, ${elapsed}ms). אפשר לנגן עם:`,
    );
    console.log(`  ffplay -nodisp -autoexit ${outPath}`);
  } catch (e) {
    console.error("שגיאה:", e);
    process.exit(1);
  }
}
