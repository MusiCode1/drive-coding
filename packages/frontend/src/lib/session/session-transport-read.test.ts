/**
 * session-transport-read.test.ts — readSessionTransport (slice remote-warm-reconnect C4).
 *
 * הקדימות עצמה (query ← stored ← env) טסוטת ב-session-transport.test.ts — כאן
 * נבדקת שכבת-הדבק: קריאת location.search/sessionStorage + שמירת ה-query param.
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
  it("no query, no stored, no env → local", () => {
    expect(readSessionTransport(undefined)).toBe("local")
  })

  it("query=remote → resolves remote AND persists to sessionStorage", () => {
    vi.stubGlobal("location", { search: "?sessionTransport=remote" })
    expect(readSessionTransport(undefined)).toBe("remote")
    expect(stores.get("sessionTransport")).toBe("remote")
  })

  it("stored only → resolves from storage (survives goto/refresh)", () => {
    stores.set("sessionTransport", "remote")
    expect(readSessionTransport(undefined)).toBe("remote")
  })

  it("env only → resolves from env", () => {
    expect(readSessionTransport("remote")).toBe("remote")
  })

  it("query overrides stored (and updates storage)", () => {
    stores.set("sessionTransport", "remote")
    vi.stubGlobal("location", { search: "?sessionTransport=local" })
    expect(readSessionTransport(undefined)).toBe("local")
    expect(stores.get("sessionTransport")).toBe("local")
  })

  it("locked precedence: stored beats env when no query", () => {
    stores.set("sessionTransport", "remote")
    expect(readSessionTransport("local")).toBe("remote")
  })

  it("garbage query is persisted (overwrites stored) — exact connect-agent.ts parity", () => {
    // שים לב: בדיוק כמו connect-agent.ts המקורי — `if (q) setItem` שומר את ה-query
    // גם כשהוא זבל, ולכן דורס את ה-stored. התוצאה: query זבל + stored-שנדרס זבל → local.
    stores.set("sessionTransport", "remote")
    vi.stubGlobal("location", { search: "?sessionTransport=bogus" })
    expect(readSessionTransport(undefined)).toBe("local")
    expect(stores.get("sessionTransport")).toBe("bogus")
  })
})
