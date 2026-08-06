#!/usr/bin/env node
/**
 * Phase 2 预览 daemon — 流式投影核心（ADR 0001 / 0002）
 *
 * Rust spawn 本进程；stdout 首行打印 "LISTENING <port>"（唯一 stdout 输出，Rust 据此拿端口）。
 * 持有 warm Puppeteer，用 CDP Page.startScreencast 把页面视口编码为 JPEG 帧，经 WebSocket 推给前端；
 * 前端把鼠标/滚轮/键盘事件发回来驱动真实 DOM；导出时前端发 capture 取当前 DOM。
 *
 * WS 消息协议：
 *   前端→daemon  {type:'open', path|url, viewportWidth, viewportHeight}
 *                {type:'input', kind:'mousemove'|'mousedown'|'mouseup'|'wheel'|'keydown'|'keyup'|'type', x,y,button,deltaX,deltaY,key}
 *                {type:'capture'}
 *                {type:'close'}
 *                {type:'shutdown'}
 *   daemon→前端   {type:'frame', data:base64JPEG}
 *                {type:'status', state:'ready'|'error', message?, viewport?}
 *                {type:'capture-result', html}
 */
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');
const { findBrowser } = require('./html2pdf-lib');

const LOG = (...a) => console.error('[daemon]', ...a);

let browser = null;
let page = null;
let cdp = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;
  const exe = findBrowser();
  if (!exe) throw new Error('未找到 Chromium 浏览器');
  LOG('launch browser:', exe);
  browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

async function openPage(msg) {
  const vw = msg.viewportWidth || 1680;
  const vh = msg.viewportHeight || 900;
  await closePage();

  const b = await getBrowser();
  page = await b.newPage();
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });

  const target = msg.url || ('file:///' + msg.path.replace(/\\/g, '/').replace(/^\/+/, ''));
  await page.goto(target, { waitUntil: 'networkidle0', timeout: 60000 });
  // 与导出引擎一致：screen 媒体（html2pdf-lib.js:94），不用 @media print 规则
  await page.emulateMediaType('screen');

  // 测量内容宽度（对齐 html2pdf-lib 的 wrapperW 裁剪逻辑）：body 或最宽子容器 < 视口 95%
  let contentWidth = 0;
  try {
    contentWidth = await page.evaluate((vwp) => {
      const body = document.body;
      let w = 0;
      if (body) {
        const br = body.getBoundingClientRect();
        if (br.width > 0 && br.width < vwp * 0.95) w = Math.ceil(br.width);
        for (const child of body.children) {
          const r = child.getBoundingClientRect();
          if (r.width > 100 && r.width < vwp * 0.95 && r.width > w) w = Math.ceil(r.width);
        }
      }
      return w;
    }, vw);
  } catch (e) {}

  // 流式帧：CDP Page.startScreencast，每帧必须 ack 否则暂停
  cdp = await page.createCDPSession();
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: vw, maxHeight: vh });
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    broadcast({ type: 'frame', data });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  broadcast({ type: 'status', state: 'ready', viewport: { width: vw, height: vh }, contentWidth });
  LOG('opened:', target, 'contentWidth:', contentWidth);
}

async function closePage() {
  if (cdp) { try { await cdp.send('Page.stopScreencast'); } catch (e) {} cdp = null; }
  if (page) { try { await page.close(); } catch (e) {} page = null; }
}

async function handleInput(m) {
  if (!page) return;
  try {
    switch (m.kind) {
      case 'mousemove': await page.mouse.move(m.x, m.y); break;
      case 'mousedown': await page.mouse.down({ button: m.button || 'left' }); break;
      case 'mouseup': await page.mouse.up({ button: m.button || 'left' }); break;
      case 'wheel': await page.mouse.wheel({ deltaX: m.deltaX || 0, deltaY: m.deltaY || 0 }); break;
      case 'keydown': await page.keyboard.down(m.key); break;
      case 'keyup': await page.keyboard.up(m.key); break;
      case 'type': await page.keyboard.type(m.key); break;
      default: break;
    }
  } catch (e) { LOG('input err:', e.message); }
}

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  }
}

const wss = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
wss.on('listening', () => {
  process.stdout.write(`LISTENING ${wss.address().port}\n`);
});
wss.on('connection', (ws) => {
  LOG('client connected');
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    try {
      switch (m.type) {
        case 'open': await openPage(m); break;
        case 'input': await handleInput(m); break;
        case 'capture': {
          if (!page) throw new Error('没有打开的页面');
          const html = await page.evaluate(() => '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
          ws.send(JSON.stringify({ type: 'capture-result', html }));
          break;
        }
        case 'close': await closePage(); break;
        case 'shutdown':
          await closePage().catch(() => {});
          if (browser) await browser.close().catch(() => {});
          process.exit(0);
          break;
        default: break;
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});
