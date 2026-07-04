import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const IMG = OUT + '/red.png';
const log = (...a) => console.log('[r2]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
log('cold connect claude/dev...');
await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click({ timeout: 60000 });
await page.waitForURL('**/chat', { timeout: 90000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /סשן חדש/ }).click();
await page.waitForTimeout(5000);
await page.getByRole('button', { name: 'הקלדה' }).click();
await page.waitForTimeout(1000);
await page.locator('textarea').first().waitFor({ state:'visible', timeout: 20000 });
await page.waitForFunction(() => { const ta=document.querySelector('textarea'); return ta && !ta.disabled; }, { timeout: 60000 });
log('connected. sending image...');
await page.locator('input[type=file]').first().setInputFiles(IMG);
await page.waitForTimeout(3000);
await page.locator('textarea').first().fill('Say READY.');
await page.getByRole('button', { name: 'שלח' }).click();
await page.waitForTimeout(5000);
R.beforeReload = await page.locator('.user-image-btn').count();
log('image bubble before reload:', R.beforeReload);
// capture current URL (has session id maybe)
const urlBefore = page.url();
log('url before reload:', urlBefore);

// RELOAD — the real session/load replay path
log('reloading...');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
log('url after reload:', page.url());
await page.screenshot({ path: OUT+'/11-after-reload.png', fullPage: true });

let imgAfter = await page.locator('.user-image-btn').count();
log('image bubble immediately after reload:', imgAfter);

// if not on chat with image, try to reopen the session from list
if (imgAfter === 0) {
  const onChat = page.url().includes('/chat');
  if (!onChat) {
    await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click({ timeout: 60000 });
    await page.waitForURL('**/chat', { timeout: 90000 });
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(2000);
  // click the top session card (most recent = the one we just made) to force session/load
  const cards = page.getByRole('button').filter({ hasText: /·\s*04\.07,\s*\d/ });
  const cc = await cards.count();
  log('session cards:', cc);
  if (cc) { await cards.first().click({ timeout: 60000 }); await page.waitForTimeout(6000); }
  imgAfter = await page.locator('.user-image-btn').count();
}
R.afterReplay = imgAfter;
log('DoD replay: image bubble after session/load:', R.afterReplay);
await page.screenshot({ path: OUT+'/13-loaded-session.png', fullPage: true });

if (R.afterReplay) {
  const src = await page.locator('.user-image-btn').first().locator('img').getAttribute('src');
  R.replaySrcLen = src?.length; R.replaySrcPrefix = src?.slice(0,30);
  log('replay src:', R.replaySrcPrefix, 'len', R.replaySrcLen);
  await page.locator('.user-image-btn').first().click({ timeout: 60000 });
  await page.waitForTimeout(900);
  R.replayLightbox = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  const lbSrc = R.replayLightbox ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
  R.replayLbMatch = (lbSrc === src);
  log('DoD replay lightbox opens:', R.replayLightbox, '| src matches:', R.replayLbMatch);
  await page.screenshot({ path: OUT+'/14-replay-lightbox.png' });
}
R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/replay-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
