// @vitest-environment jsdom

import type { SessionListQuery } from "@drive-coding/core/session"
import { flushSync, mount, unmount } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import { expect, it, vi } from "vitest"
import type { SessionListPage } from "$lib/adapters/sessions"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import SessionHistoryList from "./SessionHistoryList.svelte"

vi.mock("$lib/context", () => ({
  getI18n: () => ({ t: (key: string) => key }),
}))

const cwd = "/fixture/project"

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll("button")).find(
    (el) => el.getAttribute("aria-label") === label || el.textContent?.trim() === label,
  )
  if (!match) throw new Error(`No button for ${label}`)
  return match
}

it.each(["desktop", "mobile"])(
  "reloads the active cwd from the first page after a real click on %s",
  async (surface) => {
    const view = new MockSessionView()
    let visits = 0
    view.listSessionsMock.mockImplementation(async (query: SessionListQuery = {}) => {
      const id = query.cursor ?? (query.cwd ? `filtered-${++visits}` : "all")
      return {
        sessions: [{ sessionId: id, cwd: query.cwd ?? "/elsewhere", title: id, updatedAt: "" }],
        capabilities: { list: true, filterByCwd: true, delete: true },
        legacyCanDelete: false,
        nextCursor: query.cursor === undefined && query.cwd ? `next-${visits}` : undefined,
      }
    })
    const session = new AgentSession({ view })
    session._setStatusForTest("connected")
    session.agentId = "fixture-agent"
    session._setSessionContextForTest({ sessionId: "current", cwd, cliKind: "opencode" })
    const flags = new SvelteMap([
      ["visible", surface === "desktop"],
      ["cwdOnly", false],
    ])
    const target = document.createElement("div")
    document.body.appendChild(target)
    const app = mount(SessionHistoryList, {
      target,
      props: {
        session,
        get visible() {
          return flags.get("visible") === true
        },
        get currentCwdOnly() {
          return flags.get("cwdOnly") === true
        },
        onCurrentCwdOnlyChange: (value) => {
          flags.set("cwdOnly", value)
        },
        onNewSession: vi.fn(),
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
      },
    })
    try {
      flushSync()
      if (surface === "mobile") {
        expect(view.listSessionsMock).not.toHaveBeenCalled()
        flushSync(() => {
          flags.set("visible", true)
        })
      }
      await vi.waitFor(() => expect(target.textContent).toContain("all"))
      button(target, "sidebar.sessionsFilterAll").click()
      await vi.waitFor(() => expect(target.textContent).toContain("filtered-1"))
      button(target, "sidebar.sessionsLoadMore").click()
      await vi.waitFor(() => expect(target.textContent).toContain("next-1"))
      button(target, "sidebar.refresh").click()
      await vi.waitFor(() => expect(target.textContent).toContain("filtered-2"))
      expect(target.textContent).not.toContain("next-1")
      button(target, "sidebar.sessionsLoadMore").click()
      await vi.waitFor(() => expect(target.textContent).toContain("next-2"))

      expect(view.listSessionsMock.mock.calls).toEqual([
        [{}],
        [{ cwd }],
        [{ cwd, cursor: "next-1" }],
        [{ cwd }],
        [{ cwd, cursor: "next-2" }],
      ])
    } finally {
      await unmount(app)
      target.remove()
    }
  },
)

it("applies cwd locally to a legacy page and leaves all rows visible without a known cwd", async () => {
  const view = new MockSessionView()
  const legacy: SessionListPage = {
    sessions: [
      { sessionId: "inside", cwd, title: "inside workspace", updatedAt: "" },
      { sessionId: "outside", cwd: "/elsewhere", title: "outside workspace", updatedAt: "" },
    ],
    capabilities: null,
    legacyCanDelete: false,
  }
  view.listSessionsMock.mockResolvedValue(legacy)
  const session = new AgentSession({ view })
  session._setStatusForTest("connected")
  session.agentId = "fixture-agent"
  session._setSessionContextForTest({ sessionId: "current", cwd, cliKind: "opencode" })
  const target = document.createElement("div")
  const app = mount(SessionHistoryList, {
    target,
    props: {
      session,
      visible: true,
      currentCwdOnly: true,
      onCurrentCwdOnlyChange: vi.fn(),
      onNewSession: vi.fn(),
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
    },
  })
  try {
    flushSync()
    await vi.waitFor(() => expect(target.textContent).toContain("inside workspace"))
    expect(target.textContent).not.toContain("outside workspace")
    expect(target.textContent).not.toContain("sidebar.sessionsLoadMore")
    flushSync(() => {
      session.cwd = null
    })
    await vi.waitFor(() => expect(target.textContent).toContain("outside workspace"))
    expect(target.textContent).toContain("inside workspace")
    expect(target.querySelector("[aria-pressed]")).toBeNull()
    expect(view.listSessionsMock.mock.calls).toEqual([[{ cwd }], [{}]])
  } finally {
    await unmount(app)
  }
})
