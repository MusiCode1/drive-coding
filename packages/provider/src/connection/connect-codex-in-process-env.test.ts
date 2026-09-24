import childProcess from "node:child_process"
import { EventEmitter } from "node:events"
import { syncBuiltinESMExports } from "node:module"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectCodexInProcess } from "./connect-codex-in-process.js"
import type { ProviderConnection } from "./types.js"

const spawnMock = vi.fn()

// Keep the real codex-acp library: mocking startAcpServer would miss broken
// adapter env support. Only replace the OS process boundary (no model or login).

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: true,
    exitCode: 0,
  })
}

const children: ReturnType<typeof fakeChild>[] = []
const connections: ProviderConnection[] = []

function spawnedEnv(index = 0): NodeJS.ProcessEnv {
  const args = spawnMock.mock.calls[index]
  // Windows passes the command through a shell; POSIX uses a separate argv.
  const options = args?.[process.platform === "win32" ? 1 : 2] as {
    env: NodeJS.ProcessEnv
  }
  return options.env
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("CODEX_PATH", "/test/codex")
  vi.stubEnv("DRIVE_CODING_AGENT_ID", "parent-id")
  vi.stubEnv("DC_ENV_INHERITED_TEST", "inherited")
  vi.stubEnv("APP_SERVER_LOGS", "")
  vi.stubEnv("CODEX_CONFIG", "")
  vi.stubEnv("DEFAULT_AUTH_REQUEST", "")
  spawnMock.mockReset().mockImplementation(() => {
    const child = fakeChild()
    children.push(child)
    return child
  })
  vi.spyOn(childProcess, "spawn").mockImplementation(spawnMock)
  // The published bundle is external to Vitest's module-mocking pipeline.
  syncBuiltinESMExports()
})

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close()
  for (const child of children.splice(0)) {
    child.emit("exit", 0)
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  syncBuiltinESMExports()
})

describe("Codex per-agent env reaches the app-server spawn", () => {
  it("overlays agent identity and base URL while preserving inherited env", async () => {
    const agentEnv = {
      DRIVE_CODING_AGENT_ID: "agent-a",
      DRIVE_CODING_BASE: "http://127.0.0.1:4321",
      DC_BASE: "http://127.0.0.1:4321",
      DC_ENV_EMPTY_TEST: "",
    }
    const parentEnv = { ...process.env }
    connections.push(await connectCodexInProcess({ cwd: process.cwd(), agentEnv }))

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnedEnv()).toMatchObject({ ...agentEnv, DC_ENV_INHERITED_TEST: "inherited" })
    expect(spawnedEnv()).not.toBe(process.env)
    expect(process.env).toEqual(parentEnv)
    expect(agentEnv).not.toHaveProperty("DC_ENV_INHERITED_TEST")
  })

  it("keeps concurrent agents' overrides isolated from one another and the parent", async () => {
    const parentEnv = { ...process.env }
    connections.push(
      ...(await Promise.all(
        ["agent-a", "agent-b"].map((id) =>
          connectCodexInProcess({
            cwd: process.cwd(),
            agentEnv: { DRIVE_CODING_AGENT_ID: id, DC_TOKEN: `test-token-${id}` },
          }),
        ),
      )),
    )

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnedEnv(0)).toMatchObject({
      DRIVE_CODING_AGENT_ID: "agent-a",
      DC_TOKEN: "test-token-agent-a",
    })
    expect(spawnedEnv(1)).toMatchObject({
      DRIVE_CODING_AGENT_ID: "agent-b",
      DC_TOKEN: "test-token-agent-b",
    })
    expect(spawnedEnv(0)).not.toBe(spawnedEnv(1))
    expect(process.env).toEqual(parentEnv)
  })

  it("preserves normal environment inheritance when agentEnv is omitted", async () => {
    connections.push(await connectCodexInProcess({ cwd: process.cwd() }))
    expect(spawnedEnv()).toMatchObject({
      DRIVE_CODING_AGENT_ID: "parent-id",
      DC_ENV_INHERITED_TEST: "inherited",
    })
  })
})
