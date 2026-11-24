import type { RpcKind, RpcPipe } from "./pipe"
import type { SSEReaderOptions } from "./reader-types"

export function createHttpRpcPipe(
  agentUrl: string,
  opts: Pick<SSEReaderOptions, "headers" | "_fetch"> = {},
): RpcPipe {
  const doFetch = opts._fetch ?? ((url, init) => globalThis.fetch(url, init))
  const headers = { "Content-Type": "application/json", ...opts.headers }
  const urlFor = (kind: RpcKind) => `${agentUrl}/${kind}`
  return {
    label: (kind) => `POST ${urlFor(kind)}`,
    async call(kind, body) {
      const response = await doFetch(urlFor(kind), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      // The server sends JSON for both successful replies and RPC errors
      // (e.g. a 502 carrying -32601). Mocks may omit the body reader.
      let payload: unknown
      try {
        payload = await response.json?.()
      } catch {
        payload = undefined
      }
      return { status: response.status, body: payload }
    },
  }
}
