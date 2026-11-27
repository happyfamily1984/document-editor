const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => { if (!localStorage.getItem('recents')) localStorage.setItem('recents', JSON.stringify([
    { name: '거래내역조회_입출식_출력용.docx', uri: 'u1', kind: 'docx', time: Date.now() - 3e6 }, { name: '급여정산_2026.xlsx', uri: 'u2', kind: 'xlsx', time: Date.now() - 9e7, star: true },
    { name: '사업계획서_최종.pptx', uri: 'u3', kind: 'pptx', time: Date.now() - 18e7 }, { name: '계약서_샘플.pdf', uri: 'u4', kind: 'pdf', time: Date.now() - 27e7 }, { name: '회의록.hwp', uri: 'u5', kind: 'hwp', time: Date.now() - 36e7 }])); });
  await page.goto('http://localhost:4173/'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${S}/out/home2.png` });
  for (const t of ['recent', 'mine', 'settings']) { await page.click(`#tabbar [data-tab="${t}"]`); await page.waitForTimeout(200); await page.screenshot({ path: `${S}/out/tab-${t}.png` }); }
  await page.evaluate(() => { window.__onBack(); }); await page.waitForTimeout(200);
  console.log('뒤로가기 → 홈 탭:', await page.isVisible('.hero'));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
  await fc.setFiles(S + '/fx/bank.xls');
  await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden); await page.waitForTimeout(800);
  console.log('은행 엑셀:', (await page.innerText('#doc-body')).replace(/\s+/g, ' ').slice(0, 160), '| 안내:', await page.textContent('#doc-notice'));
  await page.screenshot({ path: `${S}/out/bank.png` });
  await page.click('#doc-edit'); await page.click('td[data-a="B2"]'); await page.fill('.cell-input', '11월 급여'); await page.keyboard.press('Enter');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doc-save')]); await dl.saveAs(S + '/out/bank.xlsx'); console.log('저장 파일 이름:', dl.suggestedFilename());
  console.log(errs.join('\n'));
  await b.close();
})();
