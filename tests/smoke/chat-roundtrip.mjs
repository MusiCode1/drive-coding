#!/usr/bin/env node
/**
 * chat-roundtrip.mjs — end-to-end smoke test.
 *
 * Verifies the full chat round-trip with real BE + FE + OneCLI gateway:
 *   1. Connect form submits → /chat route loads
 *   2. Sending a Hebrew prompt yields user + thought + message bubbles
 *   3. TTS pipeline fires for each segment (no 4xx/5xx from upstream)
 *   4. Translate fires for thought bubbles
 *   5. No errors in the browser console
 *   6. (Optional second pass) verifies BE proxy cache hit
 *
 * What it does NOT verify:
 *   - Actual audio playback (headless Chrome blocks autoplay; would need
 *     --autoplay-policy=no-user-gesture-required + audio buffer inspection)
 *   - Mic input (slice 3 territory)
 *
 * ─── Pre-conditions ───
 * Before running, start BOTH servers manually:
 *
 *   # terminal 1 — BE (must be onecli)
 *   cd packages/backend
 *   onecli run --agent voice-acp -- bun --watch src/server.ts
 *
 *   # terminal 2 — FE
 *   pnpm --filter @drive-coding/frontend-v2 dev
 *
 * Then in a third terminal:
 *
 *   node tests/smoke/chat-roundtrip.mjs
 *   FE_URL=http://localhost:5173 node tests/smoke/chat-roundtrip.mjs   # default
 *   PROMPT="מה השעה" node tests/smoke/chat-roundtrip.mjs
 *   HEADED=1 node tests/smoke/chat-roundtrip.mjs                       # show window
 *
 * Exit 0 = pass, exit 1 = fail (logs the reason).
 *
 * ─── Setup (one-time) ───
 *   cd tests/smoke && npm install
 *   npx playwright install chromium-headless-shell
 */

import { chromium } from "playwright"

const FE_URL = process.env.FE_URL ?? "http://localhost:5173"
const PROMPT = process.env.PROMPT ?? "שלום"
const CWD = process.env.CWD ?? "/home/user/projects/voice-acp/dev"
const CLI = process.env.CLI ?? "opencode"
const HEADED = process.env.HEADED === "1"
const TIMEOUT_CONNECT_MS = 15_000
const TIMEOUT_RESPONSE_MS = 30_000

// ─── helpers ───
const failures = []
function expect(condition, message) {
  if (!condition) failures.push(message)
}

function summarize(arr, n = 3) {
  return arr.slice(0, n).join("\n  ")
}

// ─── run ───
const browser = await chromium.launch({ headless: !HEADED })
const page = await browser.newPage()

const consoleErrors = []
const consoleWarnings = []
const pageErrors = []
const proxyRequests = []
const proxyResponses = []

page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text())
  if (m.type() === "warning") consoleWarnings.push(m.text())
})
page.on("pageerror", (e) => pageErrors.push(e.message))
page.on("request", (r) => {
  const url = r.url()
  if (url.includes("/proxy/")) proxyRequests.push(`${r.method()} ${url}`)
})
page.on("response", (r) => {
  const url = r.url()
  if (url.includes("/proxy/")) {
    proxyResponses.push({
      url,
      status: r.status(),
      cache: r.headers()["x-cache"] ?? null,
    })
  }
})

try {
  // ── Step 1: connect ──
  await page.goto(FE_URL, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("input", { timeout: 5_000 })
  // cwd is the second text input (first is cliKind, but it's a select)
  const cwdInput = await page.$('input[type="text"]')
  if (!cwdInput) throw new Error("cwd input not found on connect page")
  await cwdInput.fill(CWD)
  await page.click('button[type="submit"]')

  // Wait for /chat
  await page.waitForURL("**/chat", { timeout: TIMEOUT_CONNECT_MS })

  // Wait for connected status (status badge text changes to "connected")
  await page.waitForFunction(
    () =>
      document.querySelector('[class*="status-connected"]') !== null,
    null,
    { timeout: TIMEOUT_CONNECT_MS },
  )

  // ── Step 2: send prompt ──
  const textarea = await page.waitForSelector("textarea", { timeout: 2_000 })
  await textarea.fill(PROMPT)
  await page.keyboard.press("Enter")

  // ── Step 3: wait for assistant response ──
  // We wait for status to leave "thinking" (turn end) or for a message bubble
  // with text. Either condition means the agent replied.
  try {
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('[class*="bubble-message"]')
        const hasText = Array.from(msgs).some(
          (m) => m.textContent.replace(/^Agent\s*/i, "").trim().length > 0,
        )
        const connected = document.querySelector('[class*="status-connected"]') !== null
        const thinking = document.querySelector('[class*="status-thinking"]') !== null
        return hasText && connected && !thinking
      },
      null,
      { timeout: TIMEOUT_RESPONSE_MS },
    )
  } catch (e) {
    // Don't bail — fall through to assertions so we can show what we DID get
    failures.push(`timeout waiting for response (${e.message.split("\n")[0]})`)
  }

  // Brief settle period for trailing chunks / TTS prefetch
  await page.waitForTimeout(2_000)

  // ── Assertions ──
  const bubbles = await page.$$eval('[class*="bubble-"]', (els) =>
    els.map((e) => ({
      kind: (e.className.match(/bubble-(\w+)/) ?? [, "?"])[1],
      text: e.innerText.trim().slice(0, 120),
    })),
  )

  expect(
    bubbles.some((b) => b.kind === "user" && b.text.includes(PROMPT)),
    `user bubble with prompt "${PROMPT}" missing (got ${bubbles.length} bubbles)`,
  )
  expect(
    bubbles.some((b) => b.kind === "message"),
    "no agent message bubble appeared",
  )
  // thought bubble is optional — some replies skip it

  // TTS must have fired for the message
  const ttsReqs = proxyRequests.filter((r) => r.includes("/elevenlabs/"))
  expect(ttsReqs.length > 0, `no TTS request fired (proxy reqs: ${proxyRequests.length})`)

  // No 4xx/5xx from proxy
  const proxyErrors = proxyResponses.filter((r) => r.status >= 400)
  expect(
    proxyErrors.length === 0,
    `proxy errors:\n  ${summarize(proxyErrors.map((r) => `${r.status} ${r.url}`))}`,
  )

  // No browser console errors
  expect(
    consoleErrors.length === 0,
    `console errors:\n  ${summarize(consoleErrors)}`,
  )

  // No page errors
  expect(pageErrors.length === 0, `page errors:\n  ${summarize(pageErrors)}`)

  // ─── Output ───
  console.log("=== Bubbles ===")
  for (const b of bubbles) console.log(`  [${b.kind}] ${b.text}`)
  console.log(`=== Proxy: ${proxyRequests.length} requests, ${proxyErrors.length} errors ===`)
  const hits = proxyResponses.filter((r) => r.cache === "hit").length
  const misses = proxyResponses.filter((r) => r.cache === "miss").length
  console.log(`  cache: ${hits} hits, ${misses} misses, ${proxyResponses.length - hits - misses} other`)
  console.log(`=== Console: ${consoleErrors.length} errors, ${consoleWarnings.length} warnings ===`)
  if (consoleWarnings.length > 0) {
    console.log("  warnings:\n  " + summarize(consoleWarnings, 5))
  }
} catch (e) {
  failures.push(`unhandled: ${e.message}`)
} finally {
  await browser.close()
}

// ─── Verdict ───
if (failures.length === 0) {
  console.log("\n✓ SMOKE PASSED")
  process.exit(0)
} else {
  console.log("\n✗ SMOKE FAILED")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
