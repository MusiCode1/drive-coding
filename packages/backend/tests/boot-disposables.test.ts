/**
 * boot-disposables.test.ts — C2 TDD: createDeps registers pre-serve disposables.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDeps } from "../src/boot/deps.js"

let historyDir: string

afterEach(() => {
  if (historyDir) rmSync(historyDir, { recursive: true, force: true })
})

function bootConfig() {
  historyDir = mkdtempSync(join(tmpdir(), "dc-boot-hist-"))
  return { historyDbFile: join(historyDir, "sessions.sqlite") }
}

describe("createDeps disposables", () => {
  it("registers memoryGuard, httpSweep, connectionRegistry, stopWatching, usageStore", async () => {
    const app = new Hono()
    const { deps, disposables } = await createDeps(bootConfig(), process.env, app)
    const names = disposables.map((d) => d.name)
    expect(names).toContain("memoryGuard")
    expect(names).toContain("httpSweep")
    expect(names).toContain("connectionRegistry")
    expect(names).toContain("stopWatching")
    expect(names).toContain("usageStore")
    expect(names).toContain("sessionHistoryStore")
    expect(deps.tokenUsageStore).toBeDefined()
  })

  it("memoryGuard disposable calls stop()", async () => {
    const app = new Hono()
    const { deps, disposables } = await createDeps(bootConfig(), process.env, app)
    const stopSpy = vi.spyOn(deps.memoryGuard, "stop")
    const mg = disposables.find((d) => d.name === "memoryGuard")
    expect(mg).toBeDefined()
    mg!.dispose()
    expect(stopSpy).toHaveBeenCalledOnce()
  })

  it("httpSweep disposable calls agentSessionRegistry.stop()", async () => {
    const app = new Hono()
    const { deps, disposables } = await createDeps(bootConfig(), process.env, app)
    const stopSpy = vi.spyOn(deps.agentSessionRegistry, "stop")
    const sweep = disposables.find((d) => d.name === "httpSweep")
    expect(sweep).toBeDefined()
    sweep!.dispose()
    expect(stopSpy).toHaveBeenCalledOnce()
  })

  it("deps.env is the same reference as passed env", async () => {
    const app = new Hono()
    const env = { TEST_BOOT_LAYER: "1" }
    const { deps } = await createDeps(bootConfig(), env, app)
    expect(deps.env).toBe(env)
  })
})
