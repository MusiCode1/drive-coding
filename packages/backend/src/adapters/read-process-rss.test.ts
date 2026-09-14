import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { parseVmRssFromProcStatus, readProcessRss } from "./read-process-rss.js"

const fixturePath = fileURLToPath(new URL("./fixtures/proc-status.sample", import.meta.url))

describe("parseVmRssFromProcStatus", () => {
  it("parses VmRSS from fixture status file", () => {
    const content = readFileSync(fixturePath, "utf8")
    expect(parseVmRssFromProcStatus(content)).toEqual({ rssMB: 1840, source: "proc" })
  })

  it("returns null when VmRSS line is missing", () => {
    expect(parseVmRssFromProcStatus("Name:\tfoo\n")).toBeNull()
  })

  it("returns null when VmRSS is zero (zombie)", () => {
    expect(parseVmRssFromProcStatus("VmRSS:\t0 kB\n")).toBeNull()
  })

  it("returns null for invalid pid input to readProcessRss", () => {
    expect(readProcessRss(0)).toBeNull()
    expect(readProcessRss(-1)).toBeNull()
    expect(readProcessRss(1.5)).toBeNull()
  })

  it("returns null for self pid", () => {
    expect(readProcessRss(process.pid)).toBeNull()
  })

  it("returns null on win32 without reading /proc", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    expect(readProcessRss(12345)).toBeNull()
    platformSpy.mockRestore()
  })

  it("returns null when /proc file is missing", () => {
    expect(readProcessRss(999999999)).toBeNull()
  })
})
