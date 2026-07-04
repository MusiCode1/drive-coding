import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// find any element containing an agentId hex8 and report its clickable ancestor
const info = await page.evaluate(() => {
  const walker = document.querySelectorAll('*');
  for (const el of walker) {
    if (el.children.length === 0 && /^[0-9a-f]{8}$/.test(el.textContent.trim())) {
      // climb to clickable
      let p = el, chain = [];
      while (p && chain.length < 6) { chain.push({tag:p.tagName, role:p.getAttribute('role'), cls:(p.className||'').toString().slice(0,40), onclick: !!p.onclick}); p = p.parentElement; }
      return { id: el.textContent.trim(), chain };
    }
  }
  return null;
});
console.log(JSON.stringify(info,null,1));
await browser.close();
