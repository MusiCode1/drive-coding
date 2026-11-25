import type { HistoryPipe, HistoryQuery } from "./pipe"
import type { SSEReaderOptions } from "./reader-types"

function historyQueryToSearchParams(query: HistoryQuery): URLSearchParams {
  const params = new URLSearchParams()
  if ("tail" in query && query.tail) {
    params.set("tail", "1")
    params.set("maxBytes", String(query.maxBytes))
    return params
  }
  if ("before" in query) {
    params.set("before", String(query.before))
    params.set("maxBytes", String(query.maxBytes))
  }
  return params
}

export function createHttpHistoryPipe(
  historyUrl: string,
  opts: Pick<SSEReaderOptions, "headers" | "_fetch"> = {},
): HistoryPipe {
  const doFetch = opts._fetch ?? ((url, init) => globalThis.fetch(url, init))
  const headers = { ...opts.headers }

  return {
    async get(query, signal) {
      const qs = historyQueryToSearchParams(query).toString()
      const url = qs.length > 0 ? `${historyUrl}?${qs}` : historyUrl
      const response = await doFetch(url, { headers, signal })
      let body: unknown
      try {
        body = await response.json?.()
      } catch {
        body = undefined
      }
      return { status: response.status, body }
    },
  }
}
