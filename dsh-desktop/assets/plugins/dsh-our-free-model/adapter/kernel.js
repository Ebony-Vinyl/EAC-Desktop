/**
 * The kernel seam.
 *
 * This file is the only module in the package allowed to name an
 * `@deepseek-ai/*` module — the ecosystem packaging rule (audit gate §4.3,
 * "adapter 层外不允许 `@deepseek-ai/*` import") in one line of grep. Everything
 * the plugin takes from the harness kernel crosses here, so the rest of the
 * source stays a pure consumer of the structural `ctx` contract and can mount
 * on any kernel line that supplies it.
 *
 * Today the seam carries one thing: the harness attribution User-Agent. It is
 * imported lazily because the plugin must not pin a kernel version: the package
 * is supplied by whichever installation resolves the bundle, and if a
 * composition cannot supply it a literal keeps attribution present, which is
 * what the adapter contract requires.
 *
 * @module adapter/kernel.js
 */

// @ts-check

/**
 * The slice of the kernel module this seam is allowed to depend on. The real
 * declaration lives beside this file (`dsh-llm.d.ts`); it is deliberately
 * narrower than the kernel's own surface.
 *
 * @typedef {object} KernelAttribution
 * @property {() => Record<string, string> | undefined} [attributionHeaders]
 */

/**
 * Resolve the harness attribution User-Agent.
 *
 * A missing module or an unexpected shape degrades to the literal below —
 * attribution must be present even when the kernel's helper is not.
 *
 * @param {{ debug?: (message: string) => void } | undefined} [logger]
 * @returns {Promise<string>}
 */
export async function resolveAttributionUserAgent(logger) {
  try {
    const module = /** @type {KernelAttribution} */ (await import('@deepseek-ai/dsh-llm'))
    const headers = typeof module.attributionHeaders === 'function' ? module.attributionHeaders() : undefined
    const agent = headers?.['user-agent'] ?? headers?.['User-Agent']
    if (typeof agent === 'string' && agent !== '') return agent
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.debug?.(`our-free-model: attribution module unavailable (${message})`)
  }
  return 'deepseek-harness/0.1.7 (+https://github.com/deepseek-ai/deepseek-harness)'
}
