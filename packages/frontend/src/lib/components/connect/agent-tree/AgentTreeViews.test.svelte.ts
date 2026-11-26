// @vitest-environment jsdom
import type { AgentPublic } from "@drive-coding/core"
import { buildAgentTree } from "@drive-coding/core/agents/agent-tree"
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Harness from "./AgentTreeViews.harness.svelte"

function agent(id: string, parentAgentId?: string, busy?: boolean): AgentPublic {
  return {
    id,
    cwd: `/projects/${id}`,
    title: id,
    parentAgentId,
    busy,
    cliKind: "codex",
    modelOverride: null,
    status: "ready",
    createdAt: "",
    persistent: false,
    attached: false,
  }
}

const fixture = [
  agent("root"),
  agent("child", "root", true),
  agent("grandchild", "child"),
  agent("great-grandchild", "grandchild", true),
  agent("sibling", "root"),
]

let target: HTMLDivElement
let app: ReturnType<typeof Harness>

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target })
})

afterEach(async () => {
  await unmount(app)
  target.remove()
  vi.unstubAllGlobals()
})

function rows(): HTMLElement[] {
  return Array.from(target.querySelectorAll<HTMLElement>("li[data-agent-id]"))
}

describe("agent tree views", () => {
  it("keeps keyed rows in preorder with descendant and busy counts, and focuses the deep parent", async () => {
    app.setTree(buildAgentTree(fixture))
    await tick()
    const initial = rows()
    expect(initial.map((row) => row.dataset.agentId)).toEqual(fixture.map((agent) => agent.id))
    expect(initial[0]?.textContent).toMatch(/4\s+sub-agents\s+·\s+2\s+working/)
    expect(initial[2]?.textContent).toMatch(/1\s+sub-agent\s+·\s+1\s+working/)
    expect(initial[2]?.style.paddingInlineStart).toBe(initial[3]?.style.paddingInlineStart)
    const link = initial[3]?.querySelector("button")
    expect(link?.textContent).toMatch(/Parent:\s+grandchild/)
    link?.click()
    expect(document.activeElement).toBe(initial[2])

    app.setTree(buildAgentTree(fixture.map((agent) => ({ ...agent, busy: false }))))
    await tick()
    expect(rows()).toHaveLength(initial.length)
    for (const [index, row] of rows().entries()) {
      expect(row).toBe(initial[index])
    }
    expect(rows()[0]?.textContent).not.toContain("working")
  })

  it("shows an anomaly on the affected root and retains its children", async () => {
    app.setTree(
      buildAgentTree([
        agent("lost", "missing"),
        agent("lost-child", "lost"),
        agent("loop", "loop"),
        agent("loop-child", "loop"),
      ]),
    )
    await tick()

    const result = rows()
    expect(result.map((row) => row.dataset.agentId)).toEqual([
      "lost",
      "lost-child",
      "loop",
      "loop-child",
    ])
    expect(result[0]?.textContent).toContain("Missing parent")
    expect(result[1]?.textContent).not.toContain("Missing parent")
    expect(result[2]?.textContent).toContain("Cyclic link")
    expect(result[3]?.textContent).not.toContain("Cyclic link")
  })
})

function rowIds(): (string | undefined)[] {
  return rows().map((row) => row.dataset.agentId)
}

async function clickButton(text: string, container: ParentNode = target): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.trim().startsWith(text),
  )
  expect(button, `button beginning with "${text}"`).toBeDefined()
  button?.click()
  await tick()
}

describe("agent drill-down", () => {
  it("shows one level, moves focus, and supports breadcrumb and step-by-step return", async () => {
    app.setMode("flat")
    app.setTree(buildAgentTree(fixture))
    await tick()
    expect(rowIds()).toEqual(["root"])

    await clickButton("4", rows()[0])
    expect(rowIds()).toEqual(["child", "sibling"])
    expect(document.activeElement).toBe(rows()[0])
    await clickButton("2", rows()[0])
    await clickButton("1", rows()[0])
    expect(rowIds()).toEqual(["great-grandchild"])

    await clickButton("root", target.querySelector("nav") ?? target)
    expect(rowIds()).toEqual(["child", "sibling"])
    expect(document.activeElement).toBe(rows()[0])

    await clickButton("Back")
    expect(rowIds()).toEqual(["root"])
    expect(document.activeElement).toBe(rows()[0])
  })

  it("tracks a reparented branch and falls back to its updated nearest surviving ancestor", async () => {
    app.setMode("flat")
    app.setTree(buildAgentTree(fixture))
    await tick()
    await clickButton("4", rows()[0])
    await clickButton("2", rows()[0])
    await clickButton("1", rows()[0])

    const moved = fixture.map((agent) =>
      agent.id === "grandchild" ? { ...agent, parentAgentId: "sibling" } : agent,
    )
    app.setTree(buildAgentTree(moved))
    await tick()
    expect(rowIds()).toEqual(["great-grandchild"])
    expect(target.querySelector("nav")?.textContent).toContain("sibling")

    app.setTree(buildAgentTree(moved.filter((agent) => agent.id !== "grandchild")))
    await tick()
    expect(rowIds()).toEqual([])
    expect(target.querySelector('[aria-current="location"]')?.textContent).toBe("sibling")
    await clickButton("Back")
    expect(rowIds()).toEqual(["child", "sibling"])
    expect(document.activeElement).toBe(rows()[1])
  })

  it("preserves a bounded branch during loading and offers close when it disappears", async () => {
    app.setMode("flat", "child")
    await tick()
    expect(target.textContent).toContain("Loading agent branch")
    app.setTree(buildAgentTree(fixture))
    await tick()
    expect(rowIds()).toEqual(["grandchild"])
    expect(target.querySelector("nav")?.textContent).not.toContain("root")
    expect(target.querySelector("nav button")).toBeNull()

    await clickButton("1", rows()[0])
    expect(rowIds()).toEqual(["great-grandchild"])
    await clickButton("Back")
    expect(rowIds()).toEqual(["grandchild"])
    expect(target.querySelector("nav button")).toBeNull()

    app.setTree(buildAgentTree(fixture.filter((agent) => agent.id !== "child")))
    await tick()
    expect(target.textContent).toContain("This branch is no longer available")
    await clickButton("Close branch")
    expect(app.closedCount()).toBe(1)
  })

  it("applies the responsive default until a native toggle records an explicit choice", async () => {
    app.setMode("toggle")
    app.setTree(buildAgentTree(fixture))
    await tick()
    expect(target.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe("Tree")

    app.setMobile(true)
    await tick()
    expect(target.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe("Flat")
    expect(rowIds()).toEqual(["root"])

    await clickButton("Tree")
    expect(rowIds()).toEqual(fixture.map((agent) => agent.id))
    app.setMobile(false)
    app.setMobile(true)
    await tick()
    expect(target.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe("Tree")
    expect(localStorage.getItem("drive-coding-v2-settings")).toContain('"agentListView":"tree"')
  })
})
