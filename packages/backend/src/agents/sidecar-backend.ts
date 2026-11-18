/**
 * sidecar-backend.ts — the two ways a sidecar can hold an agent.
 *
 * Both present the same line-oriented surface, so the socket relay above them
 * does not care which one it has:
 *
 *   pipe    the CLI is a child process speaking ACP on stdio; we forward bytes
 *   hosted  the provider's adapter runs *in this process* and we forward lines
 *           to it directly
 *
 * ─── Why both exist ──────────────────────────────────────────────────────────
 *
 * `claude` can be run either way, and the choice is a real trade rather than a
 * leftover:
 *
 * | | pipe | hosted |
 * |---|---|---|
 * | `_drive/getQuota` · `setThinkingTokens` | ❌ `-32601` (measured) | ✅ |
 * | an adapter crash takes down… | a grandchild | the sidecar, and the agent |
 * | memory | a separate process | the SDK linked into ours |
 *
 * The two extension methods need direct access to the SDK object, which only an
 * in-process adapter has — that is the whole reason hosted mode exists. Pipe
 * mode buys isolation instead, which is the trade the acp-bridge-worker
 * pre-brief weighed for a worker and resolved the same way.
 *
 * ⚠️ Either way the per-agent environment problem is solved, because the sidecar
 * is its own process. That was the original motivation for that pre-brief, and
 * it falls out of moving the adapter out of the backend rather than out of any
 * choice made here.
 */

import { spawn } from "node:child_process"
import { createLogger } from "@drive-coding/core/log"
import { getCliCommand, getCliSpec, resolveVendoredAcpBridge } from "@drive-coding/provider/config"
import {
  connectCodexInProcess,
  connectInProcess,
  type ProviderConnection,
} from "@drive-coding/provider/connection"

const log = createLogger("sidecar.backend")

/** Adapters this process can host directly, keeping the `_drive/*` methods. */
const HOSTABLE: Record<
  string,
  (opts: { cwd: string; modelOverride?: string | null }) => Promise<ProviderConnection>
> = {
  claude: connectInProcess,
  codex: connectCodexInProcess,
}

export type SidecarMode = "pipe" | "hosted"

/** Hosted when we can — it is the only mode that keeps every method working. */
export function defaultModeFor(cliKind: string): SidecarMode {
  return cliKind in HOSTABLE ? "hosted" : "pipe"
}

export type AgentBackend = {
  readonly mode: SidecarMode
  /** The CLI's pid in pipe mode; null when the adapter is hosted here. */
  readonly cliPid: number | null
  onLine(cb: (line: string) => void): void
  write(line: string): void
  /** Fires when the agent goes away on its own. */
  onExit(cb: (code: number | null) => void): void
  close(): Promise<void>
}

/** Split a byte stream into complete lines. Chunk boundaries land mid-line. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buf = ""
  return (chunk: string) => {
    buf += chunk
    let nl = buf.indexOf("\n")
    while (nl !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line !== "") onLine(line)
      nl = buf.indexOf("\n")
    }
  }
}

/** pipe mode: spawn the CLI and forward bytes both ways. */
export function pipeBackend(opts: {
  cliKind: string
  cwd: string
  agentId: string
  modelOverride: string | null
}): AgentBackend {
  // The bundled ACP bridge beats the spec's `npx …@latest` — see acp-bridge.ts.
  const cli =
    resolveVendoredAcpBridge(opts.cliKind) ?? getCliCommand(opts.cliKind, opts.modelOverride)

  // Same env shaping spawn-core applies (cli-spec-env-parity): a spec may need a
  // variable removed as much as added.
  const env: NodeJS.ProcessEnv = { ...process.env, DRIVE_CODING_AGENT_ID: opts.agentId }
  const spec = getCliSpec(opts.cliKind, process.env)
  for (const key of spec?.unsetEnv ?? []) delete env[key]
  if (spec?.setEnv) Object.assign(env, spec.setEnv)

  const child = spawn(cli.bin, [...cli.args], {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  log.info({ pid: child.pid, bin: cli.bin }, "pipe backend spawned")

  // stderr is the CLI's diagnostics — to our journal, never into the ACP stream
  // where it would corrupt framing.
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (t: string) => log.warn({ text: t.trimEnd() }, "child stderr"))
  child.stdout.setEncoding("utf8")

  return {
    mode: "pipe",
    get cliPid() {
      return child.pid ?? null
    },
    onLine(cb) {
      child.stdout.on("data", lineSplitter(cb))
    },
    write(line) {
      child.stdin.write(line.endsWith("\n") ? line : `${line}\n`)
    },
    onExit(cb) {
      child.on("exit", (code) => cb(code))
    },
    async close() {
      child.kill("SIGTERM")
    },
  }
}

/** hosted mode: run the provider's adapter here, keeping every ACP method. */
export async function hostedBackend(opts: {
  cliKind: string
  cwd: string
  agentId: string
  modelOverride: string | null
}): Promise<AgentBackend> {
  const connect = HOSTABLE[opts.cliKind]
  if (connect === undefined) throw new Error(`sidecar: ${opts.cliKind} cannot be hosted in-process`)
  const conn = await connect({ cwd: opts.cwd, modelOverride: opts.modelOverride })
  log.info({ cliKind: opts.cliKind }, "hosted backend started")

  const exitCbs: Array<(code: number | null) => void> = []
  conn.onCrash(() => {
    for (const cb of exitCbs) cb(null)
  })

  return {
    mode: "hosted",
    // Deliberately null: there is no separate CLI process to point at. The pid
    // that identifies this agent is the sidecar's own, which the ping reports.
    cliPid: null,
    onLine(cb) {
      conn.wire.onLine(cb)
    },
    write(line) {
      conn.wire.write(line.endsWith("\n") ? line : `${line}\n`)
    },
    onExit(cb) {
      exitCbs.push(cb)
    },
    async close() {
      await conn.close()
    },
  }
}

export async function createBackend(opts: {
  cliKind: string
  cwd: string
  agentId: string
  modelOverride: string | null
  mode?: SidecarMode
}): Promise<AgentBackend> {
  const mode = opts.mode ?? defaultModeFor(opts.cliKind)
  return mode === "hosted" ? hostedBackend(opts) : pipeBackend(opts)
}
