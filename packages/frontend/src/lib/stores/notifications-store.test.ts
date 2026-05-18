/**
 * notifications-store.test.ts
 */

import { beforeEach, describe, expect, it } from "vitest"
import { notifications } from "./notifications-store.svelte"

describe("notifications store", () => {
  beforeEach(() => {
    notifications.clear()
  })

  it("starts empty", () => {
    expect(notifications.list).toHaveLength(0)
  })

  it("push adds a notification with unique id and default kind", () => {
    const id = notifications.push("hello")
    expect(notifications.list).toHaveLength(1)
    const n = notifications.list[0]!
    expect(n.id).toBe(id)
    expect(n.text).toBe("hello")
    expect(n.kind).toBe("info")
    expect(n.createdAt).toBeGreaterThan(0)
  })

  it("push with explicit kind", () => {
    notifications.push("oops", "error")
    expect(notifications.list[0]?.kind).toBe("error")
  })

  it("push generates distinct ids for distinct calls", () => {
    const a = notifications.push("a")
    const b = notifications.push("b")
    expect(a).not.toBe(b)
    expect(notifications.list).toHaveLength(2)
  })

  it("dismiss removes by id", () => {
    const a = notifications.push("a")
    notifications.push("b")
    notifications.dismiss(a)
    expect(notifications.list).toHaveLength(1)
    expect(notifications.list[0]?.text).toBe("b")
  })

  it("dismiss is a no-op for unknown id", () => {
    notifications.push("a")
    expect(() => notifications.dismiss("nope")).not.toThrow()
    expect(notifications.list).toHaveLength(1)
  })

  it("clear empties the list", () => {
    notifications.push("a")
    notifications.push("b")
    notifications.clear()
    expect(notifications.list).toHaveLength(0)
  })

  it("preserves insertion order", () => {
    notifications.push("first")
    notifications.push("second")
    notifications.push("third")
    expect(notifications.list.map((n) => n.text)).toEqual(["first", "second", "third"])
  })
})
