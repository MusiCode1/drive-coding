/**
 * STT — Gemini (Speech-to-Text)
 *
 * שולח אודיו ל-Gemini במודל מולטימודלי ומבקש תמלול.
 * המפתח מוזרק על-ידי OneCLI כ-`x-goog-api-key` header — כאן placeholder.
 */

import { GoogleGenAI, createPartFromBase64, createUserContent } from "@google/genai";

// alias מתעדכן אוטומטית — לא לנעול גרסה.
// Flash Lite מספיק לתמלול: מהיר, זול, תומך מולטימודל.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

const TRANSCRIBE_PROMPT =
  "Transcribe this audio exactly as spoken, preserving the original language. " +
  "Return only the transcription — no introductions, no explanations, no quotes, " +
  "no formatting. If the audio is silent or unintelligible, return an empty string.";

// instance יחיד — OneCLI מטפל ב-auth בדרך
const ai = new GoogleGenAI({ apiKey: "placeholder" });

export interface SttOptions {
  /** ברירת מחדל: `gemini-flash-lite-latest`. */
  model?: string;
  /** MIME של האודיו. ברירת מחדל: `audio/webm` (תואם MediaRecorder ברירת מחדל בכרום). */
  mimeType?: string;
  /** prompt מותאם אישית (אם רוצים שפה ספציפית, סגנון וכו'). */
  prompt?: string;
}

/**
 * ממיר אודיו (base64) לטקסט באמצעות Gemini.
 *
 * @param audioBase64 - האודיו המקודד ב-base64 (ללא data URL prefix)
 * @param opts        - אפשרויות אופציונליות
 * @returns           - הטקסט המתומלל (string), עשוי להיות ריק
 */
export async function transcribeAudio(
  audioBase64: string,
  opts: SttOptions = {},
): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const mimeType = opts.mimeType ?? "audio/webm";
  const prompt = opts.prompt ?? TRANSCRIBE_PROMPT;

  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromBase64(audioBase64, mimeType),
      prompt,
    ]),
  });

  const text = response.text ?? "";
  return text.trim();
}

// CLI entrypoint לבדיקה עצמאית:
//   bun src/stt.ts /path/to/audio.mp3 [audio/mpeg]
if (import.meta.main) {
  const filePath = process.argv[2];
  const mimeType = process.argv[3] ?? guessMime(filePath ?? "");

  if (!filePath) {
    console.error("שימוש: bun src/stt.ts <קובץ אודיו> [mimeType]");
    process.exit(1);
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    console.error(`קובץ לא נמצא: ${filePath}`);
    process.exit(1);
  }

  const buf = await file.arrayBuffer();
  const base64 = Buffer.from(buf).toString("base64");

  console.log(`קלט: ${filePath} (${buf.byteLength} bytes, ${mimeType})`);
  console.log(`מודל: gemini-flash-lite-latest`);

  try {
    const start = Date.now();
    const text = await transcribeAudio(base64, { mimeType });
    const elapsed = Date.now() - start;
    console.log(`\nתמלול (${elapsed}ms):`);
    console.log(text);
  } catch (e) {
    console.error("שגיאה:", e);
    process.exit(1);
  }
}

function guessMime(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "webm":
      return "audio/webm";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    default:
      return "audio/webm";
  }
}
