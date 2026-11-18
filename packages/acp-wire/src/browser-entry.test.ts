import { describe, expect, test } from "vitest"
import { WsAcpTransport } from "./browser.js"

/**
 * Browser-entry smoke — DoD mutation gate.
 * vi.mock on FE tests bypasses @drive-coding/acp-wire; this import does not.
 * Deleting `export { WsAcpTransport }` from browser.ts must fail this file.
 *
 * Imports ./browser.js, not ./index.js: the root barrel is platform-neutral
 * and the FE reaches WsAcpTransport through @drive-coding/acp-wire/browser.
 */
describe("package barrel", () => {
  test("exports WsAcpTransport", () => {
    expect(typeof WsAcpTransport).toBe("function")
  })
})
