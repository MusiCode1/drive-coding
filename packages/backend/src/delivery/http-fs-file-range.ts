/**
 * RFC 7233 bytes= Range parser for /api/fs/file audio serving.
 * Supports only `bytes=start-end` and `bytes=start-`.
 */

export type ParsedBytesRange =
  | { kind: "absent" }
  | { kind: "unsatisfiable" }
  | { kind: "single"; start: number; endInclusive: number }

export function parseBytesRange(header: string | undefined, size: number): ParsedBytesRange {
  if (header === undefined || header.trim() === "") {
    return { kind: "absent" }
  }

  const trimmed = header.trim()
  const match = /^bytes=(.+)$/i.exec(trimmed)
  if (!match) {
    return { kind: "unsatisfiable" }
  }

  const spec = match[1]
  if (spec === undefined || spec.includes(",") || spec.startsWith("-")) {
    return { kind: "unsatisfiable" }
  }

  const dash = spec.indexOf("-")
  if (dash < 0) {
    return { kind: "unsatisfiable" }
  }

  const startStr = spec.slice(0, dash)
  const endStr = spec.slice(dash + 1)

  if (startStr === "") {
    return { kind: "unsatisfiable" }
  }

  const start = Number.parseInt(startStr, 10)
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return { kind: "unsatisfiable" }
  }

  let endInclusive: number
  if (endStr === "") {
    endInclusive = size - 1
  } else {
    endInclusive = Number.parseInt(endStr, 10)
    if (!Number.isFinite(endInclusive) || endInclusive < start) {
      return { kind: "unsatisfiable" }
    }
    if (endInclusive >= size) {
      endInclusive = size - 1
    }
  }

  return { kind: "single", start, endInclusive }
}
