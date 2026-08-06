// ADR 0003 双通道验证: 实时帧流动 + 静止高清帧 + 点击不坏
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const FIXTURE = path.join(__dirname, 'narrow-page.html');
let port = null;
let ws = null;
let frames = []; // {type:'live'|'sharp', size}
let finished = false;
let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log('  ✅', l); } else { fail++; console.log('  ❌', l); } }

setTimeout(() => { if (!finished) { console.log('❌ 60s 超时'); cleanup(1); } }, 60000);

const daemon = spawn(process.execPath, [path.join(__dirname, '..', 'preview-daemon.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
daemon.stdout.on('data', (d) => { const m = d.toString().match(/LISTENING (\d+)/); if (m) { port = parseInt(m[1]); connect(); } });
daemon.stderr.on('data', (d) => process.stderr.write('[d]' + d));

function connect() {
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'open', path: FIXTURE, viewportWidth: 980, viewportHeight: 900 })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'frame') frames.push({ t: m.live ? 'live' : 'sharp', size: m.data.length });
    if (m.type === 'status' && m.state === 'ready') runScroll();
  });
}

function runScroll() {
  console.log('=== 1. 滚动 → 应收到多张 live 帧 ===');
  let step = 0;
  const iv = setInterval(() => {
    if (step >= 5) { clearInterval(iv); setTimeout(checkSettle, 400); return; }
    ws.send(JSON.stringify({ type: 'input', kind: 'wheel', deltaY: 150 }));
    step++;
  }, 60); // 滚动 5 次, 每次 60ms → screencast 应持续推帧
}

function checkSettle() {
  console.log(`  滚动期共收 ${frames.length} 帧:`, frames.slice(0, 10).map((f) => f.t[0]).join(''));
  ok(frames.some((f) => f.t === 'live'), `滚动期间收到 live 帧 (${frames.filter((f) => f.t === 'live').length} 张)`);
  console.log('=== 2. 静止后 → 应收到 sharp 高清帧 ===');
  // 等待 250ms 防抖截图完成
  setTimeout(() => {
    const sharp = frames.filter((f) => f.t === 'sharp');
    ok(sharp.length >= 1, `静止后收到 sharp 帧 (${sharp.length} 张)`);
    ok(sharp[0] && sharp[0].size > 30000, `sharp 帧较大(${sharp[0] ? Math.round(sharp[0].size / 1024) : 0}KB, 高清)`);
    console.log('=== 3. 点击 → 不应选中 ===');
    clickTest();
  }, 800);
}

function clickTest() {
  ws.send(JSON.stringify({ type: 'input', kind: 'mousedown', x: 500, y: 300, button: 'left' }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'input', kind: 'mouseup', x: 500, y: 300, button: 'left' })), 80);
  setTimeout(() => ws.send(JSON.stringify({ type: 'get-selection' })), 500);
  ws.on('message', handleSelection);
  function handleSelection(raw) {
    const m = JSON.parse(raw);
    if (m.type === 'selection') {
      ok(m.collapsed, `点击后无选中 (${m.collapsed ? '正确' : '❌ 选中: ' + m.start})`);
      ws.removeListener('message', handleSelection);
      console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
      finished = true;
      ws.send(JSON.stringify({ type: 'shutdown' }));
      setTimeout(() => process.exit(fail ? 1 : 0), 500);
    }
  }
}
function cleanup(c) { finished = true; try { daemon.kill(); } catch (e) {} process.exit(c); }
