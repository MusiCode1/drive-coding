#!/usr/bin/env node
/** Post-Commit 2 alignment measurement at 320/360/1280 */
import { chromium } from "playwright"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = "http://localhost:4015/chat?mock=greeting"
const outDir = "/home/user/Projects/drive-coding/.worktrees/bubble-alignment-rail/.evidence"

const measureScript = `
(() => {
  const rows = [...document.querySelectorAll('.bubble-row')]
  if (!rows.length) return { error: 'no .bubble-row found' }

  const results = rows.map((row) => {
    const side = row.getAttribute('data-side')
    const avatar = row.querySelector('.avatar')
    const content = row.querySelector('.bubble-row-content')
    const rowRect = row.getBoundingClientRect()
    const chain = []
    for (let n = row; n && chain.length < 6; n = n.parentElement) {
      const s = getComputedStyle(n)
      chain.push({ tag: n.tagName, cls: (n.className||'').slice(0,80), display: s.display, width: s.width, position: s.position })
    }
    const out = { side, chain }
    if (avatar && content) {
      const a = avatar.getBoundingClientRect()
      const c = content.getBoundingClientRect()
      out.avatarAboveContent = a.bottom <= c.top + 1
      out.contentInlineStart = c.left
      out.rowInlineStart = rowRect.left
      out.inlineStartDelta = Math.abs(c.left - rowRect.left)
      out.sameRow = a.bottom > c.top + 1 && Math.abs(a.top - c.top) <= 2
      out.contentInlineStartAligned = out.inlineStartDelta <= 1
      out.rowContained = rowRect.left >= 0 && rowRect.right <= (document.documentElement.clientWidth || window.innerWidth)
    }
    return out
  })
  return { count: rows.length, rows: results }
})()
`

async function measure(width) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width, height: 800 })
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForTimeout(2500)
  const result = await page.evaluate(measureScript)
  await browser.close()
  const out = { width, url: BASE, timestamp: new Date().toISOString(), ...result }
  writeFileSync(join(outDir, `commit2-post-${width}.json`), JSON.stringify(out, null, 2))
  return out
}

const widths = [320, 360, 1280]
const all = []
for (const w of widths) {
  all.push(await measure(w))
  console.log(`--- ${w}px ---`)
  console.log(JSON.stringify(all.at(-1), null, 2))
}
