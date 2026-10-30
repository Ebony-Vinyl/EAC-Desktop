/** Hold stream metadata until content arrives or the first heartbeat is due. */
export function deferStreamResponse(res, heartbeatMs) {
  let pending = true
  let head
  let writes = []
  let bytes = 0
  let timer
  const clear = () => { clearTimeout(timer); timer = undefined }
  const commit = () => {
    if (!pending || res.destroyed) return
    pending = false
    clear()
    if (head) res.writeHead(...head)
    for (const row of writes) res.write(...row)
    writes = []
  }
  const response = new Proxy(res, {
    get(target, key) {
      if (key === 'writeHead') return (...args) => {
        if (!pending) return target.writeHead(...args)
        head = args
        if (args[0] >= 400) { writes = []; bytes = 0 }
        if (!timer && heartbeatMs > 0) { timer = setTimeout(commit, heartbeatMs); timer.unref?.() }
        return response
      }
      if (key === 'flushHeaders') return () => { if (!pending) target.flushHeaders() }
      if (key === 'write') return (...args) => {
        if (!pending) return target.write(...args)
        const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
        writes.push(args)
        bytes += Buffer.byteLength(args[0])
        if (callback) queueMicrotask(callback)
        if (bytes >= 64 * 1024) commit()
        return true
      }
      if (key === 'end') return (...args) => { commit(); return target.end(...args) }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  res.once('finish', clear)
  res.once('close', clear)
  return { response, commit, dispose: clear }
}
