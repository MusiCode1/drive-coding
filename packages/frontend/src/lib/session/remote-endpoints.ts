/**
 * remote-endpoints.ts — the URLs and headers one RemoteSessionView talks through.
 *
 * Extracted while adding the client-kind header: the view held `#baseUrl`, `#headers`,
 * `#connectionId` and three one-line URL builders purely to address the backend, none of
 * which has anything to do with session state. Keeping them here means a change to how we
 * identify ourselves on the wire touches one small file instead of the 480-line view.
 */

import { CLIENT_KIND_HEADER, CLIENT_KIND_UI } from "@drive-coding/core/acp/drive-message-headers"
import { remoteHttpPost } from "./remote-request-actions.js"

export const ACP_CONNECTION_ID_HEADER = "Acp-Connection-Id"

export type RemoteEndpoints = {
  readonly headers: Record<string, string>
  readonly events: string
  readonly rpc: string
  readonly reply: string
}

export function remoteEndpoints(
  agentId: string,
  baseUrl: string,
  extraHeaders?: Record<string, string>,
): RemoteEndpoints {
  const connectionId =
    extraHeaders?.[ACP_CONNECTION_ID_HEADER] ??
    (typeof crypto !== "undefined" ? crypto.randomUUID() : "remote-view")
  const base = `${baseUrl}/api/agents/${agentId}`
  return {
    headers: {
      [ACP_CONNECTION_ID_HEADER]: connectionId,
      // Says "a human typed this". Without it the backend labels prompts as coming from
      // the API, which is the intended default for every caller that is not this app.
      [CLIENT_KIND_HEADER]: CLIENT_KIND_UI,
      ...extraHeaders,
    },
    events: `${base}/events`,
    rpc: `${base}/rpc`,
    reply: `${base}/reply`,
  }
}

export type RemoteHttp = {
  post(url: string, body: unknown, localClose?: boolean): Promise<unknown>
  rpc(method: string, params: Record<string, unknown>): Promise<unknown>
  /** The same deps bundle, for helpers that post on their own (reply dispatch). */
  context(): Parameters<typeof remoteHttpPost>[0]
}

/**
 * The two POST wrappers the view used to hold inline. Same extraction, same reason: how
 * a request is addressed and authenticated is not session state.
 *
 * ⚠️ Carried over from the view, because it is the part worth not re-learning: on `!ok`
 * the body **is** parsed. The backend ships `502 {error, code?}` for CLI failures (for
 * example `-32601`), and without parsing it the view-model would show a bare "502"
 * instead of handling an unsupported method gracefully. `.code` is attached to the thrown
 * error when numeric. Network errors already propagate — it was only the HTTP layer that
 * used to be swallowed, which made a failed prompt look like a hang rather than an error.
 */
export function remoteHttp(
  endpoints: RemoteEndpoints,
  doFetch: (url: string, init?: RequestInit) => Promise<Response>,
  guard: (localClose: boolean) => Parameters<typeof remoteHttpPost>[0]["assertCurrent"],
): RemoteHttp {
  const post = (url: string, body: unknown, localClose = false): Promise<unknown> =>
    remoteHttpPost(
      {
        doFetch: doFetch,
        headers: endpoints.headers,
        assertCurrent: guard(localClose),
      },
      url,
      body,
    )
  return {
    post,
    rpc: (method, params) => post(endpoints.rpc, { method, params }),
    context: () => ({
      doFetch: doFetch,
      headers: endpoints.headers,
      assertCurrent: guard(false),
    }),
  }
}
