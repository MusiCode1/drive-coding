/**
 * media-catalog.ts — `_drive/media` contract (pure + injected stat).
 *
 * slice media-meta-rpc Commit 0
 */

import { IMAGE_LINK } from "../voice/audio-embed.js"

export type DriveMediaRef = {
  uri: string
  mime: string
  title?: string
  bytes?: number
}

/** Same keys as http-fs-file allowlist — single source of truth for mime by extension. */
export const EXT_TO_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
}

function fileExt(pathOrUri: string): string {
  const path = pathOrUri.replace(/^file:\/\//i, "")
  const dot = path.lastIndexOf(".")
  if (dot <= 0 || dot === path.length - 1) return ""
  return path.slice(dot).toLowerCase()
}

export function mimeFromExt(pathOrUri: string): string | null {
  return EXT_TO_MIME[fileExt(pathOrUri)] ?? null
}

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

function mergeMeta(
  ...parts: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const merged = Object.assign({}, ...parts.filter(Boolean)) as Record<string, unknown>
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function extractMediaCandidates(
  text: string,
  cwd: string | null,
): { href: string; title?: string }[] {
  const out: { href: string; title?: string }[] = []
  IMAGE_LINK.lastIndex = 0
  let m: RegExpExecArray | null = IMAGE_LINK.exec(text)
  while (m !== null) {
    const title = m[1]?.trim()
    const href = m[2]?.trim() ?? ""
    if (href !== "" && !/^https?:\/\//i.test(href) && !href.startsWith("~")) {
      const uri = resolvePathToFileUri(href, cwd)
      if (uri !== null && mimeFromExt(uri) !== null) {
        out.push(title !== undefined && title !== "" ? { href, title } : { href })
      }
    }
    m = IMAGE_LINK.exec(text)
  }
  return out
}

export function mergeMedia(
  existing: DriveMediaRef[],
  incoming: DriveMediaRef[],
): DriveMediaRef[] {
  const byUri = new Map<string, DriveMediaRef>()
  for (const row of existing) byUri.set(row.uri, row)
  for (const row of incoming) {
    const prev = byUri.get(row.uri)
    byUri.set(row.uri, prev !== undefined ? { ...prev, ...row } : row)
  }
  return [...byUri.values()]
}

export function lookupMedia(list: DriveMediaRef[], uri: string): DriveMediaRef | undefined {
  return list.find((r) => r.uri === uri)
}

export function mediaFromResourceLink(block: {
  uri?: string
  mimeType?: string
  name?: string
  size?: number
}): DriveMediaRef | null {
  const uri = block.uri
  const mime = block.mimeType
  if (typeof uri !== "string" || uri === "") return null
  if (typeof mime !== "string" || mime === "") return null
  const ref: DriveMediaRef = { uri, mime }
  if (typeof block.name === "string" && block.name !== "") ref.title = block.name
  if (typeof block.size === "number" && Number.isFinite(block.size)) ref.bytes = block.size
  return ref
}

function refFromHref(
  href: string,
  title: string | undefined,
  cwd: string | null,
  stat: (uri: string) => { bytes: number } | null,
): DriveMediaRef | null {
  const uri = resolvePathToFileUri(href, cwd)
  if (uri === null) return null
  const mime = mimeFromExt(uri)
  if (mime === null) return null
  const st = stat(uri)
  if (st === null) return null
  const ref: DriveMediaRef = { uri, mime, bytes: st.bytes }
  if (title !== undefined && title !== "") ref.title = title
  return ref
}

function parseExistingMedia(meta: Record<string, unknown> | undefined): DriveMediaRef[] {
  if (meta === undefined) return []
  const raw = meta["_drive/media"]
  if (!Array.isArray(raw)) return []
  const out: DriveMediaRef[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row.uri !== "string" || typeof row.mime !== "string") continue
    const ref: DriveMediaRef = { uri: row.uri, mime: row.mime }
    if (typeof row.title === "string") ref.title = row.title
    if (typeof row.bytes === "number") ref.bytes = row.bytes
    out.push(ref)
  }
  return out
}

export function enrichUpdateWithMedia(
  update: Record<string, unknown>,
  cwd: string | null,
  stat: (uri: string) => { bytes: number } | null,
): Record<string, unknown> {
  const existingMeta =
    typeof update._meta === "object" && update._meta !== null
      ? (update._meta as Record<string, unknown>)
      : undefined
  let incoming: DriveMediaRef[] = []

  const content = update.content
  if (typeof content === "object" && content !== null) {
    const block = content as Record<string, unknown>
    if (block.type === "resource_link") {
      const fromLink = mediaFromResourceLink(block as { uri?: string; mimeType?: string; name?: string; size?: number })
      if (fromLink !== null) incoming.push(fromLink)
    } else if (block.type === "text" && typeof block.text === "string") {
      for (const cand of extractMediaCandidates(block.text, cwd)) {
        const ref = refFromHref(cand.href, cand.title, cwd, stat)
        if (ref !== null) incoming.push(ref)
      }
    }
  }

  if (incoming.length === 0) return update

  const merged = mergeMedia(parseExistingMedia(existingMeta), incoming)
  const nextMeta = mergeMeta(existingMeta, { "_drive/media": merged })
  if (nextMeta === undefined) return update
  return { ...update, _meta: nextMeta }
}

/** Parse `_drive/media` rows from update `_meta` for FE catalog merge. */
export function mediaRefsFromUpdateMeta(update: Record<string, unknown>): DriveMediaRef[] {
  const meta =
    typeof update._meta === "object" && update._meta !== null
      ? (update._meta as Record<string, unknown>)
      : undefined
  return parseExistingMedia(meta)
}
