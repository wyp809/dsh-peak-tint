/**
 * dsh-peak-tint — client half.
 *
 * Everything the user sees lives here: the billing-window clock, the theme
 * token layer, the composer pill and the settings page.
 *
 * Design rules this file follows:
 *  - Styling is done exclusively through `ctx.theme.overrideTokens()`. No
 *    global stylesheet, no DOM patching, no touching other plugins' layers.
 *  - Every timer / listener / layer is owned by `ctx` and disposed with it.
 *  - The colour change is verified against the live computed token value; when
 *    another layer wins, the pill says so instead of silently doing nothing.
 */
window.__ModuleLoader__.load({
  id: 'dsh-peak-tint',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;
    const useSyncExternalStore =
      React.useSyncExternalStore ||
      function fallback(subscribe, getSnapshot) {
        const [, force] = React.useState(0);
        React.useEffect(() => subscribe(() => force(function (x) { return x + 1; })), [subscribe]);
        return getSnapshot();
      };

    // ───────────────────────────── constants ─────────────────────────────

    const STORAGE_KEY = 'dsh-peak-tint/config@1';
    const SOURCE = 'dsh-peak-tint';
    const CN_OFFSET = 8 * 3600 * 1000;      // Asia/Shanghai, never the OS zone
    const MAX_SCAN_MINUTES = 8 * 1440;
    const MINUTE = 60 * 1000;

    const WEEKDAYS = [
      { v: 1, l: '一' }, { v: 2, l: '二' }, { v: 3, l: '三' }, { v: 4, l: '四' },
      { v: 5, l: '五' }, { v: 6, l: '六' }, { v: 0, l: '日' },
    ];

    const PRESETS = {
      amber: { label: '琥珀', peak: ['#fdf5ee', '#191310'], offpeak: ['#f3faf6', '#0f1714'] },
      rose: { label: '玫瑰', peak: ['#fdf2f4', '#1a1113'], offpeak: ['#f2f8fb', '#0f1519'] },
      teal: { label: '青碧', peak: ['#f1f8f8', '#0e1617'], offpeak: ['#f3fbf4', '#101714'] },
      violet: { label: '紫罗兰', peak: ['#f7f4fd', '#15121a'], offpeak: ['#f4f8fd', '#101317'] },
      green: { label: '翠绿', peak: ['#fbf7ef', '#181410'], offpeak: ['#eefaf1', '#0d1810'] },
      slate: { label: '石墨', peak: ['#f8f6f4', '#171614'], offpeak: ['#f5f7f8', '#121516'] },
    };

    const DEFAULT_CONFIG = {
      version: 1,
      enabled: true,
      strength: 'edge',            // edge | surface | off
      palette: 'amber',            // key of PRESETS, or 'custom'
      opacity: 0.8,                // tint alpha; < 1 lets a wallpaper show through
      wallpaperSafe: 'auto',       // auto | on | off — keep a wallpaper visible
      custom: {
        peakLight: '#fdf5ee', peakDark: '#191310',
        offpeakLight: '#f3faf6', offpeakDark: '#0f1714',
      },
      gradient: { enabled: true, angle: 160, spread: 55 },
      gradientOnBase: false,
      windows: [
        { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
        { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
      ],
    };

    // ───────────────────────────── config ─────────────────────────────

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function hmToMinutes(text) {
      if (typeof text !== 'string') return -1;
      const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
      if (!m) return -1;
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour > 23 || minute > 59) return -1;
      return hour * 60 + minute;
    }

    function sanitizeWindow(input) {
      const source = input && typeof input === 'object' ? input : {};
      const days = Array.isArray(source.days)
        ? source.days.filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; })
        : [1, 2, 3, 4, 5];
      return {
        days: days.length ? days : [1, 2, 3, 4, 5],
        start: hmToMinutes(source.start) >= 0 ? source.start : '09:00',
        end: hmToMinutes(source.end) >= 0 ? source.end : '12:00',
      };
    }

    function sanitize(input) {
      const base = clone(DEFAULT_CONFIG);
      const source = input && typeof input === 'object' ? input : {};
      const out = Object.assign(base, {});
      if (typeof source.enabled === 'boolean') out.enabled = source.enabled;
      if (source.strength === 'edge' || source.strength === 'surface' || source.strength === 'off') {
        out.strength = source.strength;
      }
      if (typeof source.palette === 'string' && (source.palette === 'custom' || PRESETS[source.palette])) {
        out.palette = source.palette;
      }
      if (typeof source.gradientOnBase === 'boolean') out.gradientOnBase = source.gradientOnBase;
      if (Number.isFinite(Number(source.opacity))) {
        out.opacity = Math.max(0.15, Math.min(1, Number(source.opacity)));
      }
      if (source.wallpaperSafe === 'auto' || source.wallpaperSafe === 'on' ||
          source.wallpaperSafe === 'ghost' || source.wallpaperSafe === 'off') {
        out.wallpaperSafe = source.wallpaperSafe;
      }

      const custom = source.custom && typeof source.custom === 'object' ? source.custom : {};
      ['peakLight', 'peakDark', 'offpeakLight', 'offpeakDark'].forEach(function (key) {
        if (typeof custom[key] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(custom[key].trim())) {
          out.custom[key] = custom[key].trim();
        }
      });

      const grad = source.gradient && typeof source.gradient === 'object' ? source.gradient : {};
      if (typeof grad.enabled === 'boolean') out.gradient.enabled = grad.enabled;
      if (Number.isFinite(Number(grad.angle))) {
        out.gradient.angle = Math.max(0, Math.min(360, Math.round(Number(grad.angle))));
      }
      if (Number.isFinite(Number(grad.spread))) {
        out.gradient.spread = Math.max(0, Math.min(100, Math.round(Number(grad.spread))));
      }

      if (Array.isArray(source.windows)) {
        out.windows = source.windows.map(sanitizeWindow);
        if (!out.windows.length) out.windows = clone(DEFAULT_CONFIG.windows);
      }
      return out;
    }

    // ───────────────────────────── schedule ─────────────────────────────

    function cnParts(ts) {
      const d = new Date(ts + CN_OFFSET);
      return { dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
    }

    function windowHit(parts, w) {
      const start = hmToMinutes(w.start);
      const end = hmToMinutes(w.end);
      if (start < 0 || end < 0) return false;
      const hasDay = function (d) { return w.days.indexOf(d) >= 0; };
      if (start === end) return hasDay(parts.dow);            // 全天
      if (start < end) return hasDay(parts.dow) && parts.minutes >= start && parts.minutes < end;
      // 跨夜：start 当天到 24:00，次日 00:00 到 end
      const previous = (parts.dow + 6) % 7;
      return (hasDay(parts.dow) && parts.minutes >= start) ||
             (hasDay(previous) && parts.minutes < end);
    }

    function bandAt(ts, config) {
      const parts = cnParts(ts);
      for (let i = 0; i < config.windows.length; i += 1) {
        if (windowHit(parts, config.windows[i])) return 'peak';
      }
      return 'offpeak';
    }

    function nextFlip(from, config) {
      const current = bandAt(from, config);
      const base = Math.floor(from / MINUTE) * MINUTE;
      for (let i = 1; i <= MAX_SCAN_MINUTES; i += 1) {
        const stamp = base + i * MINUTE;
        if (bandAt(stamp, config) !== current) return stamp;
      }
      return null;
    }

    function fmtRemain(ms) {
      if (ms === null || ms === undefined) return '';
      let total = Math.max(0, Math.round(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (days > 0) return days + '天' + hours + '小时';
      if (hours > 0) return hours + '小时' + minutes + '分';
      if (minutes > 0) return minutes + '分' + String(seconds).padStart(2, '0') + '秒';
      return seconds + '秒';
    }

    // ───────────────────────────── colours ─────────────────────────────

    function hexToRgb(hex) {
      let value = String(hex || '').trim().replace('#', '');
      if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
      if (value.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(value)) return null;
      return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
      };
    }

    function toHex(n) {
      const v = Math.max(0, Math.min(255, Math.round(n)));
      return v.toString(16).padStart(2, '0');
    }

    function mixHex(a, b, t) {
      const ca = hexToRgb(a);
      const cb = hexToRgb(b);
      if (!ca || !cb) return a;
      const w = Math.max(0, Math.min(1, Number(t) || 0));
      return '#' + toHex(ca.r + (cb.r - ca.r) * w) +
                  toHex(ca.g + (cb.g - ca.g) * w) +
                  toHex(ca.b + (cb.b - ca.b) * w);
    }

    function accentFor(band, scheme) {
      if (band === 'peak') return scheme === 'light' ? '#e0a068' : '#59371f';
      return scheme === 'light' ? '#7fc8a9' : '#1d4234';
    }

    function colorPair(config, band) {
      const preset = PRESETS[config.palette];
      if (preset) {
        return band === 'peak'
          ? { light: preset.peak[0], dark: preset.peak[1] }
          : { light: preset.offpeak[0], dark: preset.offpeak[1] };
      }
      const c = config.custom;
      return band === 'peak'
        ? { light: c.peakLight, dark: c.peakDark }
        : { light: c.offpeakLight, dark: c.offpeakDark };
    }

    function withAlpha(hex, alpha) {
      const rgb = hexToRgb(hex);
      if (!rgb) return hex;
      const a = Math.max(0, Math.min(1, Number(alpha)));
      if (!Number.isFinite(a) || a >= 1) return hex;
      return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
    }

    function surfaceValue(base, config, band, scheme) {
      const alpha = Number.isFinite(Number(config.opacity)) ? config.opacity : 1;
      const solid = withAlpha(base, alpha);
      if (!config.gradient || !config.gradient.enabled) return solid;
      const angle = config.gradient.angle;
      const spread = config.gradient.spread / 100;
      const end = withAlpha(mixHex(base, accentFor(band, scheme), spread), alpha);
      return 'linear-gradient(' + angle + 'deg, ' + solid + ' 0%, ' + end + ' 100%)';
    }

    /**
     * In the Windows layout `--dsw-specific-sidebar-fill` is shared by the
     * sidebar column AND the window frame, so whatever we put here is painted
     * across the whole window. Glass/wallpaper plugins make that window
     * transparent on purpose, so a strong fill hides the user's wallpaper.
     */
    function detectWallpaper() {
      try {
        if (typeof document === 'undefined' || !document.body) return false;
        if (readVar('--we-glass-alpha')) return true;
        if (readVar('--we-wallpaper-transform')) return true;
        const data = document.body.dataset || {};
        return data.weGlassPage === 'on' || data.weGlassWindow === 'on' || data.weWallpaper === 'on';
      } catch (err) {
        return false;
      }
    }

    function buildTokens(config, band, forceSolid) {
      const pair = colorPair(config, band);

      // `ghost` paints nothing at all: the pill stays, the wallpaper is untouched.
      if (config.wallpaperSafe === 'ghost') return {};

      const wallpaper = config.wallpaperSafe === 'on' ||
        (config.wallpaperSafe !== 'off' && detectWallpaper());

      // A gradient is valid for `background:` but not a CSS color, so a token
      // validator may reject it. `forceSolid` is the fallback pass.
      const paint = Object.assign({}, config);
      if (forceSolid) {
        paint.gradient = { enabled: false };
        paint.gradientOnBase = false;
      }
      if (wallpaper) {
        paint.opacity = Math.min(Number(paint.opacity) || 1, 0.12);
        paint.gradientOnBase = false;
      }

      const tokens = {};
      tokens['--dsw-specific-sidebar-fill'] = {
        light: surfaceValue(pair.light, paint, band, 'light'),
        dark: surfaceValue(pair.dark, paint, band, 'dark'),
      };
      tokens['--dsw-alias-border-l1'] = {
        light: mixHex(pair.light, accentFor(band, 'light'), wallpaper ? 0.18 : 0.3),
        dark: mixHex(pair.dark, accentFor(band, 'dark'), wallpaper ? 0.32 : 0.55),
      };
      // Never repaint the content surface while a wallpaper is in charge.
      if (config.strength === 'surface' && !wallpaper) {
        tokens['--dsw-alias-bg-base'] = {
          light: paint.gradientOnBase ? surfaceValue(pair.light, paint, band, 'light') : withAlpha(pair.light, paint.opacity),
          dark: paint.gradientOnBase ? surfaceValue(pair.dark, paint, band, 'dark') : withAlpha(pair.dark, paint.opacity),
        };
        tokens['--dsw-alias-bg-layer-1'] = {
          light: withAlpha(mixHex(pair.light, '#ffffff', 0.45), Math.min(1, (Number(config.opacity) || 1) + 0.12)),
          dark: withAlpha(mixHex(pair.dark, '#ffffff', 0.07), Math.min(1, (Number(config.opacity) || 1) + 0.12)),
        };
      }
      return tokens;
    }

    // ───────────────────────────── store ─────────────────────────────

    const runtime = { ctx: null, layer: null, timer: null, lastPaintAt: 0 };

    let initialized = false;
    let config = null;
    let band = 'offpeak';
    let nextAt = null;
    let check = { status: 'idle', detail: '' };
    let snapshot = null;
    let revision = 0;

    const listeners = new Set();

    function notify() {
      revision += 1;
      snapshot = { revision: revision, config: config, band: band, nextAt: nextAt, check: check };
      listeners.forEach(function (fn) {
        try { fn(); } catch (err) { console.error('[peak-tint] subscriber failed', err); }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    }

    function getSnapshot() {
      ensureInit();
      return snapshot;
    }

    function ensureInit(force) {
      if (initialized && !force) return;
      initialized = true;
      let stored = null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (err) {
        stored = null;
      }
      config = sanitize(stored);
      const now = Date.now();
      band = bandAt(now, config);
      nextAt = nextFlip(now, config);
      if (!snapshot) {
        revision += 1;
        snapshot = { revision: revision, config: config, band: band, nextAt: nextAt, check: check };
      }
    }

    function persist() {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (err) { /* quota / private mode */ }
    }

    function commit(patch) {
      ensureInit();
      config = sanitize(Object.assign({}, config, patch));
      persist();
      const now = Date.now();
      band = bandAt(now, config);
      nextAt = nextFlip(now, config);
      if (runtime.reschedule) runtime.reschedule();
      if (runtime.paint) runtime.paint();
      notify();
    }

    function useStore() {
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    // ───────────────────────────── painting ─────────────────────────────

    function normalize(value) {
      return String(value || '').replace(/\s+/g, '').toLowerCase();
    }

    function readVar(name) {
      if (typeof document === 'undefined' || !document.body) return '';
      try {
        const onBody = getComputedStyle(document.body).getPropertyValue(name);
        if (onBody && onBody.trim()) return onBody.trim();
        const onRoot = getComputedStyle(document.documentElement).getPropertyValue(name);
        return onRoot ? onRoot.trim() : '';
      } catch (err) {
        return '';
      }
    }

    function resolveTheme(ctx) {
      if (!ctx) return undefined;
      try {
        if (typeof ctx.get === 'function') {
          const service = ctx.get('theme');
          if (service) return service;
        }
      } catch (err) { /* not composited */ }
      return ctx.theme;
    }

    function probe(tokens, attempt) {
      const target = config.strength === 'surface'
        ? '--dsw-alias-bg-base'
        : '--dsw-specific-sidebar-fill';
      const expected = tokens[target];
      if (!expected) {
        check = { status: 'ok', detail: '' };
        notify();
        return;
      }
      window.setTimeout(function () {
        const actual = normalize(readVar(target));
        const ok = actual === normalize(expected.light) || actual === normalize(expected.dark);
        if (ok) {
          check = { status: 'ok', detail: '' };
          notify();
          return;
        }
        if (attempt === 0) {
          const theme = resolveTheme(runtime.ctx);
          if (theme) {
            try { runtime.layer = theme.overrideTokens(SOURCE, tokens); } catch (err) { /* keep first layer */ }
          }
          probe(tokens, 1);
          return;
        }
        check = actual
          ? {
              status: 'overridden',
              detail: '染色被其他插件或主题层覆盖（' + target + ' 实际为 ' + actual + '）。点击胶囊可重新置顶。',
            }
          : {
              status: 'unsupported',
              detail: '主题 token ' + target + ' 不存在，Harness 版本可能已改名，染色未生效。',
            };
        notify();
      }, 320);
    }

    function paint() {
      ensureInit();
      const theme = resolveTheme(runtime.ctx);
      if (runtime.layer) {
        try { runtime.layer(); } catch (err) { /* already gone */ }
        runtime.layer = null;
      }
      runtime.lastPaintAt = Date.now();

      if (!theme) {
        check = { status: 'no-service', detail: '主题服务不可用，本插件无法染色。' };
        return;
      }
      if (!config.enabled || config.strength === 'off') {
        check = { status: 'idle', detail: '染色已关闭。' };
        return;
      }
      let tokens = buildTokens(config, band, false);
      if (!Object.keys(tokens).length) {
        // Ghost mode: nothing to paint, the pill carries the whole signal.
        check = { status: 'ok', detail: '仅胶囊提示，不染背景。' };
        return;
      }
      try {
        runtime.layer = theme.overrideTokens(SOURCE, tokens);
      } catch (firstError) {
        // Most likely the validator refuses a gradient value. Fall back to the
        // solid colour of the same palette rather than leaving the UI unpainted.
        tokens = buildTokens(config, band, true);
        try {
          runtime.layer = theme.overrideTokens(SOURCE, tokens);
          check = {
            status: 'solid-fallback',
            detail: '渐变值未被接受，已退回纯色。原因：' +
              (firstError && firstError.message ? firstError.message : String(firstError)),
          };
        } catch (secondError) {
          check = {
            status: 'error',
            detail: '写入主题层失败：' +
              (secondError && secondError.message ? secondError.message : String(secondError)),
          };
          notify();
          return;
        }
      }
      probe(tokens, 0);
    }

    // ───────────────────────────── styles ─────────────────────────────

    const CSS = [
      '.pt-wrap{display:inline-flex;align-items:center}',
      '.pt-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;',
      'border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap;',
      'transition:background .2s,border-color .2s}',
      '.pt-pill[data-band=peak]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,var(--dsw-alias-bg-layer-1));',
      'border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,var(--dsw-alias-border-l2));',
      'color:var(--dsw-alias-label-primary)}',
      '.pt-pill[data-band=offpeak]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,var(--dsw-alias-bg-layer-1));',
      'border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,var(--dsw-alias-border-l2));}',
      '.pt-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.pt-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}',
      '.pt-pill[data-band=peak] .pt-dot{background:var(--dsw-alias-state-warn-primary)}',
      '.pt-pill[data-band=offpeak] .pt-dot{background:var(--dsw-alias-state-success-primary)}',
      '.pt-count{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.pt-warn{color:var(--dsw-alias-state-error-primary);font-weight:600}',
      '.pt-page{display:flex;flex-direction:column;gap:18px;padding:4px 0 40px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
      '.pt-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.pt-card h3{margin:0;font-size:14px;font-weight:500}',
      '.pt-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.pt-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.pt-row>.pt-name{flex:none;min-width:88px;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.pt-seg{display:inline-flex;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
      '.pt-seg button{border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:5px 12px;cursor:pointer}',
      '.pt-seg button[data-on=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.pt-swatches{display:flex;gap:8px;flex-wrap:wrap}',
      '.pt-swatch{width:44px;height:34px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);cursor:pointer;padding:0;position:relative;overflow:hidden}',
      '.pt-swatch[data-on=true]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.pt-swatch span{position:absolute;inset:0;display:grid;place-items:center;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.pt-color{display:flex;gap:14px;flex-wrap:wrap}',
      '.pt-color label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.pt-color input[type=color]{width:34px;height:24px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:0 0;padding:0;cursor:pointer}',
      '.pt-window{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.pt-window:last-child{border-bottom:0}',
      '.pt-days{display:inline-flex;gap:3px}',
      '.pt-days button{width:24px;height:24px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);',
      'background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;padding:0}',
      '.pt-days button[data-on=true]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}',
      '.pt-time{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:3px 6px}',
      '.pt-btn{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:0 0;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:5px 12px;cursor:pointer}',
      '.pt-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.pt-btn:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}',
      '.pt-danger{color:var(--dsw-alias-state-error-primary)}',
      '.pt-textarea{width:100%;min-height:96px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);',
      'border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;padding:8px 10px;resize:vertical}',
      '.pt-status{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px}',
      '.pt-badge{border-radius:999px;padding:1px 9px;font-size:12px;border:.5px solid var(--dsw-alias-border-l2)}',
      '.pt-badge[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}',
      '.pt-badge[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}',
      '.pt-badge[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
    ].join('');

    function StyleTag() {
      return h('style', null, CSS);
    }

    // ───────────────────────────── components ─────────────────────────────

    function Countdown(props) {
      const [now, setNow] = React.useState(function () { return Date.now(); });
      React.useEffect(function () {
        const id = window.setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { window.clearInterval(id); };
      }, []);
      return h('span', { className: 'pt-count' }, fmtRemain(props.to - now));
    }

    // A render failure inside a slot must cost this plugin's own view, never
    // the composer row or the settings panel that hosts it.
    const Guard = (function () {
      const Base = React.Component;
      if (typeof Base !== 'function') {
        return function PassThrough(props) {
          return props && props.children != null ? props.children : null;
        };
      }
      return class PeakTintBoundary extends Base {
        constructor(props) {
          super(props);
          this.state = { failed: false };
        }
        static getDerivedStateFromError() {
          return { failed: true };
        }
        componentDidCatch(error) {
          try { console.error('[peak-tint] view crashed and was contained', error); } catch (err) { /* no console */ }
        }
        render() {
          return this.state.failed ? null : this.props.children;
        }
      };
    })();

    function guarded(Inner) {
      return function PeakTintGuarded() {
        return h(Guard, null, h(Inner));
      };
    }

    function pillTitle(state) {
      const peak = state.band === 'peak';
      const lines = [
        peak ? '当前为原价（高峰）时段' : '当前为半价（空闲）时段',
        state.nextAt ? '距切换 ' + fmtRemain(state.nextAt - Date.now()) : '未找到切换点',
        '点击切换强度：贴边 → 全屏 → 关闭',
      ];
      if (state.check.detail) lines.push(state.check.detail);
      return lines.join('\n');
    }

    function nextStrength(current) {
      if (current === 'edge') return 'surface';
      if (current === 'surface') return 'off';
      return 'edge';
    }

    const STRENGTH_LABEL = { edge: '贴边', surface: '全屏', off: '关闭' };

    function Pill() {
      const state = useStore();
      const [flash, setFlash] = React.useState('');

      React.useEffect(function () {
        if (!flash) return undefined;
        const id = window.setTimeout(function () { setFlash(''); }, 1800);
        return function () { window.clearTimeout(id); };
      }, [flash]);

      const cfg = state.config;
      if (!cfg || !cfg.enabled) return null;

      const peak = state.band === 'peak';
      const warn = state.check.status !== 'idle' && state.check.status !== 'ok';

      const onClick = function () {
        if (warn) {
          if (runtime.paint) runtime.paint();
          setFlash('重新置顶…');
          return;
        }
        const next = nextStrength(cfg.strength);
        commit({ strength: next });
        setFlash(STRENGTH_LABEL[next]);
      };

      return h('div', { className: 'pt-wrap' },
        h(StyleTag),
        h('button', {
          type: 'button',
          className: 'pt-pill',
          'data-band': peak ? 'peak' : 'offpeak',
          title: pillTitle(state),
          onClick: onClick,
        },
          h('span', { className: 'pt-dot' }),
          h('span', null, flash || (peak ? '原价 ×2' : '半价 5折')),
          state.nextAt ? h(Countdown, { to: state.nextAt }) : null,
          warn ? h('span', { className: 'pt-warn', title: state.check.detail }, '!') : null,
        ),
      );
    }

    function Segmented(props) {
      return h('div', { className: 'pt-seg' },
        props.options.map(function (option) {
          return h('button', {
            key: option.value,
            type: 'button',
            'data-on': String(props.value === option.value),
            onClick: function () { props.onChange(option.value); },
          }, option.label);
        }),
      );
    }

    function WindowEditor(props) {
      const w = props.window;
      const index = props.index;
      const update = function (patch) { props.onChange(index, Object.assign({}, w, patch)); };
      const toggleDay = function (day) {
        const days = w.days.slice();
        const at = days.indexOf(day);
        if (at >= 0) days.splice(at, 1); else days.push(day);
        if (!days.length) return;
        update({ days: days });
      };
      return h('div', { className: 'pt-window' },
        h('div', { className: 'pt-days' },
          WEEKDAYS.map(function (day) {
            return h('button', {
              key: day.v,
              type: 'button',
              'data-on': String(w.days.indexOf(day.v) >= 0),
              onClick: function () { toggleDay(day.v); },
              title: '周' + day.l,
            }, day.l);
          }),
        ),
        h('input', {
          className: 'pt-time',
          type: 'time',
          value: w.start,
          onChange: function (e) { update({ start: e.target.value || '09:00' }); },
        }),
        h('span', { className: 'pt-hint' }, '→'),
        h('input', {
          className: 'pt-time',
          type: 'time',
          value: w.end,
          onChange: function (e) { update({ end: e.target.value || '12:00' }); },
        }),
        h('button', {
          className: 'pt-btn pt-danger',
          type: 'button',
          onClick: function () { props.onRemove(index); },
        }, '删除'),
      );
    }

    function SettingsPage() {
      const state = useStore();
      const cfg = state.config;
      const [buffer, setBuffer] = React.useState('');
      const [message, setMessage] = React.useState('');

      if (!cfg) return null;

      const set = function (patch) {
        setMessage('');
        commit(patch);
      };

      const setWindow = function (index, next) {
        const windows = cfg.windows.slice();
        windows[index] = next;
        set({ windows: windows });
      };

      const addWindow = function () {
        set({ windows: cfg.windows.concat([{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }]) });
      };

      const removeWindow = function (index) {
        const windows = cfg.windows.slice();
        windows.splice(index, 1);
        if (!windows.length) { setMessage('至少保留一个时段'); return; }
        set({ windows: windows });
      };

      const pickPreset = function (key) {
        const preset = PRESETS[key];
        set({
          palette: key,
          custom: preset
            ? {
                peakLight: preset.peak[0], peakDark: preset.peak[1],
                offpeakLight: preset.offpeak[0], offpeakDark: preset.offpeak[1],
              }
            : cfg.custom,
        });
      };

      const setCustom = function (key, value) {
        const custom = Object.assign({}, cfg.custom);
        custom[key] = value;
        set({ custom: custom, palette: 'custom' });
      };

      const importJson = function () {
        try {
          const parsed = JSON.parse(buffer);
          commit(parsed);
          setMessage('已导入');
        } catch (err) {
          setMessage('JSON 解析失败：' + (err && err.message ? err.message : String(err)));
        }
      };

      const exportJson = function () {
        setBuffer(JSON.stringify(cfg, null, 2));
        setMessage('已导出到下方文本框');
      };

      const reset = function () {
        commit(clone(DEFAULT_CONFIG));
        setMessage('已恢复默认');
      };

      const statusTone = state.check.status === 'ok' ? 'ok'
        : state.check.status === 'idle' ? 'ok'
        : state.check.status === 'error' || state.check.status === 'no-service' || state.check.status === 'unsupported' ? 'bad'
        : 'warn';

      function colorInput(label, key) {
        return h('label', { key: key },
          h('input', {
            type: 'color',
            value: cfg.custom[key],
            onChange: function (e) { setCustom(key, e.target.value); },
          }),
          label,
        );
      }

      return h('div', { className: 'pt-page' },
        h(StyleTag),

        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-status' },
            h('span', { className: 'pt-badge', 'data-tone': state.band === 'peak' ? 'warn' : 'ok' },
              state.band === 'peak' ? '原价时段' : '半价时段'),
            state.nextAt
              ? h(Countdown, { to: state.nextAt })
              : h('span', { className: 'pt-hint' }, '未找到切换点'),
            h('span', { className: 'pt-hint' }, '北京时间 · 按周一至周五与时段表判断，不识别法定节假日'),
            detectWallpaper()
              ? h('span', { className: 'pt-badge', 'data-tone': 'ok' }, '壁纸模式')
              : null,
            h('span', { className: 'pt-badge', 'data-tone': statusTone }, checkLabel(state.check)),
          ),
          state.check.detail ? h('div', { className: 'pt-hint' }, state.check.detail) : null,
        ),

        h('div', { className: 'pt-card' },
          h('h3', null, '染色'),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '总开关'),
            h('button', {
              className: 'pt-btn',
              type: 'button',
              onClick: function () { set({ enabled: !cfg.enabled }); },
            }, cfg.enabled ? '已启用' : '已禁用'),
          ),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '覆盖范围'),
            h(Segmented, {
              value: cfg.strength,
              options: [
                { value: 'edge', label: '贴边（侧栏+描边）' },
                { value: 'surface', label: '全屏（含对话背景）' },
                { value: 'off', label: '关闭' },
              ],
              onChange: function (value) { set({ strength: value }); },
            }),
          ),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '配色'),
            h('div', { className: 'pt-swatches' },
              Object.keys(PRESETS).map(function (key) {
                const preset = PRESETS[key];
                const active = cfg.palette === key;
                return h('button', {
                  key: key,
                  className: 'pt-swatch',
                  type: 'button',
                  'data-on': String(active),
                  title: preset.label,
                  style: {
                    background: 'linear-gradient(160deg,' + preset.offpeak[0] + ',' + preset.peak[0] + ')',
                  },
                  onClick: function () { pickPreset(key); },
                }, h('span', null, preset.label));
              }),
            ),
          ),
          h('div', { className: 'pt-hint' }, '点色卡即切换；下面可继续微调，改动即时生效，无需重启。'),
        ),

        h('div', { className: 'pt-card' },
          h('h3', null, '渐变与自定义颜色'),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '渐变'),
            h(Segmented, {
              value: cfg.gradient.enabled ? 'on' : 'off',
              options: [{ value: 'on', label: '开启' }, { value: 'off', label: '纯色' }],
              onChange: function (value) { set({ gradient: Object.assign({}, cfg.gradient, { enabled: value === 'on' }) }); },
            }),
            h('label', { className: 'pt-hint' },
              '角度 ',
              h('input', {
                type: 'range', min: 0, max: 360, step: 5, value: cfg.gradient.angle,
                onChange: function (e) { set({ gradient: Object.assign({}, cfg.gradient, { angle: Number(e.target.value) }) }); },
              }),
              ' ' + cfg.gradient.angle + '°',
            ),
            h('label', { className: 'pt-hint' },
              '强度 ',
              h('input', {
                type: 'range', min: 0, max: 100, step: 5, value: cfg.gradient.spread,
                onChange: function (e) { set({ gradient: Object.assign({}, cfg.gradient, { spread: Number(e.target.value) }) }); },
              }),
              ' ' + cfg.gradient.spread + '%',
            ),
          ),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '背景也渐变'),
            h('button', {
              className: 'pt-btn', type: 'button',
              onClick: function () { set({ gradientOnBase: !cfg.gradientOnBase }); },
            }, cfg.gradientOnBase ? '已开启' : '仅侧栏'),
            h('span', { className: 'pt-hint' }, '仅在「全屏」范围下有效；个别插件对背景做 color-mix 时可能失效。'),
          ),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '壁纸兼容'),
            h(Segmented, {
              value: cfg.wallpaperSafe,
              options: [
                { value: 'auto', label: '自动' },
                { value: 'on', label: '淡色 12%' },
                { value: 'ghost', label: '只留胶囊' },
                { value: 'off', label: '不适配' },
              ],
              onChange: function (value) { set({ wallpaperSafe: value }); },
            }),
            h('span', { className: 'pt-hint' }, '「只留胶囊」不染任何背景，壁纸完全不受影响。'),
          ),
          h('div', { className: 'pt-row' },
            h('span', { className: 'pt-name' }, '不透明度'),
            h('input', {
              type: 'range', min: 15, max: 100, step: 5,
              value: Math.round((cfg.opacity || 1) * 100),
              onChange: function (e) { set({ opacity: Number(e.target.value) / 100 }); },
            }),
            h('span', { className: 'pt-hint' }, Math.round((cfg.opacity || 1) * 100) + '%'),
            h('span', { className: 'pt-hint' }, '装了壁纸/玻璃拟态插件时调低，颜色会叠在壁纸上而不是盖掉它。'),
          ),
          h('div', { className: 'pt-color' },
            colorInput('原价 · 浅色', 'peakLight'),
            colorInput('原价 · 深色', 'peakDark'),
            colorInput('半价 · 浅色', 'offpeakLight'),
            colorInput('半价 · 深色', 'offpeakDark'),
          ),
        ),

        h('div', { className: 'pt-card' },
          h('h3', null, '计费时段（命中即原价，其余为半价）'),
          h('div', { className: 'pt-hint' }, '时间按北京时间解释；勾选的星期 + 起止时间构成一个原价窗口。跨夜写 22:00 → 06:00 即可。'),
          cfg.windows.map(function (w, index) {
            return h(WindowEditor, {
              key: index,
              index: index,
              window: w,
              onChange: setWindow,
              onRemove: removeWindow,
            });
          }),
          h('div', { className: 'pt-row' },
            h('button', { className: 'pt-btn', type: 'button', onClick: addWindow }, '添加时段'),
            h('button', { className: 'pt-btn', type: 'button', onClick: reset }, '恢复默认'),
          ),
        ),

        h('div', { className: 'pt-card' },
          h('h3', null, '配置备份'),
          h('div', { className: 'pt-row' },
            h('button', { className: 'pt-btn', type: 'button', onClick: exportJson }, '导出到文本框'),
            h('button', { className: 'pt-btn', type: 'button', onClick: importJson, disabled: !buffer.trim() }, '从文本框导入'),
            message ? h('span', { className: 'pt-hint' }, message) : null,
          ),
          h('textarea', {
            className: 'pt-textarea',
            value: buffer,
            placeholder: '把配置 JSON 粘贴到这里，再点「从文本框导入」。',
            onChange: function (e) { setBuffer(e.target.value); },
          }),
        ),
      );
    }

    function checkLabel(state) {
      switch (state.status) {
        case 'ok': return '染色生效';
        case 'idle': return '未启用';
        case 'no-service': return '主题服务缺失';
        case 'unsupported': return 'token 未找到';
        case 'overridden': return '被他层覆盖';
        case 'error': return '写入失败';
        default: return '待检测';
      }
    }

    // ───────────────────────────── plugin ─────────────────────────────

    return {
      // `slots` and `theme` are hard requirements: without them this plugin has
      // nothing to render and nothing to paint. `timer` is deliberately NOT
      // injected — it falls back to window.setTimeout so a composition without
      // it still works instead of throwing inside apply().
      inject: ['slots', 'theme'],
      apply(ctx) {
        try {
          ensureInit();
          runtime.ctx = ctx;
        } catch (err) {
          console.error('[peak-tint] init failed', err);
          return;
        }

        // Never assume a service is composed: the cordis inject list above is
        // the only guarantee, and `timer` is not in it.
        const timerService = (function () {
          try {
            const byGet = typeof ctx.get === 'function' ? ctx.get('timer') : undefined;
            const found = byGet || ctx.timer;
            return found && typeof found.timeout === 'function' ? found : null;
          } catch (err) {
            return null;
          }
        })();

        const later = timerService
          ? function (fn, delay) { return timerService.timeout(fn, delay); }
          : function (fn, delay) {
              const id = window.setTimeout(fn, delay);
              return function () { window.clearTimeout(id); };
            };

        runtime.reschedule = function () {
          const now = Date.now();
          band = bandAt(now, config);
          nextAt = nextFlip(now, config);
          if (runtime.timer) {
            try { runtime.timer(); } catch (err) { /* already fired */ }
            runtime.timer = null;
          }
          let delay = nextAt ? nextAt - now + 800 : 60 * MINUTE;
          delay = Math.max(1500, Math.min(delay, 30 * MINUTE));
          runtime.timer = later(function () {
            runtime.reschedule();
            runtime.paint();
            notify();
          }, delay);
        };

        runtime.paint = paint;

        try {
          paint();
          runtime.reschedule();
          notify();
        } catch (err) {
          console.error('[peak-tint] first paint failed', err);
        }

        ctx.effect(function () {
          const wake = function () {
            runtime.reschedule();
            runtime.paint();
            notify();
          };
          window.addEventListener('visibilitychange', wake);
          window.addEventListener('focus', wake);
          const onStorage = function (event) {
            if (event.key !== STORAGE_KEY) return;
            ensureInit(true);
            runtime.reschedule();
            runtime.paint();
            notify();
          };
          window.addEventListener('storage', onStorage);
          return function () {
            window.removeEventListener('visibilitychange', wake);
            window.removeEventListener('focus', wake);
            window.removeEventListener('storage', onStorage);
          };
        });

        // Keep our layer on top when another plugin (or a skin) restacks layers.
        // The guard stops our own override from re-triggering this handler.
        try {
          ctx.on('theme/change', function () {
            try {
              if (Date.now() - runtime.lastPaintAt < 500) return;
              const theme = resolveTheme(ctx);
              if (!theme || !config.enabled || config.strength === 'off') return;
              runtime.lastPaintAt = Date.now();
              runtime.layer = theme.overrideTokens(SOURCE, buildTokens(config, band));
            } catch (err) { /* keep the current layer */ }
          });
        } catch (err) {
          console.error('[peak-tint] theme/change listener unavailable', err);
        }

        ctx.effect(function () {
          return function () {
            if (runtime.layer) { try { runtime.layer(); } catch (err) { /* gone */ } runtime.layer = null; }
            if (runtime.timer) { try { runtime.timer(); } catch (err) { /* gone */ } runtime.timer = null; }
          };
        });

        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'peak-tint',
            order: 20,
            label: '峰谷染色',
          }, guarded(Pill));
        });

        ctx.slots.inject('settings.plugins.tab', function () {
          return ctx.slots.register({
            name: 'settings.plugins.tab',
            id: 'peak-tint',
            order: 80,
            label: '峰谷染色',
          }, guarded(SettingsPage));
        });
      },
    };
  },
});
