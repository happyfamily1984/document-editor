const { chromium, devices } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.addInitScript(() => {
    const st = {}; window.__calls = [];
    window.NativeBridge = {
      ready() {}, exit() { window.__calls.push('exit'); },
      defaultStatus: () => JSON.stringify(['hwp', 'hwpx', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'pdf', 'txt'].map((ext) => ext === 'pdf' && !st.pdf ? { ext, state: 'other', label: 'Drive PDF 뷰어', pkg: 'x.y' } : { ext, state: st[ext] ? 'mine' : 'none' })),
      chooseDefault(ext) { window.__calls.push('choose ' + ext); st[ext] = 1; setTimeout(() => window.__native.onDefaultsChanged(), 50); },
      openAppSettings(p) { window.__calls.push('settings ' + p); },
    };
  });
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.default-row');
  console.log('첫 실행 때 자동으로 뜸:', await page.textContent('.sheet h3'), '| 줄 수:', await page.locator('.default-row').count());
  await page.click('.default-row:has-text("HWP") button'); await page.click('.default-row:has-text("DOCX") button'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${S}/out/defaults.png` });
  await page.click('.default-row:has-text("PDF") button'); await page.waitForSelector('.dialog'); await page.click('.dialog button.primary');
  console.log('호출:', await page.evaluate(() => window.__calls.join(', ')));
  await page.evaluate(() => { window.__onBack(); }); await page.waitForTimeout(200);
  console.log('뒤로가기로 닫힘:', !(await page.$('.sheet')));
  await page.reload(); await page.waitForTimeout(1200);
  console.log('두 번째 실행 때는 안 뜸:', !(await page.$('.sheet')), '| 홈 버튼 보임:', await page.isVisible('#defaults-btn'));
  console.log(errs.join('\n'));
  await b.close();
})();
