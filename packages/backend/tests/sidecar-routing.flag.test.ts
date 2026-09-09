/**
 * sidecar-routing.flag.test.ts — the opt-in, and what it refuses to opt in.
 *
 * The property that matters most here is the boring one: with the flag unset,
 * nothing routes to a sidecar. Every agent on this machine currently depends on
 * that being true.
 */

import { configDefault } from "@drive-coding/core/config/specs"
import { describe, expect, it } from "vitest"
import { SIDECAR_CAPABLE, sidecarKinds, socketDirForEnv } from "../src/acp/connect-via-sidecar.js"

describe("sidecarKinds", () => {
  it("🔴 is empty unless asked for — the default must change nothing", () => {
    expect(sidecarKinds({})).toEqual(new Set())
    expect(sidecarKinds({ AGENT_SIDECAR: "" })).toEqual(new Set())
    expect(sidecarKinds({ AGENT_SIDECAR: "   " })).toEqual(new Set())
  })

  it("reads a comma-separated list, tolerating whitespace", () => {
    expect(sidecarKinds({ AGENT_SIDECAR: "cursor" })).toEqual(new Set(["cursor"]))
    expect(sidecarKinds({ AGENT_SIDECAR: " cursor , opencode " })).toEqual(
      new Set(["cursor", "opencode"]),
    )
    expect(sidecarKinds({ AGENT_SIDECAR: "cursor,,opencode," })).toEqual(
      new Set(["cursor", "opencode"]),
    )
  })

  it("🔴 drops a cliKind nothing can host rather than pretending", () => {
    expect(sidecarKinds({ AGENT_SIDECAR: "nonsense" })).toEqual(new Set())
    expect(sidecarKinds({ AGENT_SIDECAR: "nonsense,cursor" })).toEqual(new Set(["cursor"]))
  })

  it("the in-process adapters are capable too — the sidecar hosts them", () => {
    // Verified live: a full claude turn, correct auth under a transient unit,
    // session/load after the client died, and both _drive/* methods answering
    // where pipe mode returned -32601.
    expect(SIDECAR_CAPABLE.has("claude")).toBe(true)
    expect(SIDECAR_CAPABLE.has("codex")).toBe(true)
    expect(sidecarKinds({ AGENT_SIDECAR: "claude,cursor" })).toEqual(
      new Set(["claude", "cursor"]),
    )
  })
})

describe("socketDirForEnv", () => {
  it("keys the directory by this deployment's port", () => {
    const dir = socketDirForEnv({ PORT: "4002", XDG_RUNTIME_DIR: "/run/user/1001" })
    expect(dir).toBe("/run/user/1001/drive-coding/agents-4002")
  })

  it("falls back to the product default port, not to a shared directory", () => {
    const dir = socketDirForEnv({ XDG_RUNTIME_DIR: "/run/user/1001" })
    expect(dir).toBe(`/run/user/1001/drive-coding/agents-${configDefault("port")}`)
  })

  it("a nonsense PORT does not produce agents-NaN", () => {
    const dir = socketDirForEnv({ PORT: "not-a-port", XDG_RUNTIME_DIR: "/run/user/1001" })
    expect(dir).toBe(`/run/user/1001/drive-coding/agents-${configDefault("port")}`)
  })
})
