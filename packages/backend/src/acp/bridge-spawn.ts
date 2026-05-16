import { type ChildProcess, spawn } from "node:child_process"

/**
 * Parses port מ-stdout של stdio-to-ws.
 * הPattern: "Listening on ws://127.0.0.1:<port>/" או דומה.
 * Returns number or null.
 */
export function parsePortFromStdout(line: string): number | null {
  // Pattern דוגמאות שעלולים להופיע:
  //   "Listening on ws://127.0.0.1:7100/"
  //   "ws://localhost:7100"
  //   "Server started on port 7100"
  const wsMatch = line.match(/ws:\/\/[\w.]+:(\d+)/)
  if (wsMatch) return Number(wsMatch[1])

  const portMatch = line.match(/(?:port|listening on)\s+(?:port\s+)?(\d{4,5})/i)
  if (portMatch) return Number(portMatch[1])

  return null
}

export type SpawnOptions = {
  readonly bin: string // 'npx' או 'bunx'
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly portTimeoutMs?: number // default 30000
}

export type SpawnResult = {
  readonly child: ChildProcess
  readonly port: number
  readonly pid: number
  /** Returns a snapshot copy of the last ≤200 stderr lines (FIFO). */
  readonly getStderr: () => string[]
}

/**
 * Spawn stdio-to-ws + reads stdout until port is detected.
 * Throws if port not detected within timeoutMs or process exits.
 *
 * stderr is buffered as a rolling FIFO of 200 lines — accessible via
 * `getStderr()` on the returned SpawnResult. Used by agent-orchestrator
 * to extract provider-specific error messages after a crash.
 */
export async function spawnAndWaitForPort(opts: SpawnOptions): Promise<SpawnResult> {
  const timeout = opts.portTimeoutMs ?? 30000

  const child = spawn(opts.bin, [...opts.args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (!child.pid) {
    throw new Error("spawn returned no pid")
  }

  // Rolling FIFO stderr buffer — max 200 lines
  const STDERR_MAX_LINES = 200
  const stderrLines: string[] = []
  let stderrPartial = "" // accumulates chars until newline

  function appendStderrChunk(chunk: Buffer): void {
    const text = stderrPartial + chunk.toString("utf8")
    const parts = text.split("\n")
    // Everything except the last element is a complete line
    for (let i = 0; i < parts.length - 1; i++) {
      stderrLines.push(parts[i] ?? "")
      if (stderrLines.length > STDERR_MAX_LINES) {
        stderrLines.shift()
      }
    }
    // Last element may be partial — keep for next chunk
    stderrPartial = parts[parts.length - 1] ?? ""
  }

  function flushStderrPartial(): void {
    if (stderrPartial.length > 0) {
      stderrLines.push(stderrPartial)
      if (stderrLines.length > STDERR_MAX_LINES) {
        stderrLines.shift()
      }
      stderrPartial = ""
    }
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    let resolved = false
    let stdoutBuf = ""

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        child.kill("SIGTERM")
        flushStderrPartial()
        reject(
          new Error(
            `Port not detected within ${timeout}ms. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrLines.slice(-10).join("\n")}`,
          ),
        )
      }
    }, timeout)

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      stdoutBuf += text
      if (resolved) return

      // נסה לחלץ port מכל שורה חדשה
      for (const line of text.split("\n")) {
        const port = parsePortFromStdout(line)
        if (port !== null) {
          resolved = true
          clearTimeout(timeoutHandle)
          resolve({
            child,
            port,
            pid: child.pid ?? 0,
            getStderr: () => [...stderrLines],
          })
          return
        }
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      appendStderrChunk(chunk)
    })

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutHandle)
        flushStderrPartial()
        reject(
          new Error(
            `Process exited (code=${code}) before port detected. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrLines.slice(-10).join("\n")}`,
          ),
        )
      }
    })

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutHandle)
        reject(err)
      }
    })
  })
}
