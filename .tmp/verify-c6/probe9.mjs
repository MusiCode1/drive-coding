import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// dump first 6 buttons full text with newlines
const btns = await page.$$eval('button', els => els.slice(0,12).map((e,i)=>({i, t:e.textContent.replace(/\s+/g,' ').trim().slice(0,60)})));
console.log(JSON.stringify(btns,null,1));
await browser.close();
