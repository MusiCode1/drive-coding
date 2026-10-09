/**
 * codex-acp-startup.ts — prepare codex ACP config (preserve developer_instructions) and start server.
 *
 * Async work lives here so connect-codex-in-process stays sync (lint impurity / no await).
 */

import { type ChildProcess, spawn } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { startAcpServer } from "@musicode1/codex-acp/lib"
import { createLogger } from "@drive-coding/core/log"

const log = createLogger("provider.codex.startup")

const DEFAULT_READ_TIMEOUT_MS = 20_000

/** `projects={ "<cwd>" = { trust_level = "trusted" } }` — embedded table (dot paths break dotted keys). */
export function projectTrustConfigArg(cwd: string): string {
  const escaped = cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `projects={ "${escaped}" = { trust_level = "trusted" } }`
}

/** existing then ours, separated by `\n\n`, each once. Both empty ⇒ undefined. */
export function composeDeveloperInstructions(
  existing: string | null,
  ours: string | null | undefined,
): string | undefined {
  const parts: string[] = []
  const ex = existing?.trim()
  if (ex) parts.push(ex)
  const mine = ours?.trim()
  if (mine) parts.push(mine)
  if (parts.length === 0) return undefined
  return parts.join("\n\n")
}

function killQuiet(child: ChildProcess | undefined): void {
  if (!child || child.killed) return
  try {
    child.kill()
  } catch {
    /* fail-open */
  }
}

/** Effective developer_instructions for cwd, or null. Never throws; silent paths kill the child. */
export function readEffectiveDeveloperInstructions(opts: {
  cwd: string
  codexPath?: string
  timeoutMs?: number
}): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS
  const bin = opts.codexPath ?? "codex"
  const trustArg = projectTrustConfigArg(opts.cwd)

  return new Promise((resolve) => {
    let settled = false
    let child: ChildProcess | undefined

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killQuiet(child)
      resolve(value)
    }

    try {
      child = spawn(bin, ["app-server", "-c", trustArg], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      })
    } catch {
      finish(null)
      return
    }

    child.on("error", () => finish(null))

    const timer = setTimeout(() => finish(null), timeoutMs)

    let buf = ""
    const send = (payload: unknown) => {
      try {
        child?.stdin?.write(`${JSON.stringify(payload)}\n`)
      } catch {
        finish(null)
      }
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        let msg: { id?: number; result?: { config?: { developer_instructions?: unknown } }; error?: unknown }
        try {
          msg = JSON.parse(line) as typeof msg
        } catch {
          finish(null)
          return
        }
        if (msg.error !== undefined && msg.error !== null) {
          finish(null)
          return
        }
        if (msg.id === 1) {
          send({ id: 2, method: "config/read", params: { cwd: opts.cwd, includeLayers: true } })
        } else if (msg.id === 2) {
          const di = msg.result?.config?.developer_instructions
          finish(typeof di === "string" && di.length > 0 ? di : null)
          return
        }
      }
    })

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "dc-codex-startup", title: "dc-codex-startup", version: "0.0.0" },
      },
    })
  })
}

/** Sync entry: prepares config then starts codex-acp; startup failures go to onStartupError. */
export function startCodexAcp(deps: {
  serverIn: Readable & Writable
  serverOut: Readable & Writable
  cwd: string
  codexPath?: string
  instructions?: string
  isClosed: () => boolean
  onStartupError: (err: unknown) => void
}): void {
  void (async () => {
    try {
      let config: { developer_instructions: string } | undefined
      const ours = deps.instructions?.trim() ? deps.instructions.trim() : undefined

      if (ours) {
        const existing = await readEffectiveDeveloperInstructions({
          cwd: deps.cwd,
          codexPath: deps.codexPath,
        })
        const composed = composeDeveloperInstructions(existing, ours)
        if (composed !== undefined) {
          config = { developer_instructions: composed }
        }
      }

      if (deps.isClosed()) return

      startAcpServer(deps.serverIn, deps.serverOut, {
        codexPath: deps.codexPath,
        config,
      })
    } catch (err) {
      log.warn({ err }, "codex ACP startup failed")
      deps.onStartupError(err)
    }
  })()
}
