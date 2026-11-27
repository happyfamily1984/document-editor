const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.goto('http://localhost:4173/'); await page.waitForTimeout(500);
  for (const f of ['bank.xls', 't.xlsx']) {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
    await fc.setFiles(S + '/fx/' + f);
    await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden); await page.waitForTimeout(800);
    await page.screenshot({ path: `${S}/out/sheet-${f}.png` });
    if (f === 'bank.xls') {
      console.log('시트 탭 숨김:', await page.isHidden('.sheet-tabs'));
      await page.click('#doc-edit'); await page.click('td[data-a="B7"]'); await page.fill('.cell-input', '11월 급여'); await page.keyboard.press('Enter');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doc-save')]); await dl.saveAs(S + '/out/bank.xlsx');
    }
    for (let i = 0; i < 3 && !(await page.isVisible('#home')); i++) { await page.evaluate(() => { window.__onBack(); }); await page.waitForTimeout(300); }
  }
  console.log(errs.join('\n'));
  await b.close();
})();
