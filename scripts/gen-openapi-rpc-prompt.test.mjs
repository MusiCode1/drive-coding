import { readFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

const openapi = JSON.parse(
  readFileSync(new URL("../docs/agents/openapi.json", import.meta.url), "utf8"),
)
const responses = openapi.paths["/api/agents/:id/rpc"].post.responses
const ajv = new Ajv2020({ strictSchema: false })
const validate = ajv.compile(responses["409"].content["application/json"].schema)

describe("generated OpenAPI response for RPC conflicts", () => {
  it.each(["session_busy", "prompt_session_mismatch"])("accepts %s", (code) => {
    const valid = validate({ error: "Conflict", code })
    expect(valid, ajv.errorsText(validate.errors)).toBe(true)
  })

  it.each([
    [{ error: "Conflict", code: "unrelated_conflict" }],
    [{ error: "Conflict" }],
    [{ code: "prompt_session_mismatch" }],
    [{ error: 409, code: "prompt_session_mismatch" }],
  ])("rejects an unrecognized or incomplete body (%j)", (body) => {
    expect(validate(body)).toBe(false)
  })
})
