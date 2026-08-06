#!/usr/bin/env node
/**
 * Phase 2 预览 daemon — 流式投影核心（ADR 0001 / 0002）
 *
 * Rust spawn 本进程；stdout 首行打印 "LISTENING <port>"（唯一 stdout 输出，Rust 据此拿端口）。
 * 持有 warm Puppeteer，把页面视口渲染为高分辨率 JPEG（captureScreenshot 尊重 DSF，
 * 输出 视口×SCALE 像素；而 screencast 流只按 CSS 视口输出，无法提分辨率），
 * 在 open/交互滚动后防抖截图，经 WebSocket 推给前端；
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
let screenshotTimer = null;

// 投影栅格分辨率倍率：DSF 不影响布局/媒体查询/vh(都用 CSS px)，只影响栅格清晰度。
// 导出是矢量 PDF，DSF 无关；预览布局与导出仍一致。
const SCALE = 2;

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
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: SCALE });

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

  // 首帧 + ready。captureScreenshot 尊重 DSF → 输出 视口×SCALE 高分辨率帧。
  await captureAndSend();
  broadcast({ type: 'status', state: 'ready', viewport: { width: vw, height: vh }, resolution: { width: vw * SCALE, height: vh * SCALE }, contentWidth });
  LOG('opened:', target, 'contentWidth:', contentWidth);
}

async function captureAndSend() {
  if (!page) return;
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 85 });
    broadcast({ type: 'frame', data: shot.toString('base64') });
  } catch (e) { LOG('capture err:', e.message); }
}

async function closePage() {
  clearTimeout(screenshotTimer);
  if (page) { try { await page.close(); } catch (e) {} page = null; }
}

let mousePressed = false; // 按住期间不调度截图, 避免截图与 mouseup 并发干扰坐标派发
function scheduleShot() { clearTimeout(screenshotTimer); screenshotTimer = setTimeout(captureAndSend, 80); }

async function handleInput(m) {
  if (!page) return;
  try {
    switch (m.kind) {
      // down/up 必须先 move 到目标坐标, 否则在旧位置按下 → 点击落点错误/误触发大范围拖选
      case 'mousemove':
        await page.mouse.move(m.x, m.y);
        if (!mousePressed) scheduleShot(); // hover 反馈; 拖动中不截, 松开时由 mouseup 截
        break;
      case 'mousedown':
        mousePressed = true;
        clearTimeout(screenshotTimer); // 取消待执行截图, 防止与 mouseup 并发
        await page.mouse.move(m.x, m.y); await page.mouse.down({ button: m.button || 'left' });
        break;
      case 'mouseup':
        mousePressed = false;
        await page.mouse.move(m.x, m.y); await page.mouse.up({ button: m.button || 'left' });
        scheduleShot();
        break;
      case 'wheel': await page.mouse.wheel({ deltaX: m.deltaX || 0, deltaY: m.deltaY || 0 }); scheduleShot(); break;
      case 'keydown': await page.keyboard.down(m.key); break;
      case 'keyup': await page.keyboard.up(m.key); break;
      case 'type': await page.keyboard.type(m.key); scheduleShot(); break;
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
