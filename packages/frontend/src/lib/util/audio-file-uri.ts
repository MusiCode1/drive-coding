/**
 * Audio file URI detection — mirrors audio allowlist in http-fs-file.ts.
 */

const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|aac|flac|webm)$/i

/** True when uri points at a local audio file the /api/fs/file proxy serves. */
export function isAudioFileUri(uri: string): boolean {
  const path = uri.replace(/^file:\/\//i, "")
  return AUDIO_EXT.test(path)
}
