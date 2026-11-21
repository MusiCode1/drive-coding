/**
 * transport-points.test.ts — closed allowlist for sessionTransport injection (#127).
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** Returns relative paths under packages/frontend/src that match transport routing patterns. */
export function findTransportPoints(files: { path: string; text: string }[]): string[] {
  const hits: string[] = []
  for (const file of files) {
    if (
      file.text.includes("readSessionTransport(") ||
      file.text.includes('transport === "http"') ||
      file.text.includes('transport === "ws"')
    ) {
      hits.push(file.path)
    }
  }
  return hits.sort()
}

const ALLOWLIST = [
  "lib/session/session-transport-read.ts", // definition
  "lib/session/session-url.ts", // sessionPathWithTransport query flag
  "lib/actions/open-session-url.ts", // exact-host attach branch
  "lib/actions/reconnect-agent.ts", // reconnect routing
  "lib/actions/connect-agent.ts", // connect flow
  "lib/components/chat/bubbles/UserBubble.svelte", // resend uses transport
  "routes/+page.svelte", // home connect + handleReconnect
  "lib/components/layout/SessionOptionsPanel.svelte", // panel transport toggle
  "lib/actions/open-session-cold.ts", // cold URL HTTP/WS branch
] as const

function collectSourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  function walk(dir: string, rel: string) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name.startsWith(".")) continue
      const abs = join(dir, name.name)
      const relPath = rel ? `${rel}/${name.name}` : name.name
      if (name.isDirectory()) {
        walk(abs, relPath)
        continue
      }
      if (!/\.(ts|svelte)$/.test(name.name)) continue
      if (/\.test\./.test(name.name)) continue
      out.push({ path: relPath, text: readFileSync(abs, "utf8") })
    }
  }
  walk(SRC_ROOT, "")
  return out
}

describe("transport injection points allowlist", () => {
  it("negative control: fixture files are detected", () => {
    const hits = findTransportPoints([
      {
        path: "lib/fixture/has-read.ts",
        text: 'const t = readSessionTransport({ env: "", stored: null })',
      },
      {
        path: "routes/fixture/+page.svelte",
        text: 'if (transport === "http") { goto("/") }',
      },
      { path: "lib/fixture/clean.ts", text: "export const x = 1" },
    ])
    expect(hits).toEqual(["lib/fixture/has-read.ts", "routes/fixture/+page.svelte"])
  })

  it("live scan: every hit is on the allowlist and every allowlist entry is live", () => {
    const files = collectSourceFiles()
    const hits = findTransportPoints(files)
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(ALLOWLIST as readonly string[]).toContain(hit)
    }
    for (const entry of ALLOWLIST) {
      expect(hits).toContain(entry)
    }
  })
})