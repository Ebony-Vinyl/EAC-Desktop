import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'

// 最小 DOM 替身。这里刻意让 localStorage 的写操作直接抛错 ——
// 插件只要碰一次持久化数据，测试就会红。
function createHarness({ forbidStorageWrites = true } = {}) {
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
    get length() {
      if (forbidStorageWrites) throw new Error('plugin must not touch localStorage')
      return 0
    },
    key() {
      if (forbidStorageWrites) throw new Error('plugin must not touch localStorage')
      return null
    },
    getItem() {
      if (forbidStorageWrites) throw new Error('plugin must not touch localStorage')
      return null
    },
    setItem() {
      throw new Error('plugin must not write localStorage')
    },
    removeItem() {
      throw new Error('plugin must not write localStorage')
    },
  }

  const window = {
    __ModuleLoader__: { load(definition) { window.definition = definition } },
  }

  const context = { window, document, localStorage, console: { debug() {} }, Symbol, Set, Map, JSON, Object }
  return { context, window, styleElements }
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

// 1) 注入 + 不碰持久化 + 不隐藏入口
{
  const harness = createHarness({ forbidStorageWrites: true })
  const plugin = boot(harness)

  // localStorage 一被访问就抛错；apply 若能跑完，说明完全没碰持久化状态
  const dispose = plugin.apply()
  assert.equal(harness.styleElements.length, 1, '应注入一个 style')

  const css = harness.styleElements[0].textContent

  assert.ok(
    css.includes('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]'),
    'fullscreen 底色必须限定在「全屏 + 展开」状态',
  )
  assert.ok(css.includes('[data-menu-material="translucent"]'), '应有菜单遮罩规则')
  assert.ok(
    css.includes('header:has(> [data-conversation-header-leading])'),
    '标题栏规则必须以会话 header 为锚点限定作用域',
  )

  // 全屏只补底色：不得再改写宽度（全屏仍是全屏，不降级）
  const fullscreenRule = css.slice(css.indexOf('[data-sidebar-right-panel="fullscreen"]'))
  const fullscreenBlock = fullscreenRule.slice(0, fullscreenRule.indexOf('}'))
  assert.ok(fullscreenBlock.includes('background-color'), 'fullscreen 必须补底色')
  assert.equal(/\bwidth\s*:/.test(fullscreenBlock), false, 'fullscreen 不得改写宽度')
  assert.equal(
    fullscreenBlock.includes('--dsh-sidebar-width'),
    false,
    'fullscreen 不得改写 --dsh-sidebar-width',
  )

  // 不得用 display:none 藏掉任何入口
  assert.equal(css.includes('display: none'), false, '不得隐藏任何 UI 入口')

  // 不得出现无作用域的裸类名选择器
  assert.equal(
    /(^|\n)\[class\*="_header"\][^\n]*\{/.test(css),
    false,
    '不得使用无作用域的 [class*="_header"] 选择器',
  )
  assert.equal(
    /(^|\n)\[class\*="_headerActions"\]/.test(css),
    false,
    '动作容器选择器必须被 header 锚点限定',
  )

  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(harness.styleElements[0].parentNode, null, 'dispose 应移除 style')
}

// 2) 幂等：重复 apply 只保留一个 style
{
  const harness = createHarness()
  const plugin = boot(harness)
  plugin.apply()
  plugin.apply()
  assert.equal(harness.styleElements.length, 1, '重复 apply 不应重复注入 style')
}

// 3) 二次 apply 时 style 内容跟随源码同步（升级场景）
{
  const harness = createHarness()
  const plugin = boot(harness)
  plugin.apply()
  harness.styleElements[0].textContent = 'stale'
  plugin.apply()
  assert.ok(
    harness.styleElements[0].textContent.includes('data-conversation-header-leading'),
    '重复 apply 应把 style 内容刷新到当前版本',
  )
}

console.log('overlay guard: scoped selectors, no persisted-state writes, idempotence and dispose OK')
