/**
 * patch-schema.ts — ArkType runtime validation for Patch (wire boundary).
 *
 * calev-heavy remote-session-view round 3 (root-cause fix): SSEReader parsed wire
 * frames with `JSON.parse(...) as Patch` — an unvalidated cast. Three round 2/3
 * findings (unknown op wiping state, `#lastVersion` tracking "seen" instead of
 * "applied", a silent catch in the drain loop) were all downstream symptoms of
 * the same root cause — nothing validated a patch before it was trusted. This
 * schema is that validation boundary: `sse-reader.ts` uses it before a patch is
 * ever enqueued, so `RemoteSessionView` (and its `#lastVersion` dedup counter)
 * only ever sees patches that are actually well-formed.
 *
 * Intentionally light on nested/opaque fields (toolCall internals, update-session
 * changes, message meta) — those are provider-opaque or partial-by-design; the
 * job here is rejecting garbage/unknown shapes (wrong `op`, missing required
 * discriminating fields), not re-validating the whole SessionState schema.
 *
 * ─── slice remote-session-view, calev-heavy round 3 root-cause fix ───
 */
import { type } from "arktype"

const SessionSegmentSchema = type({ id: "string", text: "string" })

const AttachmentSchema = type({ mimeType: "string", dataBase64: "string" })
const SessionMessageSchema = type({
  id: "string",
  role: "'user'|'thought'|'assistant'",
  messageId: "string | null",
  segments: SessionSegmentSchema.array(),
  "meta?": "object",
  "attachments?": AttachmentSchema.array(),
}).or({
  id: "string",
  role: "'tool'",
  messageId: "null",
  toolCall: "object",
  "meta?": "object",
})

/** ArkType schema for `Patch` — validates wire input before it's trusted. */
export const PatchSchema = type({
  version: "number",
  op: "'append-segment'",
  targetId: "string",
  segment: SessionSegmentSchema,
  "meta?": "object",
})
  .or({
    version: "number",
    op: "'add-message'",
    message: SessionMessageSchema,
  })
  .or({
    version: "number",
    op: "'set-message'",
    targetId: "string",
    message: SessionMessageSchema,
  })
  .or({
    version: "number",
    op: "'update-tool'",
    targetId: "string",
    toolCall: "object",
    "meta?": "object",
  })
  .or({
    version: "number",
    op: "'reset'",
    messages: SessionMessageSchema.array(),
    nextMessageSeq: "number",
    nextSegmentSeq: "number",
  })
  .or({
    version: "number",
    op: "'update-session'",
    changes: "object",
    "meta?": "object",
  })
  // 🔴 עדכון לא-מוכר, נישא כמות שהוא. `unknown` בכוונה — הנקודה כולה היא
  // שאיננו יודעים מה יש בפנים, ואסור לנו להתנות עליו שום דבר.
  .or({
    version: "number",
    op: "'opaque'",
    update: "unknown",
  })
