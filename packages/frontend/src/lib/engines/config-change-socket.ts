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
   * backend actually applied.
   *
   * `undefined` means an older backend that predates the field — treat it as
   * "refresh everything you know". An empty array is different and meaningful:
   * the reload ran and applied nothing (the common case when only
   * cli-specs.jsonc changed), so there is nothing extra to refresh.
   */
  onConfigChanged: (changed: string[] | undefined) => void
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
        if (msg.type === "config_changed") opts.onConfigChanged(msg.changed)
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
  /** Holds GET /api/tts/capabilities — the one that gates VoicePicker. */
  ttsCapabilities: { refresh: () => Promise<void> }
  /** Subscription + usage; a new key means a different quota. */
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
      // undefined = older backend, so we cannot tell — refresh. An empty array
      // means the reload applied nothing, so there is nothing to refresh.
      const touchesTts =
        changed === undefined || changed.some((k) => TTS_PROVIDER_KEYS.includes(k))
      if (!touchesTts) return
      // capabilities first: it is what reports available/reason and gates the
      // picker. Refreshing only ttsStatus would leave a fixed key showing as
      // an auth failure until a page reload.
      void targets.ttsCapabilities.refresh()
      void targets.ttsStatus.refresh()
    },
  })
}
