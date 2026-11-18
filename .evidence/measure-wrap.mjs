#!/usr/bin/env node
/**
 * Commit 0 baseline measurement — display/width chain on bubble roots.
 * Usage: node .evidence/measure-wrap.mjs [width]
 */
import { chromium } from "playwright"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = "http://localhost:4015/chat?mock=greeting"
const width = Number(process.argv[2] ?? 360)

const chainScript = `
(() => {
  const el = document.querySelector('.flex.gap-2.self-start, .flex.gap-2.self-end, .group.min-w-0')
  if (!el) return { error: 'no bubble root found', selectors: document.body.innerHTML.slice(0, 500) }
  const chain = []
  for (let n = el; n && chain.length < 6; n = n.parentElement) {
    const s = getComputedStyle(n)
    chain.push({
      tag: n.tagName,
      cls: (n.className || '').slice(0, 120),
      display: s.display,
      width: s.width,
      position: s.position,
    })
  }
  return { root: el.className, chain }
})()
`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width, height: 800 })
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForTimeout(2000)

  const result = await page.evaluate(chainScript)
  const out = { width, url: BASE, timestamp: new Date().toISOString(), ...result }
  console.log(JSON.stringify(out, null, 2))

  const outPath = join(__dirname, `commit0-baseline-${width}.json`)
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
