import type { ChannelFrame, ChannelResponse } from "@drive-coding/core/session"

export class PipeError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = "PipeError"
  }
}

export type FramePipe = {
  open(signal: AbortSignal): Promise<AsyncIterable<ChannelFrame>>
  readonly describe: string
}

export type RpcKind = "rpc" | "reply"

export type RpcPipe = {
  call(kind: RpcKind, body: unknown): Promise<ChannelResponse>
  label(kind: RpcKind): string
}

export type SessionPipe = {
  frames: FramePipe
  rpc: RpcPipe
  close(): void
}

export function resultOf({ status, body }: ChannelResponse, label: string): unknown {
  if (status >= 200 && status < 300) return body

  const payload = body as { error?: unknown; code?: unknown } | undefined
  const detail =
    typeof payload?.error === "string" && payload.error.length > 0 ? ` (${payload.error})` : ""
  const error = new Error(
    `RemoteSessionView: ${label} failed with status ${status}${detail}`,
  ) as Error & {
    code?: number
  }
  if (typeof payload?.code === "number") error.code = payload.code
  throw error
}
