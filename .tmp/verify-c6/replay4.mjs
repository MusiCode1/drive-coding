import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const log = (...a) => console.log('[r4]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// active-processes section: click the card containing '67ea0ce3' (the multimodal e2e agent, 15:48)
log('reattach to running agent 67ea0ce3...');
const card = page.getByRole('button').filter({ hasText: /67ea0ce3/ }).first();
const cnt = await card.count();
log('matching cards:', cnt);
await card.click({ timeout: 20000 });
await page.waitForURL('**/chat', { timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT+'/20-reattached.png', fullPage: true });

await page.getByRole('button', { name: 'הקלדה' }).click().catch(()=>{});
await page.waitForTimeout(1000);

// After reattach, the chat may already show the last session (with image) OR a session list.
let n = await page.locator('.user-image-btn').count();
log('image bubbles right after reattach:', n);

if (n === 0) {
  const cards = page.getByRole('button').filter({ hasText: /·\s*04\.07,\s*\d/ });
  const cc = await cards.count();
  log('session cards:', cc);
  for (let i = 0; i < Math.min(cc, 5); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(5000);
    n = await page.locator('.user-image-btn').count();
    log(`session #${i}: image bubbles =`, n);
    if (n > 0) break;
  }
}
R.replayImgBtn = n;
await page.screenshot({ path: OUT+'/21-replay-loaded.png', fullPage: true });

if (n) {
  const src = await page.locator('.user-image-btn').first().locator('img').getAttribute('src');
  R.srcLen = src?.length; R.srcPrefix = src?.slice(0,30);
  log('replay image src:', R.srcPrefix, 'len', R.srcLen);
  await page.locator('.user-image-btn').first().click();
  await page.waitForTimeout(900);
  R.replayLightbox = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  const lbSrc = R.replayLightbox ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
  R.replayLbMatch = (lbSrc === src);
  log('DoD replay: lightbox opens:', R.replayLightbox, '| src matches:', R.replayLbMatch);
  await page.screenshot({ path: OUT+'/22-replay-lightbox.png' });
}
R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/replay-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
