/**
 * eviction-controller.test.ts — כיסוי לתזמון ה-resolve ולנתיב ה-timeout.
 *
 * למה זה קיים: כלב החזיר NO-GO על ב'2 כי הקוד היה נכון אבל **לא נבדק**.
 * הדרישה בבריף היא ש-evictAndWait ייפתר **רק אחרי ניקוי מלא**
 * (unsub + unsubCrash), לא מיד אחרי markDetached — ושב-timeout
 * ה-HTTP **לא ייקח את ה-wire**.
 *
 * ─── slice ownership-handoff C4 (post-calev) ───
 */
import { describe, expect, it, vi } from "vitest"
import { createEvictionController } from "./eviction-controller.js"

function makeWs() {
  const closeArgs: Array<[number, string?]> = []
  return { ws: { close: (c: number, r?: string) => closeArgs.push([c, r]) }, closeArgs }
}

describe("EvictionController", () => {
  it("resolves immediately when nothing is registered", async () => {
    const c = createEvictionController()
    await expect(c.evictAndWait("unknown", 4409)).resolves.toBeUndefined()
  })

  it("sends close(code) to the registered ws", async () => {
    const c = createEvictionController()
    const { ws, closeArgs } = makeWs()
    const { notifyDetached } = c.register("a1", ws)
    const p = c.evictAndWait("a1", 4409)
    expect(closeArgs[0]?.[0]).toBe(4409)
    notifyDetached()
    await expect(p).resolves.toBeUndefined()
  })

  // 🔴 הדרישה המרכזית: לא נפתר לפני notifyDetached
  it("does NOT resolve until notifyDetached is called (waits for full cleanup)", async () => {
    const c = createEvictionController()
    const { ws } = makeWs()
    const { notifyDetached } = c.register("a1", ws)

    let settled = false
    const p = c.evictAndWait("a1", 4409).then(() => {
      settled = true
    })

    // כמה סבבי microtask+macrotask — עדיין לא אמור להיפתר
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)

    notifyDetached()
    await p
    expect(settled).toBe(true)
  })

  // 🔴 נתיב ה-timeout: HTTP לא לוקח את ה-wire
  it("rejects on timeout when detach never completes", async () => {
    const c = createEvictionController()
    const { ws } = makeWs()
    c.register("a1", ws) // notifyDetached לעולם לא ייקרא
    await expect(c.evictAndWait("a1", 4409, 30)).rejects.toThrow()
  })

  it("notifyDetached from a stale ws does not resolve waiters of the new ws", async () => {
    const c = createEvictionController()
    const first = makeWs()
    const second = makeWs()
    const oldNotify = c.register("a1", first.ws).notifyDetached
    const { notifyDetached: newNotify } = c.register("a1", second.ws) // דורס

    let settled = false
    const p = c.evictAndWait("a1", 4409, 200).then(() => {
      settled = true
    })

    oldNotify() // מהישן — חייב להיות no-op
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)

    newNotify()
    await p
    expect(settled).toBe(true)
  })

  it("multiple waiters on the same agent all resolve on one notifyDetached", async () => {
    const c = createEvictionController()
    const { ws } = makeWs()
    const { notifyDetached } = c.register("a1", ws)
    const results: number[] = []
    const p1 = c.evictAndWait("a1", 4409).then(() => results.push(1))
    const p2 = c.evictAndWait("a1", 4409).then(() => results.push(2))
    notifyDetached()
    await Promise.all([p1, p2])
    expect(results.sort()).toEqual([1, 2])
  })
})
