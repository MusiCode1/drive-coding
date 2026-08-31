import { describe, expect, test } from "vitest"
import { WsAcpTransport } from "./index.js"

/**
 * Barrel smoke — DoD mutation gate.
 * vi.mock on FE tests bypasses @drive-coding/acp-wire; this import does not.
 * Deleting `export { WsAcpTransport }` from index.ts must fail this file.
 */
describe("package barrel", () => {
  test("exports WsAcpTransport", () => {
    expect(typeof WsAcpTransport).toBe("function")
  })
})
