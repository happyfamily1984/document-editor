const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); page.on('dialog', (d) => { errs.push('ALERT ' + d.message()); d.dismiss(); });
  const reqs = []; page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) reqs.push(r.url()); });
  const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
  const open = async (f) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
    await fc.setFiles(S + '/fx/' + f);
    await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(900);
  };
  await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
  await open('page.html');
  const fr = page.frameLocator('.html-frame');
  console.log('제목/안내:', await page.textContent('#doc-title'), '|', await page.textContent('#doc-notice'));
  console.log('본문:', (await fr.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80));
  console.log('스크립트 실행 안 됨:', (await page.evaluate(() => document.querySelector('.html-frame').contentDocument.title)) === '공지사항', '| 앱 화면 멀쩡:', await page.isVisible('#doc-top'));
  await page.screenshot({ path: `${S}/out/html-view.png` });
  await fr.locator('a[href="#bottom"]').click(); await page.waitForTimeout(200);
  await fr.locator('a[href^="https"]').click(); await page.waitForSelector('.dialog'); console.log('링크 확인 창:', (await page.innerText('.dialog')).replace(/\n/g, ' | ')); await page.click('.dialog button:text-is("취소")');
  await page.click('#doc-edit');
  await fr.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' 추가한 글');
  await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift'); await page.click('.tool:has-text("굵게")'); await page.waitForTimeout(200); await page.click('.tool:has-text("글꼴")');
  await page.fill('.font-search', '나눔명조'); await page.click('.font-row.pickable:has(strong:text-is("나눔명조"))'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${S}/out/html-edit.png` });
  console.log('안쪽 글꼴 읽힘:', await page.evaluate(async () => { const d = document.querySelector('.html-frame').contentDocument; await d.fonts.load('16px "나눔명조"', '가'); return d.fonts.check('16px "나눔명조"', '가'); }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doc-save')]); await dl.saveAs(S + '/out/saved.html'); await idle();
  console.log('저장 이름:', dl.suggestedFilename());
  for (let i = 0; i < 4 && !(await page.isVisible('#home')); i++) { await page.evaluate(() => window.__onBack()); await page.waitForTimeout(300); }
  await open('euckr.htm'); console.log('EUC-KR 문서:', (await fr.locator('body').innerText()).trim());
  console.log('외부 요청:', reqs.filter((u) => !u.includes('localhost')).join(', ') || '없음');
  console.log(errs.join('\n'));
  await b.close();
})();
