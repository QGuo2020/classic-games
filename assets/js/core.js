/* ==========================================================================
   classic-games · 共享运行时
   零依赖：存储 / 主题 / 音效 / 弹层 / 画布适配 / 关卡进度
   直接用 <script src> 引入，不是 ES Module，file:// 双击也能跑。
   ========================================================================== */
(function (global) {
  'use strict';

  const PREFIX = 'cg:';

  /* ------------------------------------------------------------ 存储 */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) { /* 隐私模式或配额满，忽略 */ }
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    }
  };

  /* ------------------------------------------------------------ 主题 */

  const themeListeners = [];

  const theme = {
    current() {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    set(name) {
      document.documentElement.setAttribute('data-theme', name === 'light' ? 'light' : 'dark');
      store.set('theme', name);
      themeListeners.forEach((fn) => { try { fn(name); } catch (e) {} });
    },
    toggle() {
      const next = theme.current() === 'light' ? 'dark' : 'light';
      theme.set(next);
      return next;
    },
    init() {
      theme.set(store.get('theme', 'dark'));
    },
    onChange(fn) {
      themeListeners.push(fn);
    },
    /** 绑定一个按钮：切换主题并同步图标 */
    bind(btn) {
      if (!btn) return;
      const sync = () => { btn.textContent = theme.current() === 'light' ? '☀' : '☾'; };
      sync();
      btn.addEventListener('click', () => {
        theme.toggle();
        sync();
        sfx.click();
      });
    }
  };

  /* ------------------------------------------------------------ 音效 */

  const audio = {
    ctx: null,
    enabled: store.get('sound', true),

    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    tone(freq, dur, opt) {
      const ac = this.ensure();
      if (!ac) return;
      const o = opt || {};
      const t0 = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + dur);
      const vol = o.vol == null ? 0.05 : o.vol;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    toggle() {
      this.enabled = !this.enabled;
      store.set('sound', this.enabled);
      return this.enabled;
    }
  };

  const sfx = {
    click()  { audio.tone(560, 0.05, { type: 'triangle', vol: 0.035 }); },
    step()   { audio.tone(300, 0.05, { type: 'square', vol: 0.018 }); },
    move()   { audio.tone(420, 0.04, { type: 'sine', vol: 0.03 }); },
    hit()    { audio.tone(150, 0.14, { type: 'sawtooth', vol: 0.05, to: 70 }); },
    bounce() { audio.tone(680, 0.04, { type: 'square', vol: 0.022 }); },
    ok()     { audio.tone(660, 0.07, { vol: 0.04 }); audio.tone(990, 0.1, { vol: 0.04, delay: 0.07 }); },
    bad()    { audio.tone(220, 0.16, { type: 'sawtooth', vol: 0.045, to: 110 }); },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        audio.tone(f, 0.16, { vol: 0.045, delay: i * 0.09, type: 'triangle' });
      });
    },
    lose() {
      [392, 329.6, 261.6].forEach((f, i) => {
        audio.tone(f, 0.22, { vol: 0.045, delay: i * 0.13, type: 'sine' });
      });
    }
  };

  /* ------------------------------------------------------------ 工具 */

  const util = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    rand(a, b) { return a + Math.random() * (b - a); },
    randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** 确定性随机数：同一 seed 生成同一关卡 */
    rng(seed) {
      let t = seed >>> 0;
      return function () {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    },
    /** 让 canvas 的绘制坐标系等于 CSS 像素，并返回真实尺寸 */
    fit(canvas) {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w, h, dpr };
    },
    /** 把矩形网格居中适配到画布 */
    grid(w, h, cols, rows, pad) {
      const p = pad == null ? 12 : pad;
      const cell = Math.floor(Math.min((w - p * 2) / cols, (h - p * 2) / rows));
      const gw = cell * cols;
      const gh = cell * rows;
      return { cell, ox: Math.round((w - gw) / 2), oy: Math.round((h - gh) / 2), gw, gh };
    },
    pointer(canvas) {
      return (ev) => {
        const r = canvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
      };
    },
    /** 触屏滑动方向 */
    swiper(el, onDir, threshold) {
      const th = threshold || 24;
      let sx = 0, sy = 0, active = false;
      el.addEventListener('pointerdown', (e) => {
        sx = e.clientX; sy = e.clientY; active = true;
      });
      el.addEventListener('pointerup', (e) => {
        if (!active) return;
        active = false;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) < th && Math.abs(dy) < th) return;
        if (Math.abs(dx) > Math.abs(dy)) onDir(dx > 0 ? 'right' : 'left');
        else onDir(dy > 0 ? 'down' : 'up');
      });
    }
  };

  /* ------------------------------------------------------------ 配色 */

  function colors() {
    const light = theme.current() === 'light';
    if (light) {
      return {
        light: true,
        bg: '#eaf0f8', panel: '#ffffff',
        text: '#1b2a3a', muted: '#5e7087',
        line: 'rgba(45,72,100,0.18)', lineStrong: 'rgba(45,72,100,0.42)',
        accent: '#0b8f78', accentSoft: 'rgba(11,143,120,0.13)',
        danger: '#d92b47', hint: '#a86b16', violet: '#6d4bd6',
        glow: 0.18
      };
    }
    return {
      light: false,
      bg: '#050912', panel: '#0b1220',
      text: '#eef4ff', muted: '#8695ae',
      line: 'rgba(164,190,225,0.18)', lineStrong: 'rgba(164,190,225,0.42)',
      accent: '#5df2d0', accentSoft: 'rgba(93,242,208,0.16)',
      danger: '#ff5d78', hint: '#ffd166', violet: '#a78bfa',
      glow: 0.55
    };
  }

  /* ------------------------------------------------------------ 弹层 */

  const ui = {
    overlayEl() { return document.getElementById('overlay'); },

    /**
     * 弹一个卡片，返回 Promise<动作 value>
     * actions: [{ label, value, primary }]
     */
    modal(opt) {
      const host = ui.overlayEl();
      const mask = document.createElement('div');
      mask.className = 'modal-mask';

      const card = document.createElement('div');
      card.className = 'modal';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      const h = document.createElement('h2');
      h.textContent = opt.title || '';
      card.appendChild(h);

      if (opt.text) {
        const p = document.createElement('p');
        p.innerHTML = opt.text;
        card.appendChild(p);
      }

      const actions = opt.actions && opt.actions.length ? opt.actions : [{ label: '继续', value: 'ok', primary: true }];
      const row = document.createElement('div');
      row.className = 'modal-actions';

      return new Promise((resolve) => {
        const close = (value) => {
          host.classList.remove('show');
          host.innerHTML = '';
          document.removeEventListener('keydown', onKey);
          resolve(value);
        };

        actions.forEach((a) => {
          const b = document.createElement('button');
          b.className = 'btn' + (a.primary ? ' primary' : '');
          b.textContent = a.label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (a.primary) sfx.ok(); else sfx.click();
            close(a.value);
          });
          row.appendChild(b);
        });

        card.appendChild(row);
        mask.appendChild(card);
        host.innerHTML = '';
        host.appendChild(mask);
        host.classList.add('show');

        const onKey = (e) => {
          if (e.key === 'Enter') {
            const first = actions.find((a) => a.primary) || actions[0];
            close(first.value);
          }
        };
        document.addEventListener('keydown', onKey);
      });
    },

    toast(text, ms) {
      const old = document.querySelector('.toast');
      if (old) old.remove();
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), ms || 1600);
    }
  };

  /* ------------------------------------------------------------ 进度 */

  function progress(slug) {
    const key = 'progress:' + slug;
    const data = store.get(key, { level: 1, max: 1, best: 0, wins: 0 });
    return {
      data,
      get level() { return data.level; },
      get max() { return data.max; },
      get best() { return data.best; },
      reach(level) {
        data.max = Math.max(data.max, level);
        data.level = Math.max(data.level, level);
        store.set(key, data);
      },
      win(score) {
        data.wins += 1;
        data.best = Math.max(data.best, score || 0);
        store.set(key, data);
      },
      save() { store.set(key, data); },
      reset() {
        data.level = 1; data.max = 1; data.best = 0; data.wins = 0;
        store.set(key, data);
      }
    };
  }

  /* ------------------------------------------------------------ 杂项 */

  /** 统一处理「弹层期间暂停 / 键盘」的简单循环 */
  function loop(fn) {
    let last = performance.now();
    let raf = 0;
    let running = true;
    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fn(dt, now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      stop() { running = false; cancelAnimationFrame(raf); },
      resume() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }
    };
  }

  /** 音效按钮（🔊 / 🔇） */
  function soundButton(btn) {
    if (!btn) return;
    const sync = () => { btn.textContent = audio.enabled ? '🔊' : '🔇'; };
    sync();
    btn.addEventListener('click', () => {
      audio.toggle();
      sync();
      if (audio.enabled) sfx.click();
    });
  }

  /* ------------------------------------------------------------ 调试浮层
     在地址后面加 ?debug 就会显示 FPS / 画布尺寸 / DPR，方便手机上排查 */

  if (/[?&]debug/.test(location.search)) {
    const badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.45 monospace;' +
      'color:#5df2d0;background:rgba(0,0,0,.72);padding:5px 7px;border-radius:6px;' +
      'pointer-events:none;white-space:pre;text-align:left';
    document.body.appendChild(badge);

    let frames = 0;
    let last = performance.now();
    let fps = 0;

    (function tick(t) {
      frames += 1;
      if (t - last >= 1000) {
        fps = Math.round((frames * 1000) / (t - last));
        frames = 0;
        last = t;
      }
      requestAnimationFrame(tick);
    })(performance.now());

    setInterval(() => {
      const c = document.querySelector('canvas');
      const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
      badge.textContent =
        'fps ' + fps +
        '  canvas ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        '  dpr ' + (window.devicePixelRatio || 1) +
        '\ninner ' + window.innerWidth + 'x' + window.innerHeight;
    }, 500);
  }

  global.CG = {
    store, theme, audio, sfx, util, ui, colors, progress, loop, soundButton, PREFIX
  };

  theme.init();
  window.addEventListener('error', (e) => {
    if (console && console.error) console.error('[CG] 运行时错误:', e.message);
  });
})(window);
