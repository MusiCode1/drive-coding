/**
 * audio-embed.ts — pure audio embed resolution for TTS (no IO).
 *
 * Duplicates path/extension rules from the frontend — core cannot import FE helpers.
 */

import { lookupMedia, type DriveMediaRef } from "../fs/media-catalog.js"
import { IMAGE_LINK } from "../markdown/image-link.js"

const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|aac|flac|webm)$/i

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

export type AudioEmbedOpts = {
  cwd?: string | null
  catalog?: DriveMediaRef[]
}

/** Local audio href → file URI, or null when not embeddable. */
export function resolveAudioEmbed(
  href: string,
  cwdOrOpts: string | null | AudioEmbedOpts = null,
  catalog?: DriveMediaRef[],
): AudioEmbedRef | null {
  const cwd: string | null =
    typeof cwdOrOpts === "object" && cwdOrOpts !== null && !Array.isArray(cwdOrOpts)
      ? (cwdOrOpts.cwd ?? null)
      : typeof cwdOrOpts === "string"
        ? cwdOrOpts
        : null
  const list =
    typeof cwdOrOpts === "object" && cwdOrOpts !== null && !Array.isArray(cwdOrOpts)
      ? cwdOrOpts.catalog
      : catalog
  const uri = resolvePathToFileUri(href, cwd ?? null)
  if (uri === null) return null
  const hit = list !== undefined ? lookupMedia(list, uri) : undefined
  if (hit !== undefined && hit.mime.startsWith("audio/")) {
    return {
      title: hit.title ?? "",
      href: href.trim(),
      uri,
    }
  }
  const path = uri.replace(/^file:\/\//i, "")
  if (!AUDIO_EXT.test(path)) return null
  return { title: "", href: href.trim(), uri }
}
