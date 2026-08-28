/**
 * join-transport.test.ts — resolveJoin (slice http-join-truth C0).
 *
 * מחליט אם לחיצת שקע על סוכן חי מותרת לפי attachedVia מול transport הלקוח.
 * attachedVia חסר/null → התאמה ל-clientTransport (לא mismatch).
 */

import { describe, expect, it } from "vitest"
import { resolveJoin } from "./join-transport.js"

describe("resolveJoin", () => {
  it("ws client + attachedVia ws → ws", () => {
    expect(resolveJoin({ attachedVia: "ws" }, "ws")).toEqual({ kind: "ws" })
  })

  it("http client + attachedVia http → http", () => {
    expect(resolveJoin({ attachedVia: "http" }, "http")).toEqual({ kind: "http" })
  })

  it("http client + attachedVia ws → mismatch", () => {
    expect(resolveJoin({ attachedVia: "ws" }, "http")).toEqual({ kind: "mismatch" })
  })

  it("ws client + attachedVia http → mismatch", () => {
    expect(resolveJoin({ attachedVia: "http" }, "ws")).toEqual({ kind: "mismatch" })
  })

  it("missing attachedVia → clientTransport (ws)", () => {
    expect(resolveJoin({}, "ws")).toEqual({ kind: "ws" })
  })

  it("missing attachedVia → clientTransport (http)", () => {
    expect(resolveJoin({}, "http")).toEqual({ kind: "http" })
  })

  it("attachedVia null → clientTransport (ws)", () => {
    expect(resolveJoin({ attachedVia: null }, "ws")).toEqual({ kind: "ws" })
  })

  it("attachedVia null → clientTransport (http)", () => {
    expect(resolveJoin({ attachedVia: null }, "http")).toEqual({ kind: "http" })
  })
})
