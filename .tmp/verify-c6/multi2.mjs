import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const RED = OUT+'/red.png', BLUE = OUT+'/blue.png';
const log = (...a) => console.log('[multi2]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
log('cold connect claude/dev...');
await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click({ timeout: 40000 });
await page.waitForURL('**/chat', { timeout: 90000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /סשן חדש/ }).click();
await page.waitForTimeout(5000);
await page.getByRole('button', { name: 'הקלדה' }).click();
await page.waitForTimeout(1000);
await page.locator('textarea').first().waitFor({ state:'visible', timeout: 20000 });
await page.waitForFunction(() => { const ta=document.querySelector('textarea'); return ta && !ta.disabled; }, { timeout: 60000 });
log('connected (cold). attaching 2 images...');
await page.locator('input[type=file]').first().setInputFiles([RED, BLUE]);
await page.waitForTimeout(2000);
R.trayThumbs = await page.locator('.h-16.w-16').count();
log('tray thumbnails (expect 2):', R.trayThumbs);
await page.screenshot({ path: OUT+'/40-multi-tray.png' }).catch(()=>{});

await page.locator('textarea').first().fill('Two images: name each color, brief.');
await page.getByRole('button', { name: 'שלח' }).click();
await page.waitForTimeout(3500);
const btns = page.locator('.user-image-btn');
const n = await btns.count();
R.bubbleImgBtns = n;
log('user-image-btn in bubble (expect 2):', n);
if (n >= 2) {
  const s0 = await btns.nth(n-2).locator('img').getAttribute('src');
  const s1 = await btns.nth(n-1).locator('img').getAttribute('src');
  R.distinct = s0 !== s1;
  // click 2nd
  await btns.nth(n-1).click();
  await page.waitForTimeout(800);
  const lb = await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null);
  R.secondCorrect = (lb === s1);
  R.lightboxVisible = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  log('2 distinct:', R.distinct, '| click 2nd → shows 2nd:', R.secondCorrect, '| visible:', R.lightboxVisible);
  await page.screenshot({ path: OUT+'/41-multi-lightbox-2nd.png' }).catch(()=>{});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // click 1st → shows 1st
  await btns.nth(n-2).click();
  await page.waitForTimeout(700);
  const lb2 = await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null);
  R.firstCorrect = (lb2 === s0);
  log('click 1st → shows 1st:', R.firstCorrect);
}
R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/multi2-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
