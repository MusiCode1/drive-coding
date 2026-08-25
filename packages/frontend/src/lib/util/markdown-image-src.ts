/**
 * markdown-image-src.ts — pure decision function for markdown image hrefs.
 *
 * Determines whether an image src is local (proxy), data URI, remote (click-to-load),
 * or inert (show source text). Used by markdown-parse renderer.image.
 */

import { beUrl } from "./be-url"
import { resolveFileUri } from "./file-path-links"

export type ImageSrcDecision =
  | { kind: "proxy"; src: string }
  | { kind: "data"; src: string }
  | { kind: "remote"; url: string }
  | { kind: "inert" }

export function decideImageSrc(href: string, cwd: string | null): ImageSrcDecision {
  const trimmed = href.trim()
  if (trimmed === "") return { kind: "inert" }

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: "remote", url: trimmed }
  }

  if (/^\/\//.test(trimmed)) {
    return { kind: "inert" }
  }

  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(trimmed)) {
    return { kind: "data", src: trimmed }
  }

  if (/^data:/i.test(trimmed)) {
    return { kind: "inert" }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^file:\/\//i.test(trimmed)) {
    return { kind: "inert" }
  }

  const uri = resolveFileUri(trimmed, cwd)
  if (uri === null) return { kind: "inert" }

  return {
    kind: "proxy",
    src: beUrl(`/api/fs/file?uri=${encodeURIComponent(uri)}`),
  }
}
