import fs = require('node:fs/promises');
import path = require('node:path');
import { verifyMinisign } from './update-signature';

export type SourceId = 'github' | 'gitee' | 'local' | 'custom';
export type InstallKind = 'nsis' | 'portable' | 'appimage' | 'deb' | 'rpm';
export interface UpdateDefaults {
  schemaVersion: 1;
  github: {repo: string};
  gitee: {repo: string};
  geoUrl: string;
  trustedKeys: Record<string, string>;
}
export interface SourceSelection {
  schemaVersion: 1;
  releaseChannel: 'stable';
  selectionMode: 'auto' | 'manual';
  preferredSourceId: SourceId;
  geoCountry: string | null;
  geoDetectedAt: string | null;
  localPath: string;
  customUrl: string;
}
export interface Artifact {
  target: string;
  installKind: InstallKind;
  url: string;
  size: number;
  sha256: string;
  signature: string;
}
export interface Manifest {
  schemaVersion: 1;
  product: 'eac-desktop';
  releaseChannel: 'stable';
  version: string;
  publishedAt: string;
  artifacts: Artifact[];
}
export interface ResolvedUpdate {
  envelope?: unknown;
  manifest: Manifest;
  artifact: Artifact;
  sourceId: SourceId;
  location: string;
  keyId: string;
  notice: string;
}
export type ReadRemote = (url: string, signal: AbortSignal) => Promise<unknown>;
const IDS: SourceId[] = ['github', 'gitee', 'local', 'custom'];
const KINDS: InstallKind[] = ['nsis', 'portable', 'appimage', 'deb', 'rpm'];
export function initialSelection(): SourceSelection {
  return {schemaVersion: 1, releaseChannel: 'stable', selectionMode: 'auto', preferredSourceId: 'github',
    geoCountry: null, geoDetectedAt: null, localPath: '', customUrl: ''};
}
export function parseSelection(value: unknown): SourceSelection {
  if (!value || typeof value !== 'object') throw new Error('invalid-source-settings');
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.releaseChannel !== 'stable'
    || !['auto', 'manual'].includes(String(v.selectionMode)) || !IDS.includes(v.preferredSourceId as SourceId)) throw new Error('invalid-source-settings');
  for (const field of ['localPath', 'customUrl']) if (typeof v[field] !== 'string') throw new Error('invalid-source-settings');
  if (v.customUrl) httpsUrl(String(v.customUrl));
  if (v.geoCountry !== null && !/^[A-Z]{2}$/.test(String(v.geoCountry))) throw new Error('invalid-geo-country');
  if (v.geoDetectedAt !== null && (typeof v.geoDetectedAt !== 'string' || !Number.isFinite(Date.parse(v.geoDetectedAt)))) throw new Error('invalid-geo-date');
  return {schemaVersion: 1, releaseChannel: 'stable', selectionMode: v.selectionMode as SourceSelection['selectionMode'],
    preferredSourceId: v.preferredSourceId as SourceId, localPath: String(v.localPath), customUrl: String(v.customUrl),
    geoCountry: v.geoCountry as string | null, geoDetectedAt: v.geoDetectedAt as string | null};
}
export function httpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('source-requires-https');
  return url.href;
}
export function stableVersion(value: string): number[] {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!match) throw new Error('stable-version-required');
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('invalid-version');
  return parts;
}
export function compareVersion(a: string, b: string): number {
  const av = stableVersion(a); const bv = stableVersion(b);
  for (let i = 0; i < 3; i++) { if (av[i] !== bv[i]) return av[i]! > bv[i]! ? 1 : -1; }
  return 0;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-manifest');
  return value as Record<string, unknown>;
}
export function verifyManifest(envelope: unknown, defaults: UpdateDefaults): {manifest: Manifest; keyId: string} {
  const e = record(envelope);
  if (e.schemaVersion !== 1 || typeof e.keyId !== 'string' || typeof e.payload !== 'string' || typeof e.signature !== 'string') throw new Error('invalid-signed-envelope');
  const key = Object.hasOwn(defaults.trustedKeys, e.keyId) ? defaults.trustedKeys[e.keyId] : undefined;
  if (!key) throw new Error('untrusted-update-key');
  if (e.payload.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.payload)) throw new Error('invalid-manifest-payload');
  const payload = Buffer.from(e.payload, 'base64');
  verifyMinisign(payload, e.signature, key);
  const signed = record(JSON.parse(payload.toString('utf8')));
  let m = signed;
  if (Object.hasOwn(signed,'platforms')) {
    if (signed.product !== 'com.deepseek.dsh.desktop.tauri' || signed.channel !== 'stable' || Object.hasOwn(signed,'artifacts') || Object.hasOwn(signed,'releaseChannel')) throw new Error('invalid-manifest');
    const platforms = record(signed.platforms);
    m = {...signed, product:'eac-desktop', releaseChannel:'stable', artifacts:Object.entries(platforms).map(([target, value])=>{
      const artifact=record(value);
      if(Object.hasOwn(artifact,'target') || Object.hasOwn(artifact,'installKind'))throw new Error('invalid-artifact');
      return {...artifact,target,installKind:target.slice(target.lastIndexOf('-')+1)};
    })};
  }
  if (m.schemaVersion !== 1 || m.product !== 'eac-desktop' || m.releaseChannel !== 'stable' || typeof m.version !== 'string'
    || typeof m.publishedAt !== 'string' || !Number.isFinite(Date.parse(m.publishedAt)) || !Array.isArray(m.artifacts) || !m.artifacts.length) throw new Error('invalid-manifest');
  stableVersion(m.version);
  const seen = new Set<string>();
  const artifacts: Artifact[] = m.artifacts.map(item => {
    const a = record(item);
    if (typeof a.target !== 'string' || !/^(windows|linux)-(x86_64|aarch64)-(nsis|portable|appimage|deb|rpm)$/.test(a.target)
      || !KINDS.includes(a.installKind as InstallKind) || !a.target.endsWith('-' + String(a.installKind))
      || (a.target.startsWith('windows-') !== ['nsis', 'portable'].includes(String(a.installKind)))
      || typeof a.url !== 'string' || !a.url || !Number.isSafeInteger(a.size) || Number(a.size) <= 0
      || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || typeof a.signature !== 'string') throw new Error('invalid-artifact');
    if (seen.has(a.target)) throw new Error('duplicate-artifact-target'); seen.add(a.target);
    return {target: a.target, installKind: a.installKind as InstallKind, url: a.url,
      size: Number(a.size), sha256: a.sha256, signature: a.signature};
  });
  return {manifest: {schemaVersion: 1, product: 'eac-desktop', releaseChannel: 'stable', version: m.version,
    publishedAt: m.publishedAt, artifacts}, keyId: e.keyId};
}
export async function localFile(root: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.' || !part)
    || /[:\x00]/.test(relative)) throw new Error('local-path-escape');
  const canonicalRoot = await fs.realpath(root);
  // Refuse links in every component, including the selected root.
  const absoluteRoot = path.resolve(root);
  let ancestor = path.parse(absoluteRoot).root;
  for (const component of absoluteRoot.slice(ancestor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, component);
    if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('local-source-link');
  }
  let candidate = canonicalRoot;
  for (const component of relative.split('/')) {
    candidate = path.join(candidate, component);
    if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error('local-source-link');
  }
  const real = await fs.realpath(candidate);
  const rel = path.relative(canonicalRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !(await fs.stat(real)).isFile()) throw new Error('local-path-escape');
  return real;
}
export async function fetchUpdate(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
  let endpoint = httpsUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(endpoint, {signal, redirect: 'manual', headers});
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('update-redirect-without-location');
    endpoint = httpsUrl(new URL(location, endpoint).href);
  }
  throw new Error('update-redirect-limit');
}
export async function readRemoteJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetchUpdate(url, AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    {'Accept': 'application/json', 'User-Agent': 'EAC-Desktop-Updater'});
  httpsUrl(response.url);
  if (!response.ok || !response.body) throw new Error('update-source-http-' + response.status);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('update-metadata-too-large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function autoSelect(defaults: UpdateDefaults, read: ReadRemote, signal: AbortSignal): Promise<SourceSelection> {
  const selection = initialSelection();
  if (!defaults.geoUrl) return selection;
  let country: string | null = null;
  try { const result = record(await read(httpsUrl(defaults.geoUrl), AbortSignal.any([signal, AbortSignal.timeout(3000)])));
    if (typeof result.country === 'string' && /^[A-Z]{2}$/.test(result.country)) country = result.country;
  } catch { /* Unknown exit region uses GitHub without delaying startup. */ }
  if (signal.aborted) throw signal.reason;
  selection.geoCountry = country; selection.geoDetectedAt = new Date().toISOString();
  selection.preferredSourceId = country === 'CN' ? 'gitee' : 'github'; return selection;
}
export function effectiveSource(selection: SourceSelection, defaults: UpdateDefaults): {id: SourceId; notice: string} {
  if (selection.preferredSourceId === 'gitee' && !defaults.gitee.repo) {
    if (selection.selectionMode === 'manual') throw new Error('gitee-not-configured');
    return {id: 'github', notice: 'Gitee 暂未配置，当前使用 GitHub'};
  }
  return {id: selection.preferredSourceId, notice: ''};
}
export async function resolveUpdate(selection: SourceSelection, defaults: UpdateDefaults, currentVersion: string,
  target: string, signal: AbortSignal, read: ReadRemote = readRemoteJson): Promise<ResolvedUpdate | null> {
  const effective = effectiveSource(selection, defaults);
  const resolveEnvelope = async (envelope: unknown, base: string, releaseVersion?: string): Promise<ResolvedUpdate | null> => {
    const verified = verifyManifest(envelope, defaults);
    if (releaseVersion && verified.manifest.version !== releaseVersion) throw new Error('release-manifest-version-mismatch');
    if (compareVersion(verified.manifest.version, currentVersion) <= 0) return null;
    const artifact = verified.manifest.artifacts.find(a => a.target === target);
    if (!artifact) return null;
    const location = effective.id === 'local' ? await localFile(base, artifact.url) : httpsUrl(new URL(artifact.url, base).href);
    return {envelope: JSON.parse(JSON.stringify(envelope)), manifest: verified.manifest, artifact, sourceId: effective.id, location, keyId: verified.keyId, notice: effective.notice};
  };
  if (effective.id === 'local') {
    const chosen = path.resolve(selection.localPath);
    if (!selection.localPath) throw new Error('local-source-not-configured');
    const stat = await fs.lstat(chosen);
    const root = stat.isDirectory() ? chosen : path.dirname(chosen);
    const manifestPath = await localFile(root, stat.isDirectory() ? 'stable.json' : path.basename(chosen));
    if ((await fs.stat(manifestPath)).size > 2 * 1024 * 1024) throw new Error('update-metadata-too-large');
    return resolveEnvelope(JSON.parse(await fs.readFile(manifestPath, 'utf8')), root);
  }
  if (effective.id === 'custom') {
    if (!selection.customUrl) throw new Error('custom-source-not-configured');
    const endpoint = httpsUrl(selection.customUrl);
    return resolveEnvelope(await read(endpoint, signal), endpoint);
  }
  const repo = defaults[effective.id].repo;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid-official-repo');
  const base = effective.id === 'github' ? 'https://api.github.com/repos/' : 'https://gitee.com/api/v5/repos/';
  let best: ResolvedUpdate | null = null;
  // Pagination is bounded; the API cannot keep this operation alive indefinitely.
  for (let page = 1; page <= 10; page++) {
    const releases = await read(base + repo + '/releases?per_page=100&page=' + page, signal);
    if (!Array.isArray(releases)) throw new Error('invalid-release-list');
    for (const value of releases) {
      const release = record(value);
      if (release.draft === true || release.prerelease === true || typeof release.tag_name !== 'string') continue;
      const match = /^v?((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/i.exec(release.tag_name);
      if (!match || compareVersion(match[1]!, currentVersion) <= 0) continue;
      const assets = Array.isArray(release.assets) ? release.assets
        : effective.id === 'gitee' && release.assets && typeof release.assets === 'object'
          ? record(release.assets).links : undefined;
      if (!Array.isArray(assets)) continue;
      const asset = assets.map(record).find(a => a.name === 'stable.json');
      if (!asset) continue;
      const endpoint = httpsUrl(String(asset.browser_download_url || asset.download_url || asset.url || ''));
      const update = await resolveEnvelope(await read(endpoint, signal), endpoint, match[1]!);
      if (update && (!best || compareVersion(update.manifest.version, best.manifest.version) > 0)) best = update;
    }
    if (releases.length < 100) break;
    if (page === 10) throw new Error('release-pagination-limit');
  }
  return best;
}
