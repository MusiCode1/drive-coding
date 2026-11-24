/**
 * sse-pipe.ts — fetch + ReadableStream SSE framing.
 *
 * לא משתמש ב-EventSource (לא תומך ב-POST/headers).
 * מתחבר עם fetch + ReadableStream, מנתח SSE framing ידנית.
 *
 * Protocol:
 *   event: snapshot\nid: <version>\ndata: {sessionId,version,epoch,updates[]}  ← frame-zero
 *   event: update\nid: <version>\ndata: <JSON-RPC batch של session/update>   ← עדכונים שוטפים
 *   event: stream-alive\ndata: <_drive/streamAlive notification>\n\n  ← slice sse-liveness
 *                                                                   Commit 2: visible liveness
 *                                                                   signal (replaces the old,
 *                                                                   invisible `: keepalive`
 *                                                                   SSE comment). Ignored by
 *                                                                   this parser's event-name
 *                                                                   switch (falls through like
 *                                                                   any unknown event) until
 *                                                                   Commit 4 wires the watchdog.
 *   event: taken-over\nid: <new-epoch>\ndata: {}\n\n            ← terminal: stop reconnecting
 *
 * Reconnect: exponential backoff (1s, 2s, 4s, ..., max 30s).
 * On reconnect: calls onReconnected(newSnapshot) before resuming patches.
 *
 * ─── slice remote-session-view C1 (TDD) ───
 */

import type { ChannelFrame } from "@drive-coding/core/session"
import { type FramePipe, PipeError } from "./pipe"
import type { SSEReaderOptions } from "./reader-types"

/**
 * readSSEFrames — async generator that yields parsed SSE frames from a body stream.
 * Handles CRLF and LF line endings. Releases reader lock on completion/error.
 */
async function* readSSEFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ChannelFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let currentData = ""
  // slice acp-wire-session-update: ה-`id:` נקרא עכשיו, כי הוא נושא את
  // ה-`version` — שירד מגוף ה-patch אל שורת-המסגור. עד כה הוא פשוט נזרק.
  let currentId = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Split on LF; keep the last incomplete line in the buffer
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const rawLine of lines) {
        // Strip trailing CR (CRLF → LF normalisation)
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim()
        } else if (line.startsWith("id:")) {
          currentId = line.slice(3).trim()
        } else if (line === "") {
          // Empty line → dispatch event
          if (currentEvent && currentData) {
            yield { event: currentEvent, data: currentData, id: currentId }
          }
          currentEvent = ""
          currentData = ""
          currentId = ""
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Already released
    }
  }
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    const contentType = response.headers?.get?.("content-type")
    if (contentType?.toLowerCase().includes("json")) {
      return typeof response.json === "function" ? await response.json() : undefined
    }
    return typeof response.text === "function" ? await response.text() : undefined
  } catch {
    // Preserve the status when an error body is unreadable or malformed.
    return undefined
  }
}

export function createSseFramePipe(
  url: string,
  opts: Pick<SSEReaderOptions, "headers" | "_fetch"> = {},
): FramePipe {
  const headers = opts.headers ?? {}
  const doFetch = opts._fetch ?? ((input, init) => globalThis.fetch(input, init))
  return {
    describe: url,
    async open(signal) {
      const response = await doFetch(url, { headers, signal })
      if (!response.ok) {
        // Carry the status separately so reconnect can stop on 404. Keep
        // the original message for callers of the SSEReader facade.
        throw new PipeError(
          response.status,
          await readErrorBody(response),
          `SSEReader: fetch failed with status ${response.status}`,
        )
      }
      if (!response.body) throw new Error("SSEReader: response has no body")
      return readSSEFrames(response.body)
    },
  }
}
