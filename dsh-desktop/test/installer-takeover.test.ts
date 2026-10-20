// Tauri 安装器旧版本接管（tauri-shell/installer-hooks.nsh；原 Electron
// build/installer.nsh 契约随壳退役，接管为 hooks 等价断言）：
//  1. 接管 = 自静默卸载旧壳（HKCU/HKLM 双 hive × 三个候选卸载键全覆盖），
//     卸载器缺失的脏键仅清理注册表，绝不让安装流程卡死（issue #7/#8 的
//     Tauri 版本）；
//  2. UninstallString 剥引号 + 安装目录尾反斜杠剥除（R6 实测复现）；
//  3. 拒绝仍占用目标路径的实例；UPDATE 不重复执行历史卸载。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const nsh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tauri-shell', 'installer-hooks.nsh'), 'utf8');

test('接管旧壳：HKCU/HKLM 双 hive × 三个候选卸载键全覆盖', () => {
  const takes = nsh.match(/!insertmacro DSH_TakeoverOldShell \w+ "[^"]+"/g) || [];
  assert.equal(takes.length, 6, `应接管 6 次（2 hive × 3 键），实际 ${takes.length}`);
  for (const key of ['Deepseek Harness EAC', 'com.deepseek.dsh.desktop', 'com.deepseek.dsh.desktop.tauri']) {
    assert.ok(takes.some((t) => t.startsWith('!insertmacro DSH_TakeoverOldShell HKCU "' + key + '"')), `HKCU ${key} 缺失`);
    assert.ok(takes.some((t) => t.startsWith('!insertmacro DSH_TakeoverOldShell HKLM "' + key + '"')), `HKLM ${key} 缺失`);
  }
});

test('接管落点：读旧壳卸载信息并清理注册表脏键', () => {
  assert.match(nsh, /ReadRegStr\s+\$0\s+\$\{HIVE\}.*UninstallString/, '应读取 UninstallString');
  assert.match(nsh, /DeleteRegKey\s+\$\{HIVE\}.*Uninstall\\\$\{KEYNAME\}/, '应清理旧壳卸载键');
});

test('卸载器路径剥引号 + 安装目录尾反斜杠防御（R6 实测契约）', () => {
  assert.match(nsh, /StrCpy \$4 \$3 1/, '应取首字符判引号');
  assert.match(nsh, /StrCpy \$3 \$3 "" 1/, '应剥 UninstallString 引号');
  assert.match(nsh, /StrCpy \$2 \$1 1 -1/, '应剥 InstallLocation 尾反斜杠');
  assert.ok(nsh.includes('_?='), '卸载器目录参数必须裸写 _?=（不加引号，实测退出码 2 事故回归）');
});

test('UPDATE skips legacy takeover and native installations never run the legacy uninstaller',()=>{
 const hook=nsh.match(/!macro NSIS_HOOK_PREINSTALL([\s\S]*?)!macroend/)[1];
 assert.match(hook,/\$UpdateMode <> 1[\s\S]*DSH_TakeoverOldShell/);
 assert.match(nsh,/FileExists.*\$1\\dsh-eac-shell\.exe[\s\S]*skipping legacy takeover/);
 assert.match(nsh,/ExecWait '"\$3" \/S \/UPDATE _\?=\$1'/);
 assert.doesNotMatch(nsh,/taskkill|KillProcess/);
});

test('当前安装器交付 EAC Lite，Full 需要实际安装 EAC-Pack', () => {
  const ask = nsh.match(/!macro DSH_AskInstallProfile([\s\S]*?)!macroend/)?.[1];
  assert.ok(ask, '应保留安装形态元数据初始化');
  assert.doesNotMatch(ask, /MessageBox|多智能体|手机桥|桌宠/, '基础安装包不得承诺未随包的外围插件或展示无效选择');
  assert.match(ask, /StrCpy \$DshProfileChoice "full"/, '只初始化既有兼容标记，不改变 profile 布局');
  assert.match(ask, /安装 EAC Lite/, '当前仓库的完整产物是 EAC Lite');
  assert.match(ask, /Full 需另行安装 EAC-Pack 包/, 'Full 不能由历史 full 标记或启用未安装插件获得');
  assert.ok(nsh.includes('兼容启停策略标记 = $DshProfileChoice（不代表 Full 已安装）'), '详情不能将兼容标记显示为产品档位');
});
