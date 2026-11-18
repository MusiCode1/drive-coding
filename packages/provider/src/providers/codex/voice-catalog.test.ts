/**
 * voice-catalog.test.ts — the static catalog stays consistent with what Codex offers (slice codex-voice-poc).
 */

import { describe, expect, it } from "vitest"
import { CODEX_VOICE_CATALOG } from "./voice-catalog.js"

/** `thread/realtime/listVoices` v3, codex 0.167.0. */
const CODEX_V3_VOICES =
  "juniper maple spruce ember vale breeze arbor sol cove aube bubbie haetsal hanul himari leher miko neer porto rindo rio rivage selva sonna tinta viola".split(
    " ",
  )

describe("CODEX_VOICE_CATALOG", () => {
  it("covers every Codex voice except the two ChatGPT does not offer", () => {
    const missing = CODEX_V3_VOICES.filter((v) => !(v in CODEX_VOICE_CATALOG))
    expect(missing).toEqual(["porto", "selva"])
  })

  it("only lists voices Codex offers, each with a sample on OpenAI's public CDN", () => {
    for (const [id, info] of Object.entries(CODEX_VOICE_CATALOG)) {
      expect(CODEX_V3_VOICES).toContain(id)
      expect(info.previewUrl).toMatch(
        /^https:\/\/persistent\.oaistatic\.com\/voice\/previews\/[a-z]+\.en\.[a-z0-9]+\.m4a$/,
      )
    }
  })

  it("keeps ChatGPT's own ids for the three renamed voices", () => {
    expect(CODEX_VOICE_CATALOG.spruce?.chatgptId).toBe("orbit")
    expect(CODEX_VOICE_CATALOG.sol?.chatgptId).toBe("glimmer")
    expect(CODEX_VOICE_CATALOG.arbor?.chatgptId).toBe("fathom")
  })
})
