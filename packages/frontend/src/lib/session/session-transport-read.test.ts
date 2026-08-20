/**
 * session-transport-read.test.ts — readSessionTransport (slice remote-warm-reconnect C4
 * · slice transport-polish C2).
 *
 * הקדימות עצמה (query ← override ← stored ← env ← "ws") טסוטת ב-session-transport.test.ts
 * — כאן נבדקת שכבת-הדבק: קריאת location.search/sessionStorage + שמירת ה-query param
 * המנורמל. שני מקורות: sessionStorage (override) + stored (העדפה מ-localStorage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readSessionTransport } from "./session-transport-read.js"

const stores = new Map<string, string>()

beforeEach(() => {
  stores.clear()
  vi.stubGlobal("location", { search: "" })
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((k: string) => stores.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      stores.set(k, v)
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("readSessionTransport", () => {
  it("no query, no stored, no env → ws", () => {
    expect(readSessionTransport({})).toBe("ws")
  })

  it("query=remote → resolves http AND persists http to sessionStorage", () => {
    vi.stubGlobal("location", { search: "?sessionTransport=remote" })
    expect(readSessionTransport({})).toBe("http")
    expect(stores.get("sessionTransport")).toBe("http")
  })

  it("override (sessionStorage) only → resolves from override", () => {
    stores.set("sessionTransport", "http")
    expect(readSessionTransport({})).toBe("http")
  })

  it("env only → resolves from env (when no override/stored)", () => {
    expect(readSessionTransport({ env: "http" })).toBe("http")
  })

  it("query overrides override (and updates storage)", () => {
    stores.set("sessionTransport", "http")
    vi.stubGlobal("location", { search: "?sessionTransport=ws" })
    expect(readSessionTransport({})).toBe("ws")
    expect(stores.get("sessionTransport")).toBe("ws")
  })

  it("locked precedence: override beats env when no query", () => {
    stores.set("sessionTransport", "http")
    expect(readSessionTransport({ env: "ws" })).toBe("http")
  })

  it("garbage query is NOT persisted (does not overwrite override)", () => {
    stores.set("sessionTransport", "http")
    vi.stubGlobal("location", { search: "?sessionTransport=banana" })
    // banana → normalize → null → לא נשמר. override (http) שורד.
    expect(readSessionTransport({})).toBe("http")
    expect(stores.get("sessionTransport")).toBe("http")
  })

  it("stored (preference) beats env when no override/query", () => {
    expect(readSessionTransport({ stored: "http", env: "ws" })).toBe("http")
  })

  it("override beats stored (preference)", () => {
    stores.set("sessionTransport", "http")
    expect(readSessionTransport({ stored: "ws" })).toBe("http")
  })

  it("canonicalization before write — ?sessionTransport=REMOTE  → http persisted", () => {
    vi.stubGlobal("location", { search: "?sessionTransport=REMOTE%20" })
    expect(readSessionTransport({})).toBe("http")
    expect(stores.get("sessionTransport")).toBe("http")
  })

  it("env selected when preference is null", () => {
    // stored=null → הקדימות ממשיכה ל-env. שומר את באג r3 #1.
    expect(readSessionTransport({ stored: null, env: "http" })).toBe("http")
  })
})
