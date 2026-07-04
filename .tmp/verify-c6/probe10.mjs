import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const btns = await page.$$eval('button', els => els.map((e,i)=>({i, t:e.textContent.replace(/\s+/g,' ').trim().slice(0,55)})).filter(x=>x.t));
console.log('NONEMPTY BTNS:', JSON.stringify(btns.slice(0,10),null,0));
await browser.close();
