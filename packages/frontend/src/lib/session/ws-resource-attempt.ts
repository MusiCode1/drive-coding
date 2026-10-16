import type { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import type { AcpClient } from "@drive-coding/provider/client"
import type { LocalSessionView } from "./local-session-view"

/** Captured resource generation, including resources returned after cancellation. */
export class WsResourceAttempt {
  active = true
  agentId: string | undefined
  created = false
  client: AcpClient | undefined
  view: LocalSessionView | undefined
  adopted = false
  transport: WsAcpTransport | undefined
  #rawTransport: WsAcpTransport | undefined
  #transportClosed = false
  #transportEnded = false
  #closeWait: Promise<void> | undefined
  #clientClosed = false
  #viewClosed = false

  constructor(readonly allowed: () => boolean) {}

  current(): boolean {
    return this.active && this.allowed()
  }

  ownTransport(raw: WsAcpTransport): WsAcpTransport {
    this.#rawTransport = raw
    raw.onClose?.(() => {
      this.#transportEnded = true
    })
    // The client receives this handle, so its internal transport.close shares our ledger.
    this.transport = new Proxy(raw, {
      get: (target, key) => {
        if (key === "close") return () => this.closeTransport()
        if (key === "closeAndWait") return () => this.closeTransportAndWait()
        const value: unknown = Reflect.get(target, key, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    return this.transport
  }

  closeTransport(): void {
    if (this.#transportClosed || !this.#rawTransport) return
    this.#transportClosed = true
    try {
      this.#rawTransport.close()
    } catch {
      // The generation is still closed when its transport rejects teardown.
    }
  }

  closeTransportAndWait(): Promise<void> {
    if (this.#closeWait) return this.#closeWait
    if (!this.#rawTransport) return Promise.resolve()
    if (!this.#transportClosed) {
      this.#transportClosed = true
      this.#closeWait = this.#rawTransport.closeAndWait()
    } else {
      if (this.#transportEnded) return Promise.resolve()
      const raw = this.#rawTransport
      this.#closeWait = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        raw.onClose?.(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    return this.#closeWait
  }

  disposeView(): void {
    if (this.#viewClosed || !this.view) return
    this.#viewClosed = true
    this.view.dispose()
  }

  closeClient(): void {
    if (this.#clientClosed || !this.client) return
    this.#clientClosed = true
    try {
      this.client.close()
    } catch {
      // Still release the underlying transport if the client throws first.
    }
    this.closeTransport()
  }

  close(): void {
    if (this.view && this.adopted && !this.#viewClosed && !this.#clientClosed) {
      const capturedView = this.view
      this.#viewClosed = true
      this.#clientClosed = true
      void capturedView.close().catch(() => {
        capturedView.dispose()
        this.closeTransport()
      })
    } else {
      this.disposeView()
      this.closeClient()
      this.closeTransport()
    }
  }
}
