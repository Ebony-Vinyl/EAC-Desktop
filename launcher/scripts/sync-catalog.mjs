import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(root, '..')
const revision = '98729a72cef16785293e593242c022b04950be2d'
const repository = 'https://github.com/look-back-lysj/deep-seek-harness-Unity'
const sourceUrl = `https://raw.githubusercontent.com/look-back-lysj/deep-seek-harness-Unity/${revision}/packages/market/data/index.json`
const desktopRepository = 'https://github.com/DSH-EAC/DSH-Desktop-EAC'
const desktopRevision = 'dc22280beb9d0a6338d1e02d99f5e5346f72f4f0'
const catalogPackage = 'dsh-plugin-catalog'

async function fetchJson(url, timeout = 30000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

const plugins = []
const seenIds = new Set()
const seenNames = new Set()
const addPlugin = plugin => {
  const id = String(plugin.id || '')
  const name = String(plugin.name || '').toLowerCase()
  if (!id || seenIds.has(id) || (name && seenNames.has(name))) return false
  seenIds.add(id)
  if (name) seenNames.add(name)
  plugins.push(plugin)
  return true
}

let upstreamBytes = null
let upstream = null
let offlineReuse = false
let previousPlugins = []
let previousPacks = []
let previousProvenance = {}
try {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`)
  upstreamBytes = Buffer.from(await response.arrayBuffer())
  upstream = JSON.parse(upstreamBytes.toString('utf8'))
} catch {
  // Network can be unavailable during local development. Reuse the last
  // generated records instead of shipping an empty market; provenance below
  // records that this build did not re-read the upstream revision.
  const previous = JSON.parse(await readFile(join(root, 'public/catalog.json'), 'utf8'))
  offlineReuse = true
  previousPlugins = previous.plugins || []
  previousPacks = previous.packs || []
  previousProvenance = previous.provenance || {}
}

let provenance
if (offlineReuse) {
  for (const plugin of previousPlugins) addPlugin(plugin)
  provenance = { ...previousProvenance, offlineReusedAt: new Date().toISOString(), note: '上游不可达，复用上一次生成的社区市场记录' }
} else {
  const statuses = new Map()
  for (const status of upstream.releaseStatuses) {
    const previous = statuses.get(status.releaseId)
    if (!previous || previous.sequence < status.sequence) statuses.set(status.releaseId, status)
  }
  const releases = new Map(upstream.releases.map(release => [release.releaseId, release]))
  for (const plugin of upstream.plugins) {
    const release = releases.get(plugin.releaseId)
    const delivery = upstream.deliveries.find(item =>
      item.pluginId === plugin.id && item.version === plugin.version &&
      item.artifactDigest === release?.artifactDigest)
    const source = delivery?.sources?.slice().sort((a, b) => a.priority - b.priority)
      .find(item => item.kind === 'https-artifact' && item.ref.startsWith('https://'))
    const active = statuses.get(plugin.releaseId)?.status === 'active'
    let packageJson
    try {
      packageJson = JSON.parse(Buffer.from(plugin.metadata?.packageJson?.contentBase64 || '', 'base64'))
    } catch { /* Some upstream records intentionally contain no package metadata. */ }
    const installable = plugin.installability === 'bundle-installable' && active && Boolean(source)
    addPlugin({
      id: plugin.id,
      name: plugin.packageName || plugin.name,
      version: plugin.version,
      description: plugin.summary,
      source: plugin.sourceUrl || release?.provenance?.repositoryUrl || repository,
      ref: installable ? source.ref : undefined,
      sha256: installable ? release.artifactDigest.replace(/^sha256:/, '') : undefined,
      coreRange: packageJson?.engines?.dsh,
      license: plugin.license || release?.provenance?.license,
      category: plugin.categories?.[0] || '社区插件',
      installable,
      verification: plugin.verification,
      reason: installable ? '上游提供固定版本制品；运行兼容性由官方管理器核验' :
        statuses.get(plugin.releaseId)?.reason || plugin.installability,
      releaseId: plugin.releaseId,
    })
  }

  addPlugin({
    id: 'eac-community-market',
    name: '@dsh-eac/market',
    version: '0.1.0-mvp.9',
    description: 'EAC 社区插件市场，运行在官方 Harness 内，提供发现、预检、安装和皮肤中心。',
    source: repository,
    ref: 'https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/master/artifacts/sha256/a8856180264fea4ba949ac6505c10a71bbf512cfa0dda253992994711904be7c/dsh-eac-market-0.1.0-mvp.9.tgz',
    sha256: 'a8856180264fea4ba949ac6505c10a71bbf512cfa0dda253992994711904be7c',
    category: '插件市场',
    installable: true,
    verification: '上游报告 0.1.7-rc.2 / 0.2.0-rc.1 准入通过；其他版本未知',
  })

  try {
    const npmMarket = await fetchJson('https://registry.npmjs.org/dshmarket/latest')
    if (npmMarket.name !== 'dshmarket' || !npmMarket.dist?.tarball?.startsWith('https://registry.npmjs.org/')) {
      throw new Error('Unexpected dshmarket package identity')
    }
    const artifact = await fetch(npmMarket.dist.tarball, { signal: AbortSignal.timeout(60000) })
    if (!artifact.ok) throw new Error(`dshmarket artifact HTTP ${artifact.status}`)
    const marketBytes = Buffer.from(await artifact.arrayBuffer())
    if (npmMarket.dist.integrity?.startsWith('sha512-') &&
        `sha512-${createHash('sha512').update(marketBytes).digest('base64')}` !== npmMarket.dist.integrity) {
      throw new Error('dshmarket npm integrity mismatch')
    }
    addPlugin({
      id: 'community-dshmarket', name: 'dshmarket', version: npmMarket.version,
      description: 'DSH 社区市场：发现、安装、分组、主题、备份和更新。由官方插件管理器安装到独立实例。',
      source: 'https://github.com/dsh-market/dsh-market',
      ref: npmMarket.dist.tarball, sha256: createHash('sha256').update(marketBytes).digest('hex'),
      license: npmMarket.license, coreRange: npmMarket.engines?.dsh, category: '插件市场', installable: true,
    })
  } catch { /* Keep the last known dshmarket record when npm is unreachable. */ }

  addPlugin({
    id: 'eac-plugin-suite', name: 'dsh-plugin-suite', version: '0.2.1',
    description: 'EAC/AIO 整合包完整发行版。子插件按需启用；EAC 私桥组件在官方内核上有限制。',
    source: 'https://github.com/Ebony-Vinyl/EAC-Pack/releases/tag/v0.2.1',
    ref: 'https://github.com/Ebony-Vinyl/EAC-Pack/releases/download/v0.2.1/dsh-plugin-suite-0.2.1.tgz',
    sha256: 'd8a6f0a8cf9777961f29af6dfb780011d5c90481cc79e52a2973d31ea8553c2f',
    category: '整合包管理', license: 'MIT', installable: true,
  })

  provenance = {
    repository, revision, path: 'packages/market/data/index.json',
    sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    generatedAt: upstream.generatedAt,
  }
}

// Merge the community awesome-dsh-plugin catalog package (thousands of real,
// npm-published plugins). npm name@version refs are accepted by the official
// plugin CLI; GitHub release tarballs are used verbatim when provided.
let catalogMeta = null
try {
  const npmCatalog = await fetchJson(`https://registry.npmjs.org/${catalogPackage}/latest`)
  if (npmCatalog.name !== catalogPackage || !npmCatalog.dist?.tarball?.startsWith('https://registry.npmjs.org/')) {
    throw new Error('Unexpected catalog package identity')
  }
  const tarballBytes = Buffer.from(await (await fetch(npmCatalog.dist.tarball, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
  if (npmCatalog.dist.integrity?.startsWith('sha512-') &&
      `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}` !== npmCatalog.dist.integrity) {
    throw new Error('catalog package integrity mismatch')
  }
  const work = await mkdtemp(join(tmpdir(), 'eac-catalog-'))
  const archive = join(work, 'catalog.tgz')
  await writeFile(archive, tarballBytes)
  // GNU tar treats drive-letter paths as remote hosts unless paths are
  // posix-style and --force-local is passed.
  const posix = value => value.replace(/\\/g, '/')
  execFileSync('tar', ['--force-local', '-xzf', posix(archive), '-C', posix(work), 'package/plugins.json', 'package/index.json'])
  const bundled = JSON.parse(await readFile(join(work, 'package/plugins.json'), 'utf8'))
  const bundledIndex = JSON.parse(await readFile(join(work, 'package/index.json'), 'utf8'))
  await rm(work, { recursive: true, force: true })
  const categorySources = [bundled.categories, bundledIndex.metadata?.categories, bundledIndex.categories]
  const categoryTitles = new Map()
  for (const source of categorySources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (!categoryTitles.has(key)) {
        const title = value?.title?.zh || value?.title?.en || value?.zh || value?.en
        categoryTitles.set(key, title || key)
      }
    }
  }
  const descriptionOf = entry => {
    const text = entry.description?.zh || entry.description?.en || entry.description || ''
    const clean = String(text).replace(/\s+/g, ' ').trim()
    return clean.length > 220 ? `${clean.slice(0, 219)}…` : clean
  }
  let merged = 0
  for (const entry of bundled.plugins || []) {
    const npmName = String(entry.npm || entry.name || '').trim()
    if (!npmName) continue
    const version = entry.version ? String(entry.version) : undefined
    const tarball = typeof entry.tarball === 'string' && entry.tarball.startsWith('https://') ? entry.tarball : undefined
    const ref = tarball ?? (version ? `${npmName}@${version}` : undefined)
    const added = addPlugin({
      id: `npm.${npmName.replace(/^@/, '').replace(/\//g, '.')}`,
      name: npmName,
      version: version ?? '未发布',
      description: descriptionOf(entry) || 'awesome-dsh-plugin 社区目录条目。',
      source: entry.url || entry.page || 'https://awesome-dsh-plugin.com',
      ref,
      category: categoryTitles.get(entry.category) || '社区插件',
      installable: Boolean(ref),
      reason: tarball ? 'GitHub Release 制品；运行兼容性未知' :
        version ? 'npm 固定版本，由官方插件 CLI 安装；运行兼容性未知' : '目录条目未提供可安装制品',
      ...(entry.downloads ? { downloads: entry.downloads } : {}),
      ...(entry.stars ? { stars: entry.stars } : {}),
    })
    if (added) merged++
  }
  catalogMeta = {
    package: catalogPackage,
    version: npmCatalog.version,
    tarball: npmCatalog.dist.tarball,
    tarballSha256: createHash('sha256').update(tarballBytes).digest('hex'),
    updated: bundled.updated,
    declaredCount: bundled.count,
    merged,
    source: bundled.source,
  }
} catch { /* The launcher falls back to the upstream market when the catalog package is unreachable. */ }

// Merge real plugins that ship inside the DSH-Desktop working tree. They are
// listed as catalog-only records unless an installable artifact is already
// known from the sources above; no compatibility is invented here.
const assetsRoot = join(repoRoot, 'dsh-desktop/assets/plugins')
let desktopAdded = 0
try {
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(assetsRoot, entry.name, 'package.json'), 'utf8'))
    } catch { continue }
    const name = manifest.name || entry.name
    if (seenNames.has(name.toLowerCase())) continue
    const relative = `dsh-desktop/assets/plugins/${entry.name}`
    let tracked = false
    try {
      tracked = execFileSync('git', ['-C', repoRoot, 'ls-files', '--', relative], { encoding: 'utf8' }).trim().length > 0
    } catch { /* git may be unavailable; treat as untracked local asset */ }
    const added = addPlugin({
      id: `desktop.${entry.name}`,
      name,
      version: manifest.version || '未发布',
      description: (manifest.description && String(manifest.description).slice(0, 160)) || 'DSH-Desktop 仓库内维护的插件资产；当前目录未提供独立安装制品。',
      source: tracked ? `${desktopRepository}/tree/${desktopRevision}/${relative}` : desktopRepository,
      license: manifest.license,
      category: '桌面端资产',
      installable: false,
      reason: '仓库内资产；未提供独立固定制品，不声明安装兼容',
    })
    if (added) desktopAdded++
  }
} catch { /* assets directory is optional */ }

// Merge production Mojobox packs. Component IDs resolve to refs only when the
// plugin already has a verified upstream artifact; unresolved entries stay in
// the description instead of being faked as installable refs.
const mojoboxCandidates = [
  process.env.MOJOBOX_CATALOG,
  join(root, '../../dsh max/dsh-mojobox/dist/generated/catalog.json'),
  join(root, '../../dsh max/dsh-mojobox/site/public/generated/catalog.json'),
].filter(Boolean)
let mojobox = null
for (const candidate of mojoboxCandidates) {
  try { mojobox = JSON.parse(await readFile(candidate, 'utf8')); break } catch { /* try next */ }
}
if (!mojobox) {
  try { mojobox = await fetchJson('https://dsh-eac.github.io/EAC-mojobox/generated/catalog.json', 8000) } catch { /* optional */ }
}
const refById = new Map(plugins.filter(plugin => plugin.ref).map(plugin => [plugin.id, plugin.ref]))
const packs = offlineReuse ? previousPacks.filter(pack => pack.id !== 'mojobox-') : []
const packIds = new Set(packs.map(pack => pack.id))
if (!offlineReuse) {
  const eacPack = { ref: 'https://github.com/Ebony-Vinyl/EAC-Pack/releases/download/v0.2.1/dsh-plugin-suite-0.2.1.tgz', sha256: 'd8a6f0a8cf9777961f29af6dfb780011d5c90481cc79e52a2973d31ea8553c2f' }
  const marketPack = plugins.find(plugin => plugin.id === 'community-dshmarket')
  const eacMarketPack = plugins.find(plugin => plugin.id === 'eac-community-market')
  for (const pack of [
    { id: 'eac-community-suite', name: 'EAC / AIO 完整整合包', description: '安装 EAC-Pack v0.2.1 的完整公开发行包，保留其组件兼容性守卫。', source: 'https://github.com/Ebony-Vinyl/EAC-Pack/releases/tag/v0.2.1', plugins: [eacPack] },
    ...(marketPack?.ref ? [{ id: 'community-market-starter', name: 'DSH 社区市场工作区', description: '官方内核与 DSH Market 的独立工作区。', source: 'https://github.com/dsh-market/dsh-market', plugins: [{ ref: marketPack.ref, ...(marketPack.sha256 ? { sha256: marketPack.sha256 } : {}) }] }] : []),
    ...(eacMarketPack?.ref ? [{ id: 'eac-market-starter', name: 'EAC 市场起步包', description: '官方 Harness 与 EAC 社区市场的最小组合，其余插件按需安装。', source: repository, plugins: [{ ref: eacMarketPack.ref, sha256: eacMarketPack.sha256 }] }] : []),
    { id: 'official-clean', name: '官方纯净工作区', description: '选定内核的独立 Web 实例，保持空插件集合。', source: 'https://github.com/deepseek-ai/deep-seek-harness', plugins: [] },
  ]) {
    if (packIds.has(pack.id)) continue
    packs.push(pack)
    packIds.add(pack.id)
  }
}
let packsAdded = 0
if (mojobox?.packs) {
  for (const pack of mojobox.packs) {
    const metadata = pack.metadata || {}
    if (!metadata.id || packIds.has(metadata.id)) continue
    const resolved = (pack.components || [])
      .map(component => refById.get(component.id))
      .filter(Boolean)
      .map(ref => ({ ref }))
    const missing = (pack.components || []).length - resolved.length
    packs.push({
      id: metadata.id,
      name: metadata.name,
      description: missing > 0
        ? `${metadata.description || ''}（${missing} 个组件暂无固定制品，仅安装已核实引用）`.trim()
        : metadata.description,
      source: pack.source || 'https://github.com/DSH-EAC/dsh-mojobox',
      plugins: resolved,
      mojobox: true,
    })
    packIds.add(metadata.id)
    packsAdded++
  }
}

if (catalogMeta) provenance.communityCatalog = catalogMeta
const catalog = {
  updatedAt: new Date().toISOString(),
  provenance,
  sources: [
    { id: 'eac-market', name: 'EAC 社区插件市场', url: repository, description: '固定提交目录，保留上游撤回与禁止安装状态' },
    { id: 'awesome-dsh', name: 'Awesome DSH 插件目录', url: catalogMeta?.source || 'https://awesome-dsh-plugin.com', description: 'npm 社区插件聚合目录（dsh-plugin-catalog 包）' },
    { id: 'eac-pack', name: 'EAC Pack', url: 'https://github.com/Ebony-Vinyl/EAC-Pack', description: 'EAC / AIO 套件与官方宿主适配记录' },
    { id: 'official', name: 'DeepSeek Harness', url: 'https://github.com/deepseek-ai/deep-seek-harness', description: '官方内核与桌面端' },
    { id: 'mojobox', name: 'DSH Mojobox', url: 'https://github.com/DSH-EAC/dsh-mojobox', description: '插件与整合包收录目录' },
    { id: 'dsh-desktop', name: 'DSH-Desktop 资产', url: desktopRepository, description: '桌面端仓库内维护的插件资产清单' },
    { id: 'tui', name: 'dsh-TUI', url: 'https://github.com/ccch1mneyyy/dsh-TUI', description: '独立终端体验与像素视觉参考' },
    { id: 'dshmarket', name: 'DSH Market', url: 'https://github.com/dsh-market/dsh-market', description: 'npm 固定版本社区市场' },
  ],
  plugins,
  packs,
}
for (const directory of ['resources', 'public']) {
  await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, directory, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
}
console.log(`Catalog: ${plugins.length} records; ${plugins.filter(p => p.installable).length} installable; ${packs.length} packs; +${desktopAdded} desktop assets; +${packsAdded} mojobox packs${catalogMeta ? `; community catalog ${catalogMeta.version}` : ''}${offlineReuse ? ' (offline reuse)' : ''}`)
