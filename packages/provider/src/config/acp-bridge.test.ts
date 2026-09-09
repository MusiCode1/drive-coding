/**
 * acp-bridge.test.ts — which bridge a sidecar will actually run.
 *
 * The point of the module is that the answer is *not* whatever the cli-spec
 * says: the spec fetches `@latest` over the network, and the version that
 * arrives is not the one anything here has been tested against.
 */

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { resolveVendoredAcpBridge } from "./acp-bridge.js"

describe("resolveVendoredAcpBridge", () => {
  it("🔴 resolves claude to the copy we ship, not to a network fetch", () => {
    // Measured 2026-09-08: `npx -y …@latest` took 23s and produced 0.75.1,
    // while the pinned dependency — the one connect-in-process imports as a
    // library — is 0.58.x. Two bridges of different versions for one CLI,
    // chosen by code path, is not a difference anyone debugs quickly.
    const cmd = resolveVendoredAcpBridge("claude")
    expect(cmd).not.toBeNull()
    expect(cmd?.args[0]).toMatch(/claude-agent-acp[/\\].*\.js$/)
    expect(existsSync(cmd?.args[0] ?? "")).toBe(true)
  })

  it("runs it with the interpreter already running us, by absolute path", () => {
    // A transient systemd unit gets a PATH that finds neither bun nor node
    // (measured: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin).
    const cmd = resolveVendoredAcpBridge("claude")
    expect(cmd?.bin).toBe(process.execPath)
    expect(cmd?.bin.startsWith("/")).toBe(true)
  })

  it("the resolved entry is the package's declared bin", () => {
    const require_ = createRequire(import.meta.url)
    const manifest = require_("@agentclientprotocol/claude-agent-acp/package.json") as {
      bin: Record<string, string>
    }
    const declared = Object.values(manifest.bin)[0]
    expect(resolveVendoredAcpBridge("claude")?.args[0]).toContain(
      declared?.replace(/^\.\//, "") ?? "",
    )
  })

  it("returns null for a CLI that speaks ACP itself — no override wanted", () => {
    for (const kind of ["cursor", "opencode", "gemini"]) {
      expect(resolveVendoredAcpBridge(kind)).toBeNull()
    }
  })

  it("returns null for an unknown cliKind rather than throwing", () => {
    expect(resolveVendoredAcpBridge("nonsense")).toBeNull()
  })
})
