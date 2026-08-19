/**
 * stream-alive.ts — SSE liveness signal: BE→FE "the stream is alive" notification.
 *
 * The SSE keepalive comment (`: keepalive\n\n`, `session-host/http/events.ts`) is
 * invisible to `SSEReader` by design — an SSE comment line never becomes a frame
 * (see `sse-reader.ts`'s parser: only `event:`/`data:` lines are tracked). This
 * module defines a *visible* liveness signal that rides an actual named SSE event
 * instead: `event: stream-alive` carrying a JSON-RPC notification as `data:`.
 *
 * Single source of truth for:
 *   - the `_drive/*` method name (`_drive/streamAlive`)
 *   - the SSE `event:` name (`stream-alive`)
 *   - the emission interval (30s — also the interval the BE's existing SSE
 *     keepalive comment already uses; this frame replaces its `void s.write`
 *     payload, not its timer)
 *   - the wire-frame shape (ArkType schema)
 *
 * Why `_drive/streamAlive` and not `heartbeat`: `packages/provider/src/transport/
 * ws.ts` already defines `HEARTBEAT_INTERVAL_MS` for the **FE→BE** `$/ping` on the
 * WS transport (a request expecting `$/pong`). Reusing "heartbeat" here — for a
 * **BE→FE**, no-reply notification on a *different* transport (SSE) — would create
 * two "heartbeat"s with opposite meanings in the same repo.
 *
 * Why a full JSON-RPC notification envelope and not a bare `{}`: an `event:`-named
 * SSE frame alone is just wire framing, not a protocol message. `params: {}` is a
 * real JSON-RPC 2.0 notification (no `id`, no reply expected) — the *arrival* of
 * the frame is the entire signal; no payload fields are needed (an earlier design
 * carried `{sessionId, version}` for a version-comparison detector that this slice
 * does not implement — see `docs-for-llm/plans/brief-sse-liveness.md` §4.1).
 *
 * Why this lives in `core/session` and not `provider/src/extensions/schema.ts`
 * (where the other `_drive/*` ext methods — `setThinkingTokens`, `getQuota` — are
 * registered): those are `extMethods` (request/response, routed to the CLI and
 * back). `streamAlive` is not a provider extension at all — it never touches a
 * CLI. It is a liveness signal of *our own transport* (BE SSE route → FE
 * `SSEReader`), and its only consumer (`events.ts`) is backend code that cannot
 * import a `provider` package (out of layering). See the cross-reference comment
 * in `packages/provider/src/extensions/schema.ts` for the other direction.
 *
 * ─── slice sse-liveness Commit 1 (TDD) ───
 */

import { type } from "arktype"

/** `_drive/*` ext-style method name carried in the notification's `method` field. */
export const STREAM_ALIVE_METHOD = "_drive/streamAlive"

/** SSE `event:` name the frame is dispatched under (see `events.ts` / `sse-reader.ts`). */
export const STREAM_ALIVE_EVENT = "stream-alive"

/**
 * How often the BE emits a stream-alive frame (ms). Consumed directly by
 * `events.ts` (Commit 2, replaces the literal `KEEPALIVE_INTERVAL_MS`) and
 * indirectly by the FE watchdog threshold (Commit 4ב's `liveness-thresholds.ts`
 * imports this as `SERVER_KEEPALIVE_MS`).
 */
export const STREAM_ALIVE_INTERVAL_MS = 30_000

/**
 * ArkType schema for the `_drive/streamAlive` notification envelope — the exact
 * shape of the `data:` payload on the `event: stream-alive` SSE frame.
 */
export const StreamAliveNotification = type({
  jsonrpc: "'2.0'",
  method: "'_drive/streamAlive'",
  params: "object",
})
export type StreamAliveNotification = typeof StreamAliveNotification.infer
