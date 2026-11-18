import { describe, expect, it } from "vitest"
import { parseLogConfig } from "../../src/log/config.js"

describe("parseLogConfig", () => {
  it("env LOG_LEVEL sets level", () => {
    const cfg = parseLogConfig({ env: { LOG_LEVEL: "debug" } })
    expect(cfg.level).toBe("debug")
  })

  it("env LOG_NS sets ns", () => {
    const cfg = parseLogConfig({ env: { LOG_NS: "voice.*" } })
    expect(cfg.ns).toBe("voice.*")
  })

  it("search ?log=trace sets level", () => {
    const cfg = parseLogConfig({ search: "?log=trace" })
    expect(cfg.level).toBe("trace")
  })

  it("search ?logNs=fe.voice sets ns", () => {
    const cfg = parseLogConfig({ search: "?logNs=fe.voice" })
    expect(cfg.ns).toBe("fe.voice")
  })

  it("URL params override localStorage", () => {
    const ls = makeFakeLocalStorage({ LOG_LEVEL: "warn" })
    const cfg = parseLogConfig({ search: "?log=debug", localStorage: ls })
    expect(cfg.level).toBe("debug")
  })

  it("URL params override env", () => {
    const cfg = parseLogConfig({
      env: { LOG_LEVEL: "error" },
      search: "?log=trace",
    })
    expect(cfg.level).toBe("trace")
  })

  it("localStorage read (no URL)", () => {
    const ls = makeFakeLocalStorage({ LOG_LEVEL: "debug", LOG_NS: "fe.voice" })
    const cfg = parseLogConfig({ localStorage: ls })
    expect(cfg.level).toBe("debug")
    expect(cfg.ns).toBe("fe.voice")
  })

  it("logSticky=1 writes to localStorage", () => {
    const ls = makeFakeLocalStorage({})
    parseLogConfig({ search: "?log=debug&logSticky=1", localStorage: ls })
    expect(ls.getItem("LOG_LEVEL")).toBe("debug")
  })

  it("logSticky=0 does NOT write to localStorage", () => {
    const ls = makeFakeLocalStorage({})
    parseLogConfig({ search: "?log=debug", localStorage: ls })
    expect(ls.getItem("LOG_LEVEL")).toBeNull()
  })

  it("invalid level falls back to info default", () => {
    const cfg = parseLogConfig({ env: { LOG_LEVEL: "verbose" } })
    expect(cfg.level).toBe("info")
  })

  it("logRemote=1 sets remote=true", () => {
    const cfg = parseLogConfig({ search: "?logRemote=1" })
    expect(cfg.remote).toBe(true)
  })

  it("logRemote=0 clears a remote default", () => {
    const cfg = parseLogConfig({
      search: "?logRemote=0",
      defaults: { remote: true },
    })
    expect(cfg.remote).toBe(false)
  })

  it("default format is both", () => {
    const cfg = parseLogConfig({})
    expect(cfg.format).toBe("both")
  })

  it("defaults only — all defaults applied", () => {
    const cfg = parseLogConfig({})
    expect(cfg.level).toBe("info")
    expect(cfg.ns).toBe("*")
    expect(cfg.format).toBe("both")
    expect(cfg.remote).toBe(false)
  })
})

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeFakeLocalStorage(init: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(init))
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}
