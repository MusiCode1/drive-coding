/**
 * voice-streams.ts — the codex voice mapping (voice-wire.ts) as a pair of NDJSON line streams, so the
 * connection only plugs them between itself and codex-acp.
 *
 * Slice: codex-voice-poc.
 */

import { Transform, type TransformCallback } from "node:stream"
import { createCodexVoiceWire } from "./voice-wire.js"

function lineTransform(map: (line: string) => string[]): Transform {
  let buffer = ""
  return new Transform({
    transform(chunk: Buffer | string, _enc: BufferEncoding, done: TransformCallback) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let idx = buffer.indexOf("\n")
      while (idx !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (line.length > 0) for (const out of map(line)) this.push(`${out}\n`)
        idx = buffer.indexOf("\n")
      }
      done()
    },
    flush(done: TransformCallback) {
      if (buffer.length > 0) for (const out of map(buffer)) this.push(`${out}\n`)
      buffer = ""
      done()
    },
  })
}

/** `toAgent`: FE→codex-acp. `fromAgent`: codex-acp→FE. Both share one mapping state. */
export function createCodexVoiceStreams(): { toAgent: Transform; fromAgent: Transform } {
  const wire = createCodexVoiceWire()
  return {
    toAgent: lineTransform((line) => [wire.toAgent(line)]),
    fromAgent: lineTransform((line) => wire.fromAgent(line)),
  }
}
