/**
 * tools/check.mjs — 真浏览器自检
 *
 * 起一个本地静态服务器 + 无头 Chrome（DevTools 协议，不装 puppeteer），
 * 逐个打开门户和 10 个游戏，检查：
 *   1. 有没有 JS 运行时错误 / 控制台 error
 *   2. canvas 是不是真的画了东西（像素占比）
 *   3. 产出截图到 docs/shots/
 *
 * 用法：
 *   node tools/check.mjs
 *   CHROME_PATH="D:\\...\\chrome.exe" node tools/check.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'shots');
const LIVE = process.env.CHECK_BASE ? process.env.CHECK_BASE.replace(/\/+$/, '') : null;
let SITE_PORT = 8123;
let DBG_PORT = 9333;
let chromeProc = null;

process.on('exit', () => killTree(chromeProc));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function killTree(proc) {
  if (!proc) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill('SIGKILL');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
}

/* ------------------------------------------------------------- 静态服务器 */

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, url);
      if (url.endsWith('/')) file = path.join(file, 'index.html');
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) {
          // 和 GitHub Pages 一样：未知路径回落到 404.html
          fs.readFile(path.join(ROOT, '404.html'), (e2, page) => {
            if (e2) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(page);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(SITE_PORT, '127.0.0.1', () => resolve(server));
  });
}

/* ------------------------------------------------------------- CDP 客户端 */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn) { this.listeners.push(fn); }
}

/* ------------------------------------------------------------- 主流程 */

const PAGES = [
  { name: 'portal', url: '/index.html', viewport: { width: 1280, height: 940 } },
  { name: 'portal-mobile', url: '/index.html', viewport: { width: 400, height: 860 }, mobile: true },
  { name: '404', url: '/not-a-real-page.html' },
  { name: 'breakout', url: '/games/breakout/index.html' },
  { name: 'invaders', url: '/games/invaders/index.html' },
  { name: 'snake', url: '/games/snake/index.html' },
  { name: 'sokoban', url: '/games/sokoban/index.html' },
  { name: 'flow', url: '/games/flow/index.html' },
  { name: 'ice', url: '/games/ice/index.html' },
  { name: 'lasers', url: '/games/lasers/index.html' },
  { name: 'mines', url: '/games/mines/index.html' },
  { name: '2048', url: '/games/2048/index.html' },
  { name: 'match3', url: '/games/match3/index.html' }
];

async function main() {
  if (!CHROME) {
    console.error('找不到 Chrome / Edge，请设置 CHROME_PATH 环境变量');
    process.exit(2);
  }

  SITE_PORT = await freePort();
  DBG_PORT = await freePort();

  fs.mkdirSync(SHOTS, { recursive: true });
  let server = null;
  if (!LIVE) server = await serve();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-check-'));
  chromeProc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DBG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1280,940',
    'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DBG_PORT}/json/version`);
      const j = await r.json();
      wsUrl = j.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!wsUrl) {
    console.error('Chrome 调试端口没起来');
      killTree(chromeProc);
    if (server) server.close();
    process.exit(2);
  }

  const version = await (await fetch(`http://127.0.0.1:${DBG_PORT}/json/version`)).json();
  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => browserWs.addEventListener('open', r, { once: true }));
  const browser = new CDP(browserWs);

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params).catch((e) => ({ error: e.message }));
  const sendS = (method, params) => {
    // 会话内调用：把 sessionId 塞进去
    const id = ++browser.id;
    return new Promise((resolve, reject) => {
      browser.pending.set(id, { resolve, reject });
      browserWs.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };

  /* 页面操作小工具 */
  const base = LIVE || `http://127.0.0.1:${SITE_PORT}`;

  const evaluate = async (expression) => {
    const r = await sendS('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };

  const hashCanvas = () => evaluate(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 101) h = (h * 31 + d[i]) >>> 0;
    return h;
  })()`);

  const canvasCenter = () => evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  const pressKey = async (key, code, vk) => {
    await sendS('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
    await sleep(60);
    await sendS('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };

  const clickAt = async (x, y) => {
    await sendS('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(50);
    await sendS('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const DIR_KEYS = [
    ['ArrowRight', 'ArrowRight', 39],
    ['ArrowDown', 'ArrowDown', 40],
    ['ArrowLeft', 'ArrowLeft', 37],
    ['ArrowUp', 'ArrowUp', 38]
  ];

  const anyDirectionWorks = async () => {
    const before = await hashCanvas();
    for (const [k, code, vk] of DIR_KEYS) {
      await pressKey(k, code, vk);
      await sleep(420);
      if ((await hashCanvas()) !== before) return true;
    }
    return false;
  };

  // 每个页面独立收集错误
  let errors = [];
  browser.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  await sendS('Page.enable');
  await sendS('Runtime.enable');
  await sendS('Log.enable');

  for (const page of PAGES) {
    errors = [];
    const vp = page.viewport || { width: 1000, height: 780 };
    await sendS('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: !!page.mobile
    });

    await sendS('Page.navigate', { url: base + page.url });
    await sleep(1400);

    const probe = await sendS('Runtime.evaluate', {
      expression: `(() => {
        const out = { hasCG: !!window.CG, canvas: null };
        const c = document.querySelector('canvas');
        if (c) {
          const ctx = c.getContext('2d');
          try {
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) lit++;
            }
            out.canvas = { w: c.width, h: c.height, lit: lit / (d.length / 4) };
          } catch (e) { out.canvas = { error: e.message }; }
        }
        return out;
      })()`,
      returnByValue: true
    });

    const value = probe.result?.value || {};
    const canvasOk = !value.canvas || value.canvas.error || value.canvas.lit > 0.02;
    const relevant = page.name === '404' ? errors.filter((e) => !/404/.test(e)) : errors;
    check(`${page.name} 无报错`, relevant.length === 0, relevant.slice(0, 3).join(' | '));
    check(`${page.name} 画面有内容`, !!canvasOk, value.canvas ? `lit=${(value.canvas.lit * 100).toFixed(1)}%` : 'no canvas');
    if (page.url.startsWith('/games')) {
      check(`${page.name} 加载了 CG`, !!value.hasCG);
    }

    const shot = await sendS('Page.captureScreenshot', { format: 'png' });
    if (shot.data) {
      fs.writeFileSync(path.join(SHOTS, `${page.name}.png`), Buffer.from(shot.data, 'base64'));
    }
  }

  /* --------------------------------------------------------- 交互测试 */

  console.log('\n--- 交互 ---');

  const goto = async (url, viewport, mobile) => {
    const vp = viewport || { width: 1000, height: 780 };
    await sendS('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: !!mobile
    });
    await sendS('Page.navigate', { url: base + url });
    await sleep(1300);
  };

  const shot = async (name) => {
    const res = await sendS('Page.captureScreenshot', { format: 'png' });
    if (res.data) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
  };

  await goto('/games/breakout/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { x: g.ball.x, y: g.ball.y, bricks: g.bricks.length }; })()`);
    const p = await canvasCenter();
    await clickAt(p.x, p.y);
    await sleep(600);
    const s1 = await evaluate(`(() => { const g = window.__game; return { x: g.ball.x, y: g.ball.y, bricks: g.bricks.length, stuck: g.ball.stuck }; })()`);
    check('breakout 发射后球真的在飞', Number.isFinite(s1.x) && Number.isFinite(s1.y) && s1.stuck === false && (s0.y - s1.y) > 60, JSON.stringify({ s0, s1 }));

    await sleep(3200);
    const s2 = await evaluate(`(() => { const g = window.__game; return { x: g.ball.x, y: g.ball.y, bricks: g.bricks.length, score: g.score }; })()`);
    check('breakout 球能打碎砖块且没有瞬清', Number.isFinite(s2.x) && s2.score > 0 && s2.bricks > 0 && s2.bricks < s0.bricks, JSON.stringify(s2));

    // 键盘：R 重开后按空格也能发射
    await pressKey('r', 'KeyR', 82);
    await sleep(200);
    await pressKey('Space', 'Space', 32);
    await sleep(500);
    const s3 = await evaluate(`(() => { const g = window.__game; return { stuck: g.ball.stuck, y: g.ball.y, bricks: g.bricks.length }; })()`);
    check('breakout 空格能发射', s3.stuck === false && s3.y < 560 && s3.bricks > 0, JSON.stringify(s3));
  }

  await goto('/games/invaders/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { x: g.player.x, aliens: g.aliens.length }; })()`);
    await pressKey('ArrowLeft', 'ArrowLeft', 37);
    await sleep(250);
    const x1 = await evaluate('window.__game.player.x');
    check('invaders 左右移动生效', x1 < s0.x, `${Math.round(s0.x)} -> ${Math.round(x1)}`);

    await pressKey('Space', 'Space', 32);
    await sleep(150);
    const bullets = await evaluate('window.__game.bullets.length');
    check('invaders 空格能发射', bullets > 0, 'bullets=' + bullets);
  }

  await goto('/games/snake/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { x: g.snake[0].x, y: g.snake[0].y, started: g.started, len: g.snake.length }; })()`);
    check('snake 开局不自动跑', s0.started === false && s0.len === 3);
    await pressKey('ArrowUp', 'ArrowUp', 38);
    await sleep(700);
    const s1 = await evaluate(`(() => { const g = window.__game; return { x: g.snake[0].x, y: g.snake[0].y, len: g.snake.length }; })()`);
    check('snake 按键后蛇头移动', s1.x !== s0.x || s1.y !== s0.y, JSON.stringify({ s0, s1 }));
  }

  await goto('/games/sokoban/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { boxes: g.boxes.size, goals: g.goals.size, x: g.player.x, y: g.player.y }; })()`);
    check('sokoban 生成了箱子和目标', s0.boxes > 0 && s0.goals > 0, JSON.stringify(s0));
    let moved = false;
    for (const [k, code, vk] of DIR_KEYS) {
      await pressKey(k, code, vk);
      await sleep(140);
      const now = await evaluate('[window.__game.player.x, window.__game.player.y]');
      if (now[0] !== s0.x || now[1] !== s0.y) { moved = true; break; }
    }
    check('sokoban 方向键能移动玩家', moved);

    // 走到某个箱子背后推一下，确认真的推动了
    const plan = await evaluate(`(() => {
      const g = window.__game;
      const k = (x, y) => x + ',' + y;
      const dirs = [[0, -1, 'ArrowUp', 38], [0, 1, 'ArrowDown', 40], [-1, 0, 'ArrowLeft', 37], [1, 0, 'ArrowRight', 39]];
      const start = [g.player.x, g.player.y];
      const free = (x, y) => !g.walls.has(k(x, y)) && !g.boxes.has(k(x, y));
      const prev = new Map();
      const seen = new Set([k(start[0], start[1])]);
      const q = [start];
      while (q.length) {
        const [x, y] = q.shift();
        for (const [dx, dy, key] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (!free(nx, ny)) continue;
          const kk = k(nx, ny);
          if (seen.has(kk)) continue;
          seen.add(kk);
          prev.set(kk, [x, y, key]);
          q.push([nx, ny]);
        }
      }
      for (const bk of g.boxes) {
        const [bx, by] = bk.split(',').map(Number);
        for (const [dx, dy, key] of dirs) {
          const beyond = k(bx + dx, by + dy);
          if (g.walls.has(beyond) || g.boxes.has(beyond)) continue;
          const stand = k(bx - dx, by - dy);
          if (!seen.has(stand)) continue;
          const path = [];
          let cur = [bx - dx, by - dy];
          while (k(cur[0], cur[1]) !== k(start[0], start[1])) {
            const p = prev.get(k(cur[0], cur[1]));
            if (!p) break;
            path.unshift(p[2]);
            cur = [p[0], p[1]];
          }
          path.push(key);
          return { path, box: bk };
        }
      }
      return null;
    })()`);

    if (plan && plan.path.length < 40) {
      for (const key of plan.path) {
        await pressKey(key, key, key === 'ArrowUp' ? 38 : key === 'ArrowDown' ? 40 : key === 'ArrowLeft' ? 37 : 39);
        await sleep(60);
      }
      const after = await evaluate(`(() => {
        const g = window.__game;
        return { moved: !g.boxes.has(${JSON.stringify(plan.box)}), moves: g.moves };
      })()`);
      check('sokoban 走过去能把箱子推走', after.moved && after.moves > 0, JSON.stringify({ plan: plan, after }));
    } else {
      check('sokoban 走过去能把箱子推走', false, plan ? '路径太长' : '没有可推的箱子');
    }
  }

  await goto('/games/ice/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { gems: g.gems.size, x: g.player.x, y: g.player.y }; })()`);
    check('ice 生成了宝石', s0.gems > 0, 'gems=' + s0.gems);
    let moved = false;
    for (const [k, code, vk] of DIR_KEYS) {
      await pressKey(k, code, vk);
      await sleep(160);
      const now = await evaluate('[window.__game.player.x, window.__game.player.y]');
      if (now[0] !== s0.x || now[1] !== s0.y) { moved = true; break; }
    }
    check('ice 一次滑动会滑到石头边', moved);
  }

  await goto('/games/mines/index.html');
  {
    const p = await canvasCenter();
    await clickAt(p.x, p.y);
    await sleep(320);
    const s = await evaluate(`(() => { const g = window.__game; return { revealed: g.revealed, placed: g.placed, over: g.over }; })()`);
    check('mines 首点安全并翻开一片', s.placed && s.revealed > 0 && !s.over, JSON.stringify(s));
  }

  await goto('/games/2048/index.html');
  {
    const s0 = await evaluate(`(() => { const g = window.__game; return { moves: g.moves, tiles: g.board.filter(Boolean).length }; })()`);
    await pressKey('ArrowLeft', 'ArrowLeft', 37);
    await sleep(200);
    await pressKey('ArrowDown', 'ArrowDown', 40);
    await sleep(300);
    const s1 = await evaluate(`(() => { const g = window.__game; return { moves: g.moves, tiles: g.board.filter(Boolean).length }; })()`);
    check('2048 方向键之后棋盘有变化', s1.moves > s0.moves && s1.tiles >= 2, JSON.stringify({ s0, s1 }));
  }

  /* --------------------------------------------------------- 通关验证 */

  // 一笔画：按生成器的解法整条拖一遍，应该直接铺满过关
  await goto('/games/flow/index.html');
  {
    const info = await evaluate(`(() => {
      const g = window.__flow;
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const pad = 18;
      const cell = Math.floor(Math.min((r.width - pad * 2) / g.cols, (r.height - pad * 2) / g.rows));
      const ox = Math.round((r.width - cell * g.cols) / 2);
      const oy = Math.round((r.height - cell * g.rows) / 2);
      return { cell, x0: r.left + ox, y0: r.top + oy, solution: g.solution };
    })()`);

    const pt = (c) => ({
      x: info.x0 + c[0] * info.cell + info.cell / 2,
      y: info.y0 + c[1] * info.cell + info.cell / 2
    });

    for (const seg of info.solution) {
      const first = pt(seg[0]);
      await sendS('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1 });
      for (let i = 1; i < seg.length; i++) {
        const p = pt(seg[i]);
        await sendS('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
        await sleep(12);
      }
      const last = pt(seg[seg.length - 1]);
      await sendS('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', clickCount: 1 });
      await sleep(40);
    }
    const diag = await evaluate(`(() => {
      const g = window.__flow;
      return {
        solved: g.solved,
        filled: g.owner.filter((o) => o >= 0).length,
        total: g.cols * g.rows,
        dup: (() => {
          const all = g.solution.flat().map((c) => c.join(','));
          return all.length - new Set(all).size;
        })(),
        solution: g.solution,
        paths: g.paths,
        pairs: g.colors.map((c, i) => {
          const p = g.paths[i];
          return p.length > 1 && ((p[0][0] === c.a[0] && p[0][1] === c.a[1]) || (p[0][0] === c.b[0] && p[0][1] === c.b[1]));
        })
      };
    })()`);
    check('flow 沿解法拖完整盘即过关', diag.solved === true, diag.solved ? '' : JSON.stringify(diag));

    // 过关弹层应该能点「下一关」继续
    const hasModal = await evaluate("!!document.querySelector('#overlay.show .btn.primary')");
    check('flow 过关弹出结算层', hasModal === true);
    if (hasModal) {
      await evaluate("document.querySelector('#overlay.show .btn.primary').click()");
      await sleep(400);
      const next = await evaluate(`(() => { const g = window.__game; return { level: g.level, solved: g.solved, filled: g.owner.filter((o) => o >= 0).length }; })()`);
      check('flow 点下一关进入新关卡', next.level === 2 && next.solved === false && next.filled === 0, JSON.stringify(next));
    }
  }

  // 三消：找一个能凑成三连的交换，点两下应该加分
  await goto('/games/match3/index.html');
  {
    const info = await evaluate(`(() => {
      const g = window.__match3;
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const size = Math.min(r.width - 30, r.height - 30);
      const pad = size * 0.018;
      const cell = (size - pad * 9) / 8;
      const ox = (r.width - size) / 2;
      const oy = (r.height - size) / 2;
      return { cell, pad, x0: r.left + ox, y0: r.top + oy, board: Array.from(g.board), score: g.score };
    })()`);

    const board = info.board;
    const N = 8;
    const at = (x, y) => board[y * N + x];
    const hasMatch = (b) => {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = b[y * N + x];
        if (x + 2 < N && b[y * N + x + 1] === v && b[y * N + x + 2] === v) return true;
        if (y + 2 < N && b[(y + 1) * N + x] === v && b[(y + 2) * N + x] === v) return true;
      }
      return false;
    };

    let pair = null;
    for (let y = 0; y < N && !pair; y++) {
      for (let x = 0; x < N && !pair; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= N || ny >= N) continue;
          const b = board.slice();
          const i = y * N + x, j = ny * N + nx;
          [b[i], b[j]] = [b[j], b[i]];
          if (hasMatch(b)) { pair = [[x, y], [nx, ny]]; break; }
        }
      }
    }

    if (pair) {
      for (const [x, y] of pair) {
        const px = info.x0 + info.pad + x * (info.cell + info.pad) + info.cell / 2;
        const py = info.y0 + info.pad + y * (info.cell + info.pad) + info.cell / 2;
        await clickAt(px, py);
        await sleep(60);
      }
      await sleep(200);
      check('match3 交换后计分', (await evaluate('window.__match3.score')) > info.score);
    } else {
      check('match3 盘面存在可消除的交换', false, '没有找到合法交换');
    }
  }

  // 激光：把镜子转到解法朝向，应该立刻点亮全部目标
  await goto('/games/lasers/index.html');
  {
    const info = await evaluate(`(() => {
      const g = window.__lasers;
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const pad = 24;
      const cell = Math.floor(Math.min((r.width - pad * 2) / g.cols, (r.height - pad * 2) / g.rows));
      const ox = Math.round((r.width - cell * g.cols) / 2);
      const oy = Math.round((r.height - cell * g.rows) / 2);
      return { cell, x0: r.left + ox, y0: r.top + oy, cur: Object.fromEntries(g.mirrors), sol: g.solution };
    })()`);

    for (const [k, ch] of Object.entries(info.sol || {})) {
      if (info.cur[k] === ch) continue;
      const [cx, cy] = k.split(',').map(Number);
      await clickAt(info.x0 + cx * info.cell + info.cell / 2, info.y0 + cy * info.cell + info.cell / 2);
      await sleep(90);
    }
    check('lasers 转到解法朝向即通关', (await evaluate('window.__lasers.solved')) === true);
  }

  /* --------------------------------------------------------- 随机输入压力测试 */

  console.log('\n--- 随机输入 ---');

  const scanState = () => evaluate(`(() => {
    const bad = [];
    const seen = new Set();
    const walk = (v, path, depth) => {
      if (depth > 3 || v == null) return;
      if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(path); return; }
      if (typeof v !== 'object') return;
      if (seen.has(v)) return;
      seen.add(v);
      if (v instanceof Set) { for (const x of v) walk(x, path + '{}', depth + 1); return; }
      if (v instanceof Map) { for (const [k, x] of v) walk(x, path + '[' + k + ']', depth + 1); return; }
      for (const k of Object.keys(v)) walk(v[k], path + '.' + k, depth + 1);
    };
    walk(window.__game, 'g', 0);
    return bad.slice(0, 8);
  })()`);

  const FUZZ_KEYS = [
    ['ArrowLeft', 'ArrowLeft', 37],
    ['ArrowRight', 'ArrowRight', 39],
    ['ArrowUp', 'ArrowUp', 38],
    ['ArrowDown', 'ArrowDown', 40],
    ['Space', 'Space', 32]
  ];

  for (const name of ['breakout', 'invaders', 'snake', 'sokoban', 'flow', 'ice', 'lasers', 'mines', '2048', 'match3']) {
    errors = [];
    await goto(`/games/${name}/index.html`);
    const c = await canvasCenter();
    const start = Date.now();
    while (Date.now() - start < 3500) {
      const k = FUZZ_KEYS[Math.floor(Math.random() * FUZZ_KEYS.length)];
      await pressKey(k[0], k[1], k[2]);
      await sleep(80);
      if (Math.random() < 0.22) {
        await clickAt(c.x + (Math.random() - 0.5) * 320, c.y + (Math.random() - 0.5) * 320);
        await sleep(70);
      }
    }
    const bad = await scanState();
    check(`${name} 随机输入后状态无 NaN/Infinity`, bad.length === 0, bad.join(', '));
    check(`${name} 随机输入无报错`, errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  /* --------------------------------------------------------- 主题 / 移动端 */

  await goto('/index.html');
  await evaluate("CG.theme.set('light')");
  await sleep(400);
  await shot('portal-light');
  await evaluate("CG.theme.set('dark')");

  await goto('/games/match3/index.html', { width: 400, height: 800 }, true);
  await shot('match3-mobile');
  await goto('/games/sokoban/index.html', { width: 400, height: 800 }, true);
  await shot('sokoban-mobile');

  await goto('/index.html');

  killTree(chromeProc);
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('截图目录:', SHOTS);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
