#!/usr/bin/env node
/**
 * disconnect.mjs — regression for Bug D1 (spurious `WS closed (1005)` error).
 *
 * Bug D1 history:
 *   The user clicks the Disconnect button → `AgentSession.detach()` closes
 *   the WS and `goto("/")` navigates back to the connect page. The browser
 *   then closes the WS asynchronously; without the `#detached` guard
 *   (agent-session.svelte.ts:58/73/88/117) the `transport.onClose` handler
 *   would land AFTER detach has already cleared state, set
 *   `session.error = "WS closed (1005): no reason"`, and the connect
 *   page's `{#if session.error}` would surface the error banner.
 *
 * Asserts:
 *   1. URL after disconnect = FE_URL (`/`).
 *   2. NO `.error` element on the connect page.
 *   3. NO console errors land between the click and the post-settle period
 *      (the spurious WS close fires within ~1s of detach).
 *
 * Pre-conditions: BE on :4000 (via OneCLI) + FE on :5173.
 *
 * Env: FE_URL, CWD, HEADED (same as chat-roundtrip.mjs).
 */

import { chromium } from "playwright"

const FE_URL = process.env.FE_URL ?? "http://localhost:5173"
const CWD = process.env.CWD ?? "/home/user/projects/voice-acp/dev"
const HEADED = process.env.HEADED === "1"
const TIMEOUT_CONNECT_MS = 15_000
const POST_DISCONNECT_SETTLE_MS = 2_000

const failures = []
const result = {
  ok: false,
  feUrl: FE_URL,
  disconnect: {
    urlAfter: null,
    hadErrorBanner: false,
    consoleErrorsAfterDisconnect: 0,
    pageErrorsAfterDisconnect: 0,
    errorDetails: [],
  },
  failures: [],
}

function expect(condition, message) {
  if (!condition) failures.push(message)
}

const browser = await chromium.launch({ headless: !HEADED })
const page = await browser.newPage()

const consoleErrors = []
const pageErrors = []
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ ts: Date.now(), text: m.text() })
})
page.on("pageerror", (e) => pageErrors.push({ ts: Date.now(), text: e.message }))

try {
  // ── Step 1: connect ──
  await page.goto(FE_URL, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("input", { timeout: 5_000 })
  const cwdInput = await page.$('input[type="text"]')
  if (!cwdInput) throw new Error("cwd input not found")
  await cwdInput.fill(CWD)
  await page.click('button[type="submit"]')

  await page.waitForURL("**/chat", { timeout: TIMEOUT_CONNECT_MS })
  await page.waitForFunction(
    () => document.querySelector('[class*="status-connected"]') !== null,
    null,
    { timeout: TIMEOUT_CONNECT_MS },
  )

  // ── Step 2: snapshot pre-disconnect error counts ──
  const beforeDisconnect = Date.now()

  // ── Step 3: click Disconnect ──
  // The button is in ChatHeader: `<button class="disconnect">`.
  await page.click("button.disconnect")

  // ── Step 4: wait for navigation back to / ──
  await page.waitForURL(new RegExp(`^${FE_URL.replace(/\//g, "\\/")}/?$`), {
    timeout: 5_000,
  })

  // ── Step 5: settle for async WS close events ──
  // Without the #detached guard, the spurious "WS closed (1005)" lands here.
  await page.waitForTimeout(POST_DISCONNECT_SETTLE_MS)

  // ── Step 6: capture URL ──
  result.disconnect.urlAfter = page.url()
  // Trim trailing slash so both "/" and "" are accepted as "/".
  const normalized = result.disconnect.urlAfter.replace(/\/$/, "")
  const expectedNormalized = FE_URL.replace(/\/$/, "")
  expect(
    normalized === expectedNormalized,
    `URL after disconnect should be ${FE_URL}, got ${result.disconnect.urlAfter}`,
  )

  // ── Step 7: no error banner on connect page ──
  const errorEls = await page.$$('[class*="error"]')
  result.disconnect.hadErrorBanner = errorEls.length > 0
  if (result.disconnect.hadErrorBanner) {
    // capture the text for the failure message
    const texts = await Promise.all(errorEls.map((el) => el.innerText().catch(() => "?")))
    failures.push(`error banner present on connect page: ${JSON.stringify(texts)}`)
  }

  // ── Step 8: no new console / page errors since disconnect click ──
  const newConsoleErrors = consoleErrors.filter((e) => e.ts >= beforeDisconnect)
  const newPageErrors = pageErrors.filter((e) => e.ts >= beforeDisconnect)
  result.disconnect.consoleErrorsAfterDisconnect = newConsoleErrors.length
  result.disconnect.pageErrorsAfterDisconnect = newPageErrors.length
  result.disconnect.errorDetails = [
    ...newConsoleErrors.slice(0, 5).map((e) => `console: ${e.text}`),
    ...newPageErrors.slice(0, 5).map((e) => `page: ${e.text}`),
  ]
  expect(
    newConsoleErrors.length === 0,
    `${newConsoleErrors.length} console error(s) since disconnect: ${newConsoleErrors
      .slice(0, 3)
      .map((e) => e.text)
      .join(" | ")}`,
  )
  expect(
    newPageErrors.length === 0,
    `${newPageErrors.length} page error(s) since disconnect: ${newPageErrors
      .slice(0, 3)
      .map((e) => e.text)
      .join(" | ")}`,
  )

  console.log(`=== Disconnect ===`)
  console.log(`  URL after: ${result.disconnect.urlAfter}`)
  console.log(`  error banner: ${result.disconnect.hadErrorBanner ? "PRESENT (BAD)" : "absent"}`)
  console.log(
    `  console errors after disconnect: ${result.disconnect.consoleErrorsAfterDisconnect}`,
  )
  console.log(`  page errors after disconnect: ${result.disconnect.pageErrorsAfterDisconnect}`)
} catch (e) {
  failures.push(`unhandled: ${e.message}`)
} finally {
  await browser.close()
}

result.ok = failures.length === 0
result.failures = failures

if (result.ok) {
  console.log("\n✓ DISCONNECT PASSED")
} else {
  console.log("\n✗ DISCONNECT FAILED")
  for (const f of failures) console.log(`  - ${f}`)
}

console.log("RESULT: " + JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
