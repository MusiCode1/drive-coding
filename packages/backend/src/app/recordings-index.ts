import { readFile, rename, rm, writeFile } from "node:fs/promises"

type RecordingMeta = {
  readonly filename: string
  readonly mimeType: string
  readonly savedAt: string
  readonly bytes: number
}

export type RecordingsIndex = Record<string, RecordingMeta>

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

const RECORDING_EXTENSIONS = new Set([...Object.values(MIME_TO_EXT), "bin"])

export function recordingFilename(id: string, mimeType: string): string {
  const ext = Object.hasOwn(MIME_TO_EXT, mimeType) ? MIME_TO_EXT[mimeType] : undefined
  return `${id}.${ext ?? "bin"}`
}

export function recordingFilenameForDeletion(
  index: RecordingsIndex,
  id: string,
): string | undefined {
  if (!Object.hasOwn(index, id)) return undefined

  const filename = index[id]?.filename
  if (
    typeof filename !== "string" ||
    !filename.startsWith(`${id}.`) ||
    !RECORDING_EXTENSIONS.has(filename.slice(id.length + 1))
  ) {
    throw new Error("Invalid filename in recordings index")
  }
  return filename
}

export async function readRecordingsIndex(indexPath: string): Promise<RecordingsIndex> {
  let text: string
  try {
    text = await readFile(indexPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
  const data = JSON.parse(text) as { recordings?: RecordingsIndex } | null
  const recordings = data?.recordings
  if (!recordings || typeof recordings !== "object" || Array.isArray(recordings)) {
    throw new Error("Invalid recordings index: expected a recordings object")
  }
  return recordings
}

export async function writeRecordingsIndex(
  indexPath: string,
  recordings: RecordingsIndex,
): Promise<void> {
  const tempPath = `${indexPath}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify({ recordings }, null, 2), "utf8")
    await rename(tempPath, indexPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}
