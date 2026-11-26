import type { ChannelResponse } from "@drive-coding/core/session"
import { PipeError, type RpcCallOptions, type RpcKind, type RpcPipe } from "./pipe"
import type { SSEReaderOptions } from "./reader-types"

function discardResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {})
  } catch {
    // Body cleanup is best-effort after the headers have supplied the result.
  }
}

export function createHttpRpcPipe(
  agentUrl: string,
  opts: Pick<SSEReaderOptions, "headers" | "_fetch"> = {},
): RpcPipe {
  const doFetch = opts._fetch ?? ((url, init) => globalThis.fetch(url, init))
  const headers = { "Content-Type": "application/json", ...opts.headers }
  const urlFor = (kind: RpcKind) => `${agentUrl}/${kind}`

  async function request(
    kind: RpcKind,
    body: unknown,
    options?: RpcCallOptions,
    signal?: AbortSignal,
  ): Promise<ChannelResponse> {
    const response = await doFetch(urlFor(kind), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal && { signal }),
    })
    const { status } = response
    if (signal?.aborted || status === options?.statusOnlyOn) {
      discardResponseBody(response)
      signal?.throwIfAborted()
      return { status, body: undefined }
    }

    // Non-accepted replies carry evidence in the body, including JSON-RPC error codes.
    let payload: unknown
    try {
      payload = await response.json?.()
    } catch {
      payload = undefined
    }
    return { status, body: payload }
  }

  return {
    label: (kind) => `POST ${urlFor(kind)}`,
    async call(kind, body, options) {
      const timeoutMs = options?.timeoutMs
      if (timeoutMs === undefined) return request(kind, body, options)

      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new PipeError(0, undefined, "HTTP session RPC timed out"))
          controller.abort()
        }, timeoutMs)
      })
      try {
        // Bound the request even if the fetch or body reader does not honor abort.
        return await Promise.race([request(kind, body, options, controller.signal), deadline])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  }
}
