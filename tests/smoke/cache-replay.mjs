#!/usr/bin/env node
/**
 * cache-replay.mjs — BE proxy cache regression.
 *
 * Verifies that the BE proxy cache returns `x-cache: hit` on the second
 * identical request for the two cacheable upstreams:
 *   - POST /v1beta/models/<m>:generateContent (Gemini translate path)
 *   - POST /v1/text-to-speech/<voiceId>/stream (ElevenLabs TTS)
 *
 * Why we bypass the LLM:
 *   The original brief (§4 Commit 2) considered driving the cache by
 *   sending the same prompt to the agent twice. In practice the LLM is
 *   non-deterministic — `pnpm test` runs of that approach produced 0 hits
 *   on pass 2, even with prompts like "השב במילה אחת בלבד: אישור". §6
 *   Risk #2 allowed a soft assertion as fallback, but a stricter and
 *   faster path is to issue browser-side `fetch()` calls with identical
 *   bodies, bypassing the LLM entirely. This still exercises the full
 *   path through Vite proxy → BE → OneCLI → upstream + cache writeback,
 *   which is exactly what we want to regression-protect.
 *
 * The Gemini call uses a tiny "echo" prompt so the upstream cost is
 * minimal; the ElevenLabs call uses a one-word Hebrew text.
 *
 * Pre-conditions: BE on :4000 (via OneCLI) + FE on :5173.
 *
 * Env overrides: FE_URL, HEADED.
 */

import { chromium } from "playwright"

const FE_URL = process.env.FE_URL ?? "http://localhost:5173"
const HEADED = process.env.HEADED === "1"
const VOICE_ID = process.env.VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL" // Sarah

// Unique nonce per test run so we don't piggyback on cache from a previous
// invocation (which would make pass 1 already a hit and break the assertion
// that pass 2 differs from pass 1).
const NONCE = `cache-replay-${Date.now()}-${Math.floor(Math.random() * 1e9)}`

const failures = []
const result = {
  ok: false,
  feUrl: FE_URL,
  nonce: NONCE,
  tts: { pass1: null, pass2: null },
  translate: { pass1: null, pass2: null },
  failures: [],
}

function expect(condition, message) {
  if (!condition) failures.push(message)
}

const browser = await chromium.launch({ headless: !HEADED })
const page = await browser.newPage()

try {
  // Open the FE so the page has the correct origin for proxied fetches.
  await page.goto(FE_URL, { waitUntil: "domcontentloaded" })

  // ── TTS pass 1 + pass 2 (same body) ──
  const ttsBody = {
    text: NONCE,
    model_id: "eleven_v3",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  }
  result.tts.pass1 = await page.evaluate(
    async ({ voiceId, body }) => {
      const res = await fetch(`/proxy/elevenlabs/v1/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": "browser-placeholder",
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      })
      // Drain body so cache writeback can finish.
      await res.arrayBuffer()
      return { status: res.status, cache: res.headers.get("x-cache") }
    },
    { voiceId: VOICE_ID, body: ttsBody },
  )
  // Give the BE a moment to flush the body+headers files to disk.
  await page.waitForTimeout(500)
  result.tts.pass2 = await page.evaluate(
    async ({ voiceId, body }) => {
      const res = await fetch(`/proxy/elevenlabs/v1/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": "browser-placeholder",
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      })
      await res.arrayBuffer()
      return { status: res.status, cache: res.headers.get("x-cache") }
    },
    { voiceId: VOICE_ID, body: ttsBody },
  )

  expect(result.tts.pass1.status === 200, `TTS pass 1 status ${result.tts.pass1.status} (expected 200)`)
  expect(result.tts.pass2.status === 200, `TTS pass 2 status ${result.tts.pass2.status} (expected 200)`)
  expect(result.tts.pass1.cache === "miss", `TTS pass 1 x-cache should be 'miss', got '${result.tts.pass1.cache}'`)
  expect(result.tts.pass2.cache === "hit", `TTS pass 2 x-cache should be 'hit', got '${result.tts.pass2.cache}'`)

  // ── Translate (Gemini generateContent) pass 1 + pass 2 (same body) ──
  const trBody = {
    contents: [{ role: "user", parts: [{ text: `echo: ${NONCE}` }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 16 },
  }
  result.translate.pass1 = await page.evaluate(
    async ({ body }) => {
      const res = await fetch(`/proxy/google/v1beta/models/gemini-flash-lite-latest:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": "browser-placeholder", "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      await res.arrayBuffer()
      return { status: res.status, cache: res.headers.get("x-cache") }
    },
    { body: trBody },
  )
  await page.waitForTimeout(500)
  result.translate.pass2 = await page.evaluate(
    async ({ body }) => {
      const res = await fetch(`/proxy/google/v1beta/models/gemini-flash-lite-latest:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": "browser-placeholder", "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      await res.arrayBuffer()
      return { status: res.status, cache: res.headers.get("x-cache") }
    },
    { body: trBody },
  )

  expect(
    result.translate.pass1.status === 200,
    `Translate pass 1 status ${result.translate.pass1.status} (expected 200)`,
  )
  expect(
    result.translate.pass2.status === 200,
    `Translate pass 2 status ${result.translate.pass2.status} (expected 200)`,
  )
  expect(
    result.translate.pass1.cache === "miss",
    `Translate pass 1 x-cache should be 'miss', got '${result.translate.pass1.cache}'`,
  )
  expect(
    result.translate.pass2.cache === "hit",
    `Translate pass 2 x-cache should be 'hit', got '${result.translate.pass2.cache}'`,
  )

  console.log("=== Cache replay (browser → /proxy/...) ===")
  console.log(`  nonce: ${NONCE}`)
  console.log(`  TTS:       pass1 ${result.tts.pass1.cache} / pass2 ${result.tts.pass2.cache}`)
  console.log(`  Translate: pass1 ${result.translate.pass1.cache} / pass2 ${result.translate.pass2.cache}`)
} catch (e) {
  failures.push(`unhandled: ${e.message}`)
} finally {
  await browser.close()
}

result.ok = failures.length === 0
result.failures = failures

if (result.ok) {
  console.log("\n✓ CACHE REPLAY PASSED")
} else {
  console.log("\n✗ CACHE REPLAY FAILED")
  for (const f of failures) console.log(`  - ${f}`)
}

console.log("RESULT: " + JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
