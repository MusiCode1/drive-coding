/**
 * bridge-writestdin.test.ts — integration test for bridge-manager.writeStdin
 *
 * Verifies:
 *   - writeStdin writes to child.stdin and the child echoes it back via stdout (round-trip)
 *   - writeStdin("nonexistent", ...) returns false
 *
 * Pattern: spawns a real child via createBridgeManager(), using an echo script
 * (process.stdin.on("data", d => process.stdout.write(d))) so we can verify
 * the round-trip through the actual child process.
 */

import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { createBridgeManager } from "../src/acp/bridge-manager.js"

let spawnedChildren: ChildProcessWithoutNullStreams[] = []
let echoScriptPath: string | null = null

function getEchoScript(): string {
  if (!echoScriptPath) {
    const tmpDir = os.tmpdir()
    echoScriptPath = path.join(tmpDir, "acp-echo-writestdin-test.js")
    // Echo script: pipe stdin → stdout (round-trip test)
    fs.writeFileSync(
      echoScriptPath,
      'process.stdin.on("data", (d) => process.stdout.write(d))\n',
      "utf8",
    )
  }
  return echoScriptPath
}

async function spawnEchoBridge(
  bm: ReturnType<typeof createBridgeManager>,
  id: string,
): Promise<void> {
  getEchoScript()
  const origBin = process.env.OPENCODE_BIN
  const origArgs = process.env.OPENCODE_ARGS
  process.env.OPENCODE_BIN = process.execPath
  process.env.OPENCODE_ARGS = JSON.stringify([echoScriptPath as string])
  try {
    await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
  } finally {
    if (origBin === undefined) {
      delete process.env.OPENCODE_BIN
    } else {
      process.env.OPENCODE_BIN = origBin
    }
    if (origArgs === undefined) {
      delete process.env.OPENCODE_ARGS
    } else {
      process.env.OPENCODE_ARGS = origArgs
    }
  }
  const child = bm.getChild(id)
  if (child) spawnedChildren.push(child)
}

afterEach(async () => {
  const waiting: Promise<void>[] = []
  for (const p of spawnedChildren) {
    if (!p.killed && p.exitCode === null) {
      const done = new Promise<void>((resolve) => {
        p.once("exit", () => resolve())
        p.once("error", () => resolve())
      })
      try {
        p.kill("SIGKILL")
      } catch {
        // already dead
      }
      waiting.push(done)
    }
  }
  await Promise.all(waiting)
  spawnedChildren = []
})

describe("bridge-manager writeStdin", () => {
  it("writeStdin round-trip: subscriber receives what was written to stdin", async () => {
    const bm = createBridgeManager()
    const agentId = "writestdin-echo-1"
    await spawnEchoBridge(bm, agentId)

    const received: string[] = []
    bm.onLine(agentId, (line) => {
      received.push(line)
    })

    // Write a line to stdin; the echo script will pipe it to stdout
    // writeStdin expects a line (with or without \n)
    const result = bm.writeStdin(agentId, "hello\n")
    expect(result).toBe(true)

    // Wait for the round-trip through the child process
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(resolve, 3000)
      const check = setInterval(() => {
        if (received.some((l) => l.includes("hello"))) {
          clearInterval(check)
          clearTimeout(deadline)
          resolve()
        }
      }, 10)
    })

    expect(received.some((l) => l.includes("hello"))).toBe(true)
  }, 10000)

  it("writeStdin returns false for nonexistent bridge", () => {
    const bm = createBridgeManager()
    const result = bm.writeStdin("nonexistent-bridge", "hello\n")
    expect(result).toBe(false)
  })
})
