import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// open the hamburger / menu to find running processes
const menu = page.locator('button[aria-label="תפריט"]');
if (await menu.count()) { await menu.first().click(); await page.waitForTimeout(1000); }
const body = await page.$eval('body', e=>e.innerText.slice(0,900));
console.log('BODY after menu:', body);
await page.screenshot({ path: 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6/probe-menu.png', fullPage:true });
await browser.close();
