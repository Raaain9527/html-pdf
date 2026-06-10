const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { postProcess } = require('./pdf-postprocess');

const BROWSER_PATHS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ],
};

function findBrowser() {
  const paths = BROWSER_PATHS[process.platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  return null;
}

function outputName(input, outDir) {
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    const base = url.hostname + url.pathname.replace(/[/\\?&=:]/g, '_').replace(/_+$/, '') || 'index';
    return path.join(outDir, `${base}.pdf`);
  }
  const parsed = path.parse(input);
  return path.join(outDir, `${parsed.name}.pdf`);
}

let _browser = null;
let _browserPath = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browserPath = findBrowser();
  if (!_browserPath) throw new Error('未找到 Chromium 浏览器。设置 CHROME_PATH 环境变量。');
  _browser = await puppeteer.launch({
    executablePath: _browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return _browser;
}

async function closeBrowser() {
  if (_browser) { await _browser.close(); _browser = null; }
}

async function exportPage(browser, input, output, options = {}) {
  const ownBrowser = !browser;
  if (ownBrowser) browser = await getBrowser();

  const page = await browser.newPage();
  try {
    const vpWidth = options.viewportWidth ? parseInt(options.viewportWidth) : 1280;
    await page.setViewport({ width: vpWidth, height: 900, deviceScaleFactor: 2 });

    if (/^https?:\/\//i.test(input)) {
      await page.goto(input, { waitUntil: 'networkidle0', timeout: 60000 });
    } else {
      const filePath = path.resolve(input);
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: `文件不存在: ${filePath}` };
      }
      // Convert Windows backslashes to forward slashes for file:// URL
      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    }

    const pageMetrics = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;

      const origOverflow = html.style.overflow;
      const origHeight = html.style.height;
      html.style.overflow = 'visible';
      html.style.height = 'auto';

      // Use viewport width as the PDF page width. The content may have a
      // fixed-width wrapper (like `.page { width: 860px }`) centered in a
      // wider body — but the PDF captures from (0,0), so using the wrapper
      // width would clip the right side. Keep the full viewport width.
      // Users who want exact content width can set `--width` manually.
      let contentWidth = html.clientWidth;
      if (body) {
        const bodyRect = body.getBoundingClientRect();
        contentWidth = Math.ceil(Math.max(bodyRect.width, bodyRect.right));
      }

      const scrollHeight = Math.max(
        html.scrollHeight,
        body ? body.scrollHeight : 0,
        html.clientHeight
      );

      html.style.overflow = origOverflow;
      html.style.height = origHeight;

      return { width: contentWidth, height: scrollHeight };
    });

    const pdfWidth = options.width || `${pageMetrics.width}px`;
    const pdfHeight = options.height || `${pageMetrics.height}px`;

    // Force screen media type so @media print rules don't override
    // the layout the user designed for screen display
    await page.emulateMediaType('screen');

    await page.pdf({
      path: output,
      width: pdfWidth,
      height: pdfHeight,
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      margin: {
        top: options.marginTop || '0px',
        right: options.marginRight || '0px',
        bottom: options.marginBottom || '0px',
        left: options.marginLeft || '0px',
      },
      scale: options.scale || 1,
    });

    // Post-processing: watermark, password, metadata
    const needsPost = options.watermark || options.password || options.metadata;
    if (needsPost) {
      const tmpPath = output + '.tmp.pdf';
      fs.renameSync(output, tmpPath);
      await postProcess(tmpPath, output, {
        watermark: options.watermark,
        password: options.password,
        metadata: options.metadata,
      });
      fs.unlinkSync(tmpPath);
    }

    return { ok: true, width: pageMetrics.width, height: pageMetrics.height };
  } finally {
    await page.close();
  }
}

module.exports = { findBrowser, outputName, exportPage, getBrowser, closeBrowser };
