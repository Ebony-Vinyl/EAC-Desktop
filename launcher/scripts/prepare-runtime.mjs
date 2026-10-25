import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtime = join(root, 'runtime')
const cache = join(root, '.verify/runtime-cache')
const version = '24.22.1'
const pnpmVersion = '11.7.0'
const platform = process.platform
const arch = process.arch
if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported runtime target ${platform}/${arch}`)
}
const node = join(runtime, platform === 'win32' ? 'node.exe' : 'bin/node')
const npm = join(runtime, platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js')
const pnpm = join(runtime, 'tools/node_modules/pnpm/bin/pnpm.cjs')
try {
  await access(pnpm)
  const manifest = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'))
  if (manifest.node === version && manifest.pnpm === pnpmVersion && manifest.platform === platform && manifest.arch === arch) {
    if (execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() === `v${version}`) {
      console.log(`Runtime ready: Node ${version} / pnpm ${pnpmVersion}`)
      process.exit(0)
    }
  }
} catch { /* An incomplete cache is rebuilt before packaging. */ }
await mkdir(cache, { recursive: true })
const platformName = platform === 'win32' ? 'win' : platform
const directory = `node-v${version}-${platformName}-${arch}`
const filename = `${directory}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
const origin = `https://nodejs.org/dist/v${version}`
const sumsResponse = await fetch(`${origin}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) })
if (!sumsResponse.ok) throw new Error(`Node checksums HTTP ${sumsResponse.status}`)
const expected = (await sumsResponse.text()).split(/\r?\n/).map(line => line.trim().split(/\s+/))
  .find(([, name]) => name === filename)?.[0]
if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing official checksum for ${filename}`)
const archive = join(cache, filename)
async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
let valid = false
try { valid = await digest(archive) === expected } catch { /* Download below. */ }
if (!valid) {
  console.log(`Downloading official Node ${version} runtime…`)
  const response = await fetch(`${origin}/${filename}`, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Node download HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node runtime SHA-256 mismatch')
  await writeFile(archive, bytes)
}
const staging = join(cache, `extract-${platform}-${arch}`)
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
if (platform === 'win32') {
  const literal = value => `'${value.replaceAll("'", "''")}'`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(staging)}`],
  { stdio: 'inherit', windowsHide: true })
} else {
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' })
}
const extracted = join(staging, directory)
const extractedNode = join(extracted, platform === 'win32' ? 'node.exe' : 'bin/node')
const extractedNpm = join(extracted, platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js')
if (execFileSync(extractedNode, ['--version'], { encoding: 'utf8' }).trim() !== `v${version}`) throw new Error('Extracted Node version mismatch')
execFileSync(extractedNode, [extractedNpm, 'install', '--prefix', join(extracted, 'tools'),
  '--ignore-scripts', '--no-fund', '--no-audit', '--save-exact', `pnpm@${pnpmVersion}`],
{ stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } })
const runtimeVersion = execFileSync(extractedNode, [join(extracted, 'tools/node_modules/pnpm/bin/pnpm.cjs'), '--version'], { encoding: 'utf8' }).trim()
if (runtimeVersion !== pnpmVersion) throw new Error('pnpm version mismatch')
await writeFile(join(extracted, 'runtime.json'), JSON.stringify({
  node: version, pnpm: pnpmVersion, platform, arch,
  source: `${origin}/${filename}`, sha256: expected,
}, null, 2) + '\n')
const old = join(cache, `previous-${Date.now()}`)
try { await rename(runtime, old) } catch (error) { if (error.code !== 'ENOENT') throw error }
try {
  await cp(extracted, runtime, { recursive: true, errorOnExist: true })
} catch (error) {
  await rm(runtime, { recursive: true, force: true })
  try { await rename(old, runtime) } catch { /* No previous complete runtime. */ }
  throw error
}
console.log(`Bundled runtime verified: Node ${version} / pnpm ${pnpmVersion}`)
