import { afterEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  connectClaude: vi.fn(),
  connectCodex: vi.fn(),
  getCliSpec: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("@drive-coding/provider/config", () => ({
  getCliCommand: () => ({ bin: "fake-acp", args: [] }),
  getCliSpec: mocks.getCliSpec,
  resolveVendoredAcpBridge: () => undefined,
}))
vi.mock("@drive-coding/provider/connection", () => ({
  connectInProcess: mocks.connectClaude,
  connectCodexInProcess: mocks.connectCodex,
}))

import { createBackend } from "../src/agents/sidecar-backend.js"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

const opts = { cwd: "/tmp", agentId: "synthetic", modelOverride: null }
const agentEnv = { REINSERTED: "agent", OVERRIDDEN: "agent", CLI_SPECS_JSON: "agent-only" }

it("applies the pipe payload after CLI spec unsets and overrides", async () => {
  vi.stubEnv("REINSERTED", "server")
  vi.stubEnv("SERVER_ONLY", "server")
  vi.stubEnv("CLI_SPECS_JSON", "control specs")
  mocks.getCliSpec.mockImplementation((_cli, env: NodeJS.ProcessEnv) => {
    expect(env.CLI_SPECS_JSON).toBe("control specs")
    return {
      unsetEnv: ["REINSERTED", "SERVER_ONLY"],
      setEnv: { OVERRIDDEN: "spec", SPEC_ONLY: "spec" },
    }
  })
  mocks.spawn.mockReturnValue({
    stderr: { setEncoding: vi.fn(), on: vi.fn() },
    stdout: { setEncoding: vi.fn() },
  })

  await createBackend({ ...opts, cliKind: "cursor", mode: "pipe", agentEnv })

  const childEnv: NodeJS.ProcessEnv = mocks.spawn.mock.calls[0]?.[2].env
  expect(childEnv).toMatchObject({
    ...agentEnv,
    SPEC_ONLY: "spec",
    DRIVE_CODING_AGENT_ID: opts.agentId,
  })
  expect(childEnv).not.toHaveProperty("SERVER_ONLY")
  expect(process.env.CLI_SPECS_JSON).toBe("control specs")
})

it.each([
  ["claude", mocks.connectClaude],
  ["codex", mocks.connectCodex],
])("passes the hosted payload to the %s adapter", async (cliKind, connect) => {
  connect.mockResolvedValue({ onCrash: vi.fn() })
  const backend = await createBackend({ ...opts, cliKind, mode: "hosted", agentEnv })
  expect(backend.mode).toBe("hosted")
  expect(connect).toHaveBeenCalledExactlyOnceWith({
    cwd: opts.cwd,
    modelOverride: opts.modelOverride,
    agentEnv,
  })
})
