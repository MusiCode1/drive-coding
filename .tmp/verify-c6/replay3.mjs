import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const log = (...a) => console.log('[r3]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// click a running process entry (reattach — no spawn). It shows a short agentId + time.
log('clicking running process (reattach)...');
const proc = page.getByRole('button').filter({ hasText: /^[0-9a-f]{8}\s*·\s*04\.07/ }).first();
const pc = await proc.count();
log('running-process buttons:', pc);
await proc.click({ timeout: 20000 });
await page.waitForURL('**/chat', { timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT+'/20-reattached.png', fullPage: true });

// Now in chat. It may show a session list. Open a session that contains our image.
// Sessions with images are the ones we created; open the most recent few and check.
await page.getByRole('button', { name: 'הקלדה' }).click().catch(()=>{});
await page.waitForTimeout(1000);

// find session cards
const cards = page.getByRole('button').filter({ hasText: /·\s*04\.07,\s*\d/ });
const cc = await cards.count();
log('session cards in chat:', cc);
let found = 0, checked = 0;
for (let i = 0; i < Math.min(cc, 6); i++) {
  await cards.nth(i).click();
  await page.waitForTimeout(5000);   // session/load replay
  checked++;
  const n = await page.locator('.user-image-btn').count();
  log(`session #${i}: user-image-btn =`, n);
  if (n > 0) { found = n; break; }
}
R.checked = checked; R.replayImgBtn = found;
await page.screenshot({ path: OUT+'/21-replay-loaded.png', fullPage: true });

if (found) {
  const src = await page.locator('.user-image-btn').first().locator('img').getAttribute('src');
  R.srcLen = src?.length; R.srcPrefix = src?.slice(0,30);
  log('replay image src:', R.srcPrefix, 'len', R.srcLen);
  await page.locator('.user-image-btn').first().click();
  await page.waitForTimeout(900);
  R.replayLightbox = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  const lbSrc = R.replayLightbox ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
  R.replayLbMatch = (lbSrc === src);
  log('DoD replay: lightbox opens:', R.replayLightbox, '| src matches bubble:', R.replayLbMatch);
  await page.screenshot({ path: OUT+'/22-replay-lightbox.png' });
  await page.keyboard.press('Escape');
}
R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/replay-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
