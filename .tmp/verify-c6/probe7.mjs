import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const btns = await page.$$eval('button', els => els.map(e=>e.textContent.trim().slice(0,45)).filter(t=>/claude|codex/i.test(t)));
console.log('PROJECT BTNS:', JSON.stringify(btns.slice(0,15),null,1));
await browser.close();
