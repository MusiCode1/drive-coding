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
}

/**
 * Spawn stdio-to-ws + reads stdout until port is detected.
 * Throws if port not detected within timeoutMs or process exits.
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

  return new Promise<SpawnResult>((resolve, reject) => {
    let resolved = false
    let stdoutBuf = ""
    let stderrBuf = ""

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        child.kill("SIGTERM")
        reject(
          new Error(
            `Port not detected within ${timeout}ms. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrBuf.slice(0, 500)}`,
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
          resolve({ child, port, pid: child.pid ?? 0 })
          return
        }
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8")
    })

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutHandle)
        reject(
          new Error(
            `Process exited (code=${code}) before port detected. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrBuf.slice(0, 500)}`,
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
