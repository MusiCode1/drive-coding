/**
 * sse-gzip-writer.ts — gzip SSE with Z_SYNC_FLUSH per write (slice sse-frame-zero-chunked-gzip).
 *
 * CompressionStream buffers until close — unusable for long-lived SSE. node:zlib with
 * explicit Z_SYNC_FLUSH after each frame is required (measured in brief §0).
 */

import { createGzip, type Gzip, constants as zlibConstants } from "node:zlib"

export type SseWireWrite = (chunk: Uint8Array) => Promise<void> | void
export type SseTextWrite = (text: string) => Promise<void> | void

function awaitWriteResult(result: Promise<void> | void): Promise<void> {
  return result === undefined ? Promise.resolve() : result
}

export function applySseGzipResponseHeaders(
  setHeader: (name: string, value: string) => void,
  gzipWanted: boolean,
): void {
  if (!gzipWanted) return
  setHeader("Content-Encoding", "gzip")
  setHeader("Vary", "Accept-Encoding")
}

export function createSseTextWriter(
  gzipWanted: boolean,
  rawWrite: SseTextWrite,
  gzipBinaryWrite: SseWireWrite,
): { writeWire: (text: string) => Promise<void> } {
  if (!gzipWanted) {
    return {
      writeWire: async (text: string) => {
        await awaitWriteResult(rawWrite(text))
      },
    }
  }
  const gzipWriter = new SyncFlushGzipWriter(gzipBinaryWrite)
  return {
    writeWire: (text: string) => gzipWriter.writeText(text),
  }
}

export function clientAcceptsGzip(acceptEncoding: string | undefined): boolean {
  if (!acceptEncoding) return false
  for (const part of acceptEncoding.split(",")) {
    const token = part.trim().split(";")[0]?.toLowerCase()
    if (token === "gzip" || token === "x-gzip") return true
  }
  return false
}

/** Compresses UTF-8 SSE text; each writeText flushes with Z_SYNC_FLUSH. */
export class SyncFlushGzipWriter {
  readonly #gz: Gzip
  readonly #writeOut: SseWireWrite
  readonly #encoder = new TextEncoder()

  constructor(writeOut: SseWireWrite) {
    this.#writeOut = writeOut
    this.#gz = createGzip()
  }

  writeText(text: string): Promise<void> {
    const bytes = this.#encoder.encode(text)
    const outChunks: Uint8Array[] = []
    const onData = (chunk: Buffer) => {
      outChunks.push(new Uint8Array(chunk))
    }
    this.#gz.on("data", onData)

    return new Promise((resolve, reject) => {
      this.#gz.write(bytes, (err) => {
        if (err) {
          this.#gz.off("data", onData)
          reject(err)
          return
        }
        this.#gz.flush(zlibConstants.Z_SYNC_FLUSH, (flushErr) => {
          this.#gz.off("data", onData)
          if (flushErr) {
            reject(flushErr)
            return
          }
          void (async () => {
            try {
              for (const chunk of outChunks) {
                await awaitWriteResult(this.#writeOut(chunk))
              }
              resolve()
            } catch (writeErr) {
              reject(writeErr)
            }
          })()
        })
      })
    })
  }

  end(): void {
    this.#gz.end()
  }
}
