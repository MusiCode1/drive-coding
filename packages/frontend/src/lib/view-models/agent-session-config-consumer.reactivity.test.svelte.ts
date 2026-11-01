// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import Harness from "./agent-session-config-consumer.harness.svelte"

let target: HTMLDivElement | null = null
let app: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

describe("AgentSession config — consumer reactivity", () => {
  it("component updates when session.config.configOptions changes after mount", async () => {
    target = document.createElement("div")
    document.body.appendChild(target)
    app = mount(Harness, { target })
    await tick()
    expect(target.querySelector("[data-testid=config-count]")?.textContent).toBe("0")

    const session = (
      app as { getSession(): import("./agent-session.svelte").AgentSession }
    ).getSession()
    session.config.configOptions = [
      { id: "verbose", name: "Verbose", type: "boolean", currentValue: true, category: null },
    ]
    await tick()
    expect(target.querySelector("[data-testid=config-count]")?.textContent).toBe("1")
  })
})
