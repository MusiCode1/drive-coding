import { afterEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connectSidecar: vi.fn(),
  connectSpawn: vi.fn(),
  connectClaude: vi.fn(),
  connectCodex: vi.fn(),
}))

vi.mock("../src/agents/agent-launcher.js", () => ({ launchOrAttachAgent: mocks.launch }))
vi.mock("../src/agents/deployment-dir.js", () => ({
  deploymentDir: () => "/synthetic",
  ensureDeploymentDir: (dir: string) => dir,
}))
vi.mock("@drive-coding/provider/config", () => ({ loadCliSpecsOverride: () => ({}) }))
vi.mock("@drive-coding/provider/connection", () => ({
  connectSidecar: mocks.connectSidecar,
  connectSpawn: mocks.connectSpawn,
  connectInProcess: mocks.connectClaude,
  connectCodexInProcess: mocks.connectCodex,
}))

import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
import {
  IN_PROCESS_CONNECTORS,
  openProviderConnection,
  type ProviderRoute,
  selectProviderRoute,
} from "../src/acp/open-connection.js"

const agentEnv = { BDS_SLICE: "sandbox-probe" }
const opts = {
  cwd: "/tmp",
  agentEnv,
  shapeEnv: (_kind: string, base: NodeJS.ProcessEnv) => ({ ...base, ...agentEnv }),
}

const cliByRoute = {
  sidecar: "claude",
  inProcess: "claude",
  spawn: "cursor",
} satisfies Record<ProviderRoute, SpawnBridgeInput["cliKind"]>

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

it.each(Object.keys(cliByRoute) as ProviderRoute[])(
  "delivers the env at the %s route boundary",
  async (route) => {
    const cli = cliByRoute[route]
    vi.stubEnv("AGENT_SIDECAR", route === "sidecar" ? cli : "")
    mocks.launch.mockResolvedValue({
      kind: "attached",
      socket: "/synthetic/agent.sock",
      probe: { state: "alive" },
    })

    expect(selectProviderRoute(cli)).toBe(route)
    await openProviderConnection("synthetic", cli, opts)
    switch (route) {
      case "sidecar":
        expect(mocks.launch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentEnv }))
        expect(mocks.connectSidecar).toHaveBeenCalledOnce()
        expect(mocks.connectClaude).not.toHaveBeenCalled()
        break
      case "inProcess":
        expect(mocks.connectClaude).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ agentEnv }),
        )
        break
      case "spawn":
        expect(mocks.connectSpawn).toHaveBeenCalledExactlyOnceWith(
          cli,
          expect.objectContaining({
            shapeEnv: expect.any(Function),
          }),
        )
        expect(mocks.connectSpawn.mock.calls[0]?.[1].shapeEnv(cli, {})).toEqual(agentEnv)
        break
    }
  },
)

it("covers exactly the in-process adapter map and delivers the env to each adapter", async () => {
  const expected = { claude: mocks.connectClaude, codex: mocks.connectCodex }
  expect(Object.keys(IN_PROCESS_CONNECTORS).sort()).toEqual(Object.keys(expected).sort())
  vi.stubEnv("AGENT_SIDECAR", "")
  for (const [cli, connect] of Object.entries(expected)) {
    await openProviderConnection("synthetic", cli, opts)
    expect(connect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentEnv }))
  }
})
