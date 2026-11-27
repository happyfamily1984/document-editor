const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  let page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = [];
  const hook = (p) => { p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
  hook(page);
  await page.goto('http://localhost:4173/');
  const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
  const back = () => page.evaluate(() => { window.__onBack(); });
  const open = async (f) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-btn')]);
    await fc.setFiles(S + '/fx/' + f);
    await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(1000);
  };
  // PDF 글 넣기
  await open('t.pdf'); await page.click('#doc-edit');
  await page.click('.tool:has-text("글 넣기")'); await page.mouse.click(120, 300);
  await page.waitForSelector('.sheet textarea'); await page.fill('.sheet textarea', '한글 메모 ABC 123\n둘째 줄'); await page.click('.sheet button.primary'); await idle(); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${S}/out/pdf-text.png` });
  // 임시저장: 고친 뒤 저장하지 않고 페이지를 통째로 닫았다가(앱 종료 흉내) 다시 연다
  await page.waitForTimeout(1800);
  await page.close();
  page = await ctx.newPage(); page.setDefaultTimeout(8000); hook(page);
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  console.log('재시작 후 자동 복원:', await page.textContent('#doc-title'), '| 안내:', await page.textContent('#doc-notice'), '| 저장 버튼 보임:', await page.isVisible('#doc-save'));
  await page.screenshot({ path: `${S}/out/draft-restored.png` });
  // 뒤로 → 편집 끝 → 뒤로 → 닫기 창 → 임시저장
  await back(); await page.waitForTimeout(200); await back(); await page.waitForSelector('.dialog');
  console.log('닫기 창:', (await page.innerText('.dialog')).replace(/\n/g, ' | '));
  await page.click('.dialog button:has-text("임시저장")'); await page.waitForSelector('#home:not([hidden])'); await page.waitForTimeout(500);
  console.log('홈 임시저장 목록:', (await page.innerText('#draft-list')).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${S}/out/home-draft.png` });
  // 워드 문서도: 글자 치고 1.5초 뒤 강제 종료
  await open('t.docx'); await page.click('#doc-edit');
  await page.locator('#doc-body section.docx article p').nth(3).click(); await page.keyboard.press('End'); await page.keyboard.type(' 임시저장 시험');
  await page.waitForTimeout(1800); await page.close();
  page = await ctx.newPage(); page.setDefaultTimeout(8000); hook(page);
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  console.log('워드 복원:', await page.textContent('#doc-title'), '|', (await page.innerText('#doc-body')).replace(/\s+/g, ' ').slice(0, 90));
  // 복원본을 파일로 저장하면 임시저장본이 사라져야 한다
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doc-save')]); await dl.saveAs(S + '/out/draft.docx'); await idle();
  await back(); await page.waitForTimeout(200); await back(); await page.waitForSelector('#home:not([hidden])'); await page.waitForTimeout(500);
  console.log('저장 후 임시저장 목록:', (await page.innerText('#draft-list')).replace(/\n/g, ' | '));
  // 임시저장본 이어서 편집 → 버리기
  await page.click('#draft-list .recent-main'); await page.waitForFunction(() => !document.querySelector('#doc').hidden && document.querySelector('#busy').hidden); await page.waitForTimeout(800);
  await back(); await page.waitForTimeout(200); await back(); await page.waitForSelector('.dialog'); await page.click('.dialog button:has-text("버리기")'); await page.waitForSelector('#home:not([hidden])'); await page.waitForTimeout(500);
  console.log('버린 뒤 임시저장 칸 숨김:', await page.isHidden('#draft-box'));
  // 홈에서 뒤로 → 종료 확인
  await back(); await page.waitForSelector('.dialog'); console.log('종료 창:', (await page.innerText('.dialog')).replace(/\n/g, ' | '));
  await back(); await page.waitForTimeout(200); console.log('뒤로가기로 창 닫힘:', !(await page.$('.dialog')));
  console.log(errs.join('\n'));
  await b.close();
})();
