/**
 * The slice of `@deepseek-ai/dsh-llm` this package is allowed to know about.
 *
 * The kernel is supplied by the installation, never depended on by version —
 * so this declares only the one function the adapter seam calls, and the seam
 * degrades to its fallback User-Agent when even that is absent.
 */

declare module '@deepseek-ai/dsh-llm' {
  export function attributionHeaders(): Record<string, string> | undefined
}
