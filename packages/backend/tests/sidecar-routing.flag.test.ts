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

  it("🔴 drops a cliKind that cannot be hosted in a sidecar rather than pretending", () => {
    // claude and codex are in-process adapters. Accepting them here would look
    // like the feature working and would fail at launch instead.
    expect(sidecarKinds({ AGENT_SIDECAR: "claude" })).toEqual(new Set())
    expect(sidecarKinds({ AGENT_SIDECAR: "codex,cursor" })).toEqual(new Set(["cursor"]))
    expect(sidecarKinds({ AGENT_SIDECAR: "nonsense" })).toEqual(new Set())
  })

  it("the capable set is exactly the stdio-ACP CLIs", () => {
    expect(SIDECAR_CAPABLE.has("cursor")).toBe(true)
    expect(SIDECAR_CAPABLE.has("claude")).toBe(false)
    expect(SIDECAR_CAPABLE.has("codex")).toBe(false)
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
