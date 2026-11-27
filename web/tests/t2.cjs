const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  await page.goto('http://localhost:4173/');
  const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
  const open = async (f) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
    await fc.setFiles(S + '/fx/' + f);
    await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(1000);
  };
  const save = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#doc-save')]);
    await dl.saveAs(S + '/out/' + name);
    await idle();
  };
  const close = async () => { for (let i = 0; i < 6; i++) { if (await page.isVisible('#home') && !(await page.$('.overlay'))) break; const d = await page.$('.dialog button.danger'); if (d) await d.click(); else await page.evaluate(() => window.__onBack()); await page.waitForTimeout(300); } };
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0].slice(0, 250)); await page.screenshot({ path: `${S}/out/fail-${name}.png` }); } await close(); };

  await step('docx', async () => {
    await open('t.docx'); await page.click('#doc-edit');
    const ps = page.locator('#doc-body section.docx article p');
    await ps.nth(1).click(); await page.keyboard.press('End'); await page.keyboard.type(' 추가됨');
    await page.keyboard.press('Enter'); await page.keyboard.type('새 문단');
    await ps.nth(0).click(); await page.click('.tool:has-text("기울임")');
    await page.locator('#doc-body td p').first().click(); await page.keyboard.press('End'); await page.keyboard.type('X');
    await page.screenshot({ path: `${S}/out/edit-docx.png` });
    await save('e.docx');
  });
  await step('xlsx', async () => {
    await open('t.xlsx'); await page.click('#doc-edit');
    await page.click('td[data-a="B2"]'); await page.fill('.cell-input', '10'); await page.keyboard.press('Enter');
    await page.fill('.cell-input', '한글 값'); await page.keyboard.press('Enter');
    await page.click('td[data-a="F7"]'); await page.fill('.cell-input', '=B2*2'); await page.click('.cell-bar button');
    await page.screenshot({ path: `${S}/out/edit-xlsx.png` });
    await save('e.xlsx');
  });
  await step('xls', async () => { await open('t.xls'); await page.click('#doc-edit'); await page.click('td[data-a="A1"]'); await page.fill('.cell-input', '바꿈'); await page.keyboard.press('Enter'); await save('e-from-xls.xlsx'); });
  await step('pptx', async () => {
    await open('t.pptx'); await page.click('#doc-edit');
    await page.mouse.click(200, 200); await page.waitForSelector('.slide-edit textarea');
    const ta = page.locator('.slide-edit textarea');
    console.log('   blocks', await ta.count(), JSON.stringify(await ta.nth(1).inputValue()));
    await ta.nth(0).fill('바뀐 제목\n둘째 줄'); await ta.nth(1).fill('굵은 글 보통 글 뒤에 추가');
    await page.click('.slide-edit button.primary'); await idle(); await page.waitForTimeout(800);
    await page.mouse.click(200, 200); await page.waitForSelector('.slide-edit'); await page.click('.slide-edit button:has-text("복제")'); await idle(); await page.waitForTimeout(800);
    await page.screenshot({ path: `${S}/out/edit-pptx.png` });
    await save('e.pptx');
  });
  await step('pdf', async () => {
    await open('t.pdf'); await page.click('#doc-edit');
    await page.click('.tool:has-text("글 넣기")'); await page.mouse.click(120, 300);
    await page.waitForSelector('.sheet textarea'); await page.fill('.sheet textarea', '한글 메모 ABC 123'); await page.click('.sheet button.primary'); await idle(); await page.waitForTimeout(800);
    await page.click('.tool:has-text("글 넣기 끝")');
    await page.click('.tool:has-text("쪽 돌리기")'); await idle(); await page.waitForTimeout(800);
    await page.screenshot({ path: `${S}/out/edit-pdf.png` });
    await save('e.pdf');
  });
  for (const f of ['t.hwp', 't.hwpx']) await step(f, async () => {
    await open(f); await page.click('#doc-edit');
    const box = await page.locator('.hwp-page').first().boundingBox();
    const k = box.width / 793.7;
    await page.mouse.click(box.x + 150 * k, box.y + 140 * k); await page.waitForSelector('.sheet textarea');
    console.log('   para', JSON.stringify(await page.inputValue('.sheet textarea')));
    await page.fill('.sheet textarea', '한글 문서 고친 문단입니다\n새로 나눈 줄'); await page.click('.sheet button.primary'); await page.waitForTimeout(600);
    await page.mouse.click(box.x + 150 * k, box.y + 200 * k); await page.waitForSelector('.sheet textarea');
    console.log('   2nd', await page.textContent('.sheet h3'), JSON.stringify(await page.inputValue('.sheet textarea')));
    await page.fill('.sheet textarea', '칸 내용'); await page.click('.sheet button.primary'); await page.waitForTimeout(600);
    await page.screenshot({ path: `${S}/out/edit-${f}.png` });
    await save('e.' + f.split('.')[1]);
  });
  await step('txt', async () => { await open('t.txt'); await page.click('#doc-edit'); await page.locator('.text-doc').press('Control+End'); await page.keyboard.type('\n셋째 줄'); await save('e.txt'); });
  await step('new-docs', async () => {
    for (const k of ['docx', 'xlsx', 'pptx', 'hwp', 'txt']) {
      await page.click(`[data-new="${k}"]`);
      await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
      await page.waitForTimeout(700);
      console.log('   new', k, await page.textContent('#doc-title'), await page.textContent('#doc-edit'));
      await page.screenshot({ path: `${S}/out/new-${k}.png` });
      await close();
    }
  });
  await step('back-exit', async () => {
    await page.evaluate(() => window.__onBack()); await page.waitForSelector('.dialog');
    console.log('   exit dialog:', (await page.innerText('.dialog')).replace(/\n/g, ' | '));
    await page.evaluate(() => window.__onBack()); await page.waitForTimeout(200);
    console.log('   dialog closed by back:', !(await page.$('.dialog')));
  });
  await page.screenshot({ path: `${S}/out/home.png` });
  console.log(errs.join('\n'));
  await b.close();
})();
