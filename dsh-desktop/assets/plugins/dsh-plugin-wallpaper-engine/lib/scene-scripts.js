// WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本 (NSL)
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变化更新
//       export function init(value) — 初始化一次 (返回新值; NSL init(value))
// 提供 WEColor / createScriptProperties / engine.canvasSize / Vec3 等引擎 API (vm 沙箱)
// 用户属性 (project.json general.properties) 注入 scriptProperties (user 映射)
//
// 关键设计 (sf35 重构): 脚本**编译一次、状态跨帧保留** — 旧实现每帧重编译导致
// NSL 脚本内部状态 (计数器/动画调度器) 每帧重置、大型脚本每帧编译 CPU 爆表,
// 且 init() 每帧重复调用。现在:
//   - createScriptCache() 持有 {map: Map<源码, 编译条目>, shared}
//   - 每个 SceneRenderer 实例一个 cache (scene-anim 多帧复用实例 → 状态跨帧保留)
//   - 同一源码只编译一次; init() 只在首次执行; 每帧只调 update(value)
//   - thisObject/thisLayer 通过 ownerRef 代理指向"当前脚本所属对象" (缓存共享
//     时对象不串); 读写真实渲染对象 (origin/scale/visible/alpha/animationlayers)
//   - engine API 补全 (isRunningInEditor 等) — NSL 库 (如 Mutsumi 788) 缺失
//     方法时中途抛错 → 后续 shared 赋值全部丢失 → 整个动画框架失效
import vm from 'node:vm';
import { WEColor, Vec3, ScriptPropertiesBuilder } from './scene-script-apis.js';

// NSL thisScene: getLayer(name) → 图层包装, 读写真实场景对象属性
// origin/scale/size 字符串 "x y z" ↔ Vec3; visible/alignment 直接读写
// 脚本对象 {script, value} 取 value (715 读 Launcher scale 时其脚本可能尚未
// 执行/已执行 — 读最终 value 而非原始 {script,value} 对象)
export function makeSceneRef(objects) {
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  const layer = (obj) => ({
    get visible() { return obj.visible !== false; },
    set visible(v) { obj.visible = !!v; },
    get alignment() { return obj.alignment; },
    set alignment(v) { obj.alignment = v; },
    get size() { return parseV(obj.size, [0, 0, 0]); },
    get scale() { return parseV(obj.scale, [1, 1, 1]); },
    get origin() { return parseV(obj.origin, [0, 0, 0]); },
    set origin(v) {
      if (v == null) return;
      const x = v.x != null ? v.x : v[0];
      const y = v.y != null ? v.y : v[1];
      const z = v.z != null ? v.z : v[2];
      obj.origin = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
    },
    get name() { return obj.name || ''; },
    get id() { return obj.id; },
    clicked: false,
    cursorDetected: false,
  });
  const objList = Array.isArray(objects) ? objects : [];
  return {
    getLayer: (name) => {
      const obj = objList.find((o) => o && o.name === name);
      return obj ? layer(obj) : layer({ name, origin: '0 0 0', scale: '1 1 1', size: '0 0 0', visible: true, id: -1 });
    },
    getSceneObject: (id) => {
      const obj = objList.find((o) => o && o.id === id);
      return obj ? layer(obj) : null;
    },
  };
}

// 当前脚本所属对象代理: thisObject/thisLayer 通过它指向"当前对象",
// 使缓存共享的编译条目在多个对象间不串 (每次 update 前 ownerRef.current 更新)。
function makeOwnerRef() {
  const ref = { current: null };
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  const animRef = (obj) => ({
    play: () => {}, setFrame: () => {}, setTime: () => {}, setFps: () => {},
    setVisible: () => {}, setBlend: () => {}, setRate: () => {}, setScale: () => {},
    setOrigin: () => {}, setAngles: () => {}, setAlpha: () => {}, setColor: () => {},
    setSize: () => {}, setParallaxDepth: () => {}, setPosition: () => {}, setBrightness: () => {},
    setColorBlendMode: () => {}, getAnimationLayerCount: () => (obj && obj.animationlayers ? obj.animationlayers.length : 1),
    setFrameCount: () => {},
    addEndedCallback: () => {},
  });
  const layerRef = () => {
    const obj = ref.current;
    return {
      getAnimationLayer: (i) => animRef(obj),
      getParent: () => ({ origin: new Vec3(0, 0, 0), visible: true }),
      get visible() { return obj ? obj.visible !== false : true; },
      set visible(v) { if (obj) obj.visible = !!v; },
      get origin() { return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0];
        const y = v.y != null ? v.y : v[1];
        const z = v.z != null ? v.z : v[2];
        obj.origin = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get scale() { return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0];
        const y = v.y != null ? v.y : v[1];
        const z = v.z != null ? v.z : v[2];
        obj.scale = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get alpha() { return obj ? (obj.alpha != null ? obj.alpha : 1) : 1; },
      set alpha(v) { if (obj) obj.alpha = Number(v); },
      get name() { return obj ? obj.name || '' : ''; },
      get id() { return obj ? obj.id : 0; },
      cursorDetected: false,
      clicked: false,
    };
  };
  const objectRef = () => {
    const obj = ref.current;
    return {
      getMaterial: () => ({}),
      getAnimation: () => animRef(obj),
      get origin() { return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) { if (obj && v != null) { const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2]; obj.origin = `${x} ${y} ${z}`; } },
      get scale() { return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) { if (obj && v != null) { const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2]; obj.scale = `${x} ${y} ${z}`; } },
      get visible() { return obj ? obj.visible !== false : true; },
      set visible(v) { if (obj) obj.visible = !!v; },
      get name() { return obj ? obj.name || '' : ''; },
      get id() { return obj ? obj.id : 0; },
    };
  };
  return {
    ref,
    makeLayer: layerRef,
    makeObject: objectRef,
    setOwner(o) { ref.current = o; },
  };
}

// 编译脚本: 返回 { update, applyUserProperties, init, ... } 函数 (vm 沙箱)
// opts: { canvasSize, userProps, shared, thisScene, ownerRef, runtime }
// NSL 模块映射: import * as X from 'WEColor'/'WEMath' → 对应全局对象
// (旧转译把一切 import * as 映射到 __WEColor — WEMath 模块的函数全部丢失,
//  726 Launcher 报 "WEMath.smoothStep is not a function" → update 失败)
function compileScript(source, opts = {}) {
  // 转译 ESM 导入/导出为 CommonJS
  let code = source;
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (m, name, mod) => {
    return `const ${name} = ${mod === 'WEMath' ? '__WEMath' : '__WEColor'};`;
  });
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g, (m, names, mod) => {
    const src = mod === 'WEMath' ? '__WEMath' : '__WEColor';
    return `const { ${names} } = ${src};`;
  });
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, '__exports.$1 = function (');
  code = code.replace(/export\s+var\s+scriptProperties\s*=\s*([^;]+);/g, '__scriptProps = $1;');
  code = code.replace(/export\s+let\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s+const\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map((s) => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  // scriptProperties 使用: 脚本内 `scriptProperties.x` 需指向构建的属性对象
  code = code.replace(/\bscriptProperties\b/g, '__scriptProperties');
  const shared = opts.shared || {};
  const ownerRef = opts.ownerRef || makeOwnerRef();
  const context = {
    __WEColor: WEColor,
    // NSL WEMath 模块 (脚本 import * as WEMath from 'WEMath')
    __WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      lerp: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      // 角度换算 (733 Lens Flare 等用 WEMath.rad2deg; 缺失 → angles NaN → 组件渲染异常)
      rad2deg: 180 / Math.PI,
      deg2rad: Math.PI / 180,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      pow: Math.pow,
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      PI: Math.PI,
    },
    __exports: {},
    __scriptProps: null, // export var scriptProperties = ... 写入
    __scriptProperties: null, // 脚本内 scriptProperties 引用
    Date, Math, console, JSON, Number, String, Boolean, Object, Array, Set, Map, Promise,
    parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, undefined,
    Vec3,
    // NSL 数学工具 (726 Launcher 等用 WEMath.mix/clamp/smoothStep)
    WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      rad2deg: 180 / Math.PI,
      deg2rad: Math.PI / 180,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
    },
    // 鼠标/输入 (本地无鼠标 → 画布中心, 静止): NSL Dock 逻辑 (715 L126
    // input.cursorWorldPosition) 缺失 → update 抛错 → shared 值不计算
    input: {
      cursorWorldPosition: new Vec3((opts.canvasSize || { x: 3840 }).x / 2, (opts.canvasSize || { y: 2160 }).y / 2, 0),
      cursorDelta: new Vec3(0, 0, 0),
      cursorVelocity: 0,
      mousePressed: false,
      mouseDelta: new Vec3(0, 0, 0),
    },
    createScriptProperties: () => new ScriptPropertiesBuilder(opts.userProps),
    // thisScene: NSL 场景引用 — getLayer(name) 返回图层包装 (读写真实场景对象)
    thisScene: opts.thisScene || makeSceneRef([]),
    engine: {
      registerAsset: () => ({ getAsset: () => null }),
      canvasSize: opts.canvasSize || { x: 3840, y: 2160 },
      runtime: opts.runtime || 0,
      frametime: opts.frametime || 1 / 60,
      userProperties: opts.userProps || {},
      // NSL 库 (Mutsumi 788 等) 依赖编辑器环境探测; 缺失此方法 → 脚本中途抛错,
      // 后续 shared 赋值全部丢失 → 整个动画框架失效
      isRunningInEditor: () => false,
      // setTimeout 必须异步延迟 — 旧实现立即同步执行回调, NSL 库的调度递归
      // (动画推进/节流) 会同步无限递归卡死主线程
      setTimeout: (fn, ms) => {
        const t = setTimeout(() => { try { fn(); } catch { /* ignore */ } }, Math.max(0, Number(ms) || 0));
        return () => clearTimeout(t);
      },
      clearTimeout: (t) => { try { clearTimeout(t); } catch { /* ignore */ } },
    },
    shared,
    thisObject: ownerRef.makeObject(),
    thisLayer: ownerRef.makeLayer(),
  };
  context.globalThis = context;
  vm.createContext(context);
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (e) {
    return { error: e.message, exports: context.__exports, scriptProps: context.__scriptProps, ownerRef };
  }
  // scriptProperties 构建: __scriptProps 是 builder 或对象
  let props = null;
  if (context.__scriptProps instanceof ScriptPropertiesBuilder) {
    props = context.__scriptProps.finish();
  } else if (context.__scriptProps && typeof context.__scriptProps === 'object') {
    props = context.__scriptProps;
  }
  context.__scriptProperties = props;
  return { exports: context.__exports, scriptProps: props, context, ownerRef };
}

// value → 脚本可操作对象 (Vec3 / number / 原样)
// 注意: 只有"纯数字"字符串才转 Vec3 (如 "0.5 0.5 0") — 文本类脚本的 value
// 是多词字符串 (如 "Text Layer"、"Good day!"), 误转 Vec3 会让 update 返回
// 的文本被 formatResult 格式化破坏 (FPS 计数器实测 "Text Layer" → "0.000000 ...")
function toValueObj(value) {
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 2 && parts.every((p) => p !== '' && isFinite(Number(p)))) {
      const nums = parts.map(Number);
      return new Vec3(nums[0], nums[1], nums[2] || 0);
    }
    return value; // 非纯数字字符串 → 保持原样 (文本)
  }
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return value;
  return value;
}
// 脚本返回值 → 存储值 (Vec3/{x,y,z} → "x y z")
function formatResult(result) {
  if (result instanceof Vec3 || (typeof result === 'object' && !Array.isArray(result) && 'x' in result && 'y' in result && 'z' in result)) {
    return `${Number(result.x).toFixed(6)} ${Number(result.y).toFixed(6)} ${Number(result.z).toFixed(6)}`;
  }
  return result;
}

// 创建脚本运行时: 缓存 Map + shared 对象 (每个 SceneRenderer 实例一个)
export function createScriptCache() {
  return { map: new Map(), shared: {} };
}

// 执行脚本值 (缓存模式): 编译一次, init 一次, 每帧 update(value) → 写回 obj.value
// opts: { canvasSize, userProps, shared, sceneObjects, thisScene, cache, runtime, frametime, ownerRef }
function runScriptValueCached(scriptVal, time, opts = {}) {
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return;
  const src = scriptVal.script;
  const cache = opts.cache;
  let entry = cache ? cache.get(src) : null;
  if (!entry) {
    const compiled = compileScript(src, {
      canvasSize: opts.canvasSize,
      userProps: opts.userProps,
      shared: opts.shared,
      thisScene: opts.thisScene,
      ownerRef: opts.ownerRef,
      runtime: opts.runtime != null ? opts.runtime : time,
      frametime: opts.frametime,
    });
    entry = {
      exports: compiled.exports || {},
      error: compiled.error,
      scriptProps: compiled.scriptProps,
      context: compiled.context || null,
      initialized: false,
      ownerRef: compiled.ownerRef,
    };
    if (cache) cache.set(src, entry);
  }
  const exports = entry.exports;
  if (entry.error && !exports.update && !exports.applyUserProperties && !exports.init) {
    return; // 脚本编译失败且无可用导出 → 保持静态 value
  }
  // 对象级 scriptproperties 覆盖 (WE 编辑器保存的用户调整 + user 属性绑定):
  // scene.json 对象上的 scriptproperties 是设计器存盘值, 格式 {name: value} 或
  // {name: {user: 用户属性名, value: 默认}} — 运行时读 userProps 当前值 (用户
  // 在 project.json 改过则生效), 无该键回退 value。脚本编译期 createScriptProperties
  // 只含脚本内声明的默认, 不含对象存盘覆盖 → 不应用则时钟 12/24h、分隔符等
  // 全用脚本默认 (用户调整丢失)。缓存按 src 共享, context.__scriptProperties
  // 每次按当前对象重新覆盖 (同脚本多对象不同覆盖不串)。
  if (scriptVal.scriptproperties && entry.context) {
    const props = Object.assign({}, entry.scriptProps || {});
    for (const [k, v] of Object.entries(scriptVal.scriptproperties)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.user === 'string' && v.user) {
          const uv = (opts.userProps || {})[v.user];
          props[k] = uv !== undefined && uv !== null ? uv : v.value;
        } else if ('value' in v) {
          props[k] = v.value;
        } else {
          props[k] = v;
        }
      } else {
        props[k] = v;
      }
    }
    entry.context.__scriptProperties = props;
  }
  // ownerRef 是首次编译时创建的共享代理 (entry 持有); setOwner 指向当前脚本
  // 所属对象 — 缓存共享条目在多个对象间不串
  const ownerRef = entry.ownerRef;
  if (ownerRef && ownerRef.setOwner) ownerRef.setOwner(opts.currentObject || null);
  const valueObj = toValueObj(scriptVal.value);
  try {
    if (!entry.initialized && typeof exports.init === 'function') {
      // NSL init(value): 一次性初始化 (如启动骨骼动画), 返回新值
      const r = exports.init(valueObj);
      if (r != null) scriptVal.value = formatResult(r);
      entry.initialized = true;
    }
    // applyUserProperties: NSL 语义在用户属性变化时调用 (715 Dock 逻辑的
    // shared.minScale/maxScale/radius 都在这里计算)。本地无变化检测 → 首次
    // 执行一次 (属性固定, 幂等); 不执行则依赖它的脚本读到 undefined。
    if (!entry.userPropsApplied && typeof exports.applyUserProperties === 'function') {
      exports.applyUserProperties({});
      entry.userPropsApplied = true;
    }
    if (typeof exports.update === 'function') {
      const result = exports.update(valueObj);
      if (result != null) scriptVal.value = formatResult(result);
    }
  } catch { /* 运行时错误 → 保持当前 value */ }
}

// 扫描并执行场景所有 {script, value} 对象 (更新到原对象树)
// opts: { canvasSize, userProps, scriptCache, renderObjects, runtime }
export function applySceneScripts(scene, time, opts = {}) {
  const cache = opts.scriptCache && opts.scriptCache.map ? opts.scriptCache : null;
  const shared = (cache ? cache.shared : null) || opts.shared || {};
  // 渲染对象列表 (this.objects, 已烘焙) — 脚本写这些对象 → 渲染直接生效
  const sceneObjects = opts.renderObjects || (scene.objects || []).map((o) => o);
  const thisScene = makeSceneRef(sceneObjects);
  const ownerRef = makeOwnerRef();
  const walk = (obj, owner) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      runScriptValueCached(obj, time, {
        canvasSize: opts.canvasSize,
        userProps: opts.userProps,
        shared,
        sceneObjects,
        thisScene,
        cache: cache ? cache.map : null,
        ownerRef,
        currentObject: owner || null,
        runtime: opts.runtime,
        frametime: opts.frametime,
      });
      return; // script 对象内部不再含 script 子对象
    }
    if (Array.isArray(obj)) {
      // 数组元素 owner = 元素自身 (script 常挂在对象属性上, 其 thisObject = 对象)
      obj.forEach((x) => walk(x, x));
      return;
    }
    for (const k of Object.keys(obj)) walk(obj[k], obj);
  };
  walk(scene, null);
  return shared;
}
