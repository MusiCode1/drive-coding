import type { SessionState } from "@drive-coding/core/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

const modes = {
  availableModes: [
    { id: "default", name: "Default" },
    { id: "bypassPermissions", name: "Bypass" },
  ],
  currentModeId: "default",
}
const option = (id: string) => ({ id, name: id, type: "boolean" as const, currentValue: false })
const hosts: ReturnType<typeof hostSessionView>[] = []

async function open(initial: Partial<SessionState> = {}) {
  const host = hostSessionView(initial)
  hosts.push(host)
  await host.view.connect()
  return { send: host.send, session: new AgentSession({ view: host.view }) }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(({ view }) => view.close()))
})

describe("AgentSession mode and config updates through the host", () => {
  it("updates the current mode", async () => {
    const { send, session } = await open({ modes })
    expect(session.modes?.currentModeId).toBe("default")
    send({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })
    await vi.waitFor(() => expect(session.modes?.currentModeId).toBe("bypassPermissions"))
  })

  it("preserves the list of available modes", async () => {
    const { send, session } = await open({ modes })
    send({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })
    await vi.waitFor(() =>
      expect(session.modes).toEqual({ ...modes, currentModeId: "bypassPermissions" }),
    )
  })

  it("accepts the first mode update without a mode list", async () => {
    const { send, session } = await open()
    expect(session.modes).toBeNull()
    send({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })
    await vi.waitFor(() =>
      expect(session.modes).toEqual({ currentModeId: "bypassPermissions", availableModes: [] }),
    )
  })

  it("keeps the current mode for a non-string update", async () => {
    const { send, session } = await open({ modes })
    expect(send({ sessionUpdate: "current_mode_update", currentModeId: 42 })).toBe(0)
    expect(session.modes).toEqual(modes)
  })

  it("replaces the full list when config options arrive", async () => {
    const { send, session } = await open({ configOptions: [option("opt-initial")] })
    expect(session.configOptions).toHaveLength(1)
    const configOptions = [option("opt-new-1"), option("opt-new-2")]
    send({ sessionUpdate: "config_option_update", configOptions })
    await vi.waitFor(() => expect(session.configOptions).toEqual(configOptions))
  })

  it("keeps stable options across a malformed update with or without metadata", async () => {
    const configOptions = [option("opt-stable")]
    const { send, session } = await open({ configOptions })
    for (const _meta of [undefined, { trace: "provider" }]) {
      expect(
        send({ sessionUpdate: "config_option_update", configOptions: "not-an-array", _meta }),
      ).toBe(0)
      expect(session.configOptions).toEqual(configOptions)
    }
    send({ sessionUpdate: "config_option_update", configOptions: [] })
    await vi.waitFor(() => expect(session.configOptions).toEqual([]))
  })
})
