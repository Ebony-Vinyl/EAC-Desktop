import { spawn } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = process.env.CARGO_TARGET_DIR || join(root, 'src-tauri/target')
const executable = process.env.EAC_API_BINARY || join(target, `debug/eac-launcher-api${process.platform === 'win32' ? '.exe' : ''}`)
const children = new Set()
function child(program, args, options = {}) {
  const process = spawn(program, args, { cwd: root, windowsHide: true, ...options })
  children.add(process)
  process.once('exit', () => children.delete(process))
  process.on('error', error => { console.error(error.message); shutdown(1) })
  return process
}
function shutdown(code = 0) {
  for (const process of children) process.kill()
  process.exit(code)
}
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
const build = child('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--no-default-features', '--features', 'api', '--bin', 'eac-launcher-api'], {
  stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target },
})
const status = await new Promise(resolve => build.once('exit', resolve))
if (status !== 0) process.exit(status || 1)
const port = process.env.EAC_UI_PORT || '5178'
const origin = `http://127.0.0.1:${port}`
await mkdir(join(root, '.verify'), { recursive: true })
const runningExecutable = join(root, '.verify', `eac-api-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`)
await copyFile(executable, runningExecutable)
const bridge = child(runningExecutable, ['--serve', '0', '--origin', origin], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, EAC_RUNTIME_DIR: join(root, 'runtime') },
})
const lines = createInterface({ input: bridge.stdout })
let started = false
for await (const line of lines) {
  let discovery
  try { discovery = JSON.parse(line) } catch { continue }
  if (discovery.event !== 'eac-launcher-bridge' || started) continue
  started = true
  await mkdir(join(root, '.verify'), { recursive: true })
  await writeFile(join(root, '.verify/preview.json'), JSON.stringify({ ...discovery, ui: origin, home: process.env.EAC_LAUNCHER_HOME || null }))
  const vite = child(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_EAC_BRIDGE_URL: discovery.url, VITE_EAC_BRIDGE_TOKEN: discovery.token },
  })
  vite.once('exit', code => shutdown(code || 0))
  console.log(`EAC launcher: ${origin}`)
}
shutdown(started ? 0 : 1)
