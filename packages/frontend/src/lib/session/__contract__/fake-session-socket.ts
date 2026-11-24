export class FakeSessionSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 0
  readonly sent: string[] = []

  constructor(readonly url: string) {
    super()
  }

  connect(): void {
    this.readyState = FakeSessionSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }

  receive(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }))
  }

  send(data: string): void {
    if (this.readyState !== FakeSessionSocket.OPEN) throw new Error("Socket is closed")
    this.sent.push(data)
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }))
  }
}

export function fakeSessionSockets() {
  const instances: FakeSessionSocket[] = []
  class CaptureSocket extends FakeSessionSocket {
    constructor(url: string) {
      super(url)
      instances.push(this)
    }
  }
  function latest(): FakeSessionSocket {
    const socket = instances.at(-1)
    if (!socket) throw new Error("No session socket was opened")
    return socket
  }
  return { instances, latest, WebSocket: CaptureSocket as unknown as typeof WebSocket }
}
