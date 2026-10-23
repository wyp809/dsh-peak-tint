/**
 * Headless smoke test for the dsh-peak-tint client half.
 *
 * Runs the real client.js against stub React / DOM / cordis objects so a
 * regression that would crash the composer or the settings panel fails here
 * instead of in the user's window. Both the default "edge" strength and the
 * "surface" strength (the one that repaints the whole background) are covered.
 *
 *   node test/smoke.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const STORAGE_KEY = 'dsh-peak-tint/config@1';
const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|linear-gradient\(.+\))$/;

const failures = [];
const check = (round, name, condition, detail) => {
  if (condition) return;
  failures.push('[' + round + '] ' + name + (detail ? ' — ' + detail : ''));
};

function run(round, storedConfig, wallpaper) {
  let captured = null;
  const overrideCalls = [];
  const registrations = [];
  const effects = [];

  const theme = {
    overrideTokens(source, tokens) {
      overrideCalls.push({ source, tokens });
      return () => {};
    },
    getTheme() {
      return { preference: 'dark', active: { id: 'dark', colorScheme: 'dark' }, revision: 1 };
    },
  };

  const timer = { timeout() { return () => {}; } };

  const store = new Map();
  if (storedConfig) store.set(STORAGE_KEY, JSON.stringify(storedConfig));

  const sandbox = {
    console,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    getComputedStyle() {
      return {
        getPropertyValue(name) {
          if (wallpaper && name === '--we-glass-alpha') return '0.1225';
          return '';
        },
      };
    },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, value); },
      removeItem(key) { store.delete(key); },
    },
    document: {
      body: { style: { setProperty() {}, removeProperty() {} } },
      documentElement: {},
    },
    __ModuleLoader__: {
      load(definition) { captured = definition; },
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};

  const React = {
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props || {});
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged, children };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); },
    Component: class Component {
      constructor(props) { this.props = props; this.state = {}; }
      setState(next) { this.state = Object.assign({}, this.state, next); }
    },
  };

  const ctx = {
    get(name) {
      if (name === 'theme') return theme;
      if (name === 'timer') return timer;
      return undefined;
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') effects.push(dispose);
      return () => {};
    },
    on() { return () => {}; },
    slots: {
      inject(key, callback) { callback(); return () => {}; },
      register(options, Component) {
        registrations.push({ options, Component });
        return () => {};
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });

  check(round, 'module published', captured !== null);
  if (!captured) return;
  check(round, 'module id is the package name', captured.id === 'dsh-peak-tint', captured.id);

  const plugin = captured.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  });

  check(round, 'inject declares slots', plugin.inject.includes('slots'), JSON.stringify(plugin.inject));
  check(round, 'inject declares theme', plugin.inject.includes('theme'), JSON.stringify(plugin.inject));
  check(round, 'inject does not declare timer', !plugin.inject.includes('timer'), JSON.stringify(plugin.inject));

  try {
    plugin.apply(ctx);
  } catch (error) {
    failures.push('[' + round + '] apply threw: ' + (error && error.message ? error.message : String(error)));
  }

  // Ghost mode deliberately paints nothing.
  if (round !== 'ghost') {
    check(round, 'painted at least once', overrideCalls.length > 0);
  } else {
    check(round, 'painted nothing', overrideCalls.length === 0, 'calls=' + overrideCalls.length);
  }
  check(round, 'two slot registrations', registrations.length === 2, 'got ' + registrations.length);

  const bySlot = {};
  registrations.forEach((entry) => { bySlot[entry.options.name] = entry.Component; });
  check(round, 'composer pill registered', Boolean(bySlot['conversation.input.left']));
  check(round, 'settings page registered', Boolean(bySlot['settings.plugins.tab']));

  for (const call of overrideCalls) {
    for (const [name, value] of Object.entries(call.tokens)) {
      check(round, name + ' has light', value && typeof value.light === 'string');
      check(round, name + ' has dark', value && typeof value.dark === 'string');
      if (value && value.light) {
        check(round, name + ' light is a CSS colour', COLOUR.test(value.light), value.light);
      }
      if (value && value.dark) {
        check(round, name + ' dark is a CSS colour', COLOUR.test(value.dark), value.dark);
      }
    }
  }

  // Guard boundary -> inner component -> host element.
  const unwrap = (name, Component, expectedRoot) => {
    if (!Component) return;
    try {
      const boundary = Component({});
      check(round, name + ' is wrapped by the guard', boundary && typeof boundary.type === 'function');
      const inner = boundary && boundary.props ? boundary.props.children : null;
      check(round, name + ' guard child is a component', inner && typeof inner.type === 'function');
      if (inner && typeof inner.type === 'function') {
        const element = inner.type({});
        check(round, name + ' root is <' + expectedRoot + '>',
          element && element.type === expectedRoot, String(element && element.type));
      }
    } catch (error) {
      failures.push('[' + round + '] ' + name + ' unwrap threw: ' + (error && error.message ? error.message : String(error)));
    }
  };

  unwrap('pill', bySlot['conversation.input.left'], 'div');
  unwrap('settings page', bySlot['settings.plugins.tab'], 'div');

  for (const dispose of effects) {
    try { dispose(); } catch (error) { failures.push('[' + round + '] dispose threw: ' + error.message); }
  }

  return { overrideCalls, registrations };
}

const surfaceConfig = {
  version: 1,
  enabled: true,
  strength: 'surface',
  palette: 'teal',
  opacity: 0.6,
  gradientOnBase: true,
  gradient: { enabled: true, angle: 135, spread: 40 },
  windows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }],
};

const edge = run('edge', null);
const surface = run('surface', surfaceConfig);
// Same "surface" request, but a glass/wallpaper plugin is present: the window
// frame token must go nearly transparent and the content surface must stay put.
const glass = run('wallpaper', surfaceConfig, true);
// Ghost mode paints nothing whatsoever.
const ghost = run('ghost', Object.assign({}, surfaceConfig, { wallpaperSafe: 'ghost' }), true);

const edgeTokens = Object.keys(edge.overrideCalls[0].tokens);
const surfaceTokens = Object.keys(surface.overrideCalls[0].tokens);
const glassTokens = Object.keys(glass.overrideCalls[0].tokens);
const glassFill = glass.overrideCalls[0].tokens['--dsw-specific-sidebar-fill'];

check('edge', 'edge paints sidebar + border only', edgeTokens.length === 2, edgeTokens.join(','));
check('surface', 'surface adds the base background', surfaceTokens.includes('--dsw-alias-bg-base'), surfaceTokens.join(','));
check('surface', 'surface adds layer-1', surfaceTokens.includes('--dsw-alias-bg-layer-1'), surfaceTokens.join(','));
check('wallpaper', 'content surface is left untouched',
  !glassTokens.includes('--dsw-alias-bg-base'), glassTokens.join(','));
check('wallpaper', 'layer-1 is left untouched',
  !glassTokens.includes('--dsw-alias-bg-layer-1'), glassTokens.join(','));
check('wallpaper', 'window frame token is nearly transparent',
  /0\.12\)/.test(glassFill.light) && /0\.12\)/.test(glassFill.dark),
  JSON.stringify(glassFill));
check('ghost', 'paints no token at all',
  !ghost.overrideCalls.length ||
  Object.keys(ghost.overrideCalls[ghost.overrideCalls.length - 1].tokens).length === 0,
  ghost.overrideCalls.length ? Object.keys(ghost.overrideCalls[0].tokens).join(',') : 'no calls');

if (failures.length) {
  console.error('SMOKE FAILED (' + failures.length + ')');
  failures.forEach((line) => console.error('  - ' + line));
  process.exit(1);
}

console.log('SMOKE OK');
console.log('  edge tokens     : ' + edgeTokens.join(', '));
console.log('  surface tokens  : ' + surfaceTokens.join(', '));
console.log('  wallpaper tokens: ' + glassTokens.join(', '));
console.log('  wallpaper fill  : ' + JSON.stringify(glassFill.dark));
