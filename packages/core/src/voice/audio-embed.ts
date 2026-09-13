/**
 * audio-embed.ts — pure audio embed resolution for TTS (no IO).
 *
 * Duplicates path/extension rules from the frontend — core cannot import FE helpers.
 */

const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|aac|flac|webm)$/i

const IMAGE_LINK = /!\[([^\]]*)\]\(([^)]*)\)/g

export type AudioEmbedRef = {
  title: string
  href: string
  uri: string
}

export type SpeakablePart =
  | { kind: "text"; text: string }
  | { kind: "file"; title: string; href: string; uri: string }

function resolvePathToFileUri(href: string, cwd: string | null): string | null {
  const trimmed = href.trim()
  if (trimmed === "") return null
  if (/^https?:\/\//i.test(trimmed)) return null
  if (trimmed.startsWith("~")) return null
  if (/^file:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith("/")) return `file://${trimmed}`
  if (cwd === null || cwd === "") return null
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd
  const rel = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed
  return `file://${base}/${rel}`
}

/** Local audio href → file URI, or null when not embeddable. */
export function resolveAudioEmbed(href: string, cwd: string | null): AudioEmbedRef | null {
  const uri = resolvePathToFileUri(href, cwd)
  if (uri === null) return null
  const path = uri.replace(/^file:\/\//i, "")
  if (!AUDIO_EXT.test(path)) return null
  return { title: "", href: href.trim(), uri }
}

export { IMAGE_LINK }
