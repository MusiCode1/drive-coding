import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { registerDocsHttp } from "./http-docs.js"

describe("HTTP agent docs", () => {
  const app = new Hono()
  registerDocsHttp(app)

  it("GET /api/docs returns catalog with 17 entries", async () => {
    const res = await app.request("/api/docs")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      docsVersion: string
      routeCount: number
      docs: unknown[]
    }
    expect(body.docsVersion).toBe("1.2.0")
    expect(body.docs).toHaveLength(17)
    expect(body.routeCount).toBeGreaterThanOrEqual(39)
  })

  it("GET /api/docs/:id returns markdown with version headers", async () => {
    const res = await app.request("/api/docs/render-contract")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(res.headers.get("X-Drive-Coding-Docs-Version")).toBe("1.2.0")
    const text = await res.text()
    expect(text).toContain("render-contract")
  })

  it("GET /api/docs/:id unknown → 404 JSON", async () => {
    const res = await app.request("/api/docs/no-such-doc")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
  })

  it("GET /api/openapi.json includes x-drive-coding block", async () => {
    const res = await app.request("/api/openapi.json")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      openapi: string
      "x-drive-coding"?: { routeCount: number }
    }
    expect(body.openapi).toBe("3.1.1")
    expect(body["x-drive-coding"]?.routeCount).toBeGreaterThanOrEqual(39)
  })
})
