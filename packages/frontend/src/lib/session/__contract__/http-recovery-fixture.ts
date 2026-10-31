import {
  createInitialSessionState,
  type SessionState,
  serializeFrame,
  snapshotPayload,
  type WireSessionUpdate,
} from "@drive-coding/core/session"

export function hostState(version = 43, extra: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialSessionState({ sessionId: "same-sid" }),
    version,
    status: "connected",
    ...extra,
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export class HttpStream {
  readonly response: Response
  #controller!: ReadableStreamDefaultController<Uint8Array>
  #ended = false
  constructor(state: SessionState, host: unknown = "host-A", signal?: AbortSignal) {
    this.response = new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          this.#controller = controller
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
    this.snapshot(state, host)
    signal?.addEventListener("abort", () => this.end(), { once: true })
  }
  frame(event: string, data: unknown, id?: string): void {
    if (this.#ended) return
    this.#controller.enqueue(
      new TextEncoder().encode(serializeFrame({ event, id, data: JSON.stringify(data) })),
    )
  }
  snapshot(state: SessionState, host: unknown): void {
    this.frame(
      "snapshot",
      { ...snapshotPayload(state), hostIncarnation: host },
      String(state.version),
    )
  }
  update(version: number, ...updates: WireSessionUpdate[]): void {
    this.frame(
      "update",
      updates.map((update) => ({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "same-sid", update },
      })),
      String(version),
    )
  }
  end(): void {
    if (this.#ended) return
    this.#ended = true
    this.#controller.close()
  }
}
export const textUpdate = (text: string): WireSessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
})
