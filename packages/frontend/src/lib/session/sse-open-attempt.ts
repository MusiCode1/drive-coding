import {
  createInitialSessionState,
  reduce,
  type SessionState,
  type SnapshotPayload,
} from "@drive-coding/core/session"
import { type } from "arktype"
import type { RemoteSnapshot } from "./remote-stream-events"

export class SseProtocolError extends Error {}
export class SseTakenOverError extends Error {}

const takenOverPayload = type({ error: "'taken-over'" })
const snapshotEnvelope = type({
  hostIncarnation: "string > 0",
  sessionId: "string | null",
  version: "number",
  updates: type({ sessionUpdate: "string", "[string]": "unknown" }).array(),
})

export type SSEFrame = { event: string; data: string; id: string }

/**
 * readSSEFrames — async generator that yields parsed SSE frames from a body stream.
 * Handles CRLF and LF line endings. Releases reader lock on completion/error.
 */
async function* readSSEFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEFrame> {
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

/** מקפל את ה-snapshot למצב. ה-`version` נלקח מהשרת, לא מספירת ה-updates. */
function foldSnapshot(snap: SnapshotPayload): SessionState {
  let state = createInitialSessionState({ sessionId: snap.sessionId ?? "" })
  for (const u of snap.updates) state = reduce(state, u).state
  // ⚠️ **דריסה מכוונת.** `reduce` מעלה מונה מקומי לכל update, אבל ה-`version`
  // הוא מונה של **השרת** — הוא מה שסימון-החפיפה של הלקוח נמדד מולו. ספירה
  // מקומית הייתה מייצרת בדיוק את רגרסיית-הגרסה שבאג #41 נבנה סביבה.
  return { ...state, sessionId: snap.sessionId, version: snap.version }
}

export async function openSseAttempt(d: {
  url: string
  headers: Record<string, string>
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  signal: AbortSignal
  token: object
  current(): boolean
  snapshotTimeoutMs: number
}): Promise<{ initial: RemoteSnapshot; frames: AsyncGenerator<SSEFrame> }> {
  const check = () => {
    if (d.signal.aborted || !d.current()) throw new Error("SSEReader: obsolete opening attempt")
  }
  const res = await d.fetch(d.url, { headers: d.headers, signal: d.signal })
  check()
  if (!res.ok) {
    if (res.status === 409) {
      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        check()
      }
      check()
      const parsed = takenOverPayload(payload)
      if (!(parsed instanceof type.errors)) throw new SseTakenOverError("SSEReader: taken-over")
    }
    const error = new Error(`SSEReader: fetch failed with status ${res.status}`) as Error & {
      status: number
    }
    error.status = res.status
    throw error
  }
  if (!res.body) throw new Error("SSEReader: response has no body")
  const frames = readSSEFrames(res.body)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("SSEReader: timed out waiting for snapshot frame")),
      d.snapshotTimeoutMs,
    )
  })
  const advance = (async (): Promise<RemoteSnapshot> => {
    let next = await frames.next()
    check()
    while (!next.done && next.value.event !== "snapshot") {
      next = await frames.next()
      check()
    }
    if (next.done) throw new Error("SSEReader: no snapshot frame received")
    let raw: unknown
    try {
      raw = JSON.parse(next.value.data)
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new SseProtocolError("SSEReader: invalid snapshot JSON")
      throw error
    }
    const parsed = snapshotEnvelope(raw)
    if (parsed instanceof type.errors || !Number.isFinite(parsed.version))
      throw new SseProtocolError("SSEReader: invalid snapshot envelope")
    return {
      kind: "snapshot",
      source: { hostIncarnation: parsed.hostIncarnation, token: d.token },
      state: foldSnapshot(parsed),
    }
  })()
  advance.catch(() => {})
  timeout.catch(() => {})
  try {
    const initial = await Promise.race([advance, timeout])
    check()
    return { initial, frames }
  } finally {
    clearTimeout(timer)
  }
}
