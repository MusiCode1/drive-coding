import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const btns = await page.$$eval('button', els => els.map(e=>e.textContent.trim().slice(0,50)).filter(t=>t&&t!=='✕'));
console.log('ALL BTN TEXTS:', JSON.stringify(btns.slice(0,60), null, 1));
// look for "new" / "start" buttons
const bodyText = await page.$eval('body', e=>e.innerText);
console.log('---FULL BODY---');
console.log(bodyText.slice(0, 1200));
await browser.close();
