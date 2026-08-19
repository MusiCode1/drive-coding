/**
 * config-change-socket.ts — echo-WS client for config-change broadcasts
 * (slice cli-specs-hot-reload, Commit 2).
 *
 * Owns the WebSocket, its lifecycle, and reconnect. The route only wires
 * start/stop — golden rule: no WebSocket in routes; engines own imperative
 * resources. wsFactory is a test seam, like WsAcpTransport(url, ws?).
 */

const RECONNECT_DELAY_MS = 1000

export function createConfigChangeSocket(opts: {
  url: string
  onConfigChanged: () => void
  wsFactory?: (url: string) => WebSocket
}): { start(): void; stop(): void } {
  let ws: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = true

  function connect(): void {
    if (stopped) return
    try {
      ws = (opts.wsFactory ?? ((url: string) => new WebSocket(url)))(opts.url)
    } catch {
      scheduleReconnect()
      return
    }
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string }
        if (msg.type === "config_changed") opts.onConfigChanged()
      } catch {
        // Ignore malformed or non-JSON frames.
      }
    })
    ws.addEventListener("close", () => {
      if (stopped) return
      scheduleReconnect()
    })
    ws.addEventListener("error", () => {
      // close will fire and trigger reconnect.
    })
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== undefined) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, RECONNECT_DELAY_MS)
  }

  return {
    start(): void {
      if (stopped) {
        stopped = false
        connect()
      }
    },
    stop(): void {
      if (stopped) return
      stopped = true
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      try {
        ws?.close()
      } catch {
        // already closed
      }
      ws = undefined
    },
  }
}
