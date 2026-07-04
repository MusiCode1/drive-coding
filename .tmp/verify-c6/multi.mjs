import { chromium } from 'file:///D:/Users/User/AppData/Local/npm-cache/_npx/361ceb562f3b3235/node_modules/playwright/index.mjs';
const OUT = 'D:/UserProjects/AI/drive-coding/dev/.worktrees/slice-image-paste/.tmp/verify-c6';
const RED = OUT+'/red.png', BLUE = OUT+'/blue.png';
const log = (...a) => console.log('[multi]', ...a);
const R = {};
const browser = await chromium.launch({ headless: true });
// MOBILE viewport (DoD: mobile check)
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto('http://localhost:4005/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
log('reattach ready agent for multi-image test...');
const row = page.locator('li.agent-row').filter({ hasText: '67ea0ce3' });
const targetRow = (await row.count()) ? row.first() : page.locator('li.agent-row').first();
await targetRow.getByRole('button', { name: 'התחבר מחדש' }).click({ timeout: 20000 });
await page.waitForURL('**/chat', { timeout: 60000 });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'הקלדה' }).click().catch(()=>{});
await page.waitForTimeout(1000);
await page.locator('textarea').first().waitFor({ state:'visible', timeout: 20000 });
await page.waitForFunction(() => { const ta=document.querySelector('textarea'); return ta && !ta.disabled; }, { timeout: 40000 });
await page.screenshot({ path: OUT+'/30-mobile-connected.png' }).catch(()=>{});

// attach TWO images
log('attaching 2 images (red, blue)...');
await page.locator('input[type=file]').first().setInputFiles([RED, BLUE]);
await page.waitForTimeout(2000);
R.trayThumbs = await page.locator('.h-16.w-16').count();
log('tray thumbnails (expect 2):', R.trayThumbs);
await page.screenshot({ path: OUT+'/31-mobile-tray-2.png' }).catch(()=>{});

await page.locator('textarea').first().fill('How many images and what colors? Brief.');
await page.getByRole('button', { name: 'שלח' }).click();
await page.waitForTimeout(3500);

const btns = page.locator('.user-image-btn');
// last user bubble should have 2 buttons — count all, then check the newest 2
const total = await btns.count();
log('total user-image-btn (all bubbles):', total);
// the two newest are the last two
const n = total;
const src0 = await btns.nth(n-2).locator('img').getAttribute('src');
const src1 = await btns.nth(n-1).locator('img').getAttribute('src');
R.twoDistinct = src0 !== src1;
log('last two images distinct:', R.twoDistinct);
await page.screenshot({ path: OUT+'/32-mobile-2-bubbles.png' }).catch(()=>{});

// click the SECOND (blue) → lightbox should show blue (src === src1)
await btns.nth(n-1).click();
await page.waitForTimeout(800);
R.lightboxVisible = await page.locator('[role=dialog]').isVisible().catch(()=>false);
const lbSrc = R.lightboxVisible ? await page.locator('[role=dialog] img').first().getAttribute('src').catch(()=>null) : null;
R.secondOpensCorrect = (lbSrc === src1);
log('DoD multi: click 2nd img → lightbox shows 2nd (correct src):', R.secondOpensCorrect, '| visible:', R.lightboxVisible);
await page.screenshot({ path: OUT+'/33-mobile-lightbox-2nd.png' }).catch(()=>{});
await page.keyboard.press('Escape');

R.relevantErrors = errors.filter(e=>!/elevenlabs|TTS|401|xi-api|google|generativelanguage|proxy upstream|Failed to load resource/i.test(e));
log('RELEVANT ERRORS:', JSON.stringify(R.relevantErrors));
(await import('fs')).default.writeFileSync(OUT+'/multi-results.json', JSON.stringify(R,null,2));
await browser.close();
log('DONE');
