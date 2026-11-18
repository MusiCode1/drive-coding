/**
 * boot-wire-record.test.ts — C1 TDD: wireRecord config drives recorder dir, not env truthiness.
 */

import { describe, expect, it } from "vitest"
import { CONFIG_SPECS } from "@drive-coding/core/config/specs"
import { createWireRecorder } from "../src/delivery/wire-recorder.js"
import { loadAppConfig, wireRecorderDir } from "../src/boot/config.js"

describe("wireRecorderDir", () => {
  it("returns null when wireRecord is false", () => {
    expect(wireRecorderDir({ wireRecord: false })).toBeNull()
  })

  it("returns null when wireRecord is undefined", () => {
    expect(wireRecorderDir({})).toBeNull()
  })

  it("returns a non-null dir when wireRecord is true", () => {
    const dir = wireRecorderDir({ wireRecord: true })
    expect(dir).not.toBeNull()
    expect(typeof dir).toBe("string")
  })

  it("serialized '0' parses to false and yields null dir", () => {
    const spec = CONFIG_SPECS.find((s) => s.key === "wireRecord")
    expect(spec).toBeDefined()
    const parsed = spec!.parse!("0")
    expect(parsed).toBe(false)
    expect(wireRecorderDir({ wireRecord: parsed as boolean })).toBeNull()
  })

  it("createWireRecorder with null dir is a no-op (no writes)", () => {
    const recorder = createWireRecorder({ dir: wireRecorderDir({ wireRecord: false }) })
    const session = recorder.open("test-agent")
    session.record("in", '{"test":true}')
    session.close()
    // no throw, no filesystem side effects asserted — dir null means NOOP_SESSION
  })

  it("createWireRecorder with true config gets a real dir", () => {
    const dir = wireRecorderDir({ wireRecord: true })
    expect(dir).not.toBeNull()
    const recorder = createWireRecorder({ dir })
    expect(recorder.open("agent-1")).toBeDefined()
  })
})

describe("loadAppConfig", () => {
  it("returns config from env layer", () => {
    const config = loadAppConfig({ PORT: "4316", WIRE_RECORD: "0" })
    expect(config.port).toBe(4316)
    expect(config.wireRecord).toBe(false)
  })
})
