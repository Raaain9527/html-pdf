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

    // Neutralise @media print CSS so page.pdf() (which uses print
    // emulation internally) renders the same layout as the browser.
    // Without this, @page { size: A4 } forces pagination and @media
    // print rules override widths/fonts/padding.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = '__html2pdf__';
      style.textContent = `
        @media print {
          @page { size: auto !important; margin: 0 !important; }
          *, *::before, *::after {
            font-size: inherit !important;
            line-height: inherit !important;
            margin: inherit !important;
            padding: inherit !important;
            width: inherit !important;
            max-width: inherit !important;
            min-width: inherit !important;
            box-shadow: inherit !important;
            background: inherit !important;
          }
        }
      `;
      document.head.appendChild(style);
    });

    // Wait for the override style to take effect, then measure.
    // Measurement now uses screen-equivalent layout since print
    // rules are neutralised.
    await new Promise(r => setTimeout(r, 200));

    const pageMetrics = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;

      const origOverflow = html.style.overflow;
      html.style.overflow = 'visible';

      // Detect the actual content boundary: look for a fixed-width
      // container (body with max-width, or a child wrapper).
      let contentWidth = html.clientWidth;
      if (body) {
        const bodyRect = body.getBoundingClientRect();
        if (bodyRect.width < html.clientWidth * 0.95) {
          contentWidth = Math.ceil(bodyRect.width);
        } else {
          let bestW = 0;
          for (const child of body.children) {
            const r = child.getBoundingClientRect();
            if (r.width > 100 && r.width < html.clientWidth * 0.95 && r.width > bestW) {
              bestW = Math.ceil(r.width);
            }
          }
          if (bestW > 0) contentWidth = bestW;
          else contentWidth = Math.ceil(bodyRect.width);
        }
      }

      const scrollHeight = Math.max(
        html.scrollHeight,
        body ? body.scrollHeight : 0
      );

      html.style.overflow = origOverflow;
      return { width: contentWidth, height: scrollHeight };
    });

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

    // If user specified a narrower --width, crop the PDF via pdf-lib.
    // This preserves vector text while trimming side margins.
    if (options.width) {
      const targetW = parseInt(options.width);
      if (targetW > 0 && targetW < pageMetrics.width) {
        const { PDFDocument } = require('pdf-lib-plus-encrypt');
        const cropBytes = fs.readFileSync(output);
        const cropDoc = await PDFDocument.load(cropBytes);
        const pages = cropDoc.getPages();
        const offsetX = Math.round((pageMetrics.width - targetW) / 2);
        for (const p of pages) {
          const { height } = p.getSize();
          p.setCropBox(offsetX, 0, offsetX + targetW, height);
          p.setMediaBox(offsetX, 0, offsetX + targetW, height);
        }
        fs.writeFileSync(output, await cropDoc.save());
      }
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
