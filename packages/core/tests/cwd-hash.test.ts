/**
 * cwd-hash.test.ts — TDD for cwdToHash (Web Crypto, cross-platform).
 *
 * Critical invariant: cwdToHash must produce the same output as Node's
 *   createHash('sha256').update(cwd).digest('base64url')
 * so that FE-computed hashes match BE-stored hashes in projectsRegistry.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { cwdToHash } from "../src/cwd-hash"

/** Ground-truth using Node crypto — used to validate our Web Crypto impl. */
function nodeHash(s: string): string {
  return createHash("sha256").update(s).digest("base64url")
}

describe("cwdToHash", () => {
  it("matches Node crypto for a typical project path", async () => {
    const cwd = "/home/user/projects/voice-acp-v3"
    expect(await cwdToHash(cwd)).toBe(nodeHash(cwd))
  })

  it("matches Node crypto for root path", async () => {
    const cwd = "/home/user"
    expect(await cwdToHash(cwd)).toBe(nodeHash(cwd))
  })

  it("matches Node crypto for path with Hebrew characters", async () => {
    const cwd = "/home/user/פרויקט"
    expect(await cwdToHash(cwd)).toBe(nodeHash(cwd))
  })

  it("matches Node crypto for path with spaces", async () => {
    const cwd = "/home/user/my project/with spaces"
    expect(await cwdToHash(cwd)).toBe(nodeHash(cwd))
  })

  it("is case-sensitive (Linux paths are)", async () => {
    const a = await cwdToHash("/home/user/Foo")
    const b = await cwdToHash("/home/user/foo")
    expect(a).not.toBe(b)
  })

  it("produces URL-safe base64url (no +, /, =)", async () => {
    // Run on many inputs to increase confidence
    const paths = ["/home/user/projects/voice-acp-v3", "/tmp/test", "/home/user/פרויקט", "/a"]
    for (const cwd of paths) {
      const hash = await cwdToHash(cwd)
      expect(hash).not.toMatch(/[+/=]/)
    }
  })
})
