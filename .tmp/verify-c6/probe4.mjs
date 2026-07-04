import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// look near "CLI" label — find clickable cli options
const html = await page.content();
// dump region around "CLI"
const idx = html.indexOf('opencode');
console.log('AROUND opencode:', html.slice(idx-400, idx+200).replace(/\s+/g,' '));
// list role=radio / clickable divs with claude text
const clicks = await page.$$eval('[role=button],button,label,[role=radio],[role=tab]', els => els.map(e=>({tag:e.tagName, role:e.getAttribute('role'), t:e.textContent.trim().slice(0,20)})).filter(x=>/claude|opencode|codex/i.test(x.t)));
console.log('CLI CLICKABLES:', JSON.stringify(clicks));
await browser.close();
