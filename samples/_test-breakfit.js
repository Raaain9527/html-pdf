const puppeteer = require('puppeteer-core');
const path = require('path');
const { findBrowser } = require('../html2pdf-lib');

const FIXTURE = path.join(__dirname, 'narrow-page.html');
const fileUrl = 'file:///' + FIXTURE.replace(/\\/g, '/').replace(/^\/+/, '');

async function measure(browser, vw) {
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('screen');
  const m = await page.evaluate(() => {
    const g = (s) => document.querySelector(s).getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.two-col'));
    return { vw: window.innerWidth, pageW: Math.round(g('.page').width), cols: cs.gridTemplateColumns.split(' ').length };
  });
  await page.close();
  return m;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

  console.log('=== 断点感知自动适配循环 (复刻前端 handleAutoFit) ===');
  let m1680 = await measure(browser, 1680);
  console.log(`[起始] 视口1680: 内容宽~${m1680.pageW}px, 填充${(m1680.pageW/1680*100).toFixed(0)}%, 列=${m1680.cols===2?'两列':'一列'}`);
  let target = Math.min(Math.max(m1680.pageW + 40, 320), 5120); // +40
  console.log(`[适配] 目标视口=${target}`);

  let mFit = await measure(browser, target);
  console.log(`[探测] 视口${target}: 页面宽=${mFit.pageW}, 列=${mFit.cols===2?'两列':'一列'}`);
  const isFullWidthAtFit = mFit.pageW >= mFit.vw * 0.95;
  console.log(`  页面是否变成全宽(命中断点): ${isFullWidthAtFit}`);

  let finalV = target;
  if (isFullWidthAtFit) {
    finalV = target + 80; // 抬升避开断点
    mFit = await measure(browser, finalV);
    console.log(`[抬升] 视口${finalV}: 页面宽=${mFit.pageW}, 填充${(mFit.pageW/finalV*100).toFixed(0)}%, 列=${mFit.cols===2?'两列':'一列'}`);
  }

  console.log('\n=== 断言 ===');
  const checks = [
    ['适配前页面小(填充<70%)', m1680.pageW / 1680 < 0.7],
    ['适配后填充显著提升(>85%)', mFit.pageW / finalV > 0.85],
    ['两列布局保留(未塌列)', mFit.cols === 2],
  ];
  let pass = 0;
  for (const [label, cond] of checks) { if (cond) { pass++; console.log('  ✅', label); } else console.log('  ❌', label); }
  console.log(`\n结果: ${pass}/${checks.length}`);
  await browser.close();
})();
