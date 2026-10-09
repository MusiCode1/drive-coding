/**
 * codex-acp-startup.test.ts — compose, trust arg, fail-open reader, startup facade.
 */

import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const startAcpServerMock = vi.fn()
const spawnMock = vi.fn()

vi.mock("@musicode1/codex-acp/lib", () => ({
  startAcpServer: (...args: unknown[]) => startAcpServerMock(...args),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) }
})

import {
  composeDeveloperInstructions,
  projectTrustConfigArg,
  readEffectiveDeveloperInstructions,
  startCodexAcp,
} from "./codex-acp-startup.js"

function fakeSpawnChild(stdoutLines: string[], opts?: { hang?: boolean; emitError?: boolean }) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    killed: boolean
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
  })

  if (opts?.emitError) {
    queueMicrotask(() => child.emit("error", new Error("spawn failed")))
    return child
  }

  if (!opts?.hang) {
    queueMicrotask(() => {
      for (const line of stdoutLines) {
        child.stdout.emit("data", `${line}\n`)
      }
    })
  }

  return child
}

describe("projectTrustConfigArg", () => {
  it("uses embedded table for paths containing a dot", () => {
    const cwd = "/tmp/foo.worktrees/bar"
    const arg = projectTrustConfigArg(cwd)
    expect(arg).toContain('projects={')
    expect(arg).toContain(`"${cwd}"`)
    expect(arg).toContain("trust_level")
    expect(arg).not.toMatch(/projects\.[^=]+\.trust_level/)
  })
})

describe("composeDeveloperInstructions", () => {
  it("joins existing and ours once with blank line", () => {
    expect(composeDeveloperInstructions("USER", "SURFACE")).toBe("USER\n\nSURFACE")
  })

  it("returns only ours when existing is null", () => {
    expect(composeDeveloperInstructions(null, "SURFACE")).toBe("SURFACE")
  })
})

describe("readEffectiveDeveloperInstructions", () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it("returns null when codexPath does not exist (spawn error)", async () => {
    spawnMock.mockImplementation(() => fakeSpawnChild([], { emitError: true }))
    await expect(
      readEffectiveDeveloperInstructions({ cwd: "/tmp/x", codexPath: "/no/such/codex" }),
    ).resolves.toBeNull()
  })

  it("returns null on timeout and kills the child", async () => {
    let captured: ReturnType<typeof fakeSpawnChild> | undefined
    spawnMock.mockImplementation(() => {
      captured = fakeSpawnChild([], { hang: true })
      return captured
    })
    await expect(
      readEffectiveDeveloperInstructions({ cwd: "/tmp/x", codexPath: "codex", timeoutMs: 1 }),
    ).resolves.toBeNull()
    expect(captured?.kill).toHaveBeenCalled()
  })

  it("returns null on config/read error JSON", async () => {
    spawnMock.mockImplementation(() =>
      fakeSpawnChild([
        JSON.stringify({ id: 1, result: {} }),
        JSON.stringify({ id: 2, error: { message: "fail" } }),
      ]),
    )
    await expect(readEffectiveDeveloperInstructions({ cwd: "/tmp/x" })).resolves.toBeNull()
  })

  it("returns null on non-JSON stdout", async () => {
    spawnMock.mockImplementation(() => fakeSpawnChild(["not-json"]))
    await expect(readEffectiveDeveloperInstructions({ cwd: "/tmp/x" })).resolves.toBeNull()
  })
})

describe("startCodexAcp", () => {
  beforeEach(() => {
    startAcpServerMock.mockReset()
    startAcpServerMock.mockImplementation(() => {})
    spawnMock.mockReset()
    spawnMock.mockImplementation(() =>
      fakeSpawnChild([
        JSON.stringify({ id: 1, result: {} }),
        JSON.stringify({
          id: 2,
          result: { config: { developer_instructions: "USER" } },
        }),
      ]),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("passes composed developer_instructions when instructions set", async () => {
    const serverIn = new PassThrough()
    const serverOut = new PassThrough()
    startCodexAcp({
      serverIn,
      serverOut,
      cwd: "/tmp/proj",
      instructions: "SURFACE",
      isClosed: () => false,
      onStartupError: () => {},
    })
    await vi.waitFor(() => expect(startAcpServerMock).toHaveBeenCalled())
    const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: { developer_instructions?: string } }
    expect(opts.config?.developer_instructions).toBe("USER\n\nSURFACE")
  })

  it("leaves config undefined when no instructions and does not spawn reader", async () => {
    const serverIn = new PassThrough()
    const serverOut = new PassThrough()
    startCodexAcp({
      serverIn,
      serverOut,
      cwd: "/tmp/proj",
      isClosed: () => false,
      onStartupError: () => {},
    })
    await vi.waitFor(() => expect(startAcpServerMock).toHaveBeenCalled())
    expect(spawnMock).not.toHaveBeenCalled()
    const opts = startAcpServerMock.mock.calls[0]?.[2] as { config?: unknown }
    expect(opts.config).toBeUndefined()
  })

  it("does not call startAcpServer when isClosed after read", async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeSpawnChild([], { hang: true })
      setTimeout(() => {
        child.stdout.emit("data", `${JSON.stringify({ id: 1, result: {} })}\n`)
        child.stdout.emit(
          "data",
          `${JSON.stringify({ id: 2, result: { config: { developer_instructions: "USER" } } })}\n`,
        )
      }, 30)
      return child
    })
    let shut = false
    startCodexAcp({
      serverIn: new PassThrough(),
      serverOut: new PassThrough(),
      cwd: "/tmp/proj",
      instructions: "SURFACE",
      isClosed: () => shut,
      onStartupError: () => {},
    })
    setTimeout(() => {
      shut = true
    }, 10)
    await new Promise((r) => setTimeout(r, 80))
    expect(startAcpServerMock).not.toHaveBeenCalled()
  })

  it("routes startAcpServer throw to onStartupError", async () => {
    startAcpServerMock.mockImplementation(() => {
      throw new Error("boom")
    })
    const errors: unknown[] = []
    startCodexAcp({
      serverIn: new PassThrough(),
      serverOut: new PassThrough(),
      cwd: "/tmp",
      isClosed: () => false,
      onStartupError: (e) => errors.push(e),
    })
    await vi.waitFor(() => expect(errors.length).toBe(1))
    expect(errors[0]).toBeInstanceOf(Error)
  })
})
