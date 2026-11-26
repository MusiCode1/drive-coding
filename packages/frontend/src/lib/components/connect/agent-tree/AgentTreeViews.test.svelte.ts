// @vitest-environment jsdom
import type { AgentPublic } from "@drive-coding/core"
import { buildAgentTree } from "@drive-coding/core/agents/agent-tree"
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target })
})

afterEach(async () => {
  await unmount(app)
  target.remove()
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
