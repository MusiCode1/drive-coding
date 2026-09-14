/**
 * browser-ws.test.ts — unit tests for WsAcpTransport.closeAndWait (NBug2 fix).
 *
 * WsAcpTransport קיבל פרמטר ws?: WebSocket ב-constructor — מנצלים אותו
 * להזרקת WebSocket stub בלי HTTP/Node אמיתי.
 *
 * TDD — אדום לפני הוספת closeAndWait; ירוק אחריה.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { WsAcpTransport } from "./browser-ws.js"

// ─── WebSocket constants (כמו בדפדפן) ────────────────────────────────────────

const WS_CONNECTING = 0
const WS_OPEN = 1
const WS_CLOSING = 2
const WS_CLOSED = 3

// ─── WebSocket stub ────────────────────────────────────────────────────────────

/**
 * WebSocket stub מינימלי שמאפשר לטסטים לשלוט ב-readyState ולהצית events.
 * משתמש ב-Map של listeners (כמו EventTarget אמיתי).
 */
function makeWsStub(initialReadyState: number = WS_OPEN) {
  const listeners: Map<string, Array<(ev: unknown) => void>> = new Map()
  let _readyState = initialReadyState

  const ws = {
    get readyState() { return _readyState },
    binaryType: "arraybuffer" as BinaryType,
    send: vi.fn(),
    close: vi.fn().mockImplementation(() => {
      _readyState = WS_CLOSING
    }),
    addEventListener: vi.fn().mockImplementation(
      (event: string, cb: (ev: unknown) => void, _opts?: unknown) => {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event)!.push(cb)
      },
    ),
    removeEventListener: vi.fn(),
    // helper: הצת event ידנית
    _fire(event: string, ev: unknown = {}) {
      for (const cb of listeners.get(event) ?? []) cb(ev)
    },
    // helper: סמן כ-CLOSED (לפני שמציתים close)
    _setClosed() { _readyState = WS_CLOSED },
    // helper: סמן כ-CONNECTING
    _setConnecting() { _readyState = WS_CONNECTING },
  }

  return ws
}

// ─── עזר: stub WebSocket global ───────────────────────────────────────────────

beforeEach(() => {
  // WsAcpTransport בודק WebSocket.CLOSED כ-static — צריך לstub את הגלובל
  vi.stubGlobal("WebSocket", Object.assign(
    vi.fn().mockImplementation(() => makeWsStub()),
    {
      CONNECTING: WS_CONNECTING,
      OPEN: WS_OPEN,
      CLOSING: WS_CLOSING,
      CLOSED: WS_CLOSED,
    },
  ))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ─── בדיקות closeAndWait ───────────────────────────────────────────────────────

describe("WsAcpTransport.closeAndWait — NBug2 fix", () => {
  test("מתרצה מיד כש-readyState כבר CLOSED", async () => {
    const ws = makeWsStub(WS_CLOSED)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    const start = Date.now()
    await transport.closeAndWait(500)
    const elapsed = Date.now() - start

    // מתרצה מיד (לא ממתין ל-timeout)
    expect(elapsed).toBeLessThan(100)
    // לא קרא ל-ws.close() (כבר סגור)
    expect(ws.close).not.toHaveBeenCalled()
  })

  test("מתרצה אחרי close event כש-readyState = OPEN", async () => {
    vi.useFakeTimers()
    const ws = makeWsStub(WS_OPEN)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    let resolved = false
    const p = transport.closeAndWait(1000).then(() => { resolved = true })

    // עדיין לא הסתיים — ממתין ל-close event
    expect(resolved).toBe(false)

    // מצית close event (כפי שהדפדפן היה עושה)
    ws._setClosed()
    ws._fire("close", { code: 1000, reason: "" })

    await p
    expect(resolved).toBe(true)
    expect(ws.close).toHaveBeenCalledOnce()
  })

  test("timeout fallback — מתרצה אחרי timeout אם close event לא מגיע", async () => {
    vi.useFakeTimers()
    const ws = makeWsStub(WS_OPEN)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    let resolved = false
    const p = transport.closeAndWait(200).then(() => { resolved = true })

    expect(resolved).toBe(false)

    // מקדם את הטיימרים ב-200ms בלי להצית close event
    await vi.advanceTimersByTimeAsync(200)

    await p
    expect(resolved).toBe(true)
    expect(ws.close).toHaveBeenCalledOnce()
  })

  test("רושם listener לפני קריאה ל-close (אין race)", async () => {
    vi.useFakeTimers()
    const ws = makeWsStub(WS_OPEN)
    const callOrder: string[] = []

    // עוקב אחרי הסדר
    const origClose = ws.close
    ws.close = vi.fn().mockImplementation(() => {
      callOrder.push("close()")
      origClose.call(ws)
    })
    const origAddEventListener = ws.addEventListener
    ws.addEventListener = vi.fn().mockImplementation((event: string, cb: (ev: unknown) => void, opts?: unknown) => {
      if (event === "close") callOrder.push("registered-close-listener")
      origAddEventListener.call(ws, event, cb, opts)
    })

    const p = transport_from_ws(ws).closeAndWait(500)

    // listener חייב להירשם לפני close()
    const listenerIdx = callOrder.indexOf("registered-close-listener")
    const closeIdx = callOrder.indexOf("close()")
    expect(listenerIdx).toBeGreaterThanOrEqual(0)
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(listenerIdx).toBeLessThan(closeIdx)

    ws._setClosed()
    ws._fire("close", { code: 1000, reason: "" })
    await p
  })

  test("CLOSING state — מתרצה כש-close event מגיע (לא early return)", async () => {
    vi.useFakeTimers()
    const ws = makeWsStub(WS_CLOSING)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    let resolved = false
    const p = transport.closeAndWait(1000).then(() => { resolved = true })

    // לא אמור להיפתר מיד (CLOSING אינו CLOSED)
    expect(resolved).toBe(false)

    ws._setClosed()
    ws._fire("close", { code: 1000, reason: "" })
    await p
    expect(resolved).toBe(true)
  })
})

// ─── בדיקות sendRaw ────────────────────────────────────────────────────────────

describe("WsAcpTransport.sendRaw", () => {
  test("OPEN — קורא ל-ws.send", () => {
    const ws = makeWsStub(WS_OPEN)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    transport.sendRaw('{"jsonrpc":"2.0","method":"$/detach"}\n')

    expect(ws.send).toHaveBeenCalledOnce()
    expect(ws.send).toHaveBeenCalledWith('{"jsonrpc":"2.0","method":"$/detach"}\n')
  })

  test("לא-OPEN — לא שולח ולא זורק", () => {
    const ws = makeWsStub(WS_CONNECTING)
    const transport = new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)

    expect(() => transport.sendRaw('{"jsonrpc":"2.0","method":"$/detach"}\n')).not.toThrow()
    expect(ws.send).not.toHaveBeenCalled()
  })
})

// ─── עזר מקומי ────────────────────────────────────────────────────────────────

function transport_from_ws(ws: ReturnType<typeof makeWsStub>): WsAcpTransport {
  return new WsAcpTransport("ws://localhost/test", ws as unknown as WebSocket)
}
