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
  /**
   * Called on every config_changed frame. `changed` lists the env keys the
   * backend actually applied; it is empty from an older backend that predates
   * the field, which callers should treat as "refresh everything you know".
   */
  onConfigChanged: (changed: string[]) => void
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
        const msg = JSON.parse(String(ev.data)) as { type?: string; changed?: string[] }
        if (msg.type === "config_changed") opts.onConfigChanged(msg.changed ?? [])
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

/** The view-models a config change may invalidate. */
export type ConfigChangeTargets = {
  cliAvailability: { reload: () => Promise<void> }
  ttsStatus: { refresh: () => Promise<void> }
}

const TTS_PROVIDER_KEYS = ["ELEVENLABS_API_KEY", "GEMINI_API_KEY"]

/**
 * Wire a config-change socket to the view-models it invalidates.
 *
 * Lives here rather than in the route because the route is wiring only. An
 * empty `changed` list means an older backend that does not report which keys
 * moved — treat it as "might have" and refresh rather than silently skipping.
 */
export function createConfigChangeRefresher(
  url: string,
  targets: ConfigChangeTargets,
): { start: () => void; stop: () => void } {
  return createConfigChangeSocket({
    url,
    onConfigChanged: (changed) => {
      void targets.cliAvailability.reload()
      const touchesTts = changed.length === 0 || changed.some((k) => TTS_PROVIDER_KEYS.includes(k))
      if (touchesTts) void targets.ttsStatus.refresh()
    },
  })
}
