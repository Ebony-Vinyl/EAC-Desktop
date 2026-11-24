import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { treeSha256 } from '../scripts/plugin-sync.mjs';

const pluginSource = readFileSync(
  new URL('../assets/plugins/dsh-eac-locale-compat/lib/client.js', import.meta.url),
  'utf8',
);

interface LocaleStub {
  getLocale(): { active: 'zh' | 'en' };
  subscribe(listener: () => void): () => void;
  setActive(next: 'zh' | 'en'): void;
  notifyRedundant(): void;
}

function createLocaleStub(initial: 'zh' | 'en'): LocaleStub {
  let active = initial;
  const listeners = new Set<() => void>();
  return {
    getLocale: () => ({ active }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setActive: (next) => {
      active = next;
      for (const listener of listeners) listener();
    },
    notifyRedundant: () => {
      for (const listener of listeners) listener();
    },
  };
}

function loadCompatEnv(initialLocale: 'zh' | 'en' = 'en') {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let loadedModule: any;
  (window as any).__ModuleLoader__ = {
    load(spec: { factory: () => unknown }) {
      loadedModule = spec.factory();
    },
  };
  runInNewContext(pluginSource, {
    window,
    document: window.document,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });
  const locale = createLocaleStub(initialLocale);
  const nextFrame = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  return {
    dom,
    window,
    document: window.document,
    root: window.document.getElementById('root')!,
    locale,
    internals: loadedModule.__internals as {
      hasChinese(value: string): boolean;
      translateText(value: string): string;
      translateNode(node: Node): void;
      restoreNode(node: Node): void;
      createCompatibilityRuntime(root: HTMLElement, locale: LocaleStub): () => void;
    },
    nextFrame,
  };
}

test('exact, composite, and unmapped Chinese phrases preserve translation semantics', () => {
  const { dom, internals } = loadCompatEnv('en');
  try {
    assert.equal(internals.translateText('设置'), 'Settings');
    assert.equal(internals.translateText('正在读取设置…'), 'Reading settings...');
    assert.equal(
      internals.translateText('第 2 轮 · 正在生成 3 个候选…'),
      'Round 2 · generating 3 candidates...',
    );
    // Half-translated sentences must remain untouched in Chinese.
    assert.equal(
      internals.translateText('设置：尚未收录的自定义短语'),
      '设置：尚未收录的自定义短语',
    );
    assert.equal(internals.translateText('Loading plugins...'), 'Loading plugins...');
    // Repeated lookups hit memoized cache with identical output.
    assert.equal(
      internals.translateText('第 2 轮 · 正在生成 3 个候选…'),
      'Round 2 · generating 3 candidates...',
    );
  } finally {
    dom.window.close();
  }
});

test('incremental mutations translate added subtrees and attributes without self-retrigger loops', async () => {
  const { dom, document, root, locale, internals, nextFrame } = loadCompatEnv('en');
  try {
    root.innerHTML = '<button id="initial" title="保存">设置</button>';
    const dispose = internals.createCompatibilityRuntime(root, locale);

    const initialBtn = document.getElementById('initial')!;
    assert.equal(initialBtn.textContent, 'Settings');
    assert.equal(initialBtn.getAttribute('title'), 'Save');

    const panel = document.createElement('section');
    panel.innerHTML = [
      '<span id="label">正在加载上下文…</span>',
      '<input id="search" placeholder="搜索插件（名称 / id / 描述）…" aria-label="插件管理" />',
      '<pre><code id="code-sample">设置</code></pre>',
      '<div class="dss-msg" id="chat-msg">正在读取状态…</div>',
    ].join('');
    root.appendChild(panel);

    await nextFrame();

    const label = document.getElementById('label')!;
    const search = document.getElementById('search')!;
    assert.equal(label.textContent, 'Loading context...');
    assert.equal(search.getAttribute('placeholder'), 'Search plugins (name / ID / description)...');
    assert.equal(search.getAttribute('aria-label'), 'Plugin management');
    // Excluded selectors remain untouched.
    assert.equal(document.getElementById('code-sample')!.textContent, '设置');
    assert.equal(document.getElementById('chat-msg')!.textContent, '正在读取状态…');

    // Track whether self-written translations re-trigger another setAttribute write on subsequent frames.
    let extraAttributeWrites = 0;
    const origSetAttr = search.setAttribute.bind(search);
    search.setAttribute = (name: string, value: string) => {
      extraAttributeWrites += 1;
      origSetAttr(name, value);
    };

    await nextFrame();
    await nextFrame();
    assert.equal(extraAttributeWrites, 0, 'translator writes must not re-trigger themselves');

    // External attribute update to a new Chinese string is still picked up incrementally.
    origSetAttr('title', '关闭预览');
    await nextFrame();
    assert.equal(search.getAttribute('title'), 'Close preview');

    dispose();
  } finally {
    dom.window.close();
  }
});

test('high-frequency startup status churn coalesces per frame without rescanning sibling subtrees (issue #479)', async () => {
  const { dom, document, root, locale, internals, nextFrame } = loadCompatEnv('en');
  try {
    const siblingsContainer = document.createElement('div');
    const siblingTextNodes: Text[] = [];
    for (let i = 0; i < 300; i += 1) {
      const item = document.createElement('div');
      item.setAttribute('title', i % 2 === 0 ? '插件管理' : '未收录动态提示标题' + String(i));
      const text = document.createTextNode(i % 2 === 0 ? '正在读取状态…' : `自定义未收录节点 ${i}`);
      item.appendChild(text);
      siblingsContainer.appendChild(item);
      siblingTextNodes.push(text);
    }
    const statusHost = document.createElement('div');
    const statusText = document.createTextNode('Loading plugins…');
    statusHost.appendChild(statusText);
    root.append(siblingsContainer, statusHost);

    const dispose = internals.createCompatibilityRuntime(root, locale);

    // Count any nodeValue reads on untouched sibling text nodes during startup churn.
    let siblingReads = 0;
    const textProtoDesc = Object.getOwnPropertyDescriptor(dom.window.Node.prototype, 'nodeValue')!;
    for (const textNode of siblingTextNodes) {
      Object.defineProperty(textNode, 'nodeValue', {
        configurable: true,
        get() {
          siblingReads += 1;
          return textProtoDesc.get!.call(this);
        },
        set(val: string | null) {
          textProtoDesc.set!.call(this, val);
        },
      });
    }

    const startedAt = performance.now();
    for (let step = 0; step < 200; step += 1) {
      if (step % 3 === 0) statusText.nodeValue = `Loading plugins${'.'.repeat((step % 3) + 1)}`;
      else if (step % 3 === 1) statusText.nodeValue = '正在读取设置…';
      else statusText.nodeValue = '正在读取状态…';
    }
    // Final value before frame flush:
    statusText.nodeValue = '正在读取状态…';

    await nextFrame();
    const elapsedMs = performance.now() - startedAt;

    assert.equal(statusText.nodeValue, 'Reading status...');
    assert.equal(siblingReads, 0, 'untouched sibling subtrees must never be rescanned on local status mutations');
    assert.ok(elapsedMs < 1000, `expected bounded frame flush latency, got ${elapsedMs.toFixed(1)}ms`);

    dispose();
  } finally {
    dom.window.close();
  }
});

test('Chinese locale leaves DOM untouched and switching zh <-> en restores only owned translations', async () => {
  const { dom, document, root, locale, internals, nextFrame } = loadCompatEnv('zh');
  try {
    root.innerHTML = '<button id="btn-a" title="保存">设置</button><span id="btn-b">取消</span>';
    const dispose = internals.createCompatibilityRuntime(root, locale);

    const btnA = document.getElementById('btn-a')!;
    const btnB = document.getElementById('btn-b')!;
    assert.equal(btnA.textContent, '设置');
    assert.equal(btnA.getAttribute('title'), '保存');

    // Switch to English.
    locale.setActive('en');
    await nextFrame();
    assert.equal(btnA.textContent, 'Settings');
    assert.equal(btnA.getAttribute('title'), 'Save');
    assert.equal(btnB.textContent, 'Cancel');

    // Redundant same-locale notifications do not disturb externally customized English text.
    btnB.textContent = 'Custom English';
    await nextFrame();
    locale.notifyRedundant();
    await nextFrame();
    assert.equal(btnB.textContent, 'Custom English');

    // Switch back to Chinese: btnA restores original Chinese, btnB keeps external English override.
    locale.setActive('zh');
    await nextFrame();
    assert.equal(btnA.textContent, '设置');
    assert.equal(btnA.getAttribute('title'), '保存');
    assert.equal(btnB.textContent, 'Custom English');

    dispose();
  } finally {
    dom.window.close();
  }
});

test('dispose cancels pending frame flush and never re-translates restored nodes', async () => {
  const { dom, document, root, locale, internals, nextFrame } = loadCompatEnv('en');
  try {
    root.innerHTML = '<span id="existing">设置</span>';
    const dispose = internals.createCompatibilityRuntime(root, locale);
    assert.equal(document.getElementById('existing')!.textContent, 'Settings');

    const pending = document.createElement('span');
    pending.id = 'pending';
    pending.textContent = '正在保存…';
    root.appendChild(pending);

    // Let MutationObserver enqueue its rAF callback in a microtask, then dispose before the frame fires.
    await Promise.resolve();
    dispose();

    assert.equal(document.getElementById('existing')!.textContent, '设置');
    assert.equal(pending.textContent, '正在保存…');

    await nextFrame();
    await nextFrame();
    assert.equal(document.getElementById('existing')!.textContent, '设置');
    assert.equal(pending.textContent, '正在保存…');
  } finally {
    dom.window.close();
  }
});

test('plugins.lock.json records the exact treeSha256 of dsh-eac-locale-compat', () => {
  const pluginDir = fileURLToPath(new URL('../assets/plugins/dsh-eac-locale-compat', import.meta.url));
  const lock = JSON.parse(
    readFileSync(new URL('../../.sync/plugins.lock.json', import.meta.url), 'utf8'),
  );
  const actualDigest = treeSha256(pluginDir);
  assert.equal(lock.plugins['eac-locale-compat'].local.treeSha256, actualDigest);
  assert.equal(lock.plugins['eac-locale-compat'].source.sha256, actualDigest);
});
