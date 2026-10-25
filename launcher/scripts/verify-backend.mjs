import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const executable = process.env.EAC_API_BINARY || join(root, 'src-tauri/target/debug/eac-launcher-api.exe')
const home = resolve(root, '.verify', `acceptance-${Date.now()}`)
const evidence = []
const env = { ...process.env, EAC_LAUNCHER_HOME: home, EAC_RUNTIME_DIR: join(root, 'runtime') }
function call(action, payload = {}, expectFailure = false) {
  const outputFile = join(home, 'api-output.json')
  const errorFile = join(home, 'api-error.json')
  const output = openSync(outputFile, 'w')
  const error = openSync(errorFile, 'w')
  let result
  try {
    // Windows child runtimes can retain inherited pipe handles after the API exits.
    // File output lets this probe wait for the API process rather than pipe EOF.
    result = spawnSync(executable, ['--api', action, JSON.stringify(payload)], {
      env, encoding: 'utf8', stdio: ['ignore', output, error],
      windowsHide: true, timeout: action === 'launch_instance' ? 150000 : 120000,
    })
  } finally {
    closeSync(output)
    closeSync(error)
  }
  if (result.error) throw result.error
  const diagnostic = readFileSync(errorFile, 'utf8')
  const lines = readFileSync(result.status === 0 ? outputFile : errorFile, 'utf8').trim().split(/\r?\n/)
  const envelope = JSON.parse(lines.findLast(line => line.startsWith('{')) || '{}')
  evidence.push({ action, success: envelope.ok === true, expectedFailure: expectFailure })
  if (expectFailure) {
    assert.equal(envelope.ok, false, `${action} should reject`)
    return envelope
  }
  assert.equal(envelope.ok, true, `${action}: ${envelope.error || diagnostic}`)
  return envelope.data
}
await mkdir(home, { recursive: true })
let state = call('snapshot')
assert.equal(state.instances.length, 0)
const catalog = call('catalog')
assert.ok(catalog.plugins.length >= 60)
assert.ok(catalog.plugins.some(plugin => plugin.name === '@dsh-eac/market'))
const localKernel = process.env.EAC_VERIFY_KERNEL
if (!localKernel) throw new Error('Set EAC_VERIFY_KERNEL to an installed DSH package directory for a real core test')
state = call('register_kernel', { directory: localKernel })
const kernel = state.kernels[0]
assert.ok(kernel.version)
state = call('create_instance', { name: '验收实例', kind: 'harness', kernelId: kernel.id })
const first = state.instances[0]
await writeFile(join(first.home, 'acceptance-marker.txt'), 'before', 'utf8')
call('snapshot_instance', { id: first.id })
const backups = call('list_backups', { id: first.id }).backups
await writeFile(join(first.home, 'acceptance-marker.txt'), 'after', 'utf8')
call('restore_instance', { id: first.id, backupId: backups[0].id })
assert.equal(await readFile(join(first.home, 'acceptance-marker.txt'), 'utf8'), 'before')
state = call('clone_instance', { id: first.id, name: '独立克隆' })
const clone = state.instances.find(instance => instance.id !== first.id)
assert.notEqual(first.home, clone.home)
await writeFile(join(clone.home, 'acceptance-marker.txt'), 'independent', 'utf8')
assert.equal(await readFile(join(first.home, 'acceptance-marker.txt'), 'utf8'), 'before')
call('remove_kernel', { id: kernel.id }, true)
const descriptor = join(home, 'instance-export.json')
call('export_instance', { id: first.id, destination: descriptor })
const exported = JSON.parse(await readFile(descriptor, 'utf8'))
assert.equal(exported.kernelVersion, kernel.version)
assert.equal(JSON.stringify(exported).includes(first.home), false)
state = call('import_instance', { path: descriptor })
assert.equal(state.instances.length, 3)
call('save_settings', { theme: 'dark', reducedMotion: true })
assert.equal(call('snapshot').settings.reducedMotion, true)
call('create_instance', { name: '../escape', kind: 'harness', kernelId: kernel.id }, true)
call('open_path', { path: join(home, '..') }, true)
let launchError
try {
  state = call('launch_instance', { id: first.id })
  const running = state.instances.find(instance => instance.id === first.id)
  assert.equal(running.status, 'running')
  assert.ok(running.url?.includes(`127.0.0.1:${first.port}`))
  let response = await fetch(running.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  if (response.status === 303) {
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    response = await fetch(new URL(response.headers.get('location'), running.url), {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000),
    })
  }
  assert.equal(response.ok, true)
  call('update_instance', { id: first.id, kernelId: kernel.id }, true)
} catch (error) {
  launchError = error.message.replace(/token=[^\s"\\]+/g, 'token=REDACTED')
} finally {
  call('stop_instance', { id: first.id })
}
const report = { timestamp: new Date().toISOString(), home, kernel: kernel.version, evidence, launchError }
await writeFile(join(home, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ home, kernel: kernel.version, checks: evidence.length, launchVerified: !launchError, launchError }, null, 2))
if (launchError) process.exitCode = 1
