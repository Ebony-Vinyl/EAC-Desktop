/**
 * dsh-external-links — host half (no-op).
 *
 * 外链改路由与登录授权页自动打开都是纯客户端行为（见 lib/client.js）：host 半边
 * 仅存在于此包成为合法 bundle（loader 需要 name/inject/apply 契约）。
 */
export const name = 'external-links';
export const inject = [];
export function apply() {
  // no-op.
}
