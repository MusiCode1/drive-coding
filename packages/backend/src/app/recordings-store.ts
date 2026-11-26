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
import { type } from "arktype"
import {
  type RecordingsIndex,
  readRecordingsIndex,
  recordingFilename,
  recordingFilenameForDeletion,
  writeRecordingsIndex,
} from "./recordings-index.js"

export const RecordingId = type("string.uuid")

export function createRecordingsStore(baseDir: string) {
  const indexPath = join(baseDir, "index.json")

  let pendingWrite = Promise.resolve()

  function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = pendingWrite.then(operation)
    pendingWrite = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function readIndexBestEffort(): Promise<RecordingsIndex> {
    return readRecordingsIndex(indexPath).catch(() => ({}))
  }

  return {
    /**
     * שומר בתי אודיו גולמיים לדיסק, מחזיר מזהה יציב.
     * `durationMs` לא מחושב על ידי המאגר (ידרוש פענוח אודיו);
     * קוראים עשויים להעביר אותו בנפרד בעתיד.
     */
    save(bytes: Uint8Array, mimeType: string): Promise<{ id: string; durationMs?: number }> {
      return enqueueWrite(async () => {
        const index = await readRecordingsIndex(indexPath)
        await mkdir(baseDir, { recursive: true })
        const id = crypto.randomUUID()
        const filename = recordingFilename(id, mimeType)
        await writeFile(join(baseDir, filename), bytes)
        index[id] = { filename, mimeType, savedAt: new Date().toISOString(), bytes: bytes.length }
        await writeRecordingsIndex(indexPath, index)
        return { id }
      })
    },

    /** מחזיר את הבתים הגולמיים ואת ה-mimeType, או null אם לא נמצא. */
    async get(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
      const index = await readIndexBestEffort()
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
      if (!RecordingId.allows(id)) throw new Error("Invalid recording id")
      return enqueueWrite(async () => {
        const index = await readRecordingsIndex(indexPath)
        const filename = recordingFilenameForDeletion(index, id)
        if (filename === undefined) return

        try {
          await unlink(join(baseDir, filename))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }

        delete index[id]
        await writeRecordingsIndex(indexPath, index)
      })
    },

    /** מחזיר סטטיסטיקות מצטברות: ספירה כוללת וסך כל הבתים בדיסק. */
    async stats(): Promise<{ count: number; bytes: number }> {
      const index = await readIndexBestEffort()
      const entries = Object.values(index)
      return {
        count: entries.length,
        bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      }
    },
  }
}

export type RecordingsStore = ReturnType<typeof createRecordingsStore>
