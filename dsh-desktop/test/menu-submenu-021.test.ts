import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchMenuSubmenu021Source } = require('../scripts/patch-deps.js');
// MIT，官方 dsh-web-frontend@0.2.1-rc.2 的真实渲染函数和根菜单回调。
const source = readFileSync(new URL('./fixtures/menu-021.txt', import.meta.url), 'utf8');

function harness() {
  const patched = patchMenuSubmenu021Source(source);
  assert.ok(patched);
  const timers = new Map<number, { run(): void; delay: number }>();
  let seq = 0;
  const selected: unknown[] = [];
  const opened: unknown[] = [];
  let closed = 0;
  const jsx = (type: unknown, props: any) => ({ type, props });
  const runtime = new Function('u', 'Ne', 'C8', '$8', 'se', 'ue', 'n', 's', 'de', 'j', 'l', 'U',
    'w', 'j1', 'Bs', 'Io', 'y', 'e', 'fe', 'window', 'setTimeout', 'clearTimeout', patched)(
    { jsx, jsxs: jsx }, new Proxy({}, { get: (_, key) => key }), () => false, () => false,
    (id: unknown) => opened.push(id), 'parent', null, null,
    (...values: unknown[]) => values.filter(Boolean).join(' '), 'check',
    (id: unknown) => selected.push(id), () => closed++, false, 'submenu', 'shortcut', 'check',
    true, true, () => closed++, {},
    (run: () => void, delay: number) => { timers.set(++seq, { run, delay }); return seq; },
    (id: number) => timers.delete(id));
  const tree = runtime.render({ id: 'parent', label: 'Parent', submenu: [{ id: 'child', label: 'Two lines' }] });
  return { runtime, tree, timers, selected, opened, closed: () => closed };
}

test('0.2.1 submenu transformation requires every unique anchor and is idempotent', () => {
  const once = patchMenuSubmenu021Source(source);
  assert.equal(patchMenuSubmenu021Source(once), once);
  assert.equal(patchMenuSubmenu021Source(source.replace('children:X.label', 'children:X.title')), undefined);
  assert.equal(patchMenuSubmenu021Source(source + source), undefined);
});

test('hovering between parent and submenu cancels closure and uses the new controller', () => {
  const h = harness();
  h.tree.props.onMouseEnter();
  h.tree.props.onMouseLeave();
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [600]);
  const submenu = h.tree.props.children[1];
  submenu.props.onMouseEnter();
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.opened, ['parent', 'parent']);
  submenu.props.onMouseLeave();
  const timer = [...h.timers.values()][0]!;
  assert.equal(timer.delay, 400);
  timer.run();
  assert.equal(h.opened.at(-1), null);
});

test('submenu selects the child and preserves scroll and two-line labels', () => {
  const h = harness();
  const submenu = h.tree.props.children[1];
  assert.equal(submenu.props.style.overflowY, 'auto');
  assert.ok(submenu.props.style.maxHeight);
  const child = submenu.props.children[0];
  assert.equal(child.props.style.flexShrink, 0);
  assert.equal(child.props.children[1].props.style.whiteSpace, 'normal');
  child.props.onClick();
  assert.deepEqual(h.selected, ['child']);
  assert.equal(h.closed(), 1);
});

test('root pointer leave waits for the transition before closing', () => {
  const h = harness();
  h.runtime.rootProps.onPointerLeave();
  assert.equal(h.closed(), 0);
  const timer = [...h.timers.values()][0]!;
  assert.equal(timer.delay, 300);
  timer.run();
  assert.equal(h.closed(), 1);
});
