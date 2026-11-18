/**
 * connection-id.ts — read Acp-Connection-Id from HTTP request (slice connection-set).
 */

import type { Context } from "hono"

export const CONNECTION_ID_HEADER = "Acp-Connection-Id"

export function readConnectionId(c: Context): string | undefined {
  const fromHeader = c.req.header(CONNECTION_ID_HEADER)
  if (fromHeader !== undefined && fromHeader.length > 0) return fromHeader
  const fromQuery = c.req.query("connectionId")
  if (fromQuery !== undefined && fromQuery.length > 0) return fromQuery
  return undefined
}
