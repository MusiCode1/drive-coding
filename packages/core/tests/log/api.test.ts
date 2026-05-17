import { beforeEach, describe, expect, it, vi } from "vitest"
import { addSink, createLogger, getLogConfig, initLogger } from "../../src/log/index.js"
import type { LogEntry } from "../../src/log/types.js"

// Suppress pino stdout/stderr during tests
vi.spyOn(process.stdout, "write").mockReturnValue(true)
vi.spyOn(process.stderr, "write").mockReturnValue(true)

beforeEach(() => {
  // Reset to a known state with sinks only (no pino output)
  initLogger({ level: "trace", ns: "*", format: "json", remote: false })
})

describe("createLogger — basic API", () => {
  it("info log calls sink with correct fields", () => {
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("test.api")
    log.info({ x: 1 }, "hello")

    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e).toBeDefined()
    expect(e?.ns).toBe("test.api")
    expect(e?.level).toBe("info")
    expect(e?.msg).toBe("hello")
    expect(e?.fields?.x).toBe(1)

    remove()
  })

  it("log.child inherits fields in every call", () => {
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("test.child").child({ agentId: "abc123", extra: 42 })
    log.debug({ key: "val" }, "msg")

    expect(entries[0]?.fields?.agentId).toBe("abc123")
    expect(entries[0]?.fields?.extra).toBe(42)
    expect(entries[0]?.fields?.key).toBe("val")

    remove()
  })

  it("log.ns creates sub-namespace", () => {
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("a").ns("sub").ns("deeper")
    log.info({}, "test")

    expect(entries[0]?.ns).toBe("a.sub.deeper")
    remove()
  })

  it("addSink receives entry and unsubscribe works", () => {
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    createLogger("test.sink").warn({}, "warn msg")
    expect(entries).toHaveLength(1)

    remove()
    createLogger("test.sink").warn({}, "second")
    expect(entries).toHaveLength(1) // no new entries after remove
  })

  it("level=silent → no-op completely", () => {
    initLogger({ level: "silent", ns: "*", format: "json", remote: false })

    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("test.silent")
    log.trace({}, "trace")
    log.debug({}, "debug")
    log.info({}, "info")
    log.warn({}, "warn")
    log.error({}, "error")

    expect(entries).toHaveLength(0)
    remove()
  })

  it("level filtering — debug not emitted at info level", () => {
    initLogger({ level: "info", ns: "*", format: "json", remote: false })

    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("test.level")
    log.debug({}, "should not appear")
    log.info({}, "should appear")

    expect(entries).toHaveLength(1)
    expect(entries[0]?.level).toBe("info")
    remove()
  })

  it("namespace filtering — only matching ns emits", () => {
    initLogger({ level: "trace", ns: "voice.*", format: "json", remote: false })

    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    createLogger("voice.pipeline").info({}, "match")
    createLogger("backend.server").info({}, "no match")

    expect(entries).toHaveLength(1)
    expect(entries[0]?.ns).toBe("voice.pipeline")
    remove()
  })

  it("error with Error object — includes err message in fields", () => {
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))

    const log = createLogger("test.error")
    log.error(new Error("boom"), "something failed")

    expect(entries[0]?.fields?.err).toBe("boom")
    remove()
  })

  it("getLogConfig returns current config", () => {
    initLogger({ level: "debug", ns: "fe.*", format: "pretty", remote: true })
    const cfg = getLogConfig()
    expect(cfg.level).toBe("debug")
    expect(cfg.ns).toBe("fe.*")
    expect(cfg.remote).toBe(true)
  })
})
