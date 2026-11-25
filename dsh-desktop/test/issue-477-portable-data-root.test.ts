import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  portableStorageBaseForExe,
  environmentProductRoot,
  environmentStorageRoot,
  environmentRegistryHome,
  environmentRoot,
} = require('../lib/desktop/environment.js') as typeof import('../lib/desktop/environment');
const {
  createDesktopPlatform,
} = require('../lib/desktop/platform.js') as typeof import('../lib/desktop/platform');
const {
  assertInstallBoundary,
  pathsOverlap,
} = require('../lib/desktop/update-backup.js') as typeof import('../lib/desktop/update-backup');

test('issue #477: 便携版自动派生同盘符兄弟数据目录，零写 C 盘且不与 installRoot 重叠', async () => {
  const tempParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eac-portable-477-')));
  try {
    const installDir = path.join(tempParent, 'Deepseek-Harness-EAC');
    fs.mkdirSync(installDir, { recursive: true });
    const exePath = path.join(installDir, 'dsh-eac-shell.exe');
    fs.writeFileSync(exePath, 'stub');
    fs.writeFileSync(path.join(installDir, '.dsh-portable'), '');

    const env: NodeJS.ProcessEnv = {
      DSH_SHELL_EXE: exePath,
      USERPROFILE: 'C:\\Users\\User',
      LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local',
      APPDATA: 'C:\\Users\\User\\AppData\\Roaming',
    };

    const portableBase = portableStorageBaseForExe(exePath, 'win32');
    assert.equal(portableBase, path.win32.join(tempParent, 'Deepseek-Harness-EAC-data'));

    const productRoot = environmentProductRoot(env, 'win32');
    const storageRoot = environmentStorageRoot(env, 'win32');
    const envRoot = environmentRoot(env, 'win32');
    const registryHome = environmentRegistryHome(env, 'win32');
    const userDataDir = createDesktopPlatform({ platform: 'win32', env, homeDir: 'C:\\Users\\User' }).userDataDir();

    assert.equal(productRoot, path.win32.join(tempParent, 'Deepseek-Harness-EAC-data', 'data'));
    assert.equal(storageRoot, path.win32.join(productRoot, 'dpx'));
    assert.equal(envRoot, path.win32.join(storageRoot, 'dsh-environments', 'eac-stable'));
    assert.equal(registryHome, path.win32.join(productRoot, 'dpx', 'registry'));
    assert.equal(userDataDir, path.win32.join(tempParent, 'Deepseek-Harness-EAC-data', 'desktop'));

    // 确保所有便携路径均不指向虚构 C 盘宿主目录（含 L2 userDataDir，零写 APPDATA）
    for (const target of [productRoot, storageRoot, envRoot, registryHome, userDataDir]) {
      assert.ok(!target.startsWith('C:\\Users\\User'), `路径不得回落 C 盘用户目录: ${target}`);
    }

    // 在 Windows 宿主上实测客户端自更新边界门禁 assertInstallBoundary 100% 放行
    if (process.platform === 'win32') {
      const siblingRoots = [
        productRoot,
        storageRoot,
        envRoot,
        registryHome,
        userDataDir,
        path.join(portableBase!, 'config'),
        path.join(portableBase!, 'webview'),
        path.join(portableBase!, 'guests'),
      ];
      for (const p of siblingRoots) {
        assert.equal(pathsOverlap(installDir, p), false, `不得与安装目录重叠: ${p}`);
      }
      await assertInstallBoundary(installDir, siblingRoots);
    }
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});

test('issue #477: 非便携版、盘符根目录或显式 DSH_EAC_DATA_ROOT 保持原有语义', () => {
  // 1) 无 .dsh-portable 标记（NSIS 安装版）-> 回落 LOCALAPPDATA
  const nsisExe = 'C:\\Program Files\\Deepseek Harness EAC\\dsh-eac-shell.exe';
  assert.equal(portableStorageBaseForExe(nsisExe, 'win32', () => false), null);
  assert.equal(
    environmentProductRoot(
      { DSH_SHELL_EXE: nsisExe, LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local' },
      'win32',
      () => false,
    ),
    'C:\\Users\\User\\AppData\\Local\\Deepseek Harness EAC',
  );

  // 2) 直接裸放在盘符根 Z:\dsh-eac-shell.exe（无上层父目录可建同卷兄弟）-> 安全回退默认
  assert.equal(portableStorageBaseForExe('Z:\\dsh-eac-shell.exe', 'win32', () => true), null);

  // 3) 显式注入 DSH_EAC_DATA_ROOT -> 权威值优先
  const portableExe = 'Z:\\PortableApps\\Deepseek-Harness-EAC\\dsh-eac-shell.exe';
  assert.equal(
    environmentProductRoot(
      {
        DSH_SHELL_EXE: portableExe,
        DSH_EAC_DATA_ROOT: 'D:\\ExplicitRoot',
        LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local',
      },
      'win32',
      () => true,
    ),
    'D:\\ExplicitRoot',
  );
});
