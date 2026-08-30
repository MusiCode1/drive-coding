import { describe, expect, it } from "vitest"
import {
  SURFACE_ABOUT,
  SURFACE_CAPABILITIES,
  SURFACE_DISPLAY,
  SURFACE_PROMPT_PIECES,
  buildFsFileUrl,
  buildSurfacePrompt,
  buildSurfaceRuntime,
  resolveSurfaceRuntimeEnv,
} from "./index.js"

const runtime = {
  baseUrl: "http://127.0.0.1:4001",
  port: 4001,
  pid: 4242,
  publicBaseUrl: "https://drive-coding-dev-vps.musicode.ovh",
  agentId: "agent-abc",
  parentAgentId: "parent-xyz",
}

describe("buildFsFileUrl", () => {
  it("encodes file:// absolute paths", () => {
    const url = buildFsFileUrl(
      "https://drive-coding-dev-vps.musicode.ovh",
      "/home/user/.cursor/plans/Architecture review plan-fe63ed36.plan.md",
    )
    expect(url).toBe(
      "https://drive-coding-dev-vps.musicode.ovh/api/fs/file?uri=" +
        encodeURIComponent(
          "file:///home/user/.cursor/plans/Architecture review plan-fe63ed36.plan.md",
        ),
    )
  })

  it("accepts an existing file:// URI", () => {
    expect(buildFsFileUrl("http://127.0.0.1:4000", "file:///tmp/a.md")).toBe(
      "http://127.0.0.1:4000/api/fs/file?uri=" + encodeURIComponent("file:///tmp/a.md"),
    )
  })
})

describe("buildSurfaceRuntime", () => {
  it("includes pid, port, base, mcp, agent id, and a public example link", () => {
    const text = buildSurfaceRuntime(runtime)
    expect(text).toContain("**PID:** 4242")
    expect(text).toContain("**Port:** 4001")
    expect(text).toContain("http://127.0.0.1:4001/api/mcp")
    expect(text).toContain("agent-abc")
    expect(text).toContain("https://drive-coding-dev-vps.musicode.ovh")
    expect(text).toContain("/api/fs/file?uri=")
  })

  it("renders an env table with known values", () => {
    const text = buildSurfaceRuntime(runtime)
    expect(text).toContain("## Environment (this process)")
    expect(text).toContain("| `DRIVE_CODING_BASE` | `http://127.0.0.1:4001` |")
    expect(text).toContain("| `DC_BASE` | `http://127.0.0.1:4001` |")
    expect(text).toContain("| `DRIVE_CODING_AGENT_ID` | `agent-abc` |")
    expect(text).toContain("| `PUBLIC_BASE_URL` | `https://drive-coding-dev-vps.musicode.ovh` |")
    expect(text).toContain("| `DC_PARENT` | `parent-xyz` |")
    expect(text).toContain("Prefer **`DRIVE_CODING_BASE`**")
    expect(text).toContain("Prefer **`PUBLIC_BASE_URL`**")
  })

  it("shows *(unset)* for missing optional env keys", () => {
    const text = buildSurfaceRuntime({
      baseUrl: "http://127.0.0.1:4001",
      port: 4001,
      pid: 1,
    })
    expect(text).toContain("| `DRIVE_CODING_AGENT_ID` | *(unset)* |")
    expect(text).toContain("| `PUBLIC_BASE_URL` | *(unset)* |")
    expect(text).toContain("| `DC_PARENT` | *(unset)* |")
    expect(text).toContain("| `DRIVE_CODING_BASE` | `http://127.0.0.1:4001` |")
  })

  it("lets explicit env override derived values", () => {
    const text = buildSurfaceRuntime({
      ...runtime,
      env: { DRIVE_CODING_BASE: "http://override:9", DC_BASE: "http://override:9" },
    })
    expect(text).toContain("| `DRIVE_CODING_BASE` | `http://override:9` |")
    expect(resolveSurfaceRuntimeEnv(runtime).DRIVE_CODING_AGENT_ID).toBe("agent-abc")
  })
})

describe("buildSurfacePrompt", () => {
  it("exports all piece ids", () => {
    expect([...SURFACE_PROMPT_PIECES]).toEqual([
      "about",
      "runtime",
      "capabilities",
      "display",
    ])
  })

  it("composes only selected pieces in catalog order", () => {
    const text = buildSurfacePrompt({
      pieces: ["display", "about"],
      runtime,
    })
    expect(text.startsWith(SURFACE_ABOUT)).toBe(true)
    expect(text.endsWith(SURFACE_DISPLAY)).toBe(true)
    expect(text).not.toContain(SURFACE_CAPABILITIES.slice(0, 40))
    expect(text.indexOf(SURFACE_ABOUT)).toBeLessThan(text.indexOf(SURFACE_DISPLAY))
  })

  it("includes runtime when requested", () => {
    const text = buildSurfacePrompt({
      pieces: ["runtime", "capabilities"],
      runtime,
    })
    expect(text).toContain("**PID:** 4242")
    expect(text).toContain(SURFACE_CAPABILITIES.slice(0, 30))
  })

  it("throws when runtime piece is selected without runtime info", () => {
    expect(() => buildSurfacePrompt({ pieces: ["runtime"] })).toThrow(/runtime/)
  })

  it("full compose contains every static section", () => {
    const text = buildSurfacePrompt({
      pieces: [...SURFACE_PROMPT_PIECES],
      runtime,
    })
    expect(text).toContain(SURFACE_ABOUT)
    expect(text).toContain(SURFACE_CAPABILITIES)
    expect(text).toContain(SURFACE_DISPLAY)
    expect(text).toContain("**Port:** 4001")
    expect(text).toContain("## Environment (this process)")
  })
})
