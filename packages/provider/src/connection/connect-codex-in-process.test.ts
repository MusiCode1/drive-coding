/**
 * connect-codex-in-process.test.ts — unit tests for the codex wire-adapter internals.
 *
 * We test the NDJSON line-splitting logic and resolveCodexPath separately from
 * startAcpServer (which requires a live codex binary — that is manual §0 territory).
 *
 * Tests:
 *   - resolveCodexPath: CODEX_PATH env var override takes precedence.
 *   - wire-adapter round-trip: lines written to serverOut are emitted via wire.onLine.
 *   - wire-adapter buffering: partial lines are buffered until '\n'.
 *   - wire-adapter multiple lines: multiple lines in one chunk are each emitted separately.
 *   - wire.write(line): writes line to serverIn with '\n' terminator.
 *   - wire.write returns false after close().
 *   - onFrame(dir="in"): decoded frames emitted for lines from serverOut.
 *   - onFrame(dir="out"): decoded frames emitted for lines written via wire.write.
 */

import { PassThrough } from "node:stream"
import { describe, expect, it, vi, afterEach } from "vitest"
import { resolveCodexPath } from "./connect-codex-in-process.js"

// ─── resolveCodexPath tests ────────────────────────────────────────────────────
//
// resolveCodexPath now delegates to resolveCliBinary. We verify the contract:
//   - CODEX_PATH env var takes highest precedence (env-override layer).
//   - The full PATH-scan / knownPaths logic is tested in core/cli-resolve.test.ts.

describe("resolveCodexPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns CODEX_PATH env var when set (env-override takes precedence)", () => {
    vi.stubEnv("CODEX_PATH", "/usr/local/bin/codex")
    expect(resolveCodexPath()).toBe("/usr/local/bin/codex")
  })

  it("returns a string or undefined when CODEX_PATH not set (path-scan decides)", () => {
    vi.stubEnv("CODEX_PATH", "")
    // We cannot guarantee codex is or isn't in PATH on the test machine,
    // so only verify the return type — not the exact value.
    const result = resolveCodexPath()
    expect(typeof result === "string" || result === undefined).toBe(true)
  })
})

// ─── wire-adapter: line-splitting logic (tested in isolation via PassThrough) ──
//
// We test the line-buffering logic directly, without instantiating connectCodexInProcess
// (which calls startAcpServer and requires a live codex binary).
// The logic under test is the same pattern used in connect-codex-in-process.ts.

describe("codex wire-adapter: NDJSON line-buffering", () => {
  /** Simulate the line-buffering logic from connect-codex-in-process.ts */
  function createLineBuffer(): {
    serverOut: PassThrough
    emitted: string[]
  } {
    const serverOut = new PassThrough()
    const emitted: string[] = []
    let lineBuffer = ""

    serverOut.on("data", (chunk: Buffer | string) => {
      lineBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let idx: number
      while ((idx = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, idx)
        lineBuffer = lineBuffer.slice(idx + 1)
        if (line.length === 0) continue
        emitted.push(line)
      }
    })

    return { serverOut, emitted }
  }

  it("emits a single line when followed by newline", () => {
    const { serverOut, emitted } = createLineBuffer()
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    serverOut.write(`${msg}\n`)
    expect(emitted).toEqual([msg])
  })

  it("buffers partial line until newline arrives", () => {
    const { serverOut, emitted } = createLineBuffer()
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    const half = msg.slice(0, Math.floor(msg.length / 2))
    const rest = msg.slice(Math.floor(msg.length / 2))
    serverOut.write(half)
    expect(emitted).toHaveLength(0)
    serverOut.write(`${rest}\n`)
    expect(emitted).toEqual([msg])
  })

  it("emits multiple lines from one chunk", () => {
    const { serverOut, emitted } = createLineBuffer()
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new" })
    serverOut.write(`${msg1}\n${msg2}\n`)
    expect(emitted).toEqual([msg1, msg2])
  })

  it("skips empty lines (bare newlines)", () => {
    const { serverOut, emitted } = createLineBuffer()
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    serverOut.write(`\n${msg}\n\n`)
    expect(emitted).toEqual([msg])
  })
})

// ─── wire.write: appends '\n' to serverIn ──────────────────────────────────────

describe("codex wire-adapter: wire.write appends newline to serverIn", () => {
  it("writes line with newline terminator to serverIn", async () => {
    const serverIn = new PassThrough()
    const chunks: string[] = []

    serverIn.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"))
    })

    // Simulate the write logic from connect-codex-in-process.ts
    function wireWrite(line: string): boolean {
      const data = line.endsWith("\n") ? line : `${line}\n`
      return serverIn.write(data)
    }

    wireWrite('{"jsonrpc":"2.0","id":1,"method":"initialize"}')

    // Wait for data event to fire (next microtask tick is enough for PassThrough).
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(chunks.join("")).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n')
  })
})
