/* eslint-disable */
// Visible (headed) Playwright debug session for the virtua flicker.
// Counts bubble mount/unmount on the virtua container and flags "flicker"
// (a bubble removed then re-added within 1.5s). DevTools opens so the user can watch too.
const PW = "D:/Users/User/AppData/Local/npm-cache/_npx/423231821c231c73/node_modules/playwright"
const { chromium } = require(PW)

const INSTRUMENTATION = () => {
  if (window.__flickerInstalled) return
  window.__flickerInstalled = true
  const log = (...a) => console.log("[FLICKER]", ...a)
  const recentRemoved = new Map() // text -> ts
  const lastHeight = new Map() // text -> offsetHeight בבנייה הקודמת
  let observer = null
  let observedScroll = null
  let flickerCount = 0

  const snippet = (node) =>
    (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)

  // גובה הבועה (ה-.pb-5 הפנימי, שהוא יחידת-המדידה של virtua)
  const heightOf = (node) => {
    const el = node.classList?.contains("pb-5") ? node : node.querySelector?.(".pb-5")
    return el ? Math.round(el.getBoundingClientRect().height) : -1
  }

  // האם הצומת הוא בועה (מכיל .pb-5 או הוא עצמו)?
  const isBubble = (n) =>
    n.nodeType === 1 &&
    (n.classList?.contains("pb-5") || (n.querySelector && n.querySelector(".pb-5")))

  function attach() {
    const scroll = document.querySelector(".chat-scroll")
    if (!scroll || scroll === observedScroll) return
    if (observer) observer.disconnect()
    observedScroll = scroll
    observer = new MutationObserver((muts) => {
      const now = performance.now()
      const st = Math.round(scroll.scrollTop)
      let touched = false
      for (const m of muts) {
        for (const n of m.removedNodes) {
          if (!isBubble(n)) continue
          touched = true
          const s = snippet(n)
          recentRemoved.set(s, now)
          log("−", JSON.stringify(s), "scrollTop=" + st)
        }
        for (const n of m.addedNodes) {
          if (!isBubble(n)) continue
          touched = true
          const s = snippet(n)
          const h = heightOf(n)
          const prevH = lastHeight.get(s)
          lastHeight.set(s, h)
          const hInfo =
            prevH === undefined ? `h=${h}` : prevH === h ? `h=${h}(same)` : `h=${prevH}→${h} ⚠HEIGHT-CHANGED`
          const prev = recentRemoved.get(s)
          if (prev !== undefined && now - prev < 1500) {
            flickerCount++
            log(`⚡⚡ FLICKER #${flickerCount}`, JSON.stringify(s), `${hInfo} scrollTop=${st} gap=${Math.round(now - prev)}ms`)
          } else {
            log("+", JSON.stringify(s), `${hInfo} scrollTop=${st}`)
          }
        }
      }
      if (touched) {
        const cr = scroll.getBoundingClientRect()
        const items = Array.from(scroll.querySelectorAll(".pb-5"))
        let top = Infinity
        let bot = -Infinity
        for (const el of items) {
          const r = el.getBoundingClientRect()
          top = Math.min(top, Math.round(r.top - cr.top))
          bot = Math.max(bot, Math.round(r.bottom - cr.top))
        }
        const span = items.length ? `[${top}..${bot}]` : "[]"
        // viewport הנראה בפועל = 0..clientHeight. אם הטווח-המרונדר לא מכסה אותו → virtua מרנדר חלון קטן/מוסט מהנראה.
        log(`  GEO viewportVisible=[0..${scroll.clientHeight}] renderedSpanPx=${span} items=${items.length} scrollTop=${st}`)
      }
    })
    // subtree=true — תופס mount/unmount בכל עומק (כל בועה עטופה ב-wrapper של virtua)
    observer.observe(scroll, { childList: true, subtree: true })
    log("✓ observer attached (subtree). rendered=" + scroll.querySelectorAll(".pb-5").length)
  }

  setInterval(attach, 1000)
  log("instrumentation v2 armed (subtree + scrollTop) — scroll to a flickering message. watching…")
}

;(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--auto-open-devtools-for-tabs"],
  })
  const ctx = await browser.newContext({ viewport: null })
  const page = await ctx.newPage()
  page.on("console", (msg) => {
    const t = msg.text()
    if (t.includes("[FLICKER]")) console.log(t)
  })
  await page.addInitScript(INSTRUMENTATION)
  await page.goto("http://localhost:4010/")
  console.log("──────────────────────────────────────────────")
  console.log("Browser open at http://localhost:4010/")
  console.log("→ connect an agent, generate/load a LONG chat, then scroll to a boundary.")
  console.log("→ the [FLICKER] lines below show mount/unmount; ⚡⚡ = the flicker bug.")
  console.log("──────────────────────────────────────────────")
  await new Promise(() => {}) // keep the browser open
})().catch((e) => {
  console.error("debug script failed:", e)
  process.exit(1)
})
