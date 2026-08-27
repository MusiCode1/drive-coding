/**
 * wait-for-turn.ts — wait for a session turn to end via SSE.
 *
 * Two measured parse traps (2026-08-27):
 *   1. turnState lives in _meta["_drive/turnState"], not the coarse `state` field.
 *   2. `event: update` payload is a BARE ARRAY, not {updates:[...]}.
 */

import { existsSync } from "node:fs"
import type { WaitForTurnEndResult } from "@drive-coding/core/schemas/session-bus"

export type WaitForTurnEndArgs = {
  base: string
  agent: string
  marker?: string
  file?: string
  timeoutMs?: number
  idleTimeoutMs?: number
}

/** Snapshot: {updates:[...]} ; update: [ {jsonrpc, params:{update}} ]. */
export function updatesFromSseData(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (typeof data === "object" && data !== null) {
    const updates = (data as { updates?: unknown }).updates
    if (Array.isArray(updates)) return updates
  }
  return []
}

export function sessionUpdateOf(item: unknown): Record<string, unknown> | undefined {
  if (typeof item !== "object" || item === null) return undefined
  const nested = (item as { params?: { update?: unknown } }).params?.update
  const u = nested ?? item
  if (typeof u !== "object" || u === null) return undefined
  return u as Record<string, unknown>
}

export function turnStateOf(update: Record<string, unknown>): string | undefined {
  const meta = update._meta
  if (typeof meta === "object" && meta !== null) {
    const fine = (meta as Record<string, unknown>)["_drive/turnState"]
    if (typeof fine === "string") return fine
  }
  if (typeof update.state === "string") return update.state
  return undefined
}

export async function waitForTurnEnd(args: WaitForTurnEndArgs): Promise<WaitForTurnEndResult> {
  const timeoutMs = args.timeoutMs ?? 600_000
  const idleTimeoutMs = args.idleTimeoutMs ?? 0
  let frames = 0
  let lastState = "?"
  let sawBusy = false
  const out = (code: 0 | 2 | 3 | 5, why: string, stopReason?: string): WaitForTurnEndResult => ({
    code,
    why,
    ...(stopReason !== undefined ? { stopReason } : {}),
    frames,
    lastState,
  })
  let lastFrameAt = Date.now()
  if (args.file && existsSync(args.file)) return out(0, `file already exists: ${args.file}`)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs)
  let fileTimer: ReturnType<typeof setInterval> | undefined
  if (args.file) {
    const file = args.file
    fileTimer = setInterval(() => {
      if (existsSync(file)) ctrl.abort("file")
    }, 3000)
  }
  let idleTimer: ReturnType<typeof setInterval> | undefined
  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(() => {
      if (sawBusy && Date.now() - lastFrameAt > idleTimeoutMs) ctrl.abort("idle")
    }, 2000)
  }
  const stop = (): void => {
    clearTimeout(timer)
    if (fileTimer) clearInterval(fileTimer)
    if (idleTimer) clearInterval(idleTimer)
  }

  let res: Response
  try {
    res = await fetch(`${args.base}/api/agents/${args.agent}/events`, { signal: ctrl.signal })
  } catch {
    stop()
    return out(3, "stream did not open")
  }
  if (!res.ok) {
    stop()
    return out(3, `stream rejected: HTTP ${res.status}`)
  }
  const body = res.body
  if (!body) {
    stop()
    return out(3, "stream has no body")
  }

  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        stop()
        return out(3, "stream closed without end — agent died or disconnected")
      }
      buf += dec.decode(value, { stream: true })
      let i = buf.indexOf("\n")
      while (i >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.startsWith("data:")) {
          frames++
          lastFrameAt = Date.now()
          const raw = line.slice(5).trim()
          if (args.marker && raw.includes(args.marker)) {
            stop()
            return out(0, `marker seen: "${args.marker}"`)
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            i = buf.indexOf("\n")
            continue
          }
          for (const item of updatesFromSseData(parsed)) {
            const u = sessionUpdateOf(item)
            if (u?.sessionUpdate !== "state_update") continue
            lastState = turnStateOf(u) ?? lastState
            if (u.state === "running") sawBusy = true
            else if (u.state === "idle" && sawBusy) {
              stop()
              const stopReason = typeof u.stopReason === "string" ? u.stopReason : "?"
              return out(0, "turn ended", stopReason)
            }
          }
        }
        i = buf.indexOf("\n")
      }
    }
  } catch (e) {
    stop()
    const why = ctrl.signal.reason
    if (why === "file") return out(0, `file created: ${args.file}`)
    if (why === "timeout") return out(2, "overall timeout — retry")
    if (why === "idle")
      return out(5, `silent ${Math.round(idleTimeoutMs / 1000)}s — turn open and stuck`)
    return out(3, `stream cut: ${String(e).slice(0, 80)}`)
  }
}
