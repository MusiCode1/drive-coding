/**
 * agents-store.path.test.ts — where the snapshot is written.
 *
 * The precedence is the point: a test harness that builds deps by hand passes
 * `{}` as config, and without the env layer being consulted here it would write
 * into the live deployment's state directory.
 */

import * as os from "node:os"
import { describe, expect, it } from "vitest"
import { resolveAgentsStoreFile } from "../src/agents/agents-store.js"

describe("resolveAgentsStoreFile", () => {
  it("config wins over env", () => {
    const file = resolveAgentsStoreFile(
      { agentsStoreFile: "/a/from-config.json" },
      { AGENTS_STORE_FILE: "/b/from-env.json" },
      4000,
    )
    expect(file).toBe("/a/from-config.json")
  })

  it("env is used when the config leaf is absent", () => {
    expect(resolveAgentsStoreFile({}, { AGENTS_STORE_FILE: "/b/from-env.json" }, 4000)).toBe(
      "/b/from-env.json",
    )
  })

  it("an empty env value is treated as unset, not as the file '' ", () => {
    expect(resolveAgentsStoreFile({ port: 4002 }, { AGENTS_STORE_FILE: "" }, 4000)).toMatch(
      /4002\.json$/,
    )
  })

  it("falls back to <stateDir>/agents/<port>.json", () => {
    const file = resolveAgentsStoreFile({ port: 4002 }, {}, 4000)
    expect(file.startsWith(os.homedir())).toBe(true)
    expect(file).toMatch(/agents[/\\]4002\.json$/)
  })

  it("🔴 uses the fallback port so two deployments never share a file", () => {
    const a = resolveAgentsStoreFile({ port: 4001 }, {}, 4000)
    const b = resolveAgentsStoreFile({ port: 4002 }, {}, 4000)
    expect(a).not.toBe(b)
    expect(resolveAgentsStoreFile({}, {}, 4000)).toMatch(/4000\.json$/)
  })
})
