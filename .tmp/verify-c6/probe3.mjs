import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const selects = await page.$$eval('select', els => els.map(e=>({name:e.name, opts:[...e.options].map(o=>o.value)})));
console.log('SELECTS:', JSON.stringify(selects));
const textInputs = await page.$$eval('input[type=text],input:not([type])', els => els.map(e=>({ph:e.placeholder, val:e.value})));
console.log('TEXT INPUTS:', JSON.stringify(textInputs));
// find connect button
const connect = await page.$$eval('button', els => els.map((e,i)=>({i, t:e.textContent.trim()})).filter(x=>x.t==='חבר'));
console.log('CONNECT BTN:', JSON.stringify(connect));
await browser.close();
