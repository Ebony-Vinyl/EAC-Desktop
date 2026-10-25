// settings-compat.js — dsh-settings 0.1.x → 0.2.x 兼容垫片（Pack 补丁共享）。
//
// 0.2.0-rc.2 的 @deepseek-ai/dsh-settings 只剩这些导出：
//     SettingsConflictError, SettingsForms（同时是 default）, redactSecrets
// 0.1.x 时代的 `settingsNamespace` / `installSettingsSection` 已移除，直接具名
// import 会让 ESM 在**链接期**解析失败抛 SyntaxError —— 整个插件树随之无法
// 激活（web boot 报 "N entries did not activate"），且插件本身一行代码都没跑到。
//
// 更关键的是**语义**也变了：0.2.x 退役了「插件自己 register 命名空间」的模型，
// 改为「由插件导出的 Config schema 派生设置表单」：
//     SettingsForms.describe() 对每个 entry 调 schema(entry)，
//     再经 volatileForm() 只保留「最近的 volatile 祖先被标记」的字段。
// 所以 0.1.x 的 `ctx.settings.register(ns, Config, opts)` 在 0.2.x 上：
//     · 方法不存在 → TypeError: ctx.settings.register is not a function；
//     · 即使补上，也没有 register 这一步能建立命名空间。
//
// 本垫片提供两件事：
//
//   settingsNamespace(value)
//     纯品牌 + 校验，无运行时状态。0.2.x 的 update/describe 只按 entry id
//     取表单，喂裸字符串语义完全相同。
//
//   installSettingsSection(ctx, ns, schema, entry, hooks)
//     0.1.3 的语义是「转发 provider.installSection」；0.2.x 没有这个方法。
//     这里降级为**尽力而为**：把 base 值写进 entry 的实时配置（若内核提供
//     mutate/replace），其余静默跳过，绝不阻断插件激活。
//
//   createSettingsScope(ctx, ns, schema, base)
//     **新增**：给仍按 0.1.x 写法直接调 `ctx.settings.register(...)` 的插件
//     一个等价对象。返回的 scope 实现了插件实际用到的五个方法
//     （get / set / watch / getSnapshot / subscribe），底层映射到 0.2.x 的
//     describe() 读 + update() 写。返回 null 表示这一代内核没有可用设置面，
//     调用方应降级而不是把死卡片摆进设置页。
//
// 分发方式：本文件随插件自包含（EAC 插件本就自包含分发，不进内核包解析链），
// 插件内 `from '@deepseek-ai/dsh-settings'` 改为指向本文件。

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Brand a raw string as a settings namespace; validates like the kernel's parser. */
export function settingsNamespace(value) {
  if (typeof value !== 'string' || !NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${String(value)}" must match ${String(NAMESPACE_PATTERN)}`);
  }
  return value;
}

/** Probe the settings service across kernel generations without tripping cordis inject guards. */
function getSettings(ctx) {
  try {
    if (ctx.settings !== undefined && ctx.settings !== null) return ctx.settings;
  } catch { /* reading an un-injected property throws */ }
  try {
    return typeof ctx.get === 'function' ? ctx.get('settings') : undefined;
  } catch { return undefined; }
}

/**
 * Compat wrapper for the retired installSettingsSection(ctx, ns, schema, entry, hooks).
 * Never throws: a settings surface is optional, the plugin's real functionality is not.
 */
export function installSettingsSection(ctx, ns, schema, entry, hooks) {
  try {
    if (!ctx || typeof ctx.inject !== 'function') return;
    ctx.inject(['settings'], (sctx) => {
      const settings = sctx && sctx.settings;
      if (!settings) return;
      // 0.1.3-era provider method: forward when present.
      if (typeof settings.installSection === 'function') {
        settings.installSection(ctx, ns, schema, entry, hooks);
        return;
      }
      // 0.2.x: namespace registration is retired. Best effort only.
      if (typeof hooks?.setSource === 'function') {
        try {
          hooks.setSource(() => (entry ?? {}));
          hooks.onChange?.();
        } catch { /* best effort */ }
      }
    });
  } catch { /* settings is optional; never block activation */ }
}

/**
 * Build a 0.1.x-shaped settings scope on top of the 0.2.x SettingsForms API.
 *
 * The returned object implements the surface the EAC plugins actually call:
 *   get()            → current value object (or the supplied base)
 *   set(key, value)  → merge one field (0.2.x update())
 *   watch(fn)        → subscribe to changes, returns an unwatch function
 *   getSnapshot()    → { status, value, revision } for the client selector helper
 *   subscribe(fn)    → alias of watch, returns an unsubscribe function
 *
 * Returns null when this kernel exposes no usable settings surface, so callers can
 * skip registering a section instead of rendering a permanently broken card.
 */
export function createSettingsScope(ctx, ns, schema, base = {}) {
  const settings = getSettings(ctx);
  if (!settings || typeof settings.describe !== 'function') return null;

  const read = () => {
    try {
      const row = settings.describe().find((d) => d.ns === ns);
      if (row === undefined) return undefined;
      return { value: row.value ?? base, revision: row.revision };
    } catch { return undefined; }
  };

  const listeners = new Set();
  let lastRaw;
  const emit = (snapshot) => {
    for (const fn of [...listeners]) {
      try { fn(snapshot.value ?? base); } catch { /* listener faults must not break the plugin */ }
    }
  };

  // 0.2.x emits `settings/document-updated` on the root context; poll-free subscribe
  // when available, else fall back to no live updates (still correct, just not live).
  try {
    const root = ctx.root ?? ctx;
    if (typeof root.on === 'function') {
      root.on('settings/document-updated', () => {
        const snap = read();
        const raw = JSON.stringify(snap?.value ?? null);
        if (raw === lastRaw) return;
        lastRaw = raw;
        emit(snap ?? { value: base });
      });
    }
  } catch { /* live updates are best effort */ }

  const initial = read();
  lastRaw = JSON.stringify(initial?.value ?? null);

  const scope = {
    ns,
    schema,
    get: () => (read()?.value ?? base),
    getSnapshot: () => {
      const snap = read();
      if (snap === undefined) return { status: 'unavailable', value: base };
      return { status: 'ready', value: snap.value ?? base, revision: snap.revision };
    },
    set: async (key, value) => {
      if (typeof settings.update !== 'function') return;
      await settings.update(ns, { [key]: value });
      const snap = read();
      lastRaw = JSON.stringify(snap?.value ?? null);
      emit(snap ?? { value: base });
    },
    watch: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** 0.1.x also exposed `unset`; 0.2.x has no field removal, so reset to the base value. */
    unset: async (key) => {
      if (typeof settings.update !== 'function') return;
      const fallback = base?.[key];
      await settings.update(ns, { [key]: fallback });
    },
  };
  return scope;
}
