'use strict';

// EAC 升级路径 E2E：上一版本安装产物 → 本分支产物。
//
//   node scripts/e2e-upgrade.js --old-install <旧版安装目录> --new-install <新产物目录>
//       [--tag upgrade] [--probe] [--clean]
//
// 为什么需要它：fresh 安装只证明「空目录能起来」，不覆盖老用户升级。这里用旧版
// 安装目录建一份真实用户状态（配套插件、权限设置、会话），再用本分支产物覆盖
// 安装目录，验证升级后仍能启动、插件树完整、权限设置与会话都还在。
//
// 驱动方式：EAC 的宿主是 dsh web；日志写出 dsh web 的 URL + token，脚本据此
// 登录拿 cookie，再用 HTTP RPC（POST /api/<ns>/<method>，信封 client-request）
// 读写会话与设置 —— 与页面看到的同一套接口，不依赖 DOM 选择器。
//
// 隔离：安装目录复制到临时根，APPDATA / LOCALAPPDATA / TEMP 重定向到临时目录；
// DPX 环境因此落在临时 LOCALAPPDATA 下，真实用户数据与真实安装目录都不碰。

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync, execSync } = require('node:child_process');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes('--' + name);

const OLD_INSTALL = arg('old-install');
const NEW_INSTALL = arg('new-install');
const TAG = arg('tag', 'upgrade');
const PROBE = flag('probe');
const CLEAN = flag('clean');

const EXE_NAME = 'dsh-eac-shell.exe';
const RELEASE_ENTRIES = [EXE_NAME, 'dsh-desktop', 'sidecar', 'ui-skin-manager', 'dpx', 'WebView2Loader.dll'];

if (!OLD_INSTALL || !fs.existsSync(OLD_INSTALL)) {
  console.error('[e2e-up] --old-install 必须指向存在的旧版安装目录');
  process.exit(2);
}
if (!PROBE && (!NEW_INSTALL || !fs.existsSync(NEW_INSTALL))) {
  console.error('[e2e-up] --new-install 必须指向存在的新版产物目录');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tasklistPids(name) {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ' + name + '" /FO CSV /NH', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (m) pids.add(Number(m[2]));
    }
    return pids;
  } catch { return new Set(); }
}

function procAlive(pid) {
  try {
    const out = execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { encoding: 'utf8', windowsHide: true });
    return out.includes('"' + pid + '"');
  } catch { return false; }
}

// robocopy 返回码 < 8 都是成功变体。
function mirror(src, dst) {
  const r = spawnSync('robocopy', [src, dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/MT:16', '/R:1', '/W:1'], { windowsHide: true });
  if (r.status === null || r.status >= 8) throw new Error('robocopy 失败 status=' + r.status + ' ' + String(r.stderr || '').slice(0, 300));
}

// --- HTTP / RPC -------------------------------------------------------------

function httpRequest(urlStr, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let rpcSeq = 0;
async function rpc(origin, cookie, endpoint, args) {
  const payload = JSON.stringify({ type: 'client-request', rpcId: String(++rpcSeq), method: endpoint, payload: { args } });
  const r = await httpRequest(origin + '/api/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: payload,
  });
  if (r.status !== 200) throw new Error('RPC ' + endpoint + ' HTTP ' + r.status + ' ' + r.body.slice(0, 200));
  const j = JSON.parse(r.body);
  if (!j.result || j.result.ok !== true) throw new Error('RPC ' + endpoint + ' 失败: ' + JSON.stringify(j.result && j.result.error).slice(0, 300));
  return j.result.value;
}

async function login(origin, token) {
  const r = await httpRequest(origin + '/?token=' + encodeURIComponent(token));
  const cookies = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]);
  if (!cookies.length) throw new Error('登录未下发 cookie（status=' + r.status + '）');
  return cookies.join('; ');
}

// --- 数据根与日志 -----------------------------------------------------------

function dpxBase(root) {
  return path.join(root, 'appdata', 'Local', 'Deepseek Harness EAC', 'dpx', 'dsh-environments');
}

// 返回 { envDir, dshHome, webLog }：DPX 环境目录下最近写入的 dsh-web.log。
function findEnvironment(root) {
  const base = dpxBase(root);
  let names = [];
  try { names = fs.readdirSync(base); } catch { return null; }
  let best = null;
  for (const name of names) {
    const envDir = path.join(base, name);
    const dshHome = path.join(envDir, 'dsh-home');
    const webLog = path.join(envDir, 'appdata', 'Deepseek Harness EAC', 'logs', 'dsh-web.log');
    let mtime = 0;
    try { mtime = fs.statSync(webLog).mtimeMs; } catch { continue; }
    if (!best || mtime > best.mtime) best = { envDir, dshHome, webLog, mtime };
  }
  return best;
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function logSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// 等宿主就绪：只看本次启动之后追加的日志（sizeBefore 之前的内容属于上一次运行），
// 且 URL 真正可连才算就绪 —— 日志行可能先于监听完成写出。
async function waitDshWeb(root, child, timeoutMs, sizeBefore = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const env = findEnvironment(root);
    if (env) {
      let tail = '';
      try { tail = fs.readFileSync(env.webLog).subarray(Math.max(0, sizeBefore - 64)).toString('utf8'); } catch {}
      const hits = [...tail.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+))/g)];
      if (hits.length > 0) {
        const last = hits[hits.length - 1];
        const origin = 'http://127.0.0.1:' + last[2];
        const probeT = Date.now();
        while (Date.now() - probeT < 90000) {
          try {
            const r = await httpRequest(origin + '/?token=' + encodeURIComponent(last[3]));
            if (r.status === 200 || r.status === 303) {
              return { ...env, url: last[1], origin, token: last[3], elapsed: Math.round((Date.now() - t0) / 1000) };
            }
          } catch {}
          await sleep(1500);
        }
      }
    }
    if (child.exitCode !== null) break;
    await sleep(2000);
  }
  return null;
}

// --- 断言收集 ---------------------------------------------------------------

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✔ ' : '  ✖ ') + name + (detail && !ok ? ' — ' + detail : ''));
}

// --- 启动与退出 -------------------------------------------------------------

function appEnv(root) {
  const appdata = path.join(root, 'appdata', 'Roaming');
  const localappdata = path.join(root, 'appdata', 'Local');
  const temp = path.join(root, 'temp');
  for (const d of [appdata, localappdata, temp]) fs.mkdirSync(d, { recursive: true });
  return {
    ...process.env,
    APPDATA: appdata,
    LOCALAPPDATA: localappdata,
    TEMP: temp,
    TMP: temp,
    DSH_DESKTOP_SKIP_AUTO_UPDATE: '1',
    DSH_DESKTOP_SKIP_CLIENT_UPDATE: '1',
    DSH_DESKTOP_TEST_NO_SHORTCUTS: '1',
    NPM_CONFIG_REGISTRY: 'https://registry.npmmirror.com',
  };
}

function launch(exePath, env) {
  return spawn(exePath, [], { env, detached: false, stdio: 'ignore', windowsHide: true });
}

// 优雅退出：先发 WM_CLOSE（taskkill 不带 /F），超时再强杀进程树。
async function quitApp(child) {
  try { execSync('taskkill /PID ' + child.pid, { windowsHide: true, stdio: 'ignore' }); } catch {}
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && procAlive(child.pid)) await sleep(500);
  if (procAlive(child.pid)) {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { windowsHide: true, stdio: 'ignore' }); } catch {}
    await sleep(3000);
  }
  return !procAlive(child.pid);
}

// --- 用户状态快照 -----------------------------------------------------------

function profileDeps(dshHome) {
  const pkgPath = path.join(dshHome, 'profiles', 'web-desktop', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Object.keys(pkg.dependencies || {}).sort();
  } catch { return null; }
}

function profileBundles(dshHome) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dshHome, 'profiles', 'web-desktop', 'package.json'), 'utf8'));
    const bundles = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
    return Array.isArray(bundles) ? bundles : [];
  } catch { return []; }
}

function profilePatchPath(dshHome) {
  return path.join(dshHome, 'profiles', 'web-desktop', 'cordis.patch.yml');
}

// v6.0.1 的注册表在机器级目录；本版本在数据根内。升级必须把旧记录接管过去。
function legacyRegistryFile(env) {
  return path.join(env.LOCALAPPDATA, 'DSH', 'DPX', 'registry.json');
}

function migratedRegistryFile(env) {
  return path.join(env.LOCALAPPDATA, 'Deepseek Harness EAC', 'dpx', 'registry', 'registry.json');
}

function collectInstanceIds(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return ((j && j.environments) || []).map((r) => r && r.instance && r.instance.instanceId).filter(Boolean);
  } catch { return []; }
}

function sidecarLogFile(env) {
  return path.join(env.LOCALAPPDATA, 'Deepseek Harness EAC', 'logs', 'sidecar.log');
}

// 首启日志把「按机制的插件树变化」写成了固定句式：与内核不兼容被剥离、内置插件接管市场同名包。
// 升级后 profile 的依赖清单少掉的项，必须能从这两类记录里找到出处，否则就是真丢了。
function parseReplacements(text) {
  const stripped = new Map();
  const adopted = new Map();
  const reStrip = /已从 profile 剥离 \d+ 个与官方内核不兼容的 bundle: ([^（\n]+)/g;
  let m;
  while ((m = reStrip.exec(text))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (name) stripped.set(name, true);
    }
  }
  const reAdopt = /内置插件 (\S+) 已接管市场同名包/g;
  while ((m = reAdopt.exec(text))) adopted.set(m[1], true);
  return { stripped, adopted };
}

// patch 条目状态：有引用行且未禁用 = active；有引用行但 disabled；找不到引用行 = absent。
function patchEntryState(text, name) {
  const lines = text.split(/\r?\n/);
  const needles = ['name: "' + name + '"', "name: '" + name + "'"];
  for (let i = 0; i < lines.length; i += 1) {
    if (!needles.some((needle) => lines[i].includes(needle))) continue;
    let start = i;
    while (start > 0 && !/^\s*- [\w-]+:/.test(lines[start])) start -= 1;
    let end = i;
    while (end + 1 < lines.length && !/^\s*- /.test(lines[end + 1])) end += 1;
    return /disabled:\s*true/.test(lines.slice(start, end + 1).join('\n')) ? 'disabled' : 'active';
  }
  return 'absent';
}

function distVersion(installDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(installDir, 'dsh-desktop', 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

// --- 主流程 -----------------------------------------------------------------

async function main() {
  console.log('[e2e-up:' + TAG + '] old=' + OLD_INSTALL + (PROBE ? ' (probe)' : ' new=' + NEW_INSTALL));

  const already = tasklistPids(EXE_NAME);
  if (already.size > 0) {
    console.error('[e2e-up] 检测到 ' + EXE_NAME + ' 已在运行（PID ' + [...already].join(',') + '），请先退出');
    process.exit(2);
  }

  const rootArg = arg('root');
  const rootBase = process.env.DSH_E2E_ROOT || os.tmpdir();
  let root;
  if (rootArg) {
    // 复用现场：同一个数据根上重跑（调试用，省一次 4 分钟的全量复制）
    root = path.resolve(rootArg);
    fs.mkdirSync(root, { recursive: true });
  } else {
    fs.mkdirSync(rootBase, { recursive: true });
    root = fs.mkdtempSync(path.join(rootBase, 'dsh-e2e-up-' + TAG + '-'));
  }
  const appDir = path.join(root, 'app');
  const env = appEnv(root);
  console.log('[e2e-up] root=' + root);

  // 阶段 0：复制旧版安装目录 = 用户的既有安装（现场已可用则跳过）
  const rawReady = fs.existsSync(path.join(appDir, EXE_NAME)) && fs.existsSync(path.join(appDir, 'dsh-desktop', 'package.json'));
  const upgradeTarget = NEW_INSTALL ? distVersion(NEW_INSTALL) : null;
  // 副本已经是目标版本时不能当「旧版」复用：那样阶段 2 的版本变化断言会失真。
  const appReady = rawReady && (!upgradeTarget || distVersion(appDir) !== upgradeTarget);
  const dataDir = path.join(root, 'appdata', 'Local', 'Deepseek Harness EAC', 'dpx', 'dsh-environments');
  if (fs.existsSync(dataDir)) console.log('[e2e-up] 警告：现场数据目录已存在，阶段 1 的基线可能不是干净的旧版状态（需要干净基线请换新的 --root）');
  if (appReady) {
    console.log('[e2e-up] 复用现有安装副本（' + distVersion(appDir) + '）');
  } else {
    if (rawReady) console.log('[e2e-up] 现有副本已是升级后版本（' + upgradeTarget + '），重新复制旧版');
    const tCopy = Date.now();
    mirror(OLD_INSTALL, appDir);
    console.log('[e2e-up] 旧版安装已复制（' + Math.round((Date.now() - tCopy) / 1000) + 's）');
  }
  const oldVersion = distVersion(appDir);
  check('旧版安装版本号可读（' + oldVersion + '）', !!oldVersion, String(oldVersion));

  // 阶段 1：旧版首启，让它用自身产物建 profile / 同步插件
  const envBefore1 = findEnvironment(root);
  const sizeBefore1 = envBefore1 ? logSize(envBefore1.webLog) : 0;
  let child = launch(path.join(appDir, EXE_NAME), env);
  console.log('[e2e-up] 旧版已启动 pid=' + child.pid);
  let host = await waitDshWeb(root, child, 20 * 60 * 1000, sizeBefore1);
  check('旧版启动到宿主就绪（dsh web URL）', !!host, host ? 'port=' + new URL(host.origin).port + ' ' + host.elapsed + 's' : '超时 exit=' + child.exitCode);
  if (!host) {
    console.log('[e2e-up] 日志尾部：\n' + readText(host ? host.webLog : '') .slice(-3000));
    await quitApp(child);
    return finish(1, root);
  }

  const cookie = await login(host.origin, host.token);
  check('HTTP 会话已认证（token → cookie）', !!cookie);

  const depsOld = profileDeps(host.dshHome);
  check('旧版已建立 web-desktop profile（带插件依赖）', !!depsOld && depsOld.length > 0, 'deps=' + (depsOld ? depsOld.length : 'null'));

  // 用户自定义 1：权限预设（Read Only / Workspace Write / Full access）
  const permissionSet = await rpc(host.origin, cookie, 'settings/update', { ns: 'permission', patch: { defaultPreset: 'workspace-write' } });
  check('旧版写入权限设置（permission.defaultPreset=workspace-write）',
    !!permissionSet && !!permissionSet.user && permissionSet.user.defaultPreset === 'workspace-write',
    JSON.stringify(permissionSet && permissionSet.user));

  // 会话：显式建一个普通会话，作为升级后的恢复锚点
  const created = await rpc(host.origin, cookie, 'session/create', { request: {} });
  const before = await rpc(host.origin, cookie, 'session/list', { _request: {} });
  const sessionIdsBefore = (before.items || []).map((s) => s.sessionId);
  check('旧版已建立会话（session/create 后可在 list 中看到）',
    !!created && !!created.sessionId && sessionIdsBefore.includes(created.sessionId),
    'created=' + (created && created.sessionId) + ' listed=' + sessionIdsBefore.join(','));

  const patchBefore = readText(profilePatchPath(host.dshHome));
  const legacyRegistryIds = collectInstanceIds(legacyRegistryFile(env));
  const snapshot = { depsOld, sessionIdsBefore, patchBefore, version: oldVersion, legacyRegistryIds };
  console.log('[e2e-up] 基线：deps=' + (depsOld || []).length + ' 会话=' + sessionIdsBefore.length + ' patch=' + patchBefore.length + 'B 注册表=' + legacyRegistryIds.length + ' 条');

  const quitOk = await quitApp(child);
  check('旧版退出（主进程退出）', quitOk);

  if (PROBE) {
    console.log('[e2e-up] probe 结束，现场保留：' + root);
    return finish(results.some((r) => !r.ok) ? 1 : 0, root);
  }

  // 阶段 2：用本分支产物覆盖安装目录（= 用户升级），保留 DPX 用户数据
  for (const entry of RELEASE_ENTRIES) {
    const srcPath = path.join(NEW_INSTALL, entry);
    if (!fs.existsSync(srcPath)) throw new Error('新版产物缺少 ' + entry);
    const dstPath = path.join(appDir, entry);
    fs.rmSync(dstPath, { recursive: true, force: true });
    if (fs.statSync(srcPath).isDirectory()) mirror(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
  const newVersion = distVersion(appDir);
  check('安装目录已升级到新版（' + newVersion + '）', !!newVersion && newVersion !== oldVersion, 'old=' + oldVersion + ' new=' + newVersion);

  // 阶段 3：新版首启，同一个 DPX 数据根
  const envBefore2 = findEnvironment(root);
  const sizeBefore2 = envBefore2 ? logSize(envBefore2.webLog) : 0;
  child = launch(path.join(appDir, EXE_NAME), env);
  console.log('[e2e-up] 新版已启动 pid=' + child.pid);
  host = await waitDshWeb(root, child, 20 * 60 * 1000, sizeBefore2);
  check('升级后能启动到宿主就绪', !!host, host ? 'port=' + new URL(host.origin).port + ' ' + host.elapsed + 's' : '超时 exit=' + child.exitCode);
  if (!host) {
    console.log('[e2e-up] 日志尾部：\n' + readText(path.join(env.LOCALAPPDATA, 'Deepseek Harness EAC', 'dpx')).slice(-2000));
    await quitApp(child);
    return finish(1, root);
  }

  const cookie2 = await login(host.origin, host.token);
  check('升级后 HTTP 会话已认证', !!cookie2);

  // 断言 A：插件树完整 —— 旧依赖一个不少，剥离/接管项按机制记录
  const depsNew = profileDeps(host.dshHome);
  const missingDeps = (snapshot.depsOld || []).filter((d) => !(depsNew || []).includes(d));
  const patchNewText = readText(profilePatchPath(host.dshHome));
  const replaced = parseReplacements(readText(sidecarLogFile(env)));
  const unexplained = missingDeps.filter((d) => !replaced.stripped.has(d) && !replaced.adopted.has(d));
  check('插件树完整（旧依赖全部保留，剥离/接管项除外）',
    !!depsNew && unexplained.length === 0,
    'old=' + (snapshot.depsOld || []).length + ' new=' + (depsNew || []).length +
    ' 缺失=' + missingDeps.length + '（剥离 ' + replaced.stripped.size + ' / 接管 ' + replaced.adopted.size + '）' +
    (unexplained.length ? ' 未解释=' + unexplained.slice(0, 8).join(',') : ''));

  // 断言 A2：被剥离的 bundle 不再参与加载
  const stillActive = [];
  for (const name of replaced.stripped.keys()) {
    if (patchEntryState(patchNewText, name) === 'active') stillActive.push(name);
  }
  check('被剥离的 bundle 不再激活（patch 行不存在或 disabled）', stillActive.length === 0, stillActive.join(','));

  // 断言 A3：被内置接管的插件仍可加载（node_modules 副本在位 + patch 行激活）
  const bundlesNew = profileBundles(host.dshHome);
  const notProvided = [];
  for (const name of replaced.adopted.keys()) {
    const present = fs.existsSync(path.join(host.dshHome, 'profiles', 'web-desktop', 'node_modules', ...name.split('/')));
    const loadable = bundlesNew.includes(name) || patchEntryState(patchNewText, name) === 'active';
    if (!present || !loadable) notProvided.push(name + (present ? '(无加载入口)' : '(副本缺失)'));
  }
  check('被内置接管的插件仍可加载（副本在位 + patch 行激活）', notProvided.length === 0, notProvided.join(','));

  // 断言 B：权限设置保留（内核仍把它当 user 层值）
  const descAfter = await rpc(host.origin, cookie2, 'settings/describe', {});
  const permAfter = descAfter.namespaces.find((n) => n.ns === 'permission');
  check('权限设置保留（permission.defaultPreset 仍为 workspace-write）',
    !!permAfter && !!permAfter.user && permAfter.user.defaultPreset === 'workspace-write',
    JSON.stringify(permAfter && permAfter.user));

  // 断言 C：会话可恢复（升级前的会话仍能被宿主列出）
  const after = await rpc(host.origin, cookie2, 'session/list', { _request: {} });
  const sessionIdsAfter = (after.items || []).map((s) => s.sessionId);
  const lost = snapshot.sessionIdsBefore.filter((id) => !sessionIdsAfter.includes(id));
  check('会话可恢复（升级前的会话仍可列出）', lost.length === 0,
    'before=' + snapshot.sessionIdsBefore.length + ' after=' + sessionIdsAfter.length + ' 丢失=' + lost.join(','));

  // 断言 D：用户 patch 内容未被打回默认
  const patchAfter = readText(profilePatchPath(host.dshHome));
  check('用户配置文件仍在（cordis.patch.yml 未被清空）', patchAfter.length > 0 && patchAfter.length >= snapshot.patchBefore.length - 64,
    'before=' + snapshot.patchBefore.length + 'B after=' + patchAfter.length + 'B');

  // 断言 E：v6.0.1 的机器级注册表被接管进产品数据根
  // （没有接管时 dpx 会把已在的环境目录判成「别人的」，sidecar 直接 fail closed）
  const migratedIds = collectInstanceIds(migratedRegistryFile(env));
  const keptIds = (snapshot.legacyRegistryIds || []).filter((id) => migratedIds.includes(id));
  check('机器级注册表已接管（旧实例记录进入数据根注册表）',
    (snapshot.legacyRegistryIds || []).length > 0 && keptIds.length === (snapshot.legacyRegistryIds || []).length,
    'legacy=' + (snapshot.legacyRegistryIds || []).length + ' migrated=' + migratedIds.length + ' 保留=' + keptIds.length);

  const quitOk2 = await quitApp(child);
  check('新版退出（主进程退出）', quitOk2);

  return finish(results.some((r) => !r.ok) ? 1 : 0, root);
}

function finish(code, root) {
  const pass = results.filter((r) => r.ok).length;
  console.log('\n[e2e-up:' + TAG + '] 结果：' + pass + '/' + results.length + ' 通过');
  if (CLEAN && pass === results.length) {
    try { fs.rmSync(root, { recursive: true, force: true }); console.log('[e2e-up] 已清理现场'); } catch {}
  } else {
    console.log('[e2e-up] 现场保留：' + root);
  }
  process.exit(code);
}

main().catch((err) => {
  console.error('[e2e-up] 异常: ' + ((err && err.stack) || err));
  process.exit(1);
});
