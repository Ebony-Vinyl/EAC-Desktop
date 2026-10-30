import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Run the shipped component with deterministic hooks; browser layout is verified separately.
async function market() {
  const plugins = Array.from({ length: 6815 }, (_, i) => ({
    name: `plugin-${String(i).padStart(4, '0')}`, url: `https://github.com/example/plugin-${i}`,
    cat: i < 31 ? 'a' : 'b', stars: i, profile: 'web',
  }));
  const states: any[] = [], deps: any[] = [], effects: (() => void)[] = [];
  let cursor = 0, component: any, tree: any;
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat(Infinity).filter(v => v != null) }),
    useState(initial: any) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value: any) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    useRef: (initial: any) => react.useState({ current: initial })[0],
    useEffect(fn: () => void, next: any[]) {
      const i = cursor++;
      if (!deps[i] || !next.every((v, j) => v === deps[i][j])) { deps[i] = next; effects.push(fn); }
    },
  };
  const slots = {
    inject: (_: string, fn: () => void) => fn(),
    register: (meta: any, render: any) => { if (meta.id === 'market') component = render; },
  };
  const window = { __ModuleLoader__: { load(def: any) {
    def.factory(() => react).apply({ get: () => slots, effect() {} });
  } } };
  vm.runInNewContext(readFileSync(new URL('../assets/plugins/dsh-unified-market/lib/client.js', import.meta.url), 'utf8'), {
    window, navigator: { language: 'zh' },
    fetch: async (_: string, options: any) => ({ json: async () => {
      const method = JSON.parse(options.body).method;
      return method === 'list' ? { ok: true, plugins, cats: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } : { ok: true };
    } }),
  });
  const render = () => { cursor = 0; tree = component(); effects.splice(0).forEach(fn => fn()); };
  const settle = async () => { render(); await new Promise(r => setImmediate(r)); render(); };
  const nodes = (value: any = tree): any[] => value && typeof value === 'object' ? [value, ...value.children.flatMap((c: any) => nodes(c))] : [];
  const text = (value: any): string => value && typeof value === 'object' ? value.children.map(text).join('') : String(value ?? '');
  const cards = () => nodes().filter(n => n.props.className === 'mkts-item');
  const change = async (className: string, value: string) => {
    nodes().find(n => n.props.className === className).props.onChange({ target: { value } });
    await settle();
  };
  const click = async (label: string) => {
    const button = nodes().find(n => n.type === 'button' && text(n) === label);
    assert.ok(button, `missing button ${label}`);
    assert.ok(!button.props.disabled, `disabled button ${label}`);
    button.props.onClick(); await settle();
  };
  await settle(); await settle();
  return { nodes, text, cards, change, click };
}

test('large catalog renders bounded pages without losing entries across category boundaries', async () => {
  const p = await market();
  assert.equal(p.cards().length, 50);
  const seen = new Set<string>();
  for (let page = 1; page <= 137; page++) {
    for (const card of p.cards()) seen.add(p.text(card.children.find((n: any) => n.props?.className === 'mkts-main').children[0].children[0]));
    assert.ok(p.cards().length <= 50);
    if (page < 137) await p.click('下一页');
  }
  assert.equal(seen.size, 6815);
  assert.equal(p.cards().length, 15);
  assert.equal(p.nodes().find(n => n.type === 'button' && p.text(n) === '下一页').props.disabled, true);
  await p.click('上一页');
  assert.equal(p.cards().length, 50);
});

test('search, category and sort reset pagination and operate on the entire catalog', async () => {
  const p = await market();
  await p.click('下一页');
  await p.change('mkts-search', 'plugin-6814');
  assert.equal(p.cards().length, 1);
  assert.match(p.text(p.cards()[0]), /plugin-6814/);
  await p.change('mkts-search', '');
  await p.click('下一页');
  await p.change('mkts-catsel', 'a');
  assert.equal(p.cards().length, 31);
  await p.change('mkts-catsel', 'b');
  await p.click('下一页');
  await p.click('最热');
  assert.match(p.text(p.cards()[0]), /plugin-6814/);
  assert.equal(p.nodes().find(n => n.type === 'button' && p.text(n) === '上一页').props.disabled, true);
});
