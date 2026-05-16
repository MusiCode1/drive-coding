import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock child_process to avoid invoking the real `opencode models` command
// (slow, and would couple the test to whatever is in PATH).
const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const { Hono } = await import("hono")
const { registerHttpOptions } = await import("../src/delivery/http-options")

function makeApp() {
  const app = new Hono()
  registerHttpOptions(app)
  return app
}

describe("HTTP GET /api/options", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
  })

  it("returns 200 + { models, projects }", async () => {
    execFileSyncMock.mockReturnValue("anthropic/claude-sonnet-4-5\nopenai/gpt-5\n")
    const app = makeApp()
    const res = await app.request("/api/options")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: unknown; projects: unknown }
    expect(body.models).toBeDefined()
    expect(body.projects).toBeDefined()
  })

  it("models has opencode/claude/gemini/codex keys, each is non-empty array", async () => {
    execFileSyncMock.mockReturnValue(
      "anthropic/claude-sonnet-4-5\nanthropic/claude-opus-4-7\nopenai/gpt-5\n",
    )
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { models: Record<string, string[]> }

    expect(Array.isArray(body.models.opencode)).toBe(true)
    expect(body.models.opencode?.length).toBeGreaterThan(0)
    expect(body.models.claude?.length).toBeGreaterThan(0)
    expect(body.models.gemini?.length).toBeGreaterThan(0)
    expect(body.models.codex?.length).toBeGreaterThan(0)
  })

  it("opencode list falls back to MODEL_FALLBACKS when execFileSync throws", async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("opencode: command not found")
    })
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { models: Record<string, string[]> }

    // Fallback list contains at least a claude-opus model
    expect(body.models.opencode?.some((m) => m.includes("opus"))).toBe(true)
  })

  it("models.claude contains a known sonnet model (static fallback list)", async () => {
    execFileSyncMock.mockReturnValue("anthropic/claude-sonnet-4-5\n")
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { models: Record<string, string[]> }

    expect(body.models.claude?.some((m) => m.includes("sonnet"))).toBe(true)
  })

  it("projects is an array of absolute paths, excludes user-files + node_modules", async () => {
    execFileSyncMock.mockReturnValue("")
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { projects: string[] }

    expect(Array.isArray(body.projects)).toBe(true)
    for (const p of body.projects) {
      expect(p.startsWith("/")).toBe(true)
      expect(p.includes("user-files")).toBe(false)
      expect(p.includes("node_modules")).toBe(false)
    }
  })

  it("projects list is capped at 50 entries", async () => {
    execFileSyncMock.mockReturnValue("")
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { projects: string[] }
    expect(body.projects.length).toBeLessThanOrEqual(50)
  })

  it("opencode list prefers known anthropic/openai/google prefixes (preferred picks first)", async () => {
    execFileSyncMock.mockReturnValue(
      [
        "openai/gpt-5",
        "google/gemini-2.5-pro",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-sonnet-4-6",
        "some-other-provider/whatever",
      ].join("\n"),
    )
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { models: Record<string, string[]> }

    // Preferred picks come first per impl's preferredPrefixes order
    expect(body.models.opencode?.[0]).toBe("anthropic/claude-opus-4-7")
    expect(body.models.opencode?.includes("openai/gpt-5")).toBe(true)
  })
})
