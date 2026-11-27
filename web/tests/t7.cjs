const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
  const back = () => page.evaluate(() => { window.__onBack(); });
  const home = async () => { for (let i = 0; i < 6 && !(await page.isVisible('#home')); i++) { const d = await page.$('.dialog button.danger'); if (d) await d.click(); else await back(); await page.waitForTimeout(300); } };
  const open = async (f) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
    await fc.setFiles(S + '/fx/' + f);
    await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(900);
  };
  const save = async (name) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doc-save')]); await dl.saveAs(S + '/out/' + name); await idle(); };
  const pick = async (name) => { await page.waitForSelector('.font-search'); await page.fill('.font-search', name); await page.waitForTimeout(200); await page.click(`.font-row.pickable:has(strong:text-is("${name}"))`); await page.waitForTimeout(300); };
  const step = async (n, fn) => { try { await fn(); console.log('OK  ', n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0].slice(0, 200)); await page.screenshot({ path: `${S}/out/fail-${n}.png` }); } await home(); };

  await page.goto('http://localhost:4173/'); await page.waitForTimeout(800);
  await step('글꼴 관리·받기', async () => {
    await page.click('#tabbar [data-tab="settings"]');
    console.log('   설정 글꼴 줄:', (await page.innerText('#fonts-btn')).replace(/\n/g, ' / '));
    await page.click('#fonts-btn'); await page.waitForSelector('.font-row');
    console.log('   목록 줄 수:', await page.locator('.font-row').count());
    await page.waitForTimeout(1500); await page.screenshot({ path: `${S}/out/fonts-all.png` });
    await page.click('.font-cats button:text-is("손글씨")'); await page.waitForTimeout(1200); await page.screenshot({ path: `${S}/out/fonts-hand.png` });
    await page.fill('.font-search', '가람연꽃'); await page.waitForTimeout(200);
    await page.click('.font-row button.primary'); await page.waitForSelector('.font-row button:text-is("지우기")', { timeout: 60000 });
    console.log('   받은 뒤:', (await page.innerText('.font-row')).replace(/\n/g, ' / '));
    await page.click('.font-cats button:text-is("받은 글꼴")'); await page.fill('.font-search', ''); await page.waitForTimeout(300);
    console.log('   받은 글꼴 탭:', await page.locator('.font-row').count());
    await back(); await page.click('#tabbar [data-tab="home"]');
  });
  await step('받은 글꼴 다시 켠 뒤에도 남음', async () => {
    await page.reload(); await page.waitForTimeout(1000);
    const ok = await page.evaluate(async () => { await document.fonts.load('16px "나눔손글씨 가람연꽃"', '가'); return document.fonts.check('16px "나눔손글씨 가람연꽃"', '가'); });
    console.log('   다시 켠 뒤 글꼴 사용 가능:', ok);
  });
  await step('docx 글꼴·크기', async () => {
    await open('t.docx'); await page.click('#doc-edit');
    const p = page.locator('#doc-body section.docx article p').nth(1);
    await p.click(); await page.keyboard.press('Home'); await page.keyboard.down('Shift'); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
    await page.click('.tool:has-text("글꼴")'); await pick('나눔명조');
    await page.locator('#doc-body section.docx article p').nth(0).click();
    await page.click('.tool:has-text("크기")'); await page.click('.size-grid button:text-is("28")'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${S}/out/docx-font.png` });
    await save('font.docx');
  });
  await step('hwp 글꼴·크기', async () => {
    await open('t.hwp');
    console.log('   함초롬바탕 대체 글꼴 읽힘:', await page.evaluate(() => document.fonts.check('16px "함초롬바탕"', '가')));
    await page.click('#doc-edit');
    const box = await page.locator('.hwp-page').first().boundingBox(); const k = box.width / 793.7;
    await page.mouse.click(box.x + 150 * k, box.y + 140 * k); await page.waitForSelector('.sheet textarea');
    await page.click('.chip:has-text("글꼴")'); await pick('배민 주아');
    await page.click('.chip:has-text("크기")'); await page.click('.size-grid button:text-is("20")');
    await page.click('.sheet button.primary:text-is("적용")'); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${S}/out/hwp-font.png` });
    await save('font.hwp');
  });
  await step('pptx 글꼴', async () => {
    await open('t.pptx'); await page.click('#doc-edit');
    await page.mouse.click(200, 200); await page.waitForSelector('.slide-edit textarea');
    await page.locator('.block-edit').nth(0).locator('.chip:has-text("글꼴")').click(); await pick('나눔스퀘어');
    await page.locator('.block-edit').nth(1).locator('.chip:has-text("크기")').click(); await page.click('.size-grid button:text-is("28")');
    await page.click('.slide-edit button.primary'); await idle(); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${S}/out/pptx-font.png` });
    await save('font.pptx');
  });
  await step('pdf 글꼴', async () => {
    await open('t.pdf'); await page.click('#doc-edit');
    await page.click('.tool:has-text("글 넣기")'); await page.mouse.click(120, 300);
    await page.waitForSelector('.sheet textarea'); await page.fill('.sheet textarea', '손글씨 글꼴로 넣은 글');
    await page.click('.chip:has-text("글꼴")'); await pick('나눔손글씨 펜');
    await page.click('.sheet button.primary:text-is("넣기")'); await idle(); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${S}/out/pdf-font.png` });
  });
  console.log(errs.join('\n'));
  await b.close();
})();
