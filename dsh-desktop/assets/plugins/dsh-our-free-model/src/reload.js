/**
 * Self hot-reload: replace the running plugin with the code now on disk,
 * without restarting the application.
 *
 * The kernel's HMR service reloads plugins by watching files; it deliberately
 * ships with module watching off, and it has no "reload this plugin now" API.
 * Its `partialReload` does, however, define the correct sequence, and this
 * module mirrors it step for step against the same primitives:
 *
 * 1. snapshot the fibers of the current runtime and their configs;
 * 2. back the package's entries out of Node's ESM `loadCache` (via
 *    `Map.prototype` methods — Node 24's LoadCache subclass only clears a type
 *    slot on `.delete`) and out of the CJS `require.cache`;
 * 3. re-import the entry file through the loader so the new sources evaluate;
 * 4. dispose the old fibers, re-register the replacement under the same config,
 *    and re-attach the loader entry so config writes and volatile updates keep
 *    landing on the live fiber;
 * 5. on any failure, restore the caches and the old registration — the swap
 *    reports whether the previous runtime could be restored. A restoration
 *    failure remains an explicit failure rather than an availability promise.
 *
 * The reload runs from a plain timer, outside the fiber being disposed, so the
 * disposal of the caller's own effects cannot cancel the swap mid-way.
 *
 * @module src/reload.js
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire, registerHooks } from 'node:module'

let inFlight = null
const hooksKey = Symbol.for('our-free-model.reload-hooks')
const reloadHooks = globalThis[hooksKey] ??= new Map()

/** Carry the entry's generation into its dependencies when the host hides its cache. */
function enableFreshDependencies(packageUrl) {
  if (reloadHooks.has(packageUrl)) return
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!context.parentURL?.startsWith(packageUrl) || !resolved.url.startsWith(packageUrl)) return resolved
      const generation = new URL(context.parentURL).searchParams.get('ofm-reload')
      if (generation === null) return resolved
      const target = new URL(resolved.url)
      target.searchParams.set('ofm-reload', generation)
      return { ...resolved, url: target.href }
    },
  })
  reloadHooks.set(packageUrl, hook)
}

/** Whether a reload is currently running; guards against overlapping swaps. */
export function isReloading() {
  return inFlight !== null
}

/** Directory of the installed package, as a `file://` URL with a trailing slash. */
export function packageUrlOf(entryModuleUrl) {
  return new URL('../', entryModuleUrl).href
}

/** Entry file (`index.js`) of the package, as an absolute `file://` URL. */
export function entryUrlOf(entryModuleUrl) {
  return new URL('../index.js', entryModuleUrl).href
}

/** Every loadCache key that lives inside the package. Key comparison tolerates
 *  case and percent-encoding drift between Node's resolver and `new URL`. */
export function packageCacheKeys(loadCache, packageUrl) {
  const base = decodeURIComponent(packageUrl).replace(/\/+$/, '').toLowerCase() + '/'
  const keys = []
  for (const key of loadCache.keys()) {
    if (typeof key !== 'string') continue
    let normalized
    try { normalized = decodeURIComponent(key).toLowerCase() } catch { normalized = key.toLowerCase() }
    if (normalized.startsWith(base)) keys.push(key)
  }
  return keys
}

/**
 * Back up and remove the package's modules from both module caches.
 *
 * The loadCache is accessed duck-typed on purpose: Node 24.12+ replaced the
 * Map subclass with its own structure, so `instanceof Map` is false on newer
 * runtimes even though `keys/get/delete` still behave like a map. Where the
 * cache really is a Map, `Map.prototype` methods are used directly (Node 24's
 * original LoadCache.delete only cleared a type slot); otherwise the object's
 * own methods are used.
 *
 * @returns {{esm: Map<string, unknown>, cjs: Map<string, object>}}
 */
export function purgeCaches(internal, packageUrl) {
  const backup = { esm: new Map(), cjs: new Map() }
  const cache = internal?.loadCache
  if (cache !== null && cache !== undefined && typeof cache.keys === 'function'
    && typeof cache.get === 'function' && typeof cache.delete === 'function') {
    const read = key => {
      try { return Map.prototype.get.call(cache, key) } catch { try { return cache.get(key) } catch { return undefined } }
    }
    const drop = key => {
      try { Map.prototype.delete.call(cache, key); return } catch { /* not a real Map — fall through */ }
      try { cache.delete(key) } catch { /* best effort */ }
    }
    for (const key of packageCacheKeys(cache, packageUrl)) {
      backup.esm.set(key, read(key))
      drop(key)
    }
  }
  const require = createRequire(import.meta.url)
  for (const key of backup.esm.keys()) {
    try {
      const filePath = fileURLToPath(key)
      if (require.cache[filePath] !== undefined) {
        backup.cjs.set(filePath, require.cache[filePath])
        delete require.cache[filePath]
      }
    } catch {
      // non-file: URL — nothing to purge on the CJS side
    }
  }
  return backup
}

/** Put a purge's backup back (rollback path). */
export function restoreCaches(internal, backup) {
  const cache = internal?.loadCache
  for (const [key, job] of backup.esm) {
    try { Map.prototype.set.call(cache, key, job) } catch { try { cache.set(key, job) } catch { /* best effort */ } }
  }
  const require = createRequire(import.meta.url)
  for (const [filePath, module] of backup.cjs) require.cache[filePath] = module
}

/**
 * Reload the calling plugin instance in place.
 *
 * @param {object} ctx - the context `apply` received
 * @param {{logger?: object, packageUrl?: string, entryUrl?: string, expectedVersion?: string}} [options]
 * @returns {Promise<{ok: true, version: string, fibers: number} | {ok: false, error: string, restored: boolean}>}
 */
export function selfReload(ctx, options = {}) {
  if (inFlight !== null) return inFlight
  inFlight = (async () => {
    const logger = options.logger ?? console
    const packageUrl = options.packageUrl ?? packageUrlOf(import.meta.url)
    const entryUrl = options.entryUrl ?? entryUrlOf(import.meta.url)
    const loader = ctx.loader
    const registry = ctx.registry
    if (loader === undefined || registry === undefined) {
      return { ok: false, error: 'no loader/registry on this context', restored: false }
    }

    // The plugin identity is the exports object the registry keyed the runtime by.
    const previous = ctx.fiber?.runtime?.callback
    if (previous === undefined || previous === null) {
      return { ok: false, error: 'no runtime to reload (plugin was not registered the ordinary way)', restored: false }
    }
    const runtime = registry.get(previous)
    const fibers = [...(runtime?.fibers ?? [])].map(fiber => {
      const entry = fiber.entry?.fiber?.uid === fiber.uid ? fiber.entry : undefined
      const plugin = typeof previous === 'function'
        ? { apply: previous, inject: { ...fiber.inject }, Config: runtime.Config, name: runtime.name }
        : previous
      return { fiber, entry, plugin, config: entry === undefined ? fiber._config : entry.options.config }
    })
    if (fibers.length === 0) {
      return { ok: false, error: 'runtime has no live fibers', restored: false }
    }

    const internal = loader.internal
    const backup = purgeCaches(internal, packageUrl)
    logger.info?.(`our-free-model: hot reload purging ${backup.esm.size} cached module(s)`)
    if (backup.esm.size === 0 && internal?.loadCache instanceof Map) {
      // Diagnostic for kernels whose loadCache keys use a different shape.
      const sample = [...internal.loadCache.keys()].slice(0, 6).map(key => String(key).slice(-70))
      globalThis[Symbol.for('our-free-model.purge-sample')] = { packageUrl: packageUrl.slice(-70), sample }
    }

    const importFresh = async url => loader.unwrapExports(await loader.import(url, () => []))
    let replacement
    let busted = false
    try {
      replacement = await importFresh(entryUrl)
      if (replacement === undefined || typeof replacement.apply !== 'function') {
        throw new Error('reloaded module does not export apply()')
      }
      if (backup.esm.size === 0 || replacement === previous || replacement.apply === previous
        || (typeof previous.apply === 'function' && replacement.apply === previous.apply)) {
        // The cache purge did not take effect on this kernel (the loadCache shape
        // changed across Node versions). Force a fresh evaluation of the entry
        // with a generation query shared by static and lazy dependencies.
        enableFreshDependencies(packageUrl)
        const freshUrl = new URL(entryUrl)
        freshUrl.searchParams.set('ofm-reload', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
        replacement = await importFresh(freshUrl.href)
        busted = true
        if (replacement === undefined || typeof replacement.apply !== 'function') {
          throw new Error('reloaded module does not export apply()')
        }
        if (replacement === previous || replacement.apply === previous
          || (typeof previous.apply === 'function' && replacement.apply === previous.apply)) {
          throw new Error('replacement is still the previous plugin after cache invalidation')
        }
      }
      if (options.expectedVersion !== undefined && replacement.version !== options.expectedVersion) {
        throw new Error(`activation version mismatch: expected ${options.expectedVersion}, got ${String(replacement.version ?? '(missing)')}`)
      }
    } catch (error) {
      restoreCaches(internal, backup)
      return { ok: false, error: `re-import failed, old code still running (${error?.message ?? error})`, restored: true }
    }
    globalThis[Symbol.for('our-free-model.last-reload')] = { at: Date.now(), purged: backup.esm.size, busted }

    try {
      registry.delete(previous)
      await Promise.all(fibers.map(({ fiber }) => fiber.await()))
    } catch (error) {
      // Old fibers are gone regardless; the new registration below is still the
      // right move — the error is logged, not propagated, to not skip it.
      logger.warn?.(`our-free-model: hot reload dispose reported ${error?.message ?? error}`)
    }

    try {
      const created = []
      for (const { fiber, entry, config } of fibers) {
        const registered = fiber.parent.registry.plugin(replacement, config)
        const fresh = registered.ctx.fiber
        if (entry !== undefined) {
          fresh.entry = entry
          entry.fiber = fresh
        }
        created.push(fresh)
      }
      await Promise.all(created.map(fiber => fiber.await()))
      logger.info?.(`our-free-model: hot reload complete, ${created.length} fiber(s) re-registered`)
      return { ok: true, version: String(replacement.version ?? ''), fibers: created.length }
    } catch (error) {
      // The replacement failed to start. Put the old code back both on disk
      // (caller's job, via the updater's backup) and in the registry.
      restoreCaches(internal, backup)
      try {
        registry.delete(replacement)
      } catch { /* may never have started */ }
      try {
        const restored = []
        for (const { fiber, entry, plugin, config } of fibers) {
          const registered = fiber.parent.registry.plugin(plugin, config)
          const fresh = registered.ctx.fiber
          if (entry !== undefined) {
            fresh.entry = entry
            entry.fiber = fresh
          }
          restored.push(fresh)
        }
        await Promise.all(restored.map(fiber => fiber.await()))
        return { ok: false, error: `new code failed to start, previous version restored (${error?.message ?? error})`, restored: true }
      } catch (restoreError) {
        return {
          ok: false,
          error: `new code failed to start (${error?.message ?? error}); runtime restore failed too (${restoreError?.message ?? restoreError})`,
          restored: false,
        }
      }
    }
  })()
  return inFlight.finally(() => { inFlight = null })
}

/**
 * Watch the package directory and hot-reload on any source change.
 *
 * Off by default; a production install does not rewrite its own files, and the
 * settings page exposes an explicit reload button. Meant for development and
 * for demonstrating live edits.
 *
 * @returns {() => void} stop function
 */
export function watchPackage(packageDir, { onChange, logger = console, debounceMs = 600 } = {}) {
  let timer
  let paused = false
  let watcher
  try {
    watcher = fs.watch(packageDir, { recursive: true })
  } catch (error) {
    logger.warn?.(`our-free-model: could not watch ${packageDir} (${error?.message ?? error})`)
    return () => {}
  }
  const schedule = () => {
    if (paused) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (paused) return
      onChange?.()
    }, debounceMs)
    timer.unref?.()
  }
  watcher.on('change', schedule)
  watcher.on('error', error => logger.warn?.(`our-free-model: watcher error (${error?.message ?? error})`))
  return () => {
    paused = true
    clearTimeout(timer)
    try { watcher.close() } catch { /* already closed */ }
  }
}
