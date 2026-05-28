#!/usr/bin/env node
/**
 * voice-picker.mjs — slice 9a regression: the voice picker on the connect form.
 *
 * Asserts:
 *   1. Connect page has at least 2 <select>s (cliKind + voice) — voice is the 2nd.
 *   2. The voice <select> gets populated with ≥ 1 option from ElevenLabs
 *      (the BE proxies `/proxy/elevenlabs/v1/voices`, OneCLI injects xi-api-key).
 *   3. Default voiceId before any user action = Sarah (`EXAVITQu4vr4xnSDxMaL`).
 *   4. Selecting a different voice persists it to localStorage
 *      (`drive-coding-v2-settings` → `voiceId`).
 *   5. After reload, the newly-selected voiceId is still selected.
 *   6. The BE was hit for `/proxy/elevenlabs/v1/voices` (GET).
 *
 * Pre-conditions: BE on :4000 (via OneCLI) + FE on :5173. See README.md.
 *
 * Env overrides: FE_URL, HEADED (same convention as chat-roundtrip.mjs).
 *
 * Exit 0 = pass, exit 1 = fail.
 */

import { chromium } from "playwright"

const FE_URL = process.env.FE_URL ?? "http://localhost:5173"
const HEADED = process.env.HEADED === "1"
const STORAGE_KEY = "drive-coding-v2-settings"
const SARAH_ID = "EXAVITQu4vr4xnSDxMaL"
const TIMEOUT_VOICES_MS = 15_000

const failures = []
const result = {
  ok: false,
  feUrl: FE_URL,
  voices: {
    count: 0,
    initialVoiceId: null,
    pickedVoiceId: null,
    persistedVoiceId: null,
    voicesProxyHit: false,
  },
  failures: [],
}

function expect(condition, message) {
  if (!condition) failures.push(message)
}

const browser = await chromium.launch({ headless: !HEADED })
const context = await browser.newContext()
const page = await context.newPage()

const proxyHits = []
page.on("request", (r) => {
  if (r.url().includes("/proxy/elevenlabs/v1/voices")) {
    proxyHits.push(`${r.method()} ${r.url()}`)
  }
})

try {
  // ── Step 1: open connect page with clean storage ──
  await page.goto(FE_URL, { waitUntil: "domcontentloaded" })
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY)
  await page.reload({ waitUntil: "domcontentloaded" })

  // ── Step 2: find the voice <select> (the 2nd select on the page;
  //           cliKind is the 1st). ──
  await page.waitForSelector("select", { timeout: 5_000 })
  const selects = await page.$$("select")
  expect(selects.length >= 2, `expected ≥ 2 selects on connect page, got ${selects.length}`)
  const voiceSelect = selects[1]
  if (!voiceSelect) throw new Error("voice <select> not found")

  // ── Step 3: wait for the voice catalog to populate (loadVoices is fired
  //           in $effect on mount of <VoicePicker>). ──
  await page.waitForFunction(
    () => {
      const sel = document.querySelectorAll("select")[1]
      // populated = more than just the single placeholder
      return sel !== undefined && sel.options.length > 1
    },
    null,
    { timeout: TIMEOUT_VOICES_MS },
  )

  const options = await voiceSelect.$$eval("option", (els) =>
    els.map((e) => ({ value: e.value, text: e.textContent?.trim() ?? "" })),
  )
  result.voices.count = options.length
  expect(options.length >= 1, `voice catalog empty (got ${options.length} options)`)

  // ── Step 4: default selected = Sarah ──
  result.voices.initialVoiceId = await voiceSelect.evaluate((el) => el.value)
  expect(
    result.voices.initialVoiceId === SARAH_ID,
    `default voiceId should be Sarah (${SARAH_ID}), got ${result.voices.initialVoiceId}`,
  )

  // ── Step 5: pick a different voice ──
  const otherVoice = options.find((o) => o.value && o.value !== SARAH_ID)
  if (!otherVoice) {
    failures.push("only one voice in catalog — cannot test selection change")
  } else {
    await voiceSelect.selectOption(otherVoice.value)
    result.voices.pickedVoiceId = otherVoice.value

    // localStorage was written by setVoiceId → #persist
    const persisted = await page.evaluate((k) => {
      const raw = localStorage.getItem(k)
      return raw ? JSON.parse(raw) : null
    }, STORAGE_KEY)
    expect(
      persisted !== null && persisted.voiceId === otherVoice.value,
      `localStorage voiceId should be ${otherVoice.value}, got ${persisted?.voiceId}`,
    )

    // ── Step 6: reload and assert the picked voice is still selected ──
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForSelector("select", { timeout: 5_000 })
    await page.waitForFunction(
      () => {
        const sel = document.querySelectorAll("select")[1]
        return sel !== undefined && sel.options.length > 1
      },
      null,
      { timeout: TIMEOUT_VOICES_MS },
    )
    const stillSelected = await page.evaluate(() => {
      const sel = document.querySelectorAll("select")[1]
      return sel?.value ?? null
    })
    result.voices.persistedVoiceId = stillSelected
    expect(
      stillSelected === otherVoice.value,
      `after reload, voiceId should be ${otherVoice.value}, got ${stillSelected}`,
    )
  }

  // ── Step 7: BE was hit for voices ──
  result.voices.voicesProxyHit = proxyHits.length > 0
  expect(proxyHits.length > 0, "no GET /proxy/elevenlabs/v1/voices fired")

  // ── Human-readable output ──
  console.log(`=== Voice picker (${FE_URL}) ===`)
  console.log(`  catalog: ${result.voices.count} voices`)
  console.log(`  initial: ${result.voices.initialVoiceId}`)
  console.log(`  picked:  ${result.voices.pickedVoiceId}`)
  console.log(`  after reload: ${result.voices.persistedVoiceId}`)
  console.log(`  proxy hits: ${proxyHits.length}`)
} catch (e) {
  failures.push(`unhandled: ${e.message}`)
} finally {
  await context.close()
  await browser.close()
}

result.ok = failures.length === 0
result.failures = failures

if (result.ok) {
  console.log("\n✓ VOICE PICKER PASSED")
} else {
  console.log("\n✗ VOICE PICKER FAILED")
  for (const f of failures) console.log(`  - ${f}`)
}

console.log("RESULT: " + JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
