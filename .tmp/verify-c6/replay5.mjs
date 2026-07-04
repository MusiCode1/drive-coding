import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const log = (...a) => console.log('[r5]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// find the agent-row containing '67ea0ce3' and click its reconnect button
log('reattach (reconnect) agent 67ea0ce3...');
const row = page.locator('li.agent-row').filter({ hasText: '67ea0ce3' });
const rc = await row.count();
log('rows matching 67ea0ce3:', rc);
const targetRow = rc ? row.first() : page.locator('li.agent-row').first();
await targetRow.getByRole('button', { name: 'התחבר מחדש' }).click({ timeout: 20000 });
await page.waitForURL('**/chat', { timeout: 60000 });
await page.waitForTimeout(5000);   // reattach + session/load replay
await page.screenshot({ path: OUT+'/20-reattached.png'});

await page.getByRole('button', { name: 'הקלדה' }).click().catch(()=>{});
await page.waitForTimeout(1500);

let n = await page.locator('.user-image-btn').count();
log('image bubbles after reattach+replay:', n);
if (n === 0) {
  // maybe session list — open recent sessions
  const cards = page.getByRole('button').filter({ hasText: /·\s*04\.07,\s*\d/ });
  const cc = await cards.count();
  log('session cards:', cc);
  for (let i = 0; i < Math.min(cc, 5); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(5000);
    n = await page.locator('.user-image-btn').count();
    log(`session #${i}: image =`, n);
    if (n > 0) break;
  }
}
R.replayImgBtn = n;
await page.screenshot({ path: OUT+'/21-replay-loaded.png'});

if (n) {
  const src = await page.locator('.user-image-btn').first().locator('img').getAttribute('src');
  R.srcLen = src?.length; R.srcPrefix = src?.slice(0,30);
  log('replay src:', R.srcPrefix, 'len', R.srcLen);
  await page.locator('.user-image-btn').first().click();
  await page.waitForTimeout(900);
  R.replayLightbox = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  const lbSrc = R.replayLightbox ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
  R.replayLbMatch = (lbSrc === src);
  log('DoD replay: lightbox opens:', R.replayLightbox, '| src matches bubble:', R.replayLbMatch);
  await page.screenshot({ path: OUT+'/22-replay-lightbox.png' }).catch(()=>{});
}
R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/replay-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
