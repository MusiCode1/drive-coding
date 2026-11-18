/**
 * Audio file serving for GET /api/fs/file — Range requests via fs.open + read.
 */

import { open, readFile } from "node:fs/promises"
import { type ParsedBytesRange, parseBytesRange } from "./http-fs-file-range.js"

export async function serveAudioFile(
  real: string,
  size: number,
  contentType: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  const parsed = parseBytesRange(rangeHeader, size)

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  }

  if (parsed.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${size}`,
      },
    })
  }

  if (parsed.kind === "absent") {
    const bytes = new Uint8Array(await readFile(real))
    return new Response(bytes, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(bytes.length),
      },
    })
  }

  const { start, endInclusive } = parsed
  const length = endInclusive - start + 1
  const buffer = Buffer.alloc(length)
  const fd = await open(real, "r")
  try {
    await fd.read(buffer, 0, length, start)
  } finally {
    await fd.close()
  }

  return new Response(new Uint8Array(buffer), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${endInclusive}/${size}`,
      "Content-Length": String(length),
    },
  })
}

export type { ParsedBytesRange }
