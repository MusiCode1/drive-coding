import { readFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

const openapi = JSON.parse(
  readFileSync(new URL("../docs/agents/openapi.json", import.meta.url), "utf8"),
)
const rpc = openapi.paths["/api/agents/:id/rpc"].post.requestBody.content["application/json"]
const ajv = new Ajv2020({ strictSchema: false })
const validate = ajv.compile({ ...rpc.schema, components: openapi.components })

describe.each(["session/list", "listSessions"])("generated OpenAPI request for %s", (method) => {
  it.each([
    ["omitted params", {}],
    ["null", { params: null }],
    ["empty params", { params: {} }],
    ["explicit pagination", { params: { paged: true } }],
    ["POSIX cwd and opaque cursor", { params: { cwd: "/demo/project", cursor: " a+/= " } }],
    ["Windows cwd and empty cursor", { params: { cwd: "C:\\demo\\project", cursor: "" } }],
    ["UNC cwd", { params: { cwd: "\\\\demo\\share" } }],
    ["unknown params", { params: { futureOption: ["value"] } }],
    ["integer waitMs", { params: {}, waitMs: 100 }],
    ["out-of-range waitMs", { params: {}, waitMs: -1 }],
    ["fractional waitMs", { waitMs: 0.5 }],
    ["string waitMs", { waitMs: "ignored" }],
    ["object waitMs", { waitMs: {} }],
    ["boolean waitMs", { waitMs: false }],
    ["array waitMs", { waitMs: [] }],
    ["null waitMs", { waitMs: null }],
  ])("accepts %s", (_label, fields) => {
    const valid = validate({ method, ...fields })
    expect(valid, ajv.errorsText(validate.errors)).toBe(true)
  })

  it.each([
    ["paged false", { paged: false }],
    ["relative cwd", { cwd: "demo/project" }],
    ["drive-relative cwd", { cwd: "C:demo" }],
    ["UNC cwd without a share", { cwd: "\\\\demo" }],
    ["numeric cursor", { cursor: 7 }],
    ["array params", []],
  ])("rejects %s", (_label, params) => {
    expect(validate({ method, params })).toBe(false)
  })
})

it("preserves the descriptive RPC branch and its waitMs bounds", () => {
  const body = { method: "session/delete", params: { sessionId: "demo" }, waitMs: 1 }
  const valid = validate(body)
  expect(valid, ajv.errorsText(validate.errors)).toBe(true)
  expect(validate({ ...body, waitMs: "1" })).toBe(false)
  expect(validate({ ...body, params: [] })).toBe(false)
})
