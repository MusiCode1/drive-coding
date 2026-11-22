import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn() },
}))

vi.mock("node:child_process", () => ({ spawn: mocks.spawn, spawnSync: mocks.spawnSync }))
vi.mock("@drive-coding/core/log", () => ({ createLogger: () => mocks.log }))
vi.mock("../src/agents/agent-sockets.js", () => ({
  agentSocketPath: () => "/tmp/agent.sock",
  probeAgentSocket: mocks.probe,
}))

import { buildAgentIdentityEnv } from "../src/agent-identity.js"
import { launchOrAttachAgent } from "../src/agents/agent-launcher.js"
import { consumeSidecarAgentEnv } from "../src/agents/sidecar-agent-env.js"
import { buildChildBaseEnv } from "../src/app/agent-orchestrator.js"

const baseOpts = { agentId: "synthetic", cliKind: "cursor", cwd: "/tmp", socketDir: "/tmp" }
const controlEnv = { XDG_RUNTIME_DIR: "/run/user/synthetic", PATH: "/bin", SERVER_ONLY: "server" }
const payload = {
  CLI_SPECS_JSON: "synthetic override",
  SAMPLE: "variable with\nspaces = and unicode 🐚",
  EMPTY: "",
}
const key = "DC_SIDECAR_AGENT_ENV"
const encoded = Buffer.from(JSON.stringify(payload)).toString("base64")

function launchWithSystemd(result: { status: number | null; stderr?: string; error?: Error }) {
  mocks.probe.mockResolvedValue({ state: "absent" })
  mocks.spawnSync.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce(result)
  return launchOrAttachAgent({ ...baseOpts, agentEnv: payload, env: controlEnv })
}

afterEach(() => vi.resetAllMocks())

describe("sidecar launch env", () => {
  it.skipIf(process.platform !== "linux")(
    "passes only allowlisted control env and the payload as systemd arguments",
    async () => {
      const result = await launchWithSystemd({ status: 0 })
      expect(result.kind).toBe("launched")
      const args: string[] = mocks.spawnSync.mock.calls[1]?.[1]
      const settings = args.filter((arg) => arg.startsWith("--setenv="))
      expect(settings.map((arg) => arg.slice(9, arg.indexOf("=", 9)))).toEqual([
        "PATH",
        "XDG_RUNTIME_DIR",
        key,
      ])
      expect(settings.some((arg) => arg === `--setenv=${key}=${encoded}`)).toBe(true)
    },
  )

  it("preserves the control environment in the fallback and uses a separate payload", async () => {
    mocks.probe.mockResolvedValue({ state: "absent" })
    const unref = vi.fn()
    mocks.spawn.mockReturnValue({ unref })
    const env = { ...controlEnv, XDG_RUNTIME_DIR: "", CLI_SPECS_JSON: "server specs" }
    const result = await launchOrAttachAgent({ ...baseOpts, agentEnv: payload, env })
    expect(result).toMatchObject({ kind: "launched", unit: null })
    const childEnv: NodeJS.ProcessEnv = mocks.spawn.mock.calls[0]?.[2].env
    expect(childEnv.CLI_SPECS_JSON).toBe("server specs")
    expect(childEnv.SERVER_ONLY).toBe("server")
    expect(childEnv[key] === encoded).toBe(true)
    expect(unref).toHaveBeenCalledOnce()
  })

  it.skipIf(process.platform !== "linux").each(["stderr", "spawn error"])(
    "omits encoded env from the returned reason and logs on %s",
    async (mode) => {
      const arg = `--setenv=${key}=${encoded}`
      const spawnError = Object.assign(new Error(`failed: ${arg}`), {
        code: "ENOENT",
        syscall: "spawnSync systemd-run",
        spawnargs: [arg],
      })
      const result = await launchWithSystemd(
        mode === "stderr"
          ? { status: 1, stderr: `invalid option: ${arg} and again ${encoded}` }
          : { status: null, error: spawnError },
      )
      expect(result.kind).toBe("failed")
      expect(mocks.log.warn).toHaveBeenCalledOnce()
      expect(JSON.stringify(result).includes(encoded)).toBe(false)
      expect(JSON.stringify(mocks.log.warn.mock.calls).includes(encoded)).toBe(false)
      expect(result.kind === "failed" && result.reason).toContain(
        mode === "stderr" ? "<redacted>" : "ENOENT",
      )
    },
  )

  it("admits a boundary-sized input after adding server identity and base keys", async () => {
    mocks.probe.mockResolvedValue({ state: "absent" })
    mocks.spawn.mockReturnValue({ unref: vi.fn() })
    const input = { PADDING: "x".repeat(46_066) }
    expect(Buffer.from(JSON.stringify(input)).toString("base64").length).toBe(61_440)
    const agentId = "00000000-0000-4000-a000-000000000000"
    const longHost = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".")
    const agentEnv = {
      ...input,
      ...buildAgentIdentityEnv(agentId),
      ...buildChildBaseEnv({ host: longHost, port: 65535 }),
    }
    const result = await launchOrAttachAgent({ ...baseOpts, agentId, agentEnv, env: {} })
    expect(result.kind).toBe("launched")
    const childEnv: NodeJS.ProcessEnv = mocks.spawn.mock.calls[0]?.[2].env
    expect(childEnv[key]?.length).toBeGreaterThan(61_440)
    expect(childEnv[key]?.length).toBeLessThanOrEqual(65_536)
  })

  it("rejects a final payload above the launcher's limit before spawning", async () => {
    mocks.probe.mockResolvedValue({ state: "absent" })
    const result = await launchOrAttachAgent({ ...baseOpts, agentEnv: { X: "x".repeat(50_000) } })
    expect(result).toMatchObject({ kind: "failed", reason: "sidecar agent env too large" })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it.each([
    ["absent", "gone"],
    ["stale", "gone"],
    ["wedged", "failed"],
    ["unknown", "failed"],
  ])("never launches on attachOnly when the probe is %s", async (state, kind) => {
    mocks.probe.mockResolvedValue({ state })
    const result = await launchOrAttachAgent({ ...baseOpts, intent: "attachOnly" })
    expect(result.kind).toBe(kind)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("attaches without handing any payload to an existing sidecar", async () => {
    mocks.probe.mockResolvedValue({ state: "alive" })
    const result = await launchOrAttachAgent({ ...baseOpts, agentEnv: payload })
    expect(result.kind).toBe("attached")
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })
})

describe("consuming the sidecar payload", () => {
  it("decodes multiline and empty values, leaving control env intact", () => {
    const env = { CLI_SPECS_JSON: "server specs", [key]: encoded }
    const decoded = consumeSidecarAgentEnv(env)
    expect(JSON.stringify(decoded) === JSON.stringify(payload)).toBe(true)
    expect(env).toEqual({ CLI_SPECS_JSON: "server specs" })
  })

  it("allows legacy launches without a payload", () => {
    expect(consumeSidecarAgentEnv({})).toBeUndefined()
  })

  it.each(["", "bad base64", Buffer.from('{"key":42}').toString("base64")])(
    "returns a fixed diagnostic for malformed payload %#",
    (value) => {
      const env = { [key]: value }
      expect(() => consumeSidecarAgentEnv(env)).toThrow(/^invalid DC_SIDECAR_AGENT_ENV$/)
      expect(Object.hasOwn(env, key)).toBe(false)
    },
  )
})
