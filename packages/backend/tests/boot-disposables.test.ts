/**
 * boot-disposables.test.ts — C2 TDD: createDeps registers pre-serve disposables.
 */

import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import { createDeps } from "../src/boot/deps.js"

describe("createDeps disposables", () => {
  it("registers memoryGuard, httpSweep, connectionRegistry, stopWatching, usageStore", () => {
    const app = new Hono()
    const { disposables } = createDeps({}, process.env, app)
    const names = disposables.map((d) => d.name)
    expect(names).toContain("memoryGuard")
    expect(names).toContain("httpSweep")
    expect(names).toContain("connectionRegistry")
    expect(names).toContain("stopWatching")
    expect(names).toContain("usageStore")
  })

  it("memoryGuard disposable calls stop()", () => {
    const app = new Hono()
    const { deps, disposables } = createDeps({}, process.env, app)
    const stopSpy = vi.spyOn(deps.memoryGuard, "stop")
    const mg = disposables.find((d) => d.name === "memoryGuard")
    expect(mg).toBeDefined()
    mg!.dispose()
    expect(stopSpy).toHaveBeenCalledOnce()
  })

  it("httpSweep disposable calls agentSessionRegistry.stop()", () => {
    const app = new Hono()
    const { deps, disposables } = createDeps({}, process.env, app)
    const stopSpy = vi.spyOn(deps.agentSessionRegistry, "stop")
    const sweep = disposables.find((d) => d.name === "httpSweep")
    expect(sweep).toBeDefined()
    sweep!.dispose()
    expect(stopSpy).toHaveBeenCalledOnce()
  })

  it("deps.env is the same reference as passed env", () => {
    const app = new Hono()
    const env = { TEST_BOOT_LAYER: "1" }
    const { deps } = createDeps({}, env, app)
    expect(deps.env).toBe(env)
  })
})
