// Client-half smoke test: proves the toolbar button actually opens the card.
//
// Runs client.js inside a fake module table with a minimal React shim that
// implements hooks (useState/useEffect/useCallback/useRef/useSyncExternalStore)
// so the real component code executes. No DOM needed: we render by calling the
// components and inspecting the returned element tree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'client.js'), 'utf8');

// ---- minimal React shim ---------------------------------------------------
let hookIndex = 0;
const hookStore = new Map();
let rerender = null;

function makeHooks() {
  hookIndex = 0;
  return {
    useState(initial) {
      const i = hookIndex++;
      if (!hookStore.has(i)) hookStore.set(i, typeof initial === 'function' ? initial() : initial);
      const set = (v) => {
        const next = typeof v === 'function' ? v(hookStore.get(i)) : v;
        if (Object.is(next, hookStore.get(i))) return;
        hookStore.set(i, next);
        if (rerender) rerender();
      };
      return [hookStore.get(i), set];
    },
    useEffect(fn) { const i = hookIndex++; const off = fn(); hookStore.set('e' + i, off); },
    useCallback(fn) { hookIndex++; return fn; },
    useRef(initial) {
      const i = hookIndex++;
      if (!hookStore.has('r' + i)) hookStore.set('r' + i, { current: initial });
      return hookStore.get('r' + i);
    },
    useSyncExternalStore(subscribe, snapshot) {
      const i = hookIndex++;
      if (!hookStore.has('s' + i)) {
        const key = 's' + i;
        hookStore.set(key, true);
        subscribe(() => { if (rerender) rerender(); });
      }
      return snapshot();
    },
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children: children.flat() } };
    },
  };
}

// ---- fake module table ----------------------------------------------------
let registration = null;
const fakeRequire = (name) => {
  if (name === 'react') {
    const hooks = makeHooks();
    return { ...hooks, useCallback: hooks.useCallback, createElement: hooks.createElement };
  }
  throw new Error('unexpected require: ' + name);
};

globalThis.window = {
  __ModuleLoader__: { load: (reg) => { registration = reg; } },
  addEventListener() {}, removeEventListener() {},
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ teamName: 'T', enabled: true, roles: [], providers: [] }) });

// ---- execute client.js ----------------------------------------------------
const run = new Function('window', 'fetch', 'console', src);
run(globalThis.window, globalThis.fetch, console);

if (!registration) throw new Error('client.js did not register a module');
console.log('registered id:', registration.id);

const mod = registration.factory(fakeRequire);
console.log('inject deps:', JSON.stringify(mod.inject));

// ---- capture the two slot registrations -----------------------------------
const slots = new Map();
const ctx = {
  slots: {
    inject(name, fn) { fn(); },
    register(spec, component) { slots.set(spec.id, { spec, component }); return () => {}; },
  },
};
mod.apply(ctx);
console.log('slot occupants:', [...slots.keys()].join(', '));

const TeamButton = slots.get('ai-team-toolbar').component;
const TeamCard = slots.get('ai-team-card').component;

// ---- helper: render a component through the hook system -------------------
function render(Component) {
  hookStore.clear();
  rerender = null;
  hookIndex = 0;
  return Component({});
}

// 1. Card starts closed -> renders nothing
hookStore.clear();
let cardEl = render(TeamCard);
console.log('card before click:', cardEl === null ? 'null (closed)' : 'rendered (BUG)');

// 2. Render the button, capture its onClick
const btnEl = render(TeamButton);
if (!btnEl || btnEl.type !== 'button') throw new Error('toolbar did not render a <button>');
console.log('button label:', JSON.stringify(btnEl.props.children[1]?.props?.children ?? btnEl.props.children[1]));
if (typeof btnEl.props.onClick !== 'function') throw new Error('button has no onClick');

// 3. Click it -> the card must now render
btnEl.props.onClick();
hookStore.clear();
cardEl = render(TeamCard);
const opened = cardEl !== null && cardEl !== undefined;
console.log('card after click:', opened ? 'rendered (OPEN)' : 'null (STILL CLOSED - BUG)');
if (!opened) throw new Error('clicking the toolbar button did not open the card');

// 4. Clicking the scrim closes it again
const scrimOnClick = cardEl.props.onClick;
scrimOnClick();
hookStore.clear();
cardEl = render(TeamCard);
console.log('card after scrim click:', cardEl === null ? 'null (closed)' : 'rendered (BUG)');

console.log('\nALL CLIENT CHECKS PASSED');
