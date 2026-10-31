import { describe, expect, it, vi } from "vitest"
import type { SessionView } from "$lib/session/session-view"
import {
  type PendingRequestDeps,
  syncPendingElicitation,
  syncPendingPermission,
} from "./agent-session-pending"

for (const kind of ["permission", "elicitation"] as const) {
  for (const replacement of ["view", "host"] as const) {
    describe(`${kind} pending ${replacement} fence`, () => {
      function setup() {
        const oldRespond = vi.fn().mockResolvedValue(undefined)
        const newRespond = vi.fn().mockResolvedValue(undefined)
        const oldView = { hostIncarnation: "host-A", respond: oldRespond } as unknown as SessionView
        const newView = { hostIncarnation: "host-B", respond: newRespond } as unknown as SessionView
        let current = oldView
        const deps: PendingRequestDeps = {
          state: {
            pendingPermission: null,
            pendingElicitation: null,
            error: null,
            bypassActive: false,
          },
          answered: { permissionId: null, elicitationId: null },
          view: () => current,
          tearingDown: () => false,
        }
        function sync() {
          const request = { requestId: 7, params: {} as never }
          if (kind === "permission") syncPendingPermission(deps, request, current)
          else syncPendingElicitation(deps, request, current)
        }
        const pending = () =>
          kind === "permission" ? deps.state.pendingPermission : deps.state.pendingElicitation
        function replace() {
          if (replacement === "view") current = newView
          else Object.assign(oldView, { hostIncarnation: "host-B" })
          deps.state.pendingPermission = null
          deps.state.pendingElicitation = null
          deps.answered.permissionId = null
          deps.answered.elicitationId = null
          sync() // Same numeric request id, now owned by the replacement.
        }
        const answer = () => {
          if (kind === "permission")
            deps.state.pendingPermission!.resolve({
              outcome: { outcome: "selected", optionId: "allow" },
            })
          else deps.state.pendingElicitation!.resolve({ action: "accept", content: {} })
        }
        return { deps, sync, pending, replace, answer, oldRespond, newRespond }
      }

      it("old callback cannot dispatch; replacement callback still answers", () => {
        const t = setup()
        t.sync()
        const old = t.pending()!
        t.replace()
        if (kind === "permission")
          (old as NonNullable<PendingRequestDeps["state"]["pendingPermission"]>).resolve({
            outcome: { outcome: "cancelled" },
          })
        else
          (old as NonNullable<PendingRequestDeps["state"]["pendingElicitation"]>).resolve({
            action: "cancel",
          })
        expect(t.oldRespond).not.toHaveBeenCalled()
        expect(t.newRespond).not.toHaveBeenCalled()
        t.answer()
        expect(replacement === "view" ? t.newRespond : t.oldRespond).toHaveBeenCalledOnce()
      })

      it("old rejection cannot write an error or clear replacement answered identity", async () => {
        const t = setup()
        let reject!: (error: Error) => void
        t.oldRespond.mockReturnValueOnce(
          new Promise<void>((_resolve, r) => {
            reject = r
          }),
        )
        t.sync()
        t.answer()
        t.replace()
        t.answer()
        reject(new Error("old reply failed"))
        await Promise.resolve()
        expect(t.deps.state.error).toBeNull()
        expect(
          kind === "permission" ? t.deps.answered.permissionId : t.deps.answered.elicitationId,
        ).toBe(7)
        expect(replacement === "view" ? t.newRespond : t.oldRespond).toHaveBeenCalledTimes(
          replacement === "view" ? 1 : 2,
        )
      })
    })
  }
}
