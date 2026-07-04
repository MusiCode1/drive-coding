import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const IMG = OUT + '/red.png';
const log = (...a) => console.log('[replay]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
log('cold connect claude/dev...');
await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click();
await page.waitForURL('**/chat', { timeout: 90000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /סשן חדש/ }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'הקלדה' }).click();
await page.waitForTimeout(800);
await page.locator('textarea').first().waitFor({ state:'visible', timeout: 15000 });
await page.waitForFunction(() => { const ta=document.querySelector('textarea'); return ta && !ta.disabled; }, { timeout: 30000 });

log('send image so a session with an image exists...');
await page.locator('input[type=file]').first().setInputFiles(IMG);
await page.waitForTimeout(1500);
await page.locator('textarea').first().fill('Say DONE only.');
await page.getByRole('button', { name: 'שלח' }).click();
await page.waitForTimeout(4000);
R.beforeReloadImgBtn = await page.locator('.user-image-btn').count();
log('user-image-btn before reload:', R.beforeReloadImgBtn);
await page.screenshot({ path: OUT+'/10-before-reload.png' });

// full reload → triggers session reconnect / session/load replay
log('full page reload (triggers session/load replay)...');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.screenshot({ path: OUT+'/11-after-reload.png', fullPage: true });
log('URL after reload:', page.url());

// After reload we may land on landing OR resumed chat. If landing, reconnect to same session.
let onChat = page.url().includes('/chat');
if (!onChat) {
  log('landed on landing after reload — reconnect claude/dev and open the session...');
  await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click();
  await page.waitForURL('**/chat', { timeout: 90000 });
  await page.waitForTimeout(3000);
}

// The chat may show session picker; the most recent session (with our image) should be top.
// Try to open the top session in the list to force session/load
await page.waitForTimeout(2000);
await page.screenshot({ path: OUT+'/12-session-list.png', fullPage: true });

// look for session cards (top of "סשנים" list) — click first that is not "new session"
const sessionCards = page.getByRole('button').filter({ hasText: /·\s*04\.07/ });
const scCount = await sessionCards.count();
log('session cards visible:', scCount);
if (scCount) {
  await sessionCards.first().click();
  await page.waitForTimeout(5000);
}
await page.screenshot({ path: OUT+'/13-loaded-session.png', fullPage: true });

R.afterReplayImgBtn = await page.locator('.user-image-btn').count();
log('DoD replay: user-image-btn after session/load:', R.afterReplayImgBtn);

if (R.afterReplayImgBtn) {
  const src = await page.locator('.user-image-btn').first().locator('img').getAttribute('src');
  R.replaySrcPrefix = src?.slice(0,30); R.replaySrcLen = src?.length;
  log('replay bubble img src:', R.replaySrcPrefix, 'len', R.replaySrcLen);
  // click → lightbox
  await page.locator('.user-image-btn').first().click();
  await page.waitForTimeout(900);
  R.replayLightboxVisible = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  const lbSrc = R.replayLightboxVisible ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
  R.replayLbSrcMatch = (lbSrc === src);
  log('DoD replay lightbox visible:', R.replayLightboxVisible, '| src matches:', R.replayLbSrcMatch);
  await page.screenshot({ path: OUT+'/14-replay-lightbox.png' });
  await page.keyboard.press('Escape');
}

R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT CONSOLE ERRORS:', JSON.stringify(R.relevantErrors, null, 1));
(await import('fs')).default.writeFileSync(OUT+'/replay-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
