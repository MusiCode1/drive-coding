/**
 * Recordings — שמירת הקלטות משתמש לדיסק עם metadata sidecar.
 *
 * הקלטות נשמרות תחת `$XDG_CACHE_HOME/voice-acp/recordings/`
 * (או `$HOME/.cache/voice-acp/recordings/` כברירת מחדל).
 *
 * כל הקלטה מקבלת שני קבצים תואמים:
 *   <ISO-timestamp>_<short-id>.<ext>   — האודיו הגולמי (webm/ogg/mp3/audio)
 *   <ISO-timestamp>_<short-id>.json    — metadata sidecar עם transcript, cwd וכו'
 *
 * הפעלה/השבתה דרך משתנה סביבה `VOICE_ACP_SAVE_RECORDINGS`. ברירת מחדל
 * מופעל. ערך `0` או `false` (case-insensitive) משבית.
 */

import { mkdir } from "node:fs/promises";

const SAVE_RECORDINGS_ENABLED = (() => {
  const v = (process.env.VOICE_ACP_SAVE_RECORDINGS ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
})();

const RECORDINGS_DIR =
  (process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`) +
  "/voice-acp/recordings";

let dirEnsured = false;
async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  await mkdir(RECORDINGS_DIR, { recursive: true });
  dirEnsured = true;
}

/**
 * Pure helper — file extension for a given MIME type.
 *
 * Exported for tests.
 */
export function extFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("m4a") || m.includes("mp4")) return "m4a";
  if (m.includes("flac")) return "flac";
  return "audio";
}

/**
 * Pure helper — builds the audio + metadata file paths for a recording.
 *
 * Filename format: `<ISO-timestamp-safe>_<sid-short>.<ext>` where:
 *   - ISO timestamp's `:` and `.` are replaced with `-` (filesystem-safe).
 *   - sid-short is the first 8 chars of `sessionId`, or `"no-sess"` if null.
 *
 * Exported for tests.
 */
export function buildRecordingPaths(
  baseDir: string,
  iso: string,
  sessionId: string | null,
  mimeType: string,
): { audioPath: string; metaPath: string } {
  const stampForName = iso.replace(/[:.]/g, "-");
  const sid = (sessionId ?? "no-sess").slice(0, 8);
  const ext = extFromMime(mimeType);
  const base = `${stampForName}_${sid}`;
  return {
    audioPath: `${baseDir}/${base}.${ext}`,
    metaPath: `${baseDir}/${base}.json`,
  };
}

export interface RecordingInfo {
  audioPath: string;
  metaPath: string;
  timestamp: string; // ISO
}

/**
 * שומר את האודיו הגולמי. אם השמירה מושבתת או נכשלת — מחזיר null
 * ולא זורק (אסור שתפילה זו תעצור את ה-flow של הטיפול בהודעה).
 */
export async function saveRecording(
  audioBase64: string,
  mimeType: string,
  sessionId: string | null,
): Promise<RecordingInfo | null> {
  if (!SAVE_RECORDINGS_ENABLED) return null;
  try {
    await ensureDir();
    const iso = new Date().toISOString();
    const { audioPath, metaPath } = buildRecordingPaths(
      RECORDINGS_DIR,
      iso,
      sessionId,
      mimeType,
    );
    await Bun.write(audioPath, Buffer.from(audioBase64, "base64"));
    return { audioPath, metaPath, timestamp: iso };
  } catch (e) {
    console.error(
      `[recordings] שמירת אודיו נכשלה: ${(e as Error).message}`,
    );
    return null;
  }
}

/**
 * שומר metadata sidecar (`.json`) ליד קובץ האודיו.
 * נקרא **אחרי** ש-`transcribeAudio` חזר, כדי שיהיה לנו transcript לשמור.
 */
export async function saveRecordingMetadata(
  info: RecordingInfo,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await Bun.write(info.metaPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.error(
      `[recordings] שמירת metadata נכשלה: ${(e as Error).message}`,
    );
  }
}

/** האם שמירת הקלטות מופעלת. שימושי ללוג בתחילת ריצה. */
export const recordingsEnabled = SAVE_RECORDINGS_ENABLED;
export const recordingsDir = RECORDINGS_DIR;
