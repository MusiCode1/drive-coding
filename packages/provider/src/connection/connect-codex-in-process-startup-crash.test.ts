/**
 * connect-codex-in-process-startup-crash.test.ts — startup throw reaches onCrash after connect returns.
 *
 * Reproduces registry ordering: openProviderConnection resolves before onCrash is subscribed.
 */

import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock("@musicode1/codex-acp/lib", () => ({
  startAcpServer: () => {
    throw new SyntaxError("JSON Parse error")
  },
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) }
})

function fakeSpawnWithConfigRead() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    killed: boolean
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = { write: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn()
  queueMicrotask(() => {
    child.stdout.emit("data", `${JSON.stringify({ id: 1, result: {} })}\n`)
    child.stdout.emit(
      "data",
      `${JSON.stringify({ id: 2, result: { config: { developer_instructions: "USER" } } })}\n`,
    )
  })
  return child
}

describe("connectCodexInProcess — buffered startup crash", () => {
  it("without instructions: onCrash after connect receives buffered startup error", async () => {
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({ cwd: "/tmp" })
    let got: unknown
    conn.onCrash((info) => {
      got = info
    })
    await Promise.resolve()
    expect(got).toBeDefined()
    expect((got as { spawnError?: { message?: string } }).spawnError?.message).toContain(
      "JSON Parse error",
    )
    await conn.close()
  })

  it("with instructions: onCrash after connect receives buffered startup error (async path)", async () => {
    spawnMock.mockImplementation(() => fakeSpawnWithConfigRead())
    const { connectCodexInProcess } = await import("./connect-codex-in-process.js")
    const conn = await connectCodexInProcess({
      cwd: "/tmp",
      agentPrompt: "SURFACE",
    })
    let got: unknown
    conn.onCrash((info) => {
      got = info
    })
    await Promise.resolve()
    await vi.waitFor(() => expect(got).toBeDefined())
    expect((got as { spawnError?: { message?: string } }).spawnError?.message).toContain(
      "JSON Parse error",
    )
    await conn.close()
  })
})
