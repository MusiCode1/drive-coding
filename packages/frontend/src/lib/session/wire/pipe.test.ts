import { describe, expect, it } from "vitest"
import { PipeError, resultOf } from "./pipe"

describe("resultOf", () => {
  it("returns the response body across the 2xx range", () => {
    const body = { value: 42 }
    expect(resultOf({ status: 200, body }, "POST /rpc")).toBe(body)
    expect(resultOf({ status: 204, body: undefined }, "WS reply")).toBeUndefined()
    expect(resultOf({ status: 299, body }, "WS rpc")).toBe(body)
  })

  it("preserves the HTTP error message and numeric RPC code", () => {
    expect(() =>
      resultOf({ status: 500, body: { error: "failed", code: -32603 } }, "POST /rpc"),
    ).toThrow(
      expect.objectContaining({
        message: "RemoteSessionView: POST /rpc failed with status 500 (failed)",
        code: -32603,
      }),
    )
  })

  it("uses the transport label and ignores nonstandard error fields", () => {
    expect(() => resultOf({ status: 401, body: { error: 5, code: "401" } }, "WS rpc")).toThrow(
      "RemoteSessionView: WS rpc failed with status 401",
    )
    expect(() => resultOf({ status: 300, body: null }, "WS reply")).toThrow(
      "RemoteSessionView: WS reply failed with status 300",
    )
  })
})

describe("PipeError", () => {
  it("carries the status and decoded body intact", () => {
    const body = { authMethods: [{ id: "login" }] }
    const error = new PipeError(401, body, "Connection refused")
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ status: 401, message: "Connection refused" })
    expect(error.body).toBe(body)
  })
})
