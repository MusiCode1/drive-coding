import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const IMG = OUT + '/red.png';
const log = (...a) => console.log('[e2e]', ...a);
const R = {};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
log('cold connect claude/dev...');
await page.getByRole('button').filter({ hasText: /^claude\s+dev\b/ }).first().click();
await page.waitForURL('**/chat', { timeout: 90000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /סשן חדש/ }).click();
await page.waitForTimeout(4000);

// switch to typing mode
log('switching to type mode...');
await page.getByRole('button', { name: 'הקלדה' }).click();
await page.waitForTimeout(800);
await page.locator('textarea').first().waitFor({ state:'visible', timeout: 15000 });
await page.waitForFunction(() => { const ta=document.querySelector('textarea'); return ta && !ta.disabled; }, { timeout: 30000 });
log('textarea visible + enabled');
await page.screenshot({ path: OUT+'/03-connected.png' });

R.attachBtn = await page.locator('button[aria-label="הוסף תמונה"]').count();
log('DoD/regression: attach button (cold claude image:true):', R.attachBtn);

log('setInputFiles image...');
await page.locator('input[type=file]').first().setInputFiles(IMG);
await page.waitForTimeout(1800);
await page.screenshot({ path: OUT+'/04-tray-with-image.png' });
R.trayThumbs = await page.locator('.h-16.w-16').count();
log('tray thumbnails:', R.trayThumbs);

await page.locator('textarea').first().fill('What single color dominates this image? Reply one word.');
await page.getByRole('button', { name: 'שלח' }).click();
log('sent multimodal');
await page.waitForTimeout(3500);
await page.screenshot({ path: OUT+'/05-after-send.png' });

const userImgBtn = page.locator('.user-image-btn');
R.userImgBtn = await userImgBtn.count();
log('DoD: user-image-btn count:', R.userImgBtn);
const bubbleSrc = R.userImgBtn ? await userImgBtn.first().locator('img').getAttribute('src') : null;
R.bubbleSrcLen = bubbleSrc?.length;
log('bubble img src prefix:', bubbleSrc?.slice(0,30), 'len:', R.bubbleSrcLen);

if (R.userImgBtn) {
  const imgBox = await userImgBtn.first().locator('img').boundingBox();
  const btnStyle = await userImgBtn.first().evaluate(el => { const s=getComputedStyle(el); return {marginTop:s.marginTop, marginBottom:s.marginBottom, padding:s.padding, border:s.borderWidth}; });
  R.imgBox = imgBox; R.btnStyle = btnStyle;
  log('REGRESSION img box:', JSON.stringify(imgBox), 'btn style:', JSON.stringify(btnStyle));

  await userImgBtn.first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT+'/06-lightbox-open.png' });
  const dialog = page.locator('[role=dialog]');
  R.lightboxVisible = await dialog.isVisible().catch(()=>false);
  const lbImg = dialog.locator('img');
  R.lbImgCount = await lbImg.count();
  const lbSrc = R.lbImgCount ? await lbImg.first().getAttribute('src') : null;
  R.lbSrcMatch = (lbSrc === bubbleSrc);
  log('DoD lightbox visible:', R.lightboxVisible, '| img count:', R.lbImgCount, '| src matches bubble:', R.lbSrcMatch);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  R.escClosed = !(await page.locator('[role=dialog]').isVisible().catch(()=>false));
  log('DoD Esc closes:', R.escClosed);
  await page.screenshot({ path: OUT+'/07-after-esc.png' });

  await userImgBtn.first().click();
  await page.waitForTimeout(600);
  R.reopened = await page.locator('[role=dialog]').isVisible().catch(()=>false);
  await page.mouse.click(15, 15);
  await page.waitForTimeout(700);
  R.overlayClosed = !(await page.locator('[role=dialog]').isVisible().catch(()=>false));
  log('DoD reopened:', R.reopened, '| overlay-click closes:', R.overlayClosed);
  await page.screenshot({ path: OUT+'/08-after-overlay.png' });
}

// text-only regression
log('text-only regression...');
const before = await page.locator('.user-image-btn').count();
await page.locator('textarea').first().fill('Reply with the word OK only.');
await page.getByRole('button', { name: 'שלח' }).click();
await page.waitForTimeout(2500);
R.imgBtnAfterTextOnly = await page.locator('.user-image-btn').count();
R.textOnlyNoNewImage = (R.imgBtnAfterTextOnly === before);
log('text-only: img count before/after:', before, R.imgBtnAfterTextOnly, '| no new image:', R.textOnlyNoNewImage);
await page.screenshot({ path: OUT+'/09-text-only.png' });

R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT CONSOLE ERRORS:', JSON.stringify(R.relevantErrors, null, 1));
(await import("fs")).default.writeFileSync(OUT+'/results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
