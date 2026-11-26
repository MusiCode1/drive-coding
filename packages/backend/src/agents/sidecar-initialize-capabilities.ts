import { extractPromptCaps } from "@drive-coding/core/acp/extract-prompt-caps"
import { type } from "arktype"

export const SidecarInitCapabilities = type({
  protocolVersion: "1",
  image: "boolean",
}).onUndeclaredKey("reject")

export const MAX_SIDECAR_CONTROL_BYTES = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseFrame(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function withinLimit(line: string): boolean {
  return (
    line.length <= MAX_SIDECAR_CONTROL_BYTES &&
    Buffer.byteLength(line, "utf8") <= MAX_SIDECAR_CONTROL_BYTES
  )
}

/** Observe one initialize exchange in the lifetime of the provider process. */
export function createInitializeCapabilitiesTap<Peer extends object>() {
  type State =
    | { phase: "first" }
    | { phase: "pending"; peer: Peer; id: string | number }
    | { phase: "unknown" }
    | { phase: "known"; capabilities: typeof SidecarInitCapabilities.infer }

  let state: State = { phase: "first" }
  const abandon = () => {
    state = { phase: "unknown" }
  }

  return {
    get capabilities() {
      return state.phase === "known" ? state.capabilities : undefined
    },
    onAccept(peer: Peer): void {
      if (state.phase === "pending" && state.peer !== peer) abandon()
    },
    onRequest(peer: Peer, owner: Peer | undefined, line: string): void {
      if (state.phase !== "first" && state.phase !== "pending") return
      if (peer !== owner || !withinLimit(line)) {
        abandon()
        return
      }
      const frame = parseFrame(line)
      if (state.phase === "pending") {
        if (
          Array.isArray(frame) ||
          (isRecord(frame) &&
            (frame.method === "initialize" ||
              (typeof frame.method === "string" && frame.id === state.id)))
        ) {
          abandon()
        }
        return
      }
      if (
        isRecord(frame) &&
        frame.jsonrpc === "2.0" &&
        frame.method === "initialize" &&
        (typeof frame.id === "string" ||
          (typeof frame.id === "number" && Number.isFinite(frame.id)))
      ) {
        state = { phase: "pending", peer, id: frame.id }
      } else {
        abandon()
      }
    },
    onResponse(owner: Peer | undefined, line: string): void {
      if (state.phase !== "pending") return
      if (owner !== state.peer || !withinLimit(line)) {
        abandon()
        return
      }
      const frame = parseFrame(line)
      if (!isRecord(frame) || frame.id !== state.id) return
      if (
        frame.jsonrpc !== "2.0" ||
        "method" in frame ||
        "error" in frame ||
        !isRecord(frame.result) ||
        frame.result.protocolVersion !== 1
      ) {
        abandon()
        return
      }
      state = {
        phase: "known",
        capabilities: { protocolVersion: 1, image: extractPromptCaps(frame)?.image === true },
      }
    },
  }
}
