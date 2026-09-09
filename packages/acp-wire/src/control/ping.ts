/**
 * control/ping.ts — `_drive/ping`: liveness of a transport peer, as a legal
 * JSON-RPC / ACP extension method.
 *
 * ─── Why not `$/ping` ────────────────────────────────────────────────────────
 *
 * 🔴 `$/ping` (browser-ws.ts:133, intercepted at ws-agent.ts:138) is **not an
 * ACP method**. The `$/` prefix is an LSP convention that ACP never adopted;
 * nothing in the protocol reserves it, and no agent is required to tolerate it.
 * It works today only because our own WS boundary strips it before the frame can
 * reach a CLI (browser-ws-streams.ts filters `$/…` out of the stream). The
 * moment such a frame rides a transport that does *not* strip it — a Unix socket
 * straight into a sidecar, for instance — it is an unknown method on the wire.
 *
 * The legal namespace in this repo is `_drive/*`, which is what
 * `provider/src/extensions/schema.ts` registers (`_drive/setThinkingTokens`,
 * `_drive/getQuota`) and what `core/src/session/stream-alive.ts` uses for the
 * one liveness signal we already ship (`_drive/streamAlive`). This module is the
 * request/response sibling of that notification.
 *
 * ⚠️ On the SDK side the old `extMethod()` / `extNotification()` entry points are
 * **@deprecated as of @agentclientprotocol/sdk 0.58** ("Use request" / "Use
 * notify"): an extension is now just a `request(method, params)` with a
 * namespaced method name. Anything new should go through `request`, and the
 * existing `_drive/*` call sites still on `extMethod` are a separate cleanup.
 *
 * ─── Why this lives in acp-wire and carries no product fields ────────────────
 *
 * `@drive-coding/acp-wire` has **zero runtime dependencies** by design (only
 * node builtins — no arktype), because it is the byte-transport layer that both
 * the backend and a standalone sidecar binary link against. So: hand-rolled
 * guards, and the payload stays an opaque `info` bag. The transport owns the
 * *envelope*; whoever answers the ping owns what goes inside it (a sidecar puts
 * its agentId / cliKind / pid there, and the consumer validates that at its own
 * boundary).
 *
 * ─── What a pong actually proves ─────────────────────────────────────────────
 *
 * | signal                | proves                                   |
 * |-----------------------|------------------------------------------|
 * | connect() succeeds    | the socket file is live and has a listener |
 * | `_drive/ping` → pong  | the peer's event loop is running          |
 * | a real ACP frame back | the CLI behind the peer is answering      |
 *
 * The middle row is the one that has no other test: a peer wedged in a blocked
 * event loop still completes TCP/UDS handshakes, because the kernel accepts into
 * the backlog without the process being involved. `connect()` alone would call
 * it healthy.
 */

/** Namespaced extension method. Mirrors `_drive/streamAlive`. */
export const PING_METHOD = "_drive/ping"

/** Free-form identity/state the answering peer attaches to its pong. */
export type PingInfo = Record<string, unknown>

export type PingRequest = {
  jsonrpc: "2.0"
  id: string | number
  method: typeof PING_METHOD
  params: Record<string, unknown>
}

export type PongResult = { alive: true; info?: PingInfo }

/** Serialised NDJSON line — every transport here is newline-delimited. */
export function encodePing(id: string | number): string {
  const req: PingRequest = { jsonrpc: "2.0", id, method: PING_METHOD, params: {} }
  return `${JSON.stringify(req)}\n`
}

/** Serialised pong for a given request id. */
export function encodePong(id: string | number, info?: PingInfo): string {
  const result: PongResult = info === undefined ? { alive: true } : { alive: true, info }
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  // Cheap reject before JSON.parse: this runs on every frame of every
  // connection, and the overwhelming majority are not pings.
  if (trimmed === "" || !trimmed.includes(PING_METHOD)) return null
  try {
    const v: unknown = JSON.parse(trimmed)
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Is this line a ping request? Returns the id to answer, or null.
 *
 * A request without an `id` is a notification, and a notification must never be
 * answered — replying to one is a JSON-RPC violation that shows up as an
 * unmatched response on the peer.
 */
export function decodePing(line: string): { id: string | number } | null {
  const msg = parseLine(line)
  if (msg === null || msg.method !== PING_METHOD) return null
  const id = msg.id
  if (typeof id !== "string" && typeof id !== "number") return null
  return { id }
}

/** Is this line the pong for `id`? Returns the result, or null. */
export function decodePong(line: string, id: string | number): PongResult | null {
  const trimmed = line.trim()
  if (trimmed === "") return null
  let msg: Record<string, unknown>
  try {
    const v: unknown = JSON.parse(trimmed)
    if (typeof v !== "object" || v === null) return null
    msg = v as Record<string, unknown>
  } catch {
    return null
  }
  if (msg.id !== id) return null
  const result = msg.result as PongResult | undefined
  if (result?.alive !== true) return null
  return result
}
