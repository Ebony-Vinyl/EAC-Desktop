import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
export const MAX_EXTERNAL_URL_LENGTH = 2048

export function externalUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_EXTERNAL_URL_LENGTH) return null
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        url.href.length > MAX_EXTERNAL_URL_LENGTH) return null
    return url.href
  } catch { return null }
}

/** Await the launcher so a missing browser or process failure remains recoverable. */
export async function openExternal(value, {
  platform = process.platform, exec = runFile, systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
} = {}) {
  const url = externalUrl(value)
  if (url === null) return false
  try {
    if (platform === 'win32') {
      const script = `Start-Process -FilePath '${url.replaceAll("'", "''")}' -ErrorAction Stop`
      await exec(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 10000 })
    } else {
      await exec(platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], { timeout: 10000 })
    }
    return true
  } catch { return false }
}
