/**
 * Integration tests for POST /api/recordings.
 *
 * Slice 10 Phase 1 — TDD outer-loop tests written BEFORE implementation.
 *
 * Covers:
 *   - POST /api/recordings with valid base64 → returns { id }
 *   - GET /api/recordings/:id → returns the audio bytes
 *   - POST with missing fields → 400
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createRecordingsStore } from "../src/app/recordings-store.js"
import { registerRecordingsHttp } from "../src/delivery/http-history.js"

// We also need to test the NEW POST /api/recordings endpoint
// (the existing http-history.ts only has GET /api/recordings/:id)
// The POST endpoint is being added in Phase 1.

describe("POST /api/recordings", () => {
  let tmpDir: string
  let app: Hono

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordings-post-test-"))
    const recordingsStore = createRecordingsStore(tmpDir)

    app = new Hono()

    // Register existing GET endpoint
    registerRecordingsHttp(app, { recordingsStore })

    // Dynamically import the new POST endpoint registration
    // (will fail until implemented — that's the RED phase)
    const { registerRecordingsPostHttp } = await import("../src/delivery/http-history.js")
    registerRecordingsPostHttp(app, { recordingsStore })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("POST with valid base64 → returns { id }", async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00])
    const audioBase64 = Buffer.from(audioBytes).toString("base64")

    const res = await app.request("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType: "audio/mpeg" }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(typeof body.id).toBe("string")
    expect(body.id.length).toBeGreaterThan(0)
  })

  it("POST then GET → returns the original audio bytes", async () => {
    const audioBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const audioBase64 = Buffer.from(audioBytes).toString("base64")

    const postRes = await app.request("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType: "audio/mpeg" }),
    })

    const { id } = (await postRes.json()) as { id: string }

    const getRes = await app.request(`/api/recordings/${id}`)
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get("content-type")).toContain("audio/mpeg")

    const buf = await getRes.arrayBuffer()
    expect(new Uint8Array(buf)).toEqual(audioBytes)
  })

  it("POST with missing audioBase64 → 400", async () => {
    const res = await app.request("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "audio/mpeg" }),
    })

    expect(res.status).toBe(400)
  })
})
