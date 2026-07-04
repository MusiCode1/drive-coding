import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// inspect one agent-row's inner clickable structure
const row = await page.evaluate(() => {
  const li = document.querySelector('li.agent-row');
  if (!li) return null;
  return [...li.querySelectorAll('button,[role=button],a')].map(b=>({tag:b.tagName, aria:b.getAttribute('aria-label'), t:b.textContent.trim().slice(0,20), cls:(b.className||'').toString().slice(0,30)}));
});
console.log('agent-row clickables:', JSON.stringify(row,null,1));
await browser.close();
