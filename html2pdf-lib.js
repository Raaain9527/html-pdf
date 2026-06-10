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
    await page.setViewport({ width: vpWidth, height: 900, deviceScaleFactor: 1 });

    // Load the page
    if (/^https?:\/\//i.test(input)) {
      await page.goto(input, { waitUntil: 'networkidle0', timeout: 60000 });
    } else {
      const filePath = path.resolve(input);
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: `文件不存在: ${filePath}` };
      }
      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    }

    // Emulate screen media so @media print rules don't apply.
    // This is the baseline that produces correct layout matching
    // the browser — confirmed by the user on an earlier version.
    await page.emulateMediaType('screen');

    // Measure dimensions (screen emulation is active, so layout
    // matches the browser). We capture both the full viewport and
    // the actual content wrapper so we can crop the PDF afterwards.
    const pageMetrics = await page.evaluate((vw) => {
      const html = document.documentElement;
      const body = document.body;

      const origOverflow = html.style.overflow;
      html.style.overflow = 'visible';

      // Find the actual content wrapper width (for post-export cropping).
      // This is the widest fixed-width container — body itself if it
      // has max-width, or a direct child wrapper like `.page`.
      let wrapperW = 0, wrapperX = 0, wrapperY = 0, wrapperH = 0;
      if (body) {
        const bodyRect = body.getBoundingClientRect();
        if (bodyRect.width < vw * 0.95) {
          wrapperW = Math.ceil(bodyRect.width);
          wrapperX = Math.round(bodyRect.left);
          wrapperY = Math.round(bodyRect.top);
          wrapperH = Math.ceil(bodyRect.height);
        }
        for (const child of body.children) {
          const r = child.getBoundingClientRect();
          if (r.width > 100 && r.width < vw * 0.95 && r.width > wrapperW) {
            wrapperW = Math.ceil(r.width);
            wrapperX = Math.round(r.left);
            wrapperY = Math.round(r.top);
            wrapperH = Math.ceil(r.height);
          }
        }
      }

      const scrollHeight = Math.max(
        html.scrollHeight,
        body ? body.scrollHeight : 0
      );

      html.style.overflow = origOverflow;
      return { width: vw, height: scrollHeight, wrapperW, wrapperX, wrapperY, wrapperH };
    }, vpWidth);

    const pdfWidth = options.width || `${pageMetrics.width}px`;
    const pdfHeight = options.height || `${pageMetrics.height}px`;

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

    // Crop the PDF to the content wrapper dimensions (post-processing).
    // page.pdf() converts CSS pixels to PDF points at 72/96 = 0.75×,
    // so we must apply the same conversion to our crop coordinates.
    const cropW = options.width ? parseInt(options.width) : pageMetrics.wrapperW;
    if (cropW > 0 && cropW < pageMetrics.width) {
      const SCALE = 72 / 96; // CSS px → PDF points
      const { PDFDocument } = require('pdf-lib-plus-encrypt');
      const cropBytes = fs.readFileSync(output);
      const cropDoc = await PDFDocument.load(cropBytes);
      const pages = cropDoc.getPages();
      const offsetX = Math.round(pageMetrics.wrapperX * SCALE);
      const cropWpt = Math.round(cropW * SCALE);
      for (const p of pages) {
        const fullH = p.getSize().height;
        const offsetY = pageMetrics.wrapperY
          ? Math.round((fullH - (pageMetrics.wrapperY + pageMetrics.wrapperH) * SCALE))
          : 0;
        p.translateContent(-offsetX, offsetY);
        const cropHpt = pageMetrics.wrapperH
          ? Math.round(pageMetrics.wrapperH * SCALE)
          : fullH;
        p.setMediaBox(0, 0, cropWpt, cropHpt);
        p.setCropBox(0, 0, cropWpt, cropHpt);
      }
      fs.writeFileSync(output, await cropDoc.save());
    }

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
