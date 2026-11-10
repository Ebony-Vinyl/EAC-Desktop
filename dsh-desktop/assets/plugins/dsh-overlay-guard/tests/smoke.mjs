import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'

// 最小 DOM/localStorage 替身：只为验证守卫的注入、清洗、清理与幂等。
function createHarness(seedStore = {}) {
  const store = { ...seedStore }
  const keys = Object.keys(store)

  const styleElements = []
  const document = {
    documentElement: { appendChild(element) { styleElements.push(element) } },
    head: { appendChild(element) { styleElements.push(element) } },
    getElementById(id) {
      return styleElements.find(element => element.id === id) ?? null
    },
    querySelector() { return null },
    createElement(name) {
      assert.equal(name, 'style')
      return {
        id: '',
        textContent: '',
        parentNode: null,
        setAttribute() {},
      }
    },
  }

  const localStorage = {
    get length() { return keys.length },
    key(index) { return keys[index] ?? null },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem(key, value) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) keys.push(key)
      store[key] = String(value)
    },
    removeItem(key) {
      const index = keys.indexOf(key)
      if (index >= 0) keys.splice(index, 1)
      delete store[key]
    },
  }

  const window = {
    __ModuleLoader__: { load(definition) { window.definition = definition } },
  }

  const consoleMock = { debug() {} }
  const context = { window, document, localStorage, console: consoleMock, Symbol, Set, Map, JSON, Object }
  return { context, window, document, store, styleElements }
}

const source = await readFile(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')

function boot(harness) {
  vm.runInNewContext(source, harness.context)
  const definition = harness.window.definition
  assert.equal(definition.id, 'dsh-overlay-guard')
  const plugin = definition.factory()
  assert.equal(typeof plugin.apply, 'function')
  return plugin
}

// 1) 全屏持久化清洗：mode:fullscreen -> push，nodes 保留
{
  const session = {
    layout: {
      mode: 'fullscreen',
      nodes: { pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: [] } },
      tabs: {},
      rootId: 'pane1',
      floats: [],
      activePaneId: 'pane1',
      expanded: true,
    },
    minted: 3,
  }
  const harness = createHarness({
    'dsh.sidebar-right.v1.abc': JSON.stringify({ bySession: { abc: session } }),
  })
  const plugin = boot(harness)
  const dispose = plugin.apply()

  const saved = JSON.parse(harness.store['dsh.sidebar-right.v1.abc'])
  assert.equal(saved.bySession.abc.layout.mode, 'push', 'fullscreen 应被改回 push')
  assert.ok(saved.bySession.abc.layout.nodes.pane1, 'nodes 必须保留')
  assert.equal(saved.bySession.abc.minted, 3, 'minted 必须保留')

  // style 注入且包含三类守卫
  assert.equal(harness.styleElements.length, 1)
  const css = harness.styleElements[0].textContent
  assert.ok(css.includes('[data-sidebar-right-mode]'), '应隐藏全屏按钮')
  assert.ok(css.includes('[data-sidebar-right-panel="fullscreen"]'), '应有 fullscreen 宽度兜底')
  assert.ok(css.includes('[data-menu-material="translucent"]'), '应有菜单遮罩')
  assert.ok(css.includes('_headerActions'), '应有标题栏裁剪')

  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(harness.styleElements[0].parentNode, null, 'dispose 应移除 style')
}

// 2) 已是 push：不改写
{
  const session = {
    layout: { mode: 'push', nodes: {}, tabs: {}, rootId: 'pane1', floats: [], activePaneId: 'pane1', expanded: true },
    minted: 1,
  }
  const harness = createHarness({
    'dsh.sidebar-right.v1.def': JSON.stringify({ bySession: { def: session } }),
  })
  const plugin = boot(harness)
  plugin.apply()
  const before = JSON.stringify(session)
  const after = harness.store['dsh.sidebar-right.v1.def']
  assert.equal(JSON.parse(after).bySession.def.layout.mode, 'push')
  assert.notEqual(before, after, '格式化后内容可能变化，但语义必须保持 push')
}

// 3) 坏 JSON 不抛错
{
  const harness = createHarness({ 'dsh.sidebar-right.v1.broken': '{not json' })
  const plugin = boot(harness)
  assert.doesNotThrow(() => plugin.apply())
}

// 4) 无关 key 不受影响
{
  const harness = createHarness({
    'other.key': JSON.stringify({ bySession: { a: { layout: { mode: 'fullscreen' } } } }),
  })
  const plugin = boot(harness)
  plugin.apply()
  assert.equal(
    JSON.parse(harness.store['other.key']).bySession.a.layout.mode,
    'fullscreen',
    '无关 key 不得被改写',
  )
}

// 5) 幂等：重复 apply 只保留一个 style，且第二次不抛错
{
  const harness = createHarness()
  const plugin = boot(harness)
  plugin.apply()
  plugin.apply()
  assert.equal(harness.styleElements.length, 1, '重复 apply 不应重复注入 style')
}

console.log('overlay guard: injection, persisted-state cleanup, idempotence and dispose OK')
