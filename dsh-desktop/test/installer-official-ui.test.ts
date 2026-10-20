// 官方安装器 UI 复用契约（s7）——来源：MIT 仓库 deepseek-ai/deepseek-harness
// @ 477b4f420553e8a52c2fbccc464d7561b239c443（dsh-v0.1.7-rc.2）：
//   apps/desktop/installer/{pages.nsh,path.nsh,theme.nsh,strings.nsh,lifecycle.nsh}
//
// EAC 是 Tauri：官方 Electron 的自绘 nsDialogs 窗口（window-frame.cpp + GDI+
// 圆角绘制 + 600x600 无边框窗口）不能整体搬进 Tauri 的 NSIS 模板，只移植
// 「安装位置屏 + 收尾」的视觉/交互契约：
//   1. 安装位置屏文案与离开校验（DirText + DirVerify leave）；
//   2. 官方 path.nsh 的路径合法性规则（本地固定盘、非重解析点、非系统目录、
//      非保留设备名、空目录或已注册安装目录、可写、磁盘余量）；
//   3. 官方 theme.nsh 的 96-DPI 逻辑像素几何与亮/暗配色常量（Tauri MUI2
//      向导不能逐控件重绘，常量按原值保留并用于可用的 MUI 面）；
//   4. 收尾页「立即启动」勾选（官方默认勾选）与 EAC 字标替换官方品牌位图。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nsh = readFileSync(join(root, 'tauri-shell', 'installer-hooks.nsh'), 'utf8');
const conf = JSON.parse(readFileSync(join(root, 'tauri-shell', 'tauri.conf.json'), 'utf8')) as {
  productName: string;
  bundle: { windows: { nsis: { installMode: string; installerHooks: string } } };
};

const define = (name: string): string => {
  const m = nsh.match(new RegExp(`^\\s*!define\\s+${name}\\s+"?([^"\\r\\n]+)"?\\s*$`, 'm'));
  assert.ok(m, `缺少 !define ${name}`);
  return m[1]!.trim();
};
const langString = (name: string, lang: 'ENGLISH' | 'SIMPCHINESE'): string => {
  const m = nsh.match(new RegExp(`^\\s*LangString\\s+${name}\\s+\\$\\{LANG_${lang}\\}\\s+"([^"]*)"`, 'm'));
  assert.ok(m, `缺少 LangString ${name} (${lang})`);
  return m[1]!;
};
// 文案里的 ${DSH_*} 是编译期展开；断言用户实际看到的字标形态。
const expand = (text: string): string => text
  .replace(/\$\{DSH_PRODUCT_LABEL\}/g, define('DSH_PRODUCT_LABEL'))
  .replace(/\$\{DSH_WORDMARK\}/g, define('DSH_WORDMARK'));

test('官方来源定型：安装器 UI 契约标注 commit 钉版', () => {
  assert.match(nsh, /477b4f420553e8a52c2fbccc464d7561b239c443/, '必须标注官方来源 commit');
  assert.match(nsh, /apps\/desktop\/installer/, '必须标注官方 installer 源路径');
});

test('安装位置屏：DirText 文案 + 离开校验（官方 pages.nsh InstallerWelcomeLeave 等价面）', () => {
  assert.match(nsh, /!define\s+MUI_DIRECTORYPAGE_TEXT_TOP\s+"\$\(DSH_STR_LOCATION_TOP\)"/,
    '安装位置屏顶部文案须走官方等价 LangString');
  assert.match(nsh, /!define\s+MUI_DIRECTORYPAGE_TEXT_DESTINATION\s+"\$\(DSH_STR_LOCATION_DESTINATION\)"/,
    '目标目录标签须走官方等价 LangString');
  assert.match(nsh, /!define\s+MUI_DIRECTORYPAGE_VERIFYONLEAVE/,
    '离开安装位置屏前必须校验（官方 InstallerWelcomeLeave 的 Abort 语义）');
  // 英文 + 简体中文双语（Tauri 模板 languages = SimpChinese, English）。
  assert.ok(langString('DSH_STR_LOCATION_TOP', 'ENGLISH').length > 0);
  assert.ok(langString('DSH_STR_LOCATION_TOP', 'SIMPCHINESE').length > 0);
  assert.ok(langString('DSH_STR_LOCATION_DESTINATION', 'ENGLISH').length > 0);
  assert.ok(langString('DSH_STR_LOCATION_DESTINATION', 'SIMPCHINESE').length > 0);
  // 官方 path.nsh 的规则摘要必须出现在屏上（用户可预先自查）。
  const top = langString('DSH_STR_LOCATION_TOP', 'SIMPCHINESE');
  for (const token of ['固定', '安装目录', '特殊字符', '链接']) {
    assert.ok(top.includes(token), `中文安装位置说明应包含「${token}」规则：${top}`);
  }
});

test('官方几何/配色常量逐值移植（theme.nsh 96-DPI 逻辑像素 + GDI+ ARGB）', () => {
  const expected: [string, string][] = [
    ['DSH_INSTALLER_WINDOW_SIZE', '600'],
    ['DSH_INSTALLER_BRAND_Y', '174'],
    ['DSH_INSTALLER_BRAND_HEIGHT', '196'],
    ['DSH_INSTALLER_BUTTON_X', '240'],
    ['DSH_INSTALLER_BUTTON_Y', '490'],
    ['DSH_INSTALLER_BUTTON_WIDTH', '120'],
    ['DSH_INSTALLER_BUTTON_HEIGHT', '44'],
    ['DSH_INSTALLER_STATUS_Y', '512'],
    ['DSH_INSTALLER_STATUS_HEIGHT', '22'],
    ['DSH_INSTALLER_BUTTON_FONT_SIZE', '16'],
    ['DSH_INSTALLER_STATUS_FONT_SIZE', '14'],
    ['DSH_INSTALLER_FONT', 'Microsoft YaHei UI'],
    ['DSH_INSTALLER_PRIMARY', '0xFF0F1115'],
    ['DSH_INSTALLER_PRIMARY_HOVER', '0xFF2D3135'],
    ['DSH_INSTALLER_PRIMARY_PRESSED', '0xFF000000'],
    ['DSH_INSTALLER_CONTROL_HOVER', '0xFFEEF0F2'],
    ['DSH_INSTALLER_TRACK_COLOR', '0xFFE9ECF2'],
    ['DSH_INSTALLER_TEXT_COLORREF', '0x15110F'],
    ['DSH_INSTALLER_DARK_BG', '0xFF151517'],
    ['DSH_INSTALLER_DARK_TEXT', '0xFFFFFF'],
  ];
  for (const [name, value] of expected) {
    assert.equal(define(name), value, `${name} 必须与官方 theme.nsh 一致`);
  }
  // DPI 缩放规则：MulDiv(逻辑像素, 系统 DPI, 96)（官方 lifecycle.nsh InstallerGuiInit）。
  assert.match(nsh, /GetDeviceCaps\(p r\d+, i 88\)/, '须按 LOGPIXELSX(88) 探测 DPI');
  assert.match(nsh, /MulDiv\(i \$\{DSH_INSTALLER_WINDOW_SIZE\}, i \$DshInstallerDpi, i 96\)/,
    '官方 600 逻辑像素窗口须按 96-DPI 基准换算');
  assert.match(nsh, /!define\s+MUI_CUSTOMFUNCTION_GUIINIT\s+"DshOnGuiInit"/, '须在 GUI 初始化期注册 DPI/主题解析');
  assert.match(nsh, /Function\s+DshOnGuiInit/, 'GUI 初始化函数缺失');
});

test('主题开关沿用官方 /THEME=auto、/THEME=light、/THEME=dark（auto 读系统偏好）', () => {
  assert.match(nsh, /GetOptions\}\s+\$CMDLINE\s+"\/THEME="/, '须解析 /THEME= 开关');
  assert.match(nsh, /AppsUseLightTheme/, 'auto 须读 HKCU Personalize 的 AppsUseLightTheme');
  for (const lang of ['ENGLISH', 'SIMPCHINESE'] as const) {
    const message = langString('DSH_STR_THEME_ERROR', lang);
    for (const option of ['/THEME=auto', '/THEME=light', '/THEME=dark']) {
      assert.ok(message.includes(option), `${lang} 主题错误提示应列出 ${option}`);
    }
  }
  assert.match(nsh, /!macro\s+DSH_InstallLocationGuard[\s\S]*?DSH_ValidateThemeSwitch[\s\S]*?!macroend/,
    '静默安装也要校验主题开关（GUI 初始化不执行）');
  assert.match(nsh, /!insertmacro\s+DSH_NotifyPerMachineInstall/, '官方「仅当前用户」提示须接入 preflight');
});

test('EAC 字标替换官方品牌位图（不引入官方鲸鱼/Logo 资产，不收集视觉资产）', () => {
  assert.equal(define('DSH_WORDMARK'), 'EAC', '小字标必须是 EAC');
  assert.match(nsh, /!define\s+MUI_WELCOMEPAGE_TITLE\s+"\$\(DSH_STR_WELCOME_TITLE\)"/);
  assert.ok(expand(langString('DSH_STR_WELCOME_TITLE', 'ENGLISH')).includes('EAC'), '欢迎页标题须带 EAC 字标');
  assert.ok(expand(langString('DSH_STR_WELCOME_TITLE', 'SIMPCHINESE')).includes('EAC'), '欢迎页标题须带 EAC 字标');
  // 小字标：欢迎/收尾文案里的独立 EAC 行（官方品牌位图的文本替代）。
  assert.ok(expand(langString('DSH_STR_WELCOME_TEXT', 'ENGLISH')).includes('EAC'), '欢迎页文案须带 EAC 字标');
  assert.ok(expand(langString('DSH_STR_FINISH_TEXT', 'SIMPCHINESE')).includes('EAC'), '收尾页文案须带 EAC 字标');
  assert.equal(define('DSH_PRODUCT_LABEL'), conf.productName, '产品标签必须与 tauri.conf.json productName 一致');
  // 官方 installer/assets 下的位图一律不引用（用户要求：不复制官方品牌资产、不收集额外视觉资产）。
  for (const asset of ['brand-2x.bmp', 'brand-dark-2x.bmp', 'brand.bmp', 'brand-dark.bmp', 'uninstaller-sidebar.png', 'welcome-brand.svg']) {
    assert.ok(!nsh.includes(asset), `不得引用官方品牌资产 ${asset}`);
  }
  assert.doesNotMatch(nsh, /\bMUI_(?:WELCOMEFINISHPAGE_BITMAP|HEADERIMAGE|UNBITMAP)\b/, '不得新增位图面');
  assert.doesNotMatch(nsh, /whale|鲸/i, '不得出现官方鲸鱼品牌指涉');
});

test('安装位置校验规则逐条移植官方 path.nsh / InstallerPreflight', () => {
  // 长度与盘符形态：4..180、X:\ 三段校验。
  assert.equal(define('DSH_PATH_MIN_LENGTH'), '4');
  assert.equal(define('DSH_PATH_MAX_LENGTH'), '180');
  assert.match(nsh, /DSH_PATH_MIN_LENGTH[\s\S]{0,400}DSH_PATH_MAX_LENGTH/, '长度边界须成对使用');
  // 仅本地固定盘（GetDriveTypeW == DRIVE_FIXED）。
  assert.equal(define('DSH_DRIVE_FIXED'), '3');
  assert.match(nsh, /GetDriveTypeW/, '须判定盘符类型');
  // 重解析点/非目录：FILE_ATTRIBUTE_REPARSE_POINT 0x400 / DIRECTORY 0x10。
  assert.equal(define('DSH_FILE_ATTRIBUTE_REPARSE_POINT'), '0x400');
  assert.equal(define('DSH_FILE_ATTRIBUTE_DIRECTORY'), '0x10');
  assert.match(nsh, /GetFileAttributesW/, '须检测重解析点/目录属性');
  // 非法字符清单：官方 InstallerValidatePath 同一组（: * ? " < > | / 与控制字符）。
  // 管道符不能写字面量 —— installer-nsh-pipe 守护断言整份 nsh 零管道符（nsExec 直连
  // taskkill 的前提），故用 ASCII 124 经 IntFmt "%c" 构造（NSIS 文档同款用法
  // IntFmt $1 "%c" 0x41），再进同一张逐字符清单。
  const validateFn = nsh.match(/Function\s+DshValidateInstallLocation[\s\S]*?\nFunctionEnd/);
  assert.ok(validateFn, '缺少 DshValidateInstallLocation');
  const charScan = validateFn![0].match(/GetDriveTypeW[\s\S]*?; 逐级上溯父目录/);
  assert.ok(charScan, '缺少安装路径逐字符扫描段');
  assert.ok(!nsh.includes('|'), '本文件不得出现管道符字面量（installer-nsh-pipe 契约）');
  const pipeDecl = charScan![0].match(/IntFmt\s+\$(\d)\s+"%c"\s+124\b/);
  assert.ok(pipeDecl, '逐字符扫描段须含管道符（IntFmt "%c" 124 构造）——官方清单里有 |');
  assert.match(charScan![0], new RegExp(`\\$\\{OrIf\\}\\s+\\$2\\s*==\\s*\\$${pipeDecl![1]}\\b`),
    '管道符须与其余非法字符同列拒绝');
  for (const ch of [':', '*', '?', '"', '<', '>', '/']) {
    assert.ok(charScan![0].includes(`$2 == '${ch}'`), `非法字符清单缺少 ${ch}`);
  }
  // 保留设备名（含扩展名形态）。
  assert.match(nsh, /CON[\s\S]{0,80}PRN[\s\S]{0,80}AUX[\s\S]{0,80}NUL/, '须拒绝保留设备名 CON/PRN/AUX/NUL');
  assert.match(nsh, /COM[\s\S]{0,120}LPT/, '须拒绝 COM1-9 / LPT1-9');
  // 受保护根：不得直接装进 WINDIR / PROGRAMFILES / PROFILE / LOCALAPPDATA（其子目录允许）。
  for (const guard of ['$WINDIR', '$PROGRAMFILES32', '$PROGRAMFILES64', '$PROFILE', '$LOCALAPPDATA']) {
    assert.ok(nsh.includes(`"${guard}"`) || nsh.includes(guard), `须保护 ${guard}`);
  }
  assert.match(nsh, /GetParent/, '须逐级上溯父目录判定');
  // 全路径归一化 + 写入探针 + 磁盘余量。
  assert.match(nsh, /GetFullPathNameW/, '须归一化完整路径');
  assert.match(nsh, /GetTempFileNameW/, '须做可写探针');
  assert.match(nsh, /GetDiskFreeSpaceExW/, '须查磁盘余量');
  assert.match(nsh, /\$\{ESTIMATEDSIZE\}/, '磁盘余量须对比 Tauri 模板的安装体积估算');
  // 归属校验见下方「归属判定」专测：已注册判定的键集必须与 PREINSTALL 接管键集一致
  // （只认 SHCTX 一处会把 HKLM 残留 / identifier 键注册的旧装目录判成外部目录），
  // 且 InstallLocation 带引号（Tauri 模板写入 $\"$INSTDIR$\"）须剥引号后比较。
});

// 归属判定（官方 InstallerPreflight 的 EAC 裁定版）：
//   放行 = 空目录（新装）｜接管键集注册的安装目录｜含本产品主程序的旧壳目录；
//   其余非空目录一律拒绝（$(DSH_STR_PATH_OWNERSHIP)「请选择空文件夹，或原来的安装目录」）。
// 「接管键集」与 installer-takeover.test.ts 钉住的 DSH_TakeoverOldShell 同源：
// PREINSTALL 会静默卸载这些键注册的旧壳，故它们注册的目录就是本产品的合法落点。
// 漏掉任一键（尤其 HKLM / identifier 键）＝ 把「本来就是本产品装在那里的目录」
// 误判成外部目录而 fail-closed 挡死升级；只认 HKCU 一处正是官方原版形态
// （${OrIfNot}），照抄会破坏 EAC 接管语义（issue #224 perMachine 残留）。
test('归属判定：非空目录须为本产品目录（接管键集注册或含主程序），外部非空目录拒绝', () => {
  const preflight = nsh.match(/!macro\s+DSH_InstallPreflight[\s\S]*?!macroend/);
  assert.ok(preflight, '缺少 DSH_InstallPreflight');
  const body = preflight![0];
  // 键集比对：!insertmacro <MACRO> <HIVE> "<KEY>" 逐项对齐（SHCTX 在 currentUser
  // 安装模式下即 HKCU；${UNINSTKEY} 是 Tauri 模板的 ...\Uninstall\${PRODUCTNAME}）。
  const pairs = (text: string, macro: string): string[] =>
    [...text.matchAll(new RegExp(`!insertmacro\\s+${macro}\\s+(\\w+)\\s+"([^"]+)"`, 'g'))]
      .map((m) => `${m[1]}|${m[2]}`);
  const normalize = (pair: string): string => {
    const [hive, keyPath] = pair.split('|') as [string, string];
    const leaf = keyPath === '${UNINSTKEY}' ? conf.productName : keyPath.split('\\').pop()!;
    return `${hive === 'SHCTX' ? 'HKCU' : hive}|${leaf}`;
  };
  const takeover = pairs(nsh, 'DSH_TakeoverOldShell').map(normalize);
  assert.equal(takeover.length, 6, `接管键集应为 2 hive × 3 键名 = 6，实际 ${takeover.length}`);
  const ownership = pairs(body, 'DSH_OwnershipProbe').map(normalize);
  assert.deepEqual([...ownership].sort(), [...takeover].sort(),
    '归属探针键集须与接管键集逐项一致（漏 HKLM 残留 / identifier 键会误挡已注册目录）');
  // 探针须剥 InstallLocation 引号（Tauri 模板 WriteRegStr ... "$\"$INSTDIR$\""）。
  const probeMacro = nsh.match(/!macro\s+DSH_OwnershipProbe[\s\S]*?!macroend/);
  assert.ok(probeMacro, '缺少 DSH_OwnershipProbe 归属探针宏');
  assert.match(probeMacro![0], /StrCpy\s+\$6\s+\$5\s+1[\s\S]{0,200}StrCpy\s+\$5\s+\$5\s+""\s+1/,
    '探针须剥 InstallLocation 引号后比较');
  // 旧壳兜底：注册键被清理 / 卸载器缺失（接管宏按「脏键也接管」处理）时，含本产品
  // 主程序的目录仍可原地接管 —— 与已注册判定是 OR 关系（保留 AND 语义见下）。
  assert.match(body, /\$\{AndIfNot\}\s+\$\{FileExists\}\s+"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/,
    '须保留「含本产品主程序」的旧壳目录兜底（AND 语义：已注册目录 或 本产品目录）');
  // 拒绝：两个信号都不成立且目录非空 → 归属错误（绝不静默覆盖外部目录）。
  assert.match(body, /\$\{If\}\s+\$4\s*==\s*0[\s\S]{0,500}FindFirst[\s\S]{0,500}DSH_STR_PATH_OWNERSHIP/,
    '非注册且无本产品主程序的非空目录须 fail-closed 拒绝');
  assert.doesNotMatch(body, /\$\{OrIfNot\}/,
    '不得照抄官方 ${OrIfNot}：官方只认 HKCU 一处注册目录，会挡死 HKLM 残留旧壳接管');
});

test('preflight 在 PREINSTALL 内、写入与接管之前 fail-closed 执行', () => {
  const hook = nsh.match(/!macro\s+NSIS_HOOK_PREINSTALL[\s\S]*?!macroend/);
  assert.ok(hook, '缺少 NSIS_HOOK_PREINSTALL');
  const body = hook[0];
  assert.match(body, /!insertmacro\s+DSH_InstallLocationGuard/, 'PREINSTALL 须先校验安装位置');
  const guard = body.indexOf('DSH_InstallLocationGuard');
  const closed = body.indexOf('DSH_RequireClosed');
  assert.ok(guard >= 0 && closed > guard, '路径校验必须先于目标实例检查与接管');
  assert.match(nsh, /!macro\s+DSH_InstallLocationGuard[\s\S]*?SetErrorLevel\s+2[\s\S]*?Quit[\s\S]*?!macroend/,
    '校验失败须以错误码退出（官方 InstallerBeforeInstall 语义）');
  assert.match(nsh, /MessageBox\s+MB_ICONEXCLAMATION\s+"\$DshLocationError"\s+\/SD\s+IDOK/,
    '失败须弹本地化错误（单个图标位，避免管道符；静默安装 /SD 自动确认）');
});

test('收尾页复用官方「立即启动」勾选（官方默认勾选）与 EAC 收尾文案', () => {
  assert.match(nsh, /!define\s+MUI_FINISHPAGE_RUN_TEXT\s+"\$\(DSH_STR_LAUNCH_NOW\)"/);
  assert.ok(langString('DSH_STR_LAUNCH_NOW', 'ENGLISH').length > 0);
  assert.ok(langString('DSH_STR_LAUNCH_NOW', 'SIMPCHINESE').length > 0);
  assert.match(nsh, /!define\s+MUI_FINISHPAGE_TITLE\s+"\$\(DSH_STR_FINISH_TITLE\)"/);
  assert.match(nsh, /!define\s+MUI_FINISHPAGE_TEXT\s+"\$\(DSH_STR_FINISH_TEXT\)"/);
  assert.ok(expand(langString('DSH_STR_FINISH_TITLE', 'SIMPCHINESE')).includes('EAC'), '收尾页标题须带 EAC 字标');
  // MUI2 运行勾选默认勾选；显式 NOTCHECKED 会偏离官方默认态。
  assert.doesNotMatch(nsh, /MUI_FINISHPAGE_RUN_NOTCHECKED/, '不得把「立即启动」改成默认不勾选');
});

test('多语言与静默安装：每个用户可见串都有中英双语', () => {
  const names = [...nsh.matchAll(/LangString\s+(\w+)\s+\$\{LANG_(\w+)\}/g)];
  const byName = new Map<string, Set<string>>();
  for (const [, name, lang] of names) {
    const set = byName.get(name!) ?? new Set<string>();
    set.add(lang!);
    byName.set(name!, set);
  }
  const dshStrings = [...byName.entries()].filter(([name]) => name.startsWith('DSH_STR_'));
  assert.ok(dshStrings.length >= 8, `DSH_STR_* 串过少：${dshStrings.length}`);
  for (const [name, langs] of dshStrings) {
    assert.deepEqual([...langs].sort(), ['ENGLISH', 'SIMPCHINESE'], `${name} 缺中英双语`);
  }
});

test('安装器不落任何凭据（API Key 只在应用内经官方 credentials 面）', () => {
  assert.doesNotMatch(nsh, /WriteRegStr[^\r\n]*[Aa]pi[-_]?[Kk]ey/, '安装器不得写 API Key 注册表值');
  assert.doesNotMatch(nsh, /credentials\.set|apiKeyEnv|dsh-welcome:/, '安装器不得触碰官方账号/凭据协议');
  assert.doesNotMatch(nsh, /sk-[A-Za-z0-9]/, '安装器不得内嵌任何密钥样式字面量');
});

test('既有装配边界不被破坏：hook 文件仍由 tauri.conf.json 指定且安装模式为 currentUser', () => {
  assert.equal(conf.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser', '官方安装位置屏仅支持当前用户安装');
  assert.ok(langString('DSH_STR_PER_USER', 'SIMPCHINESE').includes('当前用户'), '须有官方「仅当前用户」提示');
});
