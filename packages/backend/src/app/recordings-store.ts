/**
 * RecordingsStore — מאגר מבוסס-דיסק עבור הקלטות אודיו של המשתמש.
 *
 * Slice 8a: שומר בתי אודיו גולמיים אל `<baseDir>/<uuid>.<ext>`.
 * קובץ נלווה `<baseDir>/index.json` עוקב אחר מטא-דאטה (mimeType, savedAt, bytes).
 * בשימוש של agent-session.sendAudioPrompt לשמירת הקלטות לפני תמלול (STT).
 * אין ניקוי אוטומטי ב-MVP.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

type RecordingMeta = {
  readonly filename: string
  readonly mimeType: string
  readonly savedAt: string // ISO
  readonly bytes: number
}

type IndexFile = {
  readonly recordings: Record<string, RecordingMeta>
}

// ממפה סוגי MIME נפוצים של אודיו לסיומות קבצים.
const MIME_TO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
}

function extFromMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? "bin"
}

export function createRecordingsStore(baseDir: string) {
  const indexPath = join(baseDir, "index.json")

  async function ensureDir(): Promise<void> {
    await mkdir(baseDir, { recursive: true })
  }

  async function loadIndex(): Promise<Record<string, RecordingMeta>> {
    try {
      const text = await readFile(indexPath, "utf8")
      const data = JSON.parse(text) as IndexFile
      return typeof data.recordings === "object" && data.recordings !== null ? data.recordings : {}
    } catch {
      return {}
    }
  }

  async function saveIndex(recordings: Record<string, RecordingMeta>): Promise<void> {
    await ensureDir()
    const data: IndexFile = { recordings }
    await writeFile(indexPath, JSON.stringify(data, null, 2), "utf8")
  }

  return {
    /**
     * שומר בתי אודיו גולמיים לדיסק, מחזיר מזהה יציב.
     * `durationMs` לא מחושב על ידי המאגר (ידרוש פענוח אודיו);
     * קוראים עשויים להעביר אותו בנפרד בעתיד.
     */
    async save(bytes: Uint8Array, mimeType: string): Promise<{ id: string; durationMs?: number }> {
      await ensureDir()
      const id = crypto.randomUUID()
      const ext = extFromMimeType(mimeType)
      const filename = `${id}.${ext}`
      await writeFile(join(baseDir, filename), bytes)

      const index = await loadIndex()
      const updated: Record<string, RecordingMeta> = {
        ...index,
        [id]: { filename, mimeType, savedAt: new Date().toISOString(), bytes: bytes.length },
      }
      await saveIndex(updated)

      return { id }
    },

    /** מחזיר את הבתים הגולמיים ואת ה-mimeType, או null אם לא נמצא. */
    async get(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
      const index = await loadIndex()
      const meta = index[id]
      if (!meta) return null

      try {
        const buf = await readFile(join(baseDir, meta.filename))
        return { bytes: new Uint8Array(buf), mimeType: meta.mimeType }
      } catch {
        return null
      }
    },

    /** מוחק את קובץ ההקלטה ומסיר אותו מהאינדקס. לא עושה כלום אם לא נמצא. */
    async delete(id: string): Promise<void> {
      const index = await loadIndex()
      const meta = index[id]
      if (!meta) return

      try {
        await unlink(join(baseDir, meta.filename))
      } catch {
        // ייתכן שהקובץ כבר איננו — בטוח להתעלם
      }

      const { [id]: _removed, ...rest } = index
      await saveIndex(rest)
    },

    /** מחזיר סטטיסטיקות מצטברות: ספירה כוללת וסך כל הבתים בדיסק. */
    async stats(): Promise<{ count: number; bytes: number }> {
      const index = await loadIndex()
      const entries = Object.values(index)
      return {
        count: entries.length,
        bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      }
    },
  }
}

export type RecordingsStore = ReturnType<typeof createRecordingsStore>
