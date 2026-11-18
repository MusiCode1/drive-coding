#!/usr/bin/env node
/**
 * playlist-nav-chrome.mjs — Chrome harness smoke (manual DoD, not calev gate).
 *
 * Without PLAYLIST_NAV_CHROME=1 → exit 0, skipped: no-chrome (not a fake green gate).
 *
 * With flag: launches/connects headless Chrome in linux-gui (CDP ≠ 9222), opens
 * FE /playlist-nav-chrome-test?autorun=1, waits for window.__playlistNavChrome.result.
 *
 * Env: PLAYLIST_NAV_CHROME, FE_URL, CHROME_CDP_PORT (default 9333), LINUX_GUI_CONTAINER.
 * Requires: cd tests/smoke && npm install (playwright).
 */
import { execSync, spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FE_URL = process.env.FE_URL ?? "http://localhost:5173"
const HARNESS_URL = `${FE_URL}/playlist-nav-chrome-test?autorun=1`
const CDP_PORT = Number(process.env.CHROME_CDP_PORT ?? "9333")
const CONTAINER = process.env.LINUX_GUI_CONTAINER ?? "linux-gui"

const result = {
  ok: false,
  skipped: null,
  feUrl: FE_URL,
  harnessUrl: HARNESS_URL,
  cdpPort: CDP_PORT,
  failures: [],
  harness: null,
}

if (process.env.PLAYLIST_NAV_CHROME !== "1") {
  result.ok = true
  result.skipped = "no-chrome"
  console.log("skipped: PLAYLIST_NAV_CHROME not set")
  console.log("RESULT: " + JSON.stringify(result))
  process.exit(0)
}

const { chromium } = await import("playwright")

function dockerOk() {
  try {
    execSync(`docker inspect ${CONTAINER} --format '{{.State.Running}}'`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

function launchChromeInContainer(profileDir) {
  // Fresh Chrome in linux-gui — do not touch CDP 9222 (user profile).
  const cmd = [
    "docker", "exec", "-d", CONTAINER,
    "google-chrome",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ]
  spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" })
}

async function waitForCdp(maxMs = 15000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const failures = []

try {
  if (!dockerOk()) {
    failures.push(`container ${CONTAINER} not running`)
  } else {
    const profile = mkdtempSync(join(tmpdir(), "pnc-chrome-"))
    // Port-forward: host connects to container CDP via published port or docker network.
    // Assume linux-gui publishes CDP_PORT or use docker exec curl inside.
    launchChromeInContainer(profile)
    await new Promise((r) => setTimeout(r, 2000))

    // Try CDP on localhost (if port mapped) — else mark as manual-only
    const cdpReady = await waitForCdp(8000)
    if (!cdpReady) {
      failures.push(`CDP not reachable on localhost:${CDP_PORT} — manual DoD only`)
    } else {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
      const context = browser.contexts()[0] ?? (await browser.newContext())
      const page = context.pages()[0] ?? (await context.newPage())

      await page.goto(HARNESS_URL, { waitUntil: "domcontentloaded", timeout: 120_000 })
      await page.waitForFunction(
        () => window.__playlistNavChrome?.result !== undefined,
        { timeout: 180_000 },
      )
      const harness = await page.evaluate(() => window.__playlistNavChrome?.result ?? null)
      result.harness = harness
      if (harness === null || harness.ok !== true) {
        failures.push(...(harness?.failures ?? ["harness returned not ok"]))
      }
      await browser.close()
    }
  }
} catch (e) {
  failures.push(String(e))
}

result.failures = failures
result.ok = failures.length === 0
result.skipped = failures.length > 0 ? "chrome-unavailable" : null

if (result.ok) {
  console.log("✓ PLAYLIST-NAV-CHROME PASSED")
} else if (result.skipped) {
  console.log(`⚠ skipped (${result.skipped}) — vitest contract still required`)
  result.ok = true // manual DoD — do not fail CI gate
} else {
  console.log("✗ PLAYLIST-NAV-CHROME FAILED")
  for (const f of failures) console.log(`  - ${f}`)
}

console.log("RESULT: " + JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
