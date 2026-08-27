import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createWireRecorder, serializeWireRecord } from "./wire-recorder.js"

// ── serializeWireRecord ────────────────────────────────────────────────────────

describe("serializeWireRecord", () => {
  it("produces NDJSON line with ts/dir/raw + trailing newline", () => {
    const result = serializeWireRecord(1000, "in", "hello")
    expect(result).toBe('{"ts":1000,"dir":"in","raw":"hello"}\n')
  })

  it("escapes raw with embedded quotes and newline via JSON.stringify", () => {
    const raw = 'line with "quotes" and\nnewline'
    const result = serializeWireRecord(42, "out", raw)
    const parsed = JSON.parse(result.trim()) as { ts: number; dir: string; raw: string }
    expect(parsed.ts).toBe(42)
    expect(parsed.dir).toBe("out")
    expect(parsed.raw).toBe(raw)
    // ensure no literal newline inside the JSON (only in the raw value, escaped)
    const withoutTrailingNewline = result.slice(0, -1)
    expect(withoutTrailingNewline).not.toContain("\n")
  })
})

// ── no-op (dir=null) ───────────────────────────────────────────────────────────

describe("createWireRecorder — no-op (dir=null)", () => {
  it("open().record() and close() do not throw and write nothing", () => {
    const rec = createWireRecorder({ dir: null })
    const session = rec.open("agent-1")
    expect(() => {
      session.record("in", "data")
      session.record("out", "more data")
      session.close()
    }).not.toThrow()
  })

  it("open() after open() is still no-op (idempotent)", () => {
    const rec = createWireRecorder({ dir: null })
    const s1 = rec.open("a")
    const s2 = rec.open("b")
    expect(() => {
      s1.record("in", "x")
      s2.record("out", "y")
      s1.close()
      s2.close()
    }).not.toThrow()
  })
})

// ── write path (tmp dir) ───────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "wire-rec-test-"))
}

async function waitFlush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 30))
}

describe("createWireRecorder — write (tmp dir)", () => {
  it("open creates <agentId>-<ts>.jsonl file", async () => {
    const dir = makeTmpDir()
    const fixedTs = 99999
    const rec = createWireRecorder({ dir, now: () => fixedTs })
    const session = rec.open("my-agent")
    session.close()
    await waitFlush()

    const expectedFile = join(dir, `my-agent-${fixedTs}.jsonl`)
    expect(() => readFileSync(expectedFile)).not.toThrow()
  })

  it("record writes valid NDJSON lines matching serializeWireRecord", async () => {
    const dir = makeTmpDir()
    let tick = 100
    const rec = createWireRecorder({ dir, now: () => tick++ })
    const session = rec.open("agent-x")
    session.record("in", "frame-one")
    session.record("out", "frame-two")
    session.close()
    await waitFlush()

    const file = join(dir, `agent-x-100.jsonl`) // first now() call → 100 (open filename)
    const content = readFileSync(file, "utf8")
    const lines = content.trim().split("\n").filter(Boolean)
    const parsed = lines.map((l) => JSON.parse(l) as { ts: number; dir: string; raw: string })

    // first record: now()=101 (second call after open), dir=in, raw=frame-one
    expect(parsed[0]?.dir).toBe("in")
    expect(parsed[0]?.raw).toBe("frame-one")
    // second record: now()=102
    expect(parsed[1]?.dir).toBe("out")
    expect(parsed[1]?.raw).toBe("frame-two")
  })

  it("record after close is no-op and does not throw", async () => {
    const dir = makeTmpDir()
    const fixedTs = 5000
    const rec = createWireRecorder({ dir, now: () => fixedTs })
    const session = rec.open("agent-close-test")
    session.close()
    await waitFlush()

    expect(() => {
      session.record("in", "late-frame")
    }).not.toThrow()

    await waitFlush()
    const file = join(dir, `agent-close-test-${fixedTs}.jsonl`)
    const content = readFileSync(file, "utf8")
    // after close, the late frame must not appear
    expect(content.trim()).toBe("")
  })

  it("two open() calls create two separate files", async () => {
    const dir = makeTmpDir()
    let ts = 1000
    const rec = createWireRecorder({ dir, now: () => ts++ })
    const s1 = rec.open("agent-alpha") // ts=1000
    const s2 = rec.open("agent-beta") // ts=1001
    s1.record("in", "alpha-data")
    s2.record("out", "beta-data")
    s1.close()
    s2.close()
    await waitFlush()

    const f1 = join(dir, `agent-alpha-1000.jsonl`)
    const f2 = join(dir, `agent-beta-1001.jsonl`)
    const c1 = readFileSync(f1, "utf8")
    const c2 = readFileSync(f2, "utf8")

    expect(c1).toContain("alpha-data")
    expect(c2).toContain("beta-data")
    expect(c1).not.toContain("beta-data")
    expect(c2).not.toContain("alpha-data")
  })
})
