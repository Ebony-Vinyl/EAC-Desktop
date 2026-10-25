import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const connection = JSON.parse(await readFile(join(root, '.verify/preview.json'), 'utf8'))
const evidence = []
async function call(action, payload = {}, rejected = false) {
  const response = await fetch(`${connection.url}/api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(action.includes('install') ? 900000 : 150000),
  })
  const result = await response.json()
  evidence.push({ action, passed: rejected ? result.ok === false : result.ok === true })
  console.log(`${action}: ${result.ok ? 'completed' : rejected ? 'rejected as expected' : 'failed'}`)
  if (rejected) { assert.equal(result.ok, false); return result }
  assert.equal(result.ok, true, result.error)
  return result.data
}
let snapshot = await call('snapshot')
if (!snapshot.kernels.length) {
  const directory = process.env.EAC_VERIFY_KERNEL
  if (!directory) throw new Error('Set EAC_VERIFY_KERNEL to a real installed kernel')
  snapshot = await call('register_kernel', { directory })
}
const core = snapshot.kernels[0]
let instance = snapshot.instances.find(item => item.name === 'EAC 验收工作区')
if (!instance) {
  snapshot = await call('create_instance', { name: 'EAC 验收工作区', kind: 'harness', kernelId: core.id })
  instance = snapshot.instances.find(item => item.name === 'EAC 验收工作区')
}
await call('stop_instance', { id: instance.id })
snapshot = await call('launch_instance', { id: instance.id })
const running = snapshot.instances.find(item => item.id === instance.id)
assert.equal(running.status, 'running')
let page = await fetch(running.url, { redirect: 'manual' })
if (page.status === 303) {
  const cookies = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  page = await fetch(new URL(page.headers.get('location'), running.url), { headers: { Cookie: cookies } })
}
assert.equal(page.status, 200)
await call('update_instance', { id: instance.id, kernelId: core.id }, true)
await call('stop_instance', { id: instance.id })
await call('snapshot_instance', { id: instance.id })
const { backups } = await call('list_backups', { id: instance.id })
assert.ok(backups.length)
await call('restore_instance', { id: instance.id, backupId: backups[0].id })
await call('remove_kernel', { id: core.id }, true)
const catalog = await call('catalog')
assert.equal(catalog.plugins.length, 64)
if (process.env.EAC_VERIFY_NETWORK === '1') {
  const plugin = catalog.plugins.find(item => item.id === 'community-dshmarket')
  await call('install_plugin', { instanceId: instance.id, ref: plugin.ref, expectedSha256: plugin.sha256 })
  snapshot = await call('snapshot')
  const installed = snapshot.instances.find(item => item.id === instance.id).plugins
  assert.ok(installed.some(item => item.name === plugin.name && item.version === plugin.version))
  snapshot = await call('toggle_plugin', { instanceId: instance.id, name: plugin.name, enabled: false })
  assert.equal(snapshot.instances.find(item => item.id === instance.id).plugins.find(item => item.name === plugin.name).enabled, false)
  snapshot = await call('toggle_plugin', { instanceId: instance.id, name: plugin.name, enabled: true })
  assert.equal(snapshot.instances.find(item => item.id === instance.id).plugins.find(item => item.name === plugin.name).enabled, true)
  await call('remove_plugin', { instanceId: instance.id, name: plugin.name })
  const eacReleases = await call('releases', { source: 'eac' })
  assert.ok(eacReleases.releases.some(release => release.assets.some(asset => asset.name.endsWith('portable.zip'))))
  const official = await call('releases', { source: 'official' })
  assert.ok(official.releases[0].assets[0].url.startsWith('https://download.deepseek.com/'))
}
const report = { timestamp: new Date().toISOString(), kernel: core.version, root: snapshot.root, instanceId: instance.id, evidence }
await writeFile(join(root, '.verify/connected-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Verified ${evidence.length} real Rust operations; instance stopped.`)
