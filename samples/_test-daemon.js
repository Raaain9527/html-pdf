// Phase 2 核心回归: 流式帧 + 滚动触发新帧 + capture + shutdown
// 用法: node samples/_test-daemon.js
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const FIXTURE = path.join(__dirname, 'collapse-test.html');
let port = null;
let frames = 0;
let ws = null;
let finished = false;

setTimeout(() => { if (!finished) { console.log('❌ 60s 超时, 已收帧:', frames); cleanup(1); } }, 60000);

const daemon = spawn(process.execPath, [path.join(__dirname, '..', 'preview-daemon.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
daemon.stdout.on('data', (d) => { const m = d.toString().match(/LISTENING (\d+)/); if (m) { port = parseInt(m[1]); connectAndTest(); } });
daemon.stderr.on('data', (d) => process.stderr.write('[daemon] ' + d));
daemon.on('exit', (code) => { console.log('daemon 进程退出, code:', code); if (!finished) process.exit(0); });

function connectAndTest() {
  console.log('WS 端口:', port);
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('open', () => {
    console.log('WS 已连接 → open collapse-test');
    ws.send(JSON.stringify({ type: 'open', path: FIXTURE, viewportWidth: 1680, viewportHeight: 900 }));
  });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'frame') {
      frames++;
      if (frames === 1) { console.log('✅ 第1帧(初始渲染):', m.data.length, 'bytes → 发送滚动'); sendWheel(); }
      else if (frames === 2) { console.log('✅ 第2帧(滚动后新帧) → capture'); setTimeout(() => ws.send(JSON.stringify({ type: 'capture' })), 300); }
    } else if (m.type === 'status') {
      console.log('status:', m.state);
      if (m.state === 'error') { console.log('❌', m.message); cleanup(1); }
    } else if (m.type === 'error') {
      console.log('❌ daemon error:', m.message); cleanup(1);
    } else if (m.type === 'capture-result') {
      const ok = m.html.includes('100vh') && m.html.includes('Hero');
      console.log(`✅ capture ${m.html.length} 字符, 含页面内容: ${ok} → shutdown`);
      finished = true;
      ws.send(JSON.stringify({ type: 'shutdown' }));
    }
  });
  ws.on('error', (e) => { console.log('❌ WS error:', e.message); cleanup(1); });
}

function sendWheel() {
  for (let i = 0; i < 6; i++) ws.send(JSON.stringify({ type: 'input', kind: 'wheel', deltaY: 120 }));
}

function cleanup(code) {
  finished = true;
  try { daemon.kill(); } catch (e) {}
  setTimeout(() => process.exit(code), 500);
}
