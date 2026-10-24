window.__ModuleLoader__.load({
	id: "dsh-plugin-wallpaper-engine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		// Portal for the wallpaper picker modal. react-dom is registered in the DSH
		// client module loader (see @deepseek-ai/dsh-client-web), so out-of-tree client
		// bundles can require it just like "react".
		const ReactDOM = require("react-dom");

		const SETTINGS_KEY = "dsh-wallpaper-engine:selection";
		// Host-sourced settings: the same-origin route the browser half uses to read
		// and write its persisted settings. The host stores them in a plain file
		// (~/.dsh-wallpaper-engine/config.json), which is PORT-INDEPENDENT — unlike
		// localStorage, which is origin-scoped and therefore reset whenever DSH
		// Desktop restarts on a new random --port 0 loopback port.
		const SETTINGS_URL = "/wallpaper-engine/settings";
		const INVENTORY_URL = "/wallpaper-engine/inventory";
		// Body attribute set while a wallpaper is active; CSS uses it to make the frame
		// background transparent so the behind-body layer shows through.
		const ACTIVE_ATTR = "data-we-wallpaper";
		const LAYER_ID = "dsh-wallpaper-engine-layer";
		const SCRIM_ID = "dsh-wallpaper-engine-scrim";
		// Chat-interface rope dock: a draggable pull-cord floating over the chat plus
		// the glass repo side panel it pulls out. Both are portalled onto <body> under
		// their own React root (see apply), independent of the settings view.
		const ROPE_DOCK_ID = "dsh-wallpaper-engine-rope-dock";
		const ROPE_POS_KEY = "dsh-wallpaper-engine:rope-pos";

		// ── Defaults ─────────────────────────────────────────────────────────────────
		// scrim default is intentionally LOW now: iOS liquid glass needs the wallpaper
		// colour to pass through the glass, so we no longer crush it behind a near-black
		// scrim. Users can raise it back via the 暗化 slider for busy wallpapers.
		const DEFAULTS = {
		  scrim: 0.25,
		  border: 0.35,
		  blur: 16,
		  wallpaperBlur: 0,
		  // Background knobs (%, 100 = untouched): brightness / contrast / saturate of
		  // the wallpaper media filter. Ranges mirror the readability lab.
		  backgroundBrightness: 100,
		  backgroundContrast: 100,
		  backgroundSaturate: 100,
		  rotationEnabled: false,
		  rotationInterval: 30,
		  rotationGroupId: "",
		  rotationGroups: [],
		  rotationSeeded: false,
		  // Soft-delete: ids of wallpapers the user hid (localStorage only, no file
		  // changes). Hidden wallpapers leave the normal list + rotation candidates
		  // but keep playing if already active; they reappear on restore.
		  hiddenIds: [],
		  // Video playback speed (0.5x–2x, applied via native playbackRate).
		  playbackRate: 1,
		  // 解码帧率上限（fps；0 = 无限制）：对源帧率高于上限的视频壁纸，host 一次性
		  // ffmpeg 重编码为上限帧率的"抽帧版"（4K120→4K60，时间线保持 1.0x 正常速度，
		  // 解码占用随帧率线性下降）。与倍速完全解耦 —— 倍速照常叠加在抽帧版上。
		  // 无 ffmpeg 或转码失败时自动回退原片（transcodeState: "fallback"）。
		  fpsCap: 0,
		  // Scene 壁纸动画化: 静态帧的 frameUrl (供 fpsCap 变更时重渲染动画) + 渲染进度
		  // (0-100; 后台渲染 scene-anim 视频期间轮询, 完成置 null)。
		  sceneFrameUrl: null,
		  sceneAnimProgress: null,
		  // beta场景动画: 默认关闭 — 关闭时 scene 壁纸只渲染静态帧 (稳定), 不启动
		  // scene-anim 视频后台渲染; 开启后才走动画化升级 (CPU 渲染试验性, 可能有
		  // 组件错误), 渲染期间进度条 + 完成自动切换视频。
		  betaSceneAnim: false,
		  // 遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」——桌面端大部分时间
		  // GPU≈0 主因就是它）：
		  // - pauseOnHidden：页面隐藏（窗口最小化 / 切到其它标签页）时暂停视频。
		  //   浏览器对后台页的节流并不保证解码停止，显式 pause 让解码引擎直接归零。
		  // - pauseOnBlur：窗口失焦（切到其它应用，壁纸很可能被遮挡）时暂停。
		  //   浏览器无法直接探测"被窗口遮挡"，失焦是最接近的代理信号。
		  // 恢复可见 / 聚焦后，若用户未手动暂停则自动继续（同步 effective 播放态）。
		  pauseOnHidden: true,
		  pauseOnBlur: false,
		  // 使用电池供电时暂停（类似 WE 的电池优化）：navigator.getBattery 判定
		  // 是否在电池上（!charging），不支持的浏览器自动无操作。
		  pauseOnBattery: false,
		  // Horizontal mirror (CSS scaleX(-1)) — pure compositor, no main-thread cost.
		  flip: false,
		  // Fit mode for CUSTOM-uploaded wallpapers only (WE wallpapers keep cover):
		  // 覆盖=cover · 填充=contain · 居中=center · 拉伸=fill (one object-fit var).
		  objectFit: "cover",
		  // Content-rating filter, reproducing Wallpaper Engine's own rating taxonomy
		  // (project.json `contentrating`: "Everyone" / "PG13" / "Mature" — WE's
		  // workshop tags G / PG13 / R; projects without the field are "unrated").
		  // "everyone" is the default, matching WE's conservative first-run stance.
		  contentRatingFilter: "everyone",
		  // Wallpaper-type filter (all / video / web / image / scene). "all" disables it.
		  typeFilter: "all",
		  // Thumbnail-card style: "classic" (WE's original aspect-ratio 16/9 cards —
		  // the CD-like look the author liked; can overlap in older browsers) or
		  // "fixed" (rewritten fixed-height cards that never overlap). The vinyl
		  // record next to the selection is shown in BOTH styles (here + modal head).
		  pickerLayout: "fixed",
		  // Edge 兼容渲染：Edge（且仅 Edge）会在任何"可见的 <video>"上绘制浏览器
		  // 自带的「下载 / 投屏」悬浮工具栏且无官方开关，故默认在 Edge 中把视频壁纸
		  // 改为 canvas 渲染（见 IS_EDGE / weStartDraw）；关闭后所有浏览器一律使用
		  // 原生 <video>（Edge 上悬浮栏会重新出现，属预期）。
		  edgeCompat: true,
		  // Settings-page liquid-glass theming:
		  // - accent: the plugin's own accent color (#rrggbb), written to --we-accent
		  //   and consumed by buttons/sliders/selected cards/badges/glass highlights —
		  //   independent of the shell's theme brand token.
		  // - glassAlpha: glass-surface transparency in % (0–60, step 5), written to
		  //   --we-glass-alpha and used by the settings window, settings card, composer
		  //   card, bubbles and sidebar panels. Higher = MORE transparent (clearer
		  //   wallpaper shows through), lower = closer to solid.
		  // - glassColor: the GLASS BASE COLOR of the settings window (#rrggbb),
		  //   written to --we-glass-color. Defaults keep the stock look (white glass
		  //   in light mode, deep navy in dark); once the user picks a color BOTH
		  //   themes use it, so the window glass can be tinted to taste.
		  // - glassWindow: master switch for the WHOLE native settings window — when
		  //   on, the dialog (nav + every native section: General/Models/Plugins/…)
		  //   becomes liquid glass with the accent + transparency above; off restores
		  //   the shell's stock look.
		  accent: "#4f8cff",
		  glassAlpha: 12,
		  glassColor: "#ffffff",
		  glassWindow: true,
		  // dsh-better-sidebar 液态玻璃：与设置窗口玻璃同级的一套「细节自由」控制，
		  // 独立于会话玻璃（玻璃 / 玻璃透明度）——侧栏想多透 / 多糊 / 换个底色都行：
		  // - sidebarGlass：总开关，关闭后侧栏恢复原生外观（不再透明 / 不再模糊）；
		  // - sidebarBlur：侧栏专用 backdrop 模糊半径（px，0 = 关闭毛玻璃）；
		  // - sidebarAlpha：侧栏玻璃透明度（%），语义与玻璃透明度一致（越大越透）。
		  //   默认 120（映射后白罩 ≈16.3%；旧默认 12 ≈35.9%，面板明显发亮 — #56 实测）：
		  //   已存配置经 sanitize 只钳范围不覆盖，故仅影响新用户开箱观感；编辑器/终端
		  //   内容面有独立近不透明底色兜底，文字可读性不受影响。
		  // - sidebarColor：侧栏玻璃基底色调（#rrggbb），默认白色，双主题统一生效。
		  sidebarGlass: true,
		  sidebarBlur: 16,
		  sidebarAlpha: 120,
		  sidebarColor: "#ffffff",
		  // 内容面（编辑器/终端）近不透明玻璃底的细调——既有固定调色板（语法高亮/
		  // ANSI）为不透明底设计，全透明毛玻璃下注释灰不可读，全不透明又失去玻璃感：
		  // - sidebarContentAlpha：内容面透明度（%），越大越透（映射到底色不透明度
		  //   100%→20%；默认 30 → 70% 不透明，亮/暗主题实测显示均合理，玻璃感与
		  //   注释可读性平衡）；
		  // - sidebarContentColor：内容面底色（#rrggbb），空 = 跟随主题面板色
		  //   (--dsw-alias-bg-layer-1)，选定后双主题统一使用该色。
		  sidebarContentAlpha: 30,
		  sidebarContentColor: "",
		  // Persisted: show the chat-interface mascot pull-cord (rope dock).
		  ropeShown: true,
		  // Persisted: which mascot artwork + how big. ropeForm ∈ {maid, whale};
		  // ropeScale multiplies the form's base box (0.5×–2.5×).
		  ropeForm: "maid",
		  ropeScale: 1,
		  // Persisted "what's new" notice: the last version the user dismissed. Stored
		  // with the other settings (host file, port-independent) so it survives DSH
		  // Desktop's random --port restarts and never re-shows after being closed.
		  noticeSeen: "",
		  // ── 字体自定义（#57 精简回归版）：仅字体颜色 / 字重 / 字体族 ──
		  // - fontCustom：总开关。关闭 = 全部恢复 dsh 原生字体外观（清空注入的变量与
		  //   样式表，即「恢复默认」）；开启后下方三项才生效。默认关闭——PR #57 全局
		  //   染色的开箱观感不佳，本次重做默认不给用户任何覆盖。
		  // - fontColor / fontWeight / fontFamily：应用范围与报错红字保护见
		  //   applyFontStyles()（<style id="we-font-patch">）。
		  fontCustom: false,
		  fontColor: "#000000",
		  fontWeight: 400,
		  fontFamily: "inherit",
		};

		// Selectable values for the two filters. Declared up top because
		// readPersisted() validates against them at module load (const TDZ).
		const RATING_VALUES = ["all", "everyone", "pg13", "mature", "unrated"];
		const TYPE_VALUES = ["all", "video", "web", "image", "scene"];
		// 吉祥物（拉绳）可选形态：maid = 默认小女仆，whale = 鲸御姐；以及可调大小
		// （scale 0.5–2.5，默认 1）。形态/大小常量必须在此声明（同理于 RATING_VALUES）：
		// readPersisted() 会在模块加载时用它们校验持久化值（const TDZ）。
		const ROPE_FORM_VALUES = ["maid", "whale"];
		const ROPE_SCALE_MIN = 0.5, ROPE_SCALE_MAX = 2.5, ROPE_SCALE_STEP = 0.05;
		// 字体族白名单（字体自定义三件套之一）。inherit = 跟随 dsh 原生字体栈。
		// 必须在此声明：readPersisted() 在模块加载时用它校验持久化值（const TDZ）。
		const FONT_FAMILY_VALUES = ["inherit", "Microsoft YaHei", "KaiTi", "SimSun", "SimHei", "STXingkai", "monospace"];
		// 字体族按钮数据：label 显示名 + stack 应用/预览字体栈。stack 里保留中文
		// fallback 链（行楷缺字体时退楷体、等宽用系统等宽栈），预览与应用同源，
		// 用户在按钮上看到的就是应用后的效果。
		// 华文行楷 STXingkai 随 Office 安装，缺失时退 KaiTi；macOS 走 "Xingkai SC"。
		const FONT_FAMILY_STACKS = {
		  inherit: "inherit",
		  "Microsoft YaHei": '"Microsoft YaHei", sans-serif',
		  KaiTi: 'KaiTi, serif',
		  SimSun: 'SimSun, serif',
		  SimHei: 'SimHei, sans-serif',
		  STXingkai: '"STXingkai", "Xingkai SC", KaiTi, serif',
		  monospace: 'ui-monospace, Consolas, "Courier New", monospace',
		};
		const FONT_FAMILY_LABELS = [
		  { v: "inherit", label: "默认" },
		  { v: "Microsoft YaHei", label: "雅黑" },
		  { v: "KaiTi", label: "楷体" },
		  { v: "SimSun", label: "宋体" },
		  { v: "SimHei", label: "黑体" },
		  { v: "STXingkai", label: "行楷" },
		  { v: "monospace", label: "等宽" },
		];
		// 依持久化值取应用字体栈（sanitize 已保证值在白名单内）。
		function fontFamilyStack(v) {
		  return FONT_FAMILY_STACKS[v] || "inherit";
		}
		// 帧率上限 options (fps); 0 = 无限制. Mirror of the host whitelist.
		const FPS_CAP_VALUES = [0, 60, 48, 30, 24];

		// 配色 presets for the settings-page liquid-glass theme. The accent drives
		// buttons/sliders/selected cards/badges and the glass sheen via --we-accent;
		// users can also pick any color with the native <input type="color">.
		const ACCENT_PRESETS = [
		  "#4f8cff", // 经典蓝 (default)
		  "#67DCE7", // 冰青 (summer-liquid-glass primary)
		  "#DD8FAC", // 玫瑰粉 (summer-liquid-glass brand)
		  "#F3B75F", // 琥珀金
		  "#F1717F", // 珊瑚红
		  "#CBE77D", // 黄绿 (success)
		];

		// 玻璃颜色 presets for the settings-window glass BASE tint (--we-glass-color).
		// The first two are the stock-look defaults (white in light mode, deep navy in
		// dark); picking any preset (or a custom color) tints the glass in BOTH themes.
		const GLASS_COLOR_PRESETS = [
		  "#ffffff", // 白（浅色默认）
		  "#0d1524", // 深夜蓝（深色默认）
		  "#67DCE7", // 冰青
		  "#DD8FAC", // 玫瑰粉
		  "#F3B75F", // 琥珀金
		  "#F1717F", // 珊瑚红
		];

		// ── Persisted selection ─────────────────────────────────────────────────────
		function clampNum(v, lo, hi, fallback) {
		  return typeof v === "number" && v >= lo && v <= hi ? v : fallback;
		}

		// Rotation groups are user-defined carousel lists: each holds a set of
		// wallpaper ids picked from the inventory, its own switch interval (minutes),
		// and its own playback order. They are fully client-side (localStorage), so
		// rotation never depends on Wallpaper Engine's own config.json paths.
		function readRotationGroups(raw) {
		  if (!Array.isArray(raw)) return [];
		  const groups = [];
		  for (const g of raw) {
		    if (!g || typeof g !== "object") continue;
		    const id = typeof g.id === "string" && g.id ? g.id : "";
		    if (!id) continue;
		    groups.push({
		      id,
		      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : "轮播列表",
		      interval: clampNum(g.interval, 1, 1440, DEFAULTS.rotationInterval),
		      order: g.order === "random" ? "random" : "sequence",
		      wallpaperIds: Array.isArray(g.wallpaperIds)
		        ? g.wallpaperIds.filter((x) => typeof x === "string" && x)
		        : [],
		    });
		  }
		  return groups;
		}

		// Shared settings sanitizer: used by readPersisted() (localStorage cache) and
		// by loadPersisted() (host /wallpaper-engine/settings). The host half keeps a
		// mirror (lib/index.js sanitizeSettings) — keep the two in sync.
		function sanitizeSettings(o) {
		  if (!o || typeof o !== "object") return { id: "", ...DEFAULTS };
		  return {
		    id: typeof o.id === "string" ? o.id : "",
		    scrim: clampNum(o.scrim, 0, 1, DEFAULTS.scrim),
		    border: clampNum(o.border, 0, 1, DEFAULTS.border),
		    blur: clampNum(o.blur, 0, 60, DEFAULTS.blur),
		    wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
		    backgroundBrightness: clampNum(o.backgroundBrightness, 40, 160, DEFAULTS.backgroundBrightness),
		    backgroundContrast: clampNum(o.backgroundContrast, 40, 200, DEFAULTS.backgroundContrast),
		    backgroundSaturate: clampNum(o.backgroundSaturate, 0, 200, DEFAULTS.backgroundSaturate),
		    rotationEnabled: o.rotationEnabled === true,
		    rotationGroupId: typeof o.rotationGroupId === "string" ? o.rotationGroupId : "",
		    rotationGroups: readRotationGroups(o.rotationGroups),
		    rotationSeeded: o.rotationSeeded === true,
		    hiddenIds: Array.isArray(o.hiddenIds)
		      ? o.hiddenIds.filter((x) => typeof x === "string" && x)
		      : [],
		    playbackRate: clampNum(o.playbackRate, 0.5, 2, DEFAULTS.playbackRate),
		    fpsCap: FPS_CAP_VALUES.includes(o.fpsCap) ? o.fpsCap : DEFAULTS.fpsCap,
		    betaSceneAnim: o.betaSceneAnim === true,
		    pauseOnHidden: o.pauseOnHidden !== false,
		    pauseOnBlur: o.pauseOnBlur === true,
		    pauseOnBattery: o.pauseOnBattery === true,
		    flip: o.flip === true,
		    objectFit: ["cover", "contain", "center", "fill"].includes(o.objectFit)
		      ? o.objectFit : DEFAULTS.objectFit,
		    contentRatingFilter: RATING_VALUES.includes(o.contentRatingFilter)
		      ? o.contentRatingFilter : DEFAULTS.contentRatingFilter,
		    typeFilter: TYPE_VALUES.includes(o.typeFilter)
		      ? o.typeFilter : DEFAULTS.typeFilter,
		    pickerLayout: o.pickerLayout === "classic" ? "classic" : "fixed",
		    edgeCompat: o.edgeCompat !== false,
		    accent: typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent)
		      ? o.accent : DEFAULTS.accent,
		    glassAlpha: clampNum(o.glassAlpha, 0, 60, DEFAULTS.glassAlpha),
		    glassColor: typeof o.glassColor === "string" && /^#[0-9a-f]{6}$/i.test(o.glassColor)
		      ? o.glassColor : DEFAULTS.glassColor,
		    glassWindow: o.glassWindow !== false,
		    sidebarGlass: o.sidebarGlass !== false,
		    sidebarBlur: clampNum(o.sidebarBlur, 0, 200, DEFAULTS.sidebarBlur),
		    sidebarAlpha: clampNum(o.sidebarAlpha, 0, 200, DEFAULTS.sidebarAlpha),
		    sidebarColor: typeof o.sidebarColor === "string" && /^#[0-9a-f]{6}$/i.test(o.sidebarColor)
		      ? o.sidebarColor : DEFAULTS.sidebarColor,
		    sidebarContentAlpha: clampNum(o.sidebarContentAlpha, 0, 80, DEFAULTS.sidebarContentAlpha),
		    sidebarContentColor: typeof o.sidebarContentColor === "string" && /^#[0-9a-f]{6}$/i.test(o.sidebarContentColor)
		      ? o.sidebarContentColor : DEFAULTS.sidebarContentColor,
		    ropeShown: o.ropeShown !== false,
		    ropeForm: ROPE_FORM_VALUES.includes(o.ropeForm) ? o.ropeForm : DEFAULTS.ropeForm,
		    ropeScale: clampNum(o.ropeScale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, DEFAULTS.ropeScale),
		    noticeSeen: typeof o.noticeSeen === "string" ? o.noticeSeen : "",
		    // 字体自定义（#57 精简回归版）：只钳范围不覆盖已存配置
		    fontCustom: o.fontCustom === true,
		    fontColor: typeof o.fontColor === "string" && /^#[0-9a-f]{6}$/i.test(o.fontColor)
		      ? o.fontColor : DEFAULTS.fontColor,
		    fontWeight: clampNum(o.fontWeight, 100, 900, DEFAULTS.fontWeight),
		    fontFamily: FONT_FAMILY_VALUES.includes(o.fontFamily) ? o.fontFamily : DEFAULTS.fontFamily,
		  };
		}

		function readPersisted() {
		  try {
		    const raw = localStorage.getItem(SETTINGS_KEY);
		    if (!raw) return { id: "", ...DEFAULTS };
		    return sanitizeSettings(JSON.parse(raw));
		  } catch {
		    return { id: "", ...DEFAULTS };
		  }
		}

		// ── Shared selection store (React + DOM layer share it) ────────────────────
		const selection = {
		  ...readPersisted(),
		  // Transient: becomes true once loadPersisted() has applied the host-side
		  // settings (the port-independent source of truth). The one-time notice waits
		  // for it so it never flashes before the persisted noticeSeen is known.
		  hostLoaded: false,
		  url: null,
		  type: null,
		  previewUrl: null,
		  // Transient: scene wallpaper animation MP4 URL (host /scene-video route).
		  // When present the scene plays as a hardware-decoded <video>; on load error
		  // it is nulled and the layer rebuilds as the extracted static frame.
		  sceneVideo: null,
		  // Transient: source media metadata ({ width, height, codec, fps }) from
		  // /media-info (host moov probe, cached).
		  mediaInfo: null,
		  // Transient: whether dsh-better-sidebar is installed & enabled (host reports
		  // it via the settings GET response). Gates the 侧栏玻璃 control group in the
		  // picker — the knobs are meaningless without the sidebar, so they only show
		  // when it is actually there.
		  sidebarPresent: false,
		  // Transient: 抽帧转码 lifecycle — "idle" | "working" | "ready" | "fallback"
		  // | "skipped" (see maybeUpgradeToTranscoded).
		  transcodeState: "idle",
		  // Transient: { phase: "download"|"transcode"|"done"|"error", percent, source }
		  // polled from /transcode-progress while "working" (progress bar).
		  transcodeProgress: null,
		  playing: true,
		  loading: false,
		  rotationTimer: null,
		  // Draft of the rotation group currently being created/edited in the picker
		  // (null when the editor is closed). Mutated live; committed on 保存.
		  editing: null,
		  // Transient picker UI state (NOT persisted): batch hide/restore selection
		  // mode, the open/closed state of the wallpaper picker MODAL and its active
		  // view ("normal" | "hidden"). The hidden section used to be inline; it now
		  // lives as a tab inside the modal (see WallpaperPicker).
		  batchMode: false,
		  batchSelected: [],
		  page: 0,
		  hiddenPage: 0,
		  editorPage: 0,
		  hiddenOpen: false,
		  pickerOpen: false,
		  modalView: "normal",
		  // Transient: picker-modal title search (not persisted).
		  search: "",
		  // Custom-upload UI state (transient): in-flight flag + last error message.
		  uploading: false,
		  uploadError: "",
		  uploadNote: "",
		  // Upload-directory editor (transient): open state + draft path.
		  editingUploadDir: false,
		  uploadDirDraft: "",
		  inventory: { installDir: null, uploadDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
		  loaded: false,
		};

		const listeners = new Set();
		function emit() { for (const fn of [...listeners]) fn(); }
		function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

		// ── React hook for the picker UI ────────────────────────────────────────────
		function useStore() {
		  const [, setTick] = React.useState(0);
		  React.useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
		  return selection;
		}

		// Whitelist serialization of the persisted settings (the ONLY fields the host
		// file and the localStorage cache carry).
		function serializeSelection() {
		  return {
		    id: selection.id,
		    scrim: selection.scrim,
		    border: selection.border,
		    blur: selection.blur,
		    wallpaperBlur: selection.wallpaperBlur,
		    backgroundBrightness: selection.backgroundBrightness,
		    backgroundContrast: selection.backgroundContrast,
		    backgroundSaturate: selection.backgroundSaturate,
		    rotationEnabled: selection.rotationEnabled,
		    rotationGroupId: selection.rotationGroupId,
		    rotationGroups: selection.rotationGroups,
		    rotationSeeded: selection.rotationSeeded,
		    hiddenIds: selection.hiddenIds,
		    playbackRate: selection.playbackRate,
		    fpsCap: selection.fpsCap,
		    betaSceneAnim: selection.betaSceneAnim,
		    pauseOnHidden: selection.pauseOnHidden,
		    pauseOnBlur: selection.pauseOnBlur,
		    pauseOnBattery: selection.pauseOnBattery,
		    flip: selection.flip,
		    objectFit: selection.objectFit,
		    contentRatingFilter: selection.contentRatingFilter,
		    typeFilter: selection.typeFilter,
		    pickerLayout: selection.pickerLayout,
		    edgeCompat: selection.edgeCompat,
		    accent: selection.accent,
		    glassAlpha: selection.glassAlpha,
		    glassColor: selection.glassColor,
		    glassWindow: selection.glassWindow,
		    sidebarGlass: selection.sidebarGlass,
		    sidebarBlur: selection.sidebarBlur,
		    sidebarAlpha: selection.sidebarAlpha,
		    sidebarColor: selection.sidebarColor,
		    sidebarContentAlpha: selection.sidebarContentAlpha,
		    sidebarContentColor: selection.sidebarContentColor,
		    ropeShown: selection.ropeShown,
		    ropeForm: selection.ropeForm,
		    ropeScale: selection.ropeScale,
		    noticeSeen: selection.noticeSeen,
		    fontCustom: selection.fontCustom,
		    fontColor: selection.fontColor,
		    fontWeight: selection.fontWeight,
		    fontFamily: selection.fontFamily,
		  };
		}

		// Host persistence: debounced PUT to /wallpaper-engine/settings (same origin;
		// the host writes ~/.dsh-wallpaper-engine/config.json — port-independent).
		// localStorage stays a synchronous-read cache + migration source + rollback,
		// never the source of truth — and its WRITE is debounced together with the
		// PUT: slider drags used to trigger a full JSON.stringify + synchronous
		// localStorage write on every input tick (dozens per drag). Timers go through
		// window.* (guarded) like the rotation timer below, so headless verify
		// environments without a timer facility fall back to an immediate write.
		let persistTimer = null;
		// Dirty flag: a failed/非-2xx PUT must not be silently dropped — the host file
		// would go stale and the NEXT load (host = source of truth) would roll the
		// user's settings back. Retried on the next persistSelection or when the page
		// becomes visible again.
		let persistDirty = false;
		// Write counter: loadPersisted() snapshots it before its GET and skips the
		// host→selection merge when the user edited settings while the GET was in
		// flight (the user's pending PUT is newer than the host's answer).
		let persistWrites = 0;
		function writeLocalCache() {
		  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(serializeSelection())); } catch { /* ignore */ }
		}
		async function pushPersisted() {
		  try {
		    const res = await fetch(SETTINGS_URL, {
		      method: "PUT",
		      headers: { "Content-Type": "application/json" },
		      body: JSON.stringify(serializeSelection()),
		      keepalive: true, // let a pending flush survive pagehide/close
		    });
		    persistDirty = !res.ok;
		  } catch {
		    // Host unreachable: the localStorage cache remains the fallback.
		    persistDirty = true;
		  }
		}
		function flushPersist() {
		  persistTimer = null;
		  writeLocalCache();
		  pushPersisted();
		}
		function schedulePersist() {
		  if (persistTimer) return;
		  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
		    flushPersist();
		    return;
		  }
		  persistTimer = window.setTimeout(flushPersist, 200);
		}

		// Flush a pending write when the page goes away (tab close / navigate), and
		// retry a failed PUT when the page becomes visible again.
		if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
		  window.addEventListener("pagehide", () => {
		    if (persistTimer && typeof window.clearTimeout === "function") {
		      window.clearTimeout(persistTimer);
		      flushPersist();
		    }
		  });
		  document.addEventListener("visibilitychange", () => {
		    if (!document.hidden && persistDirty && !persistTimer) schedulePersist();
		  });
		}

		function persistSelection() {
		  persistWrites++;
		  schedulePersist();
		}

		// ── Host-sourced settings (load once at startup) ────────────────────────────
		// GET /wallpaper-engine/settings: the host file is the source of truth (it
		// survives DSH Desktop's random --port 0 restarts and browser data clears;
		// localStorage is origin-scoped). Migration: when the host has nothing yet but
		// localStorage does, upload it once so the host becomes the truth. On any host
		// failure fall back to localStorage so a plain web load keeps working.
		async function loadPersisted() {
		  let hostSettings = null;
		  let hostOk = false;
		  // Race guard: if the user edits settings while this GET is in flight, the
		  // response is STALE (their pending PUT is newer) and must not overwrite the
		  // live selection.
		  const writesAtStart = persistWrites;
		  try {
		    const res = await fetch(SETTINGS_URL, { cache: "no-store" });
		    if (res.ok) {
		      const data = await res.json();
		      hostSettings = data && data.settings;
		      // 侧栏玻璃控制组只在 dsh-better-sidebar 已安装且启用时显示（host 检测）。
		      selection.sidebarPresent = !!(data && data.betterSidebar);
		      hostOk = true;
		    }
		  } catch { /* host unreachable */ }

		  const stale = persistWrites !== writesAtStart;
		  if (hostOk && hostSettings && typeof hostSettings === "object") {
		    // Host is the truth: apply it and refresh the local cache copy — unless the
		    // user edited settings during the fetch (their write wins).
		    if (!stale) {
		      Object.assign(selection, sanitizeSettings(hostSettings));
		      writeLocalCache();
		    }
		  } else if (hostOk) {
		    // Host has nothing saved yet: migrate any existing localStorage data once.
		    // JSON.parse MUST be guarded here: a corrupted localStorage payload used to
		    // reject loadPersisted(), which broke the loadPersisted().then(loadInventory)
		    // boot chain and left the picker stuck on "扫描 Wallpaper Engine…" forever.
		    const local = localStorage.getItem(SETTINGS_KEY);
		    let parsedLocal = null;
		    try { parsedLocal = local ? JSON.parse(local) : null; } catch { /* corrupted cache: treat as absent */ }
		    if (!stale) Object.assign(selection, parsedLocal ? sanitizeSettings(parsedLocal) : { id: "", ...DEFAULTS });
		    if (parsedLocal) pushPersisted();
		  } else {
		    // Host unreachable (route missing / static load): localStorage fallback.
		    if (!stale) Object.assign(selection, readPersisted());
		  }

		  // Settings applied (host or fallback). Mark loaded so gated UI — the one-time
		  // notice — knows the persisted noticeSeen is final before it renders.
		  selection.hostLoaded = true;
		  applyEffects();
		  emit();
		}

		// Concurrency guard: 刷新 / 上传完成 / 移除 / 改目录 all call loadInventory(),
		// and two overlapping requests used to resolve in arbitrary order — an older,
		// slower response could clobber a newer inventory. The last caller wins;
		// superseded requests drop their result entirely.
		let inventorySeq = 0;
		async function loadInventory() {
		  const seq = ++inventorySeq;
		  selection.loading = true;
		  emit();
		  let next;
		  try {
		    const res = await fetch(INVENTORY_URL, { cache: "no-store" });
		    if (!res.ok) throw new Error("inventory HTTP " + res.status);
		    const data = await res.json();
		    next = {
		      installDir: data.installDir,
		      uploadDir: data.uploadDir || null,
		      wallpapers: data.wallpapers || [],
		      total: data.total || 0,
		      portableCount: data.portableCount || 0,
		      playlists: Array.isArray(data.playlists) ? data.playlists : [],
		      error: null,
		    };
		  } catch (err) {
		    next = {
		      installDir: null,
		      uploadDir: null,
		      wallpapers: [],
		      total: 0,
		      portableCount: 0,
		      playlists: [],
		      error: String(err && err.message ? err.message : err),
		    };
		  }
		  if (seq !== inventorySeq) return; // superseded by a newer loadInventory()
		  selection.inventory = next;
		  selection.loading = false;
		  selection.loaded = true;
		  // Fresh inventory → reset pagination, but ONLY when the wallpaper id set
		  // actually changed: an upload/remove/refresh that keeps the same list must
		  // not kick the user back to page 1.
		  const prevIds = selection._invIds || "";
		  const nextIds = next.wallpapers.map((w) => w.id).join("\u0001");
		  if (prevIds !== nextIds) {
		    selection._invIds = nextIds;
		    selection.page = 0;
		    selection.hiddenPage = 0;
		    selection.editorPage = 0;
		  }

		  // Rotation groups: validate the active one and seed a first group from a
		  // playable Wallpaper Engine playlist when the user has none yet (so the
		  // rotation feature starts working out of the box, using ids the host already
		  // resolved — no WE config.json path matching involved). Seeding happens once
		  // (`rotationSeeded`), so deleting every list stays respected on refresh.
		  if (!selection.rotationGroups.length && !selection.rotationSeeded) {
		    selection.rotationSeeded = true;
		    seedGroupsFromPlaylists();
		    persistSelection();
		  }
		  if (selection.rotationGroupId && !activeRotationGroup()) {
		    selection.rotationGroupId = "";
		    persistSelection();
		  }
		  if (selection.rotationEnabled) {
		    if (!selection.rotationGroupId) {
		      const usable = firstUsableGroup();
		      if (usable) selection.rotationGroupId = usable.id;
		      else selection.rotationEnabled = false;
		    } else if (rotationCandidates().length < 2) {
		      const usable = firstUsableGroup();
		      if (usable && usable.id !== selection.rotationGroupId) selection.rotationGroupId = usable.id;
		      else if (!usable) selection.rotationEnabled = false;
		    }
		    persistSelection();
		  }

		  // Re-validate the selection against the refreshed inventory + filters (also
		  // covers the rating/type filters): drop vanished/no-longer-matching
		  // selections, then restore rotation state.
		  revalidateSelection();
		}

		// ── Content-rating + type filters ───────────────────────────────────────────
		// Reproduces Wallpaper Engine's own content categories (project.json
		// `contentrating`): "Everyone" (G) / "PG13" (parental guidance) / "Mature" (R);
		// projects without the field are "unrated". A separate type filter narrows the
		// playable types (video / web / image / scene static frame). Both are enforced
		// at the single choke point below, so the grid, the rotation editor, the
		// rotation candidates and the auto-selection all stay consistent. Matching is
		// case-insensitive and accepts common spellings so other local copies behave
		// the same.
		const ADULT_RATING_PATTERN = /^(mature|adult|adultonly|18\+|r18)$/i;
		const PG13_RATING_PATTERN = /^(pg13|pg-13|pg ?13|questionable)$/i;

		function ratingOf(w) {
		  const rating = typeof w.contentrating === "string" ? w.contentrating.trim() : "";
		  if (!rating) return "unrated";
		  if (/^(everyone|general|g)$/i.test(rating)) return "everyone";
		  if (PG13_RATING_PATTERN.test(rating)) return "pg13";
		  if (ADULT_RATING_PATTERN.test(rating)) return "mature";
		  return "unrated";
		}

		function matchesRatingFilter(w) {
		  const filter = selection.contentRatingFilter;
		  if (filter === "all") return true;
		  return ratingOf(w) === filter;
		}

		function matchesTypeFilter(w) {
		  const filter = selection.typeFilter;
		  if (filter === "all") return true;
		  return w.type === filter;
		}

		function isPlayableType(w) {
		  // "image" = user-uploaded still image (custom uploads, id prefix "up-").
		  // "scene" = WE scene wallpaper — usable as a static frame when the host
		  // served a frameUrl (extracted from its main texture).
		  if (!w) return false;
		  if (w.playable && (w.type === "video" || w.type === "web" || w.type === "image")) return true;
		  return w.type === "scene" && Boolean(w.frameUrl);
		}

		function isRotatableWallpaper(w) {
		  return isPlayableType(w) && matchesRatingFilter(w) && matchesTypeFilter(w);
		}

		function playableInventory() {
		  return selection.inventory.wallpapers.filter(
		    (w) => isRotatableWallpaper(w) && !isHiddenWallpaper(w.id),
		  );
		}

		// Re-validate the active selection against the current inventory + filters.
		// Called after a refresh AND after changing the rating/type filter: drop a
		// selection that vanished, is no longer playable, or no longer matches the
		// selected categories; when rotation is on and nothing matches, pick the next
		// candidate instead of stopping playback.
		function revalidateSelection() {
		  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && isRotatableWallpaper(w))) {
		    selection.id = "";
		    persistSelection();
		  }
		  if (selection.rotationEnabled && selection.id && !rotationCandidates().some((w) => w.id === selection.id)) {
		    const first = rotationCandidates()[0];
		    selection.id = first ? first.id : "";
		    persistSelection();
		  }
		  if (!selection.id && selection.rotationEnabled) {
		    const first = rotationCandidates()[0];
		    if (first) selection.id = first.id;
		  }
		  applySelection(selection.id);
		  emit();
		}

		// ── Rotation groups (user-defined carousel lists) ───────────────────────────
		function activeRotationGroup() {
		  return selection.rotationGroups.find((g) => g.id === selection.rotationGroupId) || null;
		}

		// byId lookup cache: groupWallpapers() is called from render, revalidate,
		// rotation scheduling and firstUsableGroup() — rebuilding a full Map per call
		// was O(N) × O(calls) on every emit. Keyed by the inventory ARRAY REFERENCE,
		// so a fresh loadInventory() (which replaces the array) invalidates it.
		let byIdCache = null;
		let byIdRef = null;
		function wallpaperById() {
		  const list = selection.inventory.wallpapers;
		  if (byIdRef !== list) {
		    byIdRef = list;
		    byIdCache = new Map(list.map((w) => [w.id, w]));
		  }
		  return byIdCache;
		}

		function groupWallpapers(group) {
		  if (!group || !Array.isArray(group.wallpaperIds)) return [];
		  const byId = wallpaperById();
		  return group.wallpaperIds
		    .map((id) => byId.get(id))
		    .filter((w) => w && isRotatableWallpaper(w) && !isHiddenWallpaper(w.id));
		}

		function rotationCandidates() {
		  return groupWallpapers(activeRotationGroup());
		}

		function firstUsableGroup() {
		  return selection.rotationGroups.find((g) => groupWallpapers(g).length >= 2) || null;
		}

		// First run / upgrade path: turn the first playable Wallpaper Engine playlist
		// into a rotation group so existing setups keep working without any WE-side
		// configuration. Returns true when a group was created.
		function seedGroupsFromPlaylists() {
		  const playable = selection.inventory.playlists.filter((p) => (p.portableCount || 0) >= 2);
		  const source = playable[0];
		  if (!source) return false;
		  const ids = Array.isArray(source.wallpaperIds) ? source.wallpaperIds.slice() : [];
		  if (!ids.length) return false;
		  selection.rotationGroups.push({
		    id: nextGroupId(),
		    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "轮播列表",
		    interval: DEFAULTS.rotationInterval,
		    order: source.order === "random" ? "random" : "sequence",
		    wallpaperIds: ids,
		  });
		  selection.rotationGroupId = selection.rotationGroups[selection.rotationGroups.length - 1].id;
		  return true;
		}

		function nextGroupId() {
		  return "grp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		}

		function nextRotationWallpaper() {
		  const list = rotationCandidates();
		  if (list.length < 2) return null;
		  const group = activeRotationGroup();
		  if (group && group.order === "random") {
		    const candidates = list.filter((w) => w.id !== selection.id);
		    return candidates[Math.floor(Math.random() * candidates.length)] || null;
		  }
		  const current = list.findIndex((w) => w.id === selection.id);
		  return list[(current + 1 + list.length) % list.length] || null;
		}

		function clearRotationTimer() {
		  if (selection.rotationTimer === null) return;
		  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		    window.clearTimeout(selection.rotationTimer);
		  }
		  selection.rotationTimer = null;
		}

		function syncRotationTimer() {
		  clearRotationTimer();
		  if (!selection.rotationEnabled || !selection.id) return;
		  if (rotationCandidates().length < 2) return;
		  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
		  const group = activeRotationGroup();
		  const minutes = group ? group.interval : DEFAULTS.rotationInterval;
		  selection.rotationTimer = window.setTimeout(() => {
		    selection.rotationTimer = null;
		    if (!selection.rotationEnabled || !selection.id) return;
		    const next = nextRotationWallpaper();
		    if (next) applySelection(next.id);
		    // 静默停摆修复：候选在 armed 期间被隐藏到不足 2 个时 next 为 null，
		    // 不重建定时器轮播就无声停止。re-arm（候选仍 <2 时 syncRotationTimer
		    // 自身不会 arm；恢复 ≥2 由 hide/restore 里的补 arm 接管）。
		    else syncRotationTimer();
		  }, minutes * 60 * 1000);
		}

		// ── Rotation group CRUD (draft-based editor) ────────────────────────────────
		function startEditGroup(id) {
		  const group = selection.rotationGroups.find((g) => g.id === id);
		  if (!group) return;
		  selection.editing = JSON.parse(JSON.stringify(group));
		  emit();
		}

		function startCreateGroup() {
		  selection.editing = {
		    id: nextGroupId(),
		    name: "轮播列表 " + (selection.rotationGroups.length + 1),
		    interval: DEFAULTS.rotationInterval,
		    order: "sequence",
		    wallpaperIds: [],
		  };
		  emit();
		}

		function saveEditingGroup() {
		  const draft = selection.editing;
		  if (!draft) return;
		  const idx = selection.rotationGroups.findIndex((g) => g.id === draft.id);
		  const cleaned = {
		    id: draft.id,
		    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "轮播列表",
		    interval: clampNum(draft.interval, 1, 1440, DEFAULTS.rotationInterval),
		    order: draft.order === "random" ? "random" : "sequence",
		    wallpaperIds: Array.isArray(draft.wallpaperIds)
		      ? draft.wallpaperIds.filter((x) => typeof x === "string" && x)
		      : [],
		  };
		  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
		  else selection.rotationGroups.push(cleaned);
		  selection.rotationGroupId = cleaned.id;
		  selection.editing = null;
		  if (selection.rotationEnabled && !rotationCandidates().some((w) => w.id === selection.id)) {
		    const first = rotationCandidates()[0];
		    applySelection(first ? first.id : "");
		    return;
		  }
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function cancelEditGroup() {
		  selection.editing = null;
		  emit();
		}

		function deleteGroup(id) {
		  const idx = selection.rotationGroups.findIndex((g) => g.id === id);
		  if (idx < 0) return;
		  selection.rotationGroups.splice(idx, 1);
		  if (selection.rotationGroupId === id) {
		    selection.rotationGroupId = "";
		    if (selection.rotationEnabled) {
		      const fallback = firstUsableGroup();
		      if (fallback) selection.rotationGroupId = fallback.id;
		      else selection.rotationEnabled = false;
		    }
		  }
		  if (selection.editing && selection.editing.id === id) selection.editing = null;
		  persistSelection();
		  syncRotationTimer();
		  emit();
		}

		function importPlaylistIntoDraft(playlist) {
		  if (!selection.editing || !playlist || !Array.isArray(playlist.wallpaperIds)) return;
		  selection.editing.wallpaperIds = playlist.wallpaperIds.slice();
		  emit();
		}

		function applySelection(id) {
		  // 切换壁纸 (任意类型): 终止旧的 scene 动画升级 — 旧轮询 timer 停止写进度,
		  // 旧 probe 下载断开 → 服务端 res close → 取消渲染 (worker/ffmpeg 释放 CPU)。
		  cancelSceneAnimUpgrade();
		  selection.id = id || "";
		  persistSelection();
		  if (!selection.id) {
		    selection.url = null;
		    selection.type = null;
		    selection.previewUrl = null;
		    selection.sceneVideo = null;
		    selection.mediaInfo = null;
		    selection.transcodeState = "idle";
		    mediaInfoToken = "";
		    abortTranscodeUpgrade();
		    syncRotationTimer();
		    emit();
		    return;
		  }
		  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
		  if (!w || !isRotatableWallpaper(w)) {
		    selection.url = null;
		    selection.type = null;
		    selection.previewUrl = null;
		    selection.sceneVideo = null;
		    selection.mediaInfo = null;
		    selection.transcodeState = "idle";
		    mediaInfoToken = "";
		    abortTranscodeUpgrade();
		    syncRotationTimer();
		    emit();
		    return;
		  }
		  selection.url = w.type === "scene" ? w.frameUrl : w.media;
		  selection.type = w.type;
		  // Scene 壁纸动画化: 先显示静态帧 (frameUrl, 立即), 后台预渲染动画视频
		  // (scene-anim 路由 ?fmt=mp4, 首次分钟级) 完成后无缝切换 — video 元素提供
		  // 播放/暂停/倍速 控制, 与视频壁纸同款。sceneFrameUrl 供 fpsCap 变更时重渲染。
		  selection.sceneFrameUrl = w.type === "scene" ? (w.frameUrl || null) : null;
		  // Scene wallpapers with an embedded animation (host-extracted MP4) play it
		  // as a hardware-decoded <video>; scenes without one stay on the static frame.
		  // 有内嵌 MP4 (sceneVideo) 的场景直接用硬件解码播放 — 不再触发 CPU scene-anim
		  // 升级 (避免重复动画 + 浪费 CPU, 且 scene-anim 完成后会覆盖 sceneVideo)。
		  selection.sceneVideo = w.type === "scene" ? (w.sceneVideo || null) : null;
		  if (w.type === "scene" && w.frameUrl && !selection.sceneVideo) queueSceneAnimUpgrade(w.frameUrl);
		  // Keep the preview around so a failed static frame can fall back to it.
		  selection.previewUrl = w.preview || null;
		  selection.transcodeState = "idle";
		  // The previous wallpaper's media info must not leak into the new one: a stale
		  // fps would make the sync "源帧率 ≤ 上限" check wrongly skip the transcode
		  // (and the UI would keep claiming 无需抽帧 for a 120fps source).
		  selection.mediaInfo = null;
		  abortTranscodeUpgrade();
		  refreshMediaInfo();
		  syncRotationTimer();
		  emit();
		}

		// ── Hidden wallpapers (soft delete / restore, localStorage only) ───────────
		// Hiding is a pure status flag: no source file is touched, and a hidden
		// wallpaper that is currently playing keeps playing (it only leaves the
		// lists). Rotation candidates exclude hidden ids via groupWallpapers(), so a
		// hidden wallpaper can never be auto-selected by the carousel.
		function isHiddenWallpaper(id) {
		  return Boolean(id) && selection.hiddenIds.includes(id);
		}

		function hiddenInventoryList() {
		  return selection.inventory.wallpapers.filter((w) => isHiddenWallpaper(w.id));
		}

		function hideWallpapers(ids) {
		  const added = ids.filter((id) => id && !selection.hiddenIds.includes(id));
		  if (!added.length) return;
		  for (const id of added) selection.hiddenIds.push(id);
		  persistSelection();
		  syncRotationTimer(); // 候选可能跌破 2 个 → 停表；恢复时重新 arm
		  emit();
		}

		function restoreWallpapers(ids) {
		  const set = new Set(ids.filter(Boolean));
		  if (!set.size) return;
		  const before = selection.hiddenIds.length;
		  selection.hiddenIds = selection.hiddenIds.filter((id) => !set.has(id));
		  if (selection.hiddenIds.length !== before) {
		    persistSelection();
		    syncRotationTimer(); // 候选恢复到 ≥2 → 重新 arm 轮播
		    emit();
		  }
		}

		// ── Custom uploads (read-A storage) ─────────────────────────────────────────
		// The HOST writes the uploaded bytes to its plugin-managed directory and
		// serves them through the same token/media/preview routes as WE media; the
		// client only POSTs the file, then refreshes the (already-merged) inventory.
		const UPLOAD_URL = "/wallpaper-engine/upload";
		const REMOVE_URL = "/wallpaper-engine/remove";
		const UPLOAD_TYPES = ["image/jpeg", "image/png", "video/mp4"];

		function isUploadedWallpaper(w) {
		  return Boolean(w && w.id && w.id.indexOf("up-") === 0);
		}

		async function uploadWallpaperFile(file) {
		  const ctype = (file.type || "").toLowerCase();
		  if (!UPLOAD_TYPES.includes(ctype)) {
		    selection.uploadError = "仅支持 JPG / PNG 图片与 MP4 视频";
		    emit();
		    return;
		  }
		  if (!/\.(jpe?g|png|mp4)$/i.test(file.name)) {
		    selection.uploadError = "文件扩展名需为 .jpg / .png / .mp4";
		    emit();
		    return;
		  }
		  selection.uploading = true;
		  selection.uploadError = "";
		  selection.uploadNote = "";
		  emit();
		  try {
		    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
		    const res = await fetch(UPLOAD_URL + "?title=" + encodeURIComponent(title), {
		      method: "POST",
		      headers: { "Content-Type": ctype },
		      body: file,
		    });
		    const data = await res.json().catch(() => ({}));
		    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
		    // Host dedup: uploading the same file again returns the existing entry
		    // (data.duplicate) instead of storing a second copy.
		    if (data.duplicate) {
		      selection.uploadNote = "已存在相同内容的壁纸，已直接选择原有的那张";
		    }
		    await loadInventory();
		    applySelection(data.id);
		  } catch (err) {
		    selection.uploadError = "上传失败：" + (err && err.message ? err.message : err);
		  }
		  selection.uploading = false;
		  emit();
		}

		async function removeUploadWallpaper(id) {
		  if (!id) return;
		  selection.uploading = true;
		  selection.uploadError = "";
		  emit();
		  try {
		    const res = await fetch(REMOVE_URL, {
		      method: "POST",
		      headers: { "Content-Type": "application/json" },
		      body: JSON.stringify({ id }),
		    });
		    const data = await res.json().catch(() => ({}));
		    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
		    if (selection.id === id) applySelection("");
		    await loadInventory();
		  } catch (err) {
		    selection.uploadError = "移除失败：" + (err && err.message ? err.message : err);
		  }
		  selection.uploading = false;
		  emit();
		}

		const UPLOAD_DIR_URL = "/wallpaper-engine/upload-dir";

		// Change where custom uploads are stored. The host persists the choice to its
		// config file (survives restarts) and migrates existing files by default —
		// users can point uploads at a non-system drive without touching config files.
		async function changeUploadDir(dir, migrate) {
		  if (!dir || !String(dir).trim()) {
		    selection.uploadError = "请输入存储位置路径";
		    emit();
		    return;
		  }
		  selection.uploading = true;
		  selection.uploadError = "";
		  emit();
		  try {
		    const res = await fetch(UPLOAD_DIR_URL, {
		      method: "POST",
		      headers: { "Content-Type": "application/json" },
		      body: JSON.stringify({ dir: String(dir).trim(), migrate: migrate !== false }),
		    });
		    const data = await res.json().catch(() => ({}));
		    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
		    selection.editingUploadDir = false;
		    selection.uploadDirDraft = "";
		    await loadInventory();
		  } catch (err) {
		    selection.uploadError = "更改失败：" + (err && err.message ? err.message : err);
		  }
		  selection.uploading = false;
		  emit();
		}

		// ── Behind-body layer: wallpaper + scrim (plain DOM, NOT a slot) ───────────
		// Edge (and only Edge) paints its own floating "下载/投屏" media-overlay toolbar
		// over any VISIBLE <video> element, and it ignores pointer-events / controlsList /
		// disableRemotePlayback; there is no browser switch to turn it off. The only
		// reliable way to keep it off the wallpaper is to never paint a visible video
		// element, so on Edge video wallpapers are drawn onto a <canvas> instead:
		//   * Edge-only (UA-gated): Chrome/Firefox/other engines keep the native <video>
		//     path untouched — zero cost and zero behaviour change outside Edge.
		//   * Event-driven: requestVideoFrameCallback() redraws only when the video
		//     presents a NEW frame (video framerate, not display refresh rate; paused or
		//     background-tab → no callbacks → zero work). Falls back to rAF if absent.
		//   * The canvas bitmap is capped at the video's native resolution (never
		//     upscaled), then CSS scales it to the viewport — ~1/4 the pixels of a
		//     dpr-2 fullscreen canvas.
		// The <video> stays in the DOM (offscreen, invisible) purely as the decoder
		// source for drawImage; play/pause/playbackRate still work on it.
		const IS_EDGE = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);
		let weVfHandle = 0;     // requestVideoFrameCallback handle
		let weRafId = 0;        // requestAnimationFrame fallback handle
		let weResizeObs = null; // ResizeObserver (canvas size / DPR changes)
		let weDrawCtx = null;   // { canvas, video, fit }
		function weStopDraw() {
		  const v = weDrawCtx && weDrawCtx.video;
		  if (weVfHandle && v && v.cancelVideoFrameCallback) {
		    try { v.cancelVideoFrameCallback(weVfHandle); } catch { /* ignore */ }
		  }
		  weVfHandle = 0;
		  if (weRafId) { cancelAnimationFrame(weRafId); weRafId = 0; }
		  if (weResizeObs) { weResizeObs.disconnect(); weResizeObs = null; }
		  weDrawCtx = null;
		}
		// Detach is NOT enough: a playing <video> is a GC root and keeps decoding in
		// the background after removal — every rotation switch used to accumulate one
		// more background decoder. Pause + clear src BEFORE dropping the node.
		function releaseLayerMedia(node) {
		  const v = node && node.querySelector("video");
		  if (v) {
		    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
		  }
		}
		function weDrawFrame() {
		  const ctx = weDrawCtx;
		  if (!ctx || !ctx.canvas.isConnected) return;
		  const video = ctx.video;
		  const vw = video.videoWidth, vh = video.videoHeight;
		  if (!vw || !vh) return;
		  const canvas = ctx.canvas;
		  const dpr = Math.min(window.devicePixelRatio || 1, 2);
		  // Cap the bitmap at the video's native resolution; CSS does the upscaling.
		  const cw = Math.max(1, Math.min(vw, Math.round(canvas.clientWidth * dpr)));
		  const ch = Math.max(1, Math.min(vh, Math.round(canvas.clientHeight * dpr)));
		  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
		  const g = canvas.getContext("2d");
		  g.clearRect(0, 0, cw, ch);
		  // Same semantics as CSS object-fit (cover / contain / center / fill).
		  const vr = vw / vh, cr = cw / ch;
		  let dx = 0, dy = 0, dw = cw, dh = ch, sx = 0, sy = 0, sw = vw, sh = vh;
		  if (ctx.fit === "cover") {
		    if (cr > vr) { sw = vh * cr; sx = (vw - sw) / 2; }
		    else { sh = vw / cr; sy = (vh - sh) / 2; }
		  } else if (ctx.fit === "contain") {
		    if (cr > vr) { dh = cw / vr; dy = (ch - dh) / 2; }
		    else { dw = ch * vr; dx = (cw - dw) / 2; }
		  } else if (ctx.fit === "center") {
		    sw = Math.min(vw, cw); sh = Math.min(vh, ch);
		    sx = (vw - sw) / 2; sy = (vh - sh) / 2;
		    dw = sw; dh = sh; dx = (cw - dw) / 2; dy = (ch - dh) / 2;
		  }
		  // "fill" stretches the full source over the full canvas (defaults above).
		  g.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
		}
		function weDrawTick() {
		  weDrawFrame();
		  const ctx = weDrawCtx;
		  if (!ctx || !ctx.canvas.isConnected) return;
		  const v = ctx.video;
		  if (v.requestVideoFrameCallback) { weVfHandle = v.requestVideoFrameCallback(weDrawTick); return; }
		  // rAF fallback: a PAUSED wallpaper must not redraw the same frame 60–120
		  // times per second. Stop the loop while paused; a one-shot play listener
		  // resumes it (identity-guarded so a stale listener can't re-arm after stop).
		  if (!v.paused && !v.ended) { weRafId = requestAnimationFrame(weDrawTick); return; }
		  v.addEventListener("play", () => { if (weDrawCtx === ctx) weDrawTick(); }, { once: true });
		}
		function weStartDraw(canvas, video, customFit) {
		  weStopDraw();
		  weDrawCtx = {
		    canvas,
		    video,
		    fit: customFit
		      ? (getComputedStyle(document.body).getPropertyValue("--we-object-fit").trim() || "cover")
		      : "cover",
		  };
		  weDrawFrame(); // first paint (a paused wallpaper never presents new frames)
		  // If the video is still loading while paused, neither the paint above nor
		  // rVFC covers it — draw once as soon as the first frame is available.
		  if (!video.dataset.weLoadedOnce) {
		    video.dataset.weLoadedOnce = "1";
		    video.addEventListener("loadeddata", () => weDrawFrame(), { once: true });
		  }
		  if (video.requestVideoFrameCallback) weVfHandle = video.requestVideoFrameCallback(weDrawTick);
		  else weRafId = requestAnimationFrame(weDrawTick);
		  weResizeObs = new ResizeObserver(() => weDrawFrame());
		  weResizeObs.observe(canvas);
		}

		// ── Scene 壁纸动画化: 静态帧 → 后台预渲染视频 → 无缝切换 ──────
		// scene-anim 路由 (?fmt=mp4) 有落盘缓存 + 并发去重; 首次渲染分钟级, 故先显示
		// 静态帧 (frameUrl), 用隐藏 <video> 预加载动画视频 (触发宿主渲染), 完成后
		// 替换当前壁纸 URL — video 元素原生提供 播放/暂停/倍速/进度 控制,
		// 与视频壁纸同款配置。渲染期间轮询 /scene-anim-progress 显示进度条。
		// 切换壁纸 / fpsCap 变更会调用本函数: 必须终止旧升级 (轮询 timer + probe
		// 下载) — 否则旧 timer 继续把旧壁纸进度写进共享 selection (进度条跳变),
		// 且旧 probe 的下载保持服务端渲染任务活跃 (worker + ffmpeg 占满 CPU)。
		let sceneAnimUpgrade = null; // {pollTimer, probe, frameUrl, maxWait} — 当前活跃的升级
		function cancelSceneAnimUpgrade() {
		  const u = sceneAnimUpgrade;
		  sceneAnimUpgrade = null;
		  if (!u) return;
		  if (u.pollTimer) { clearInterval(u.pollTimer); }
		  if (u.maxWait) { clearTimeout(u.maxWait); }
		  if (u.probe) {
		    // 清 src 触发浏览器 abort 下载 → 服务端 res close → 渲染任务取消
		    try { u.probe.removeAttribute("src"); u.probe.load(); } catch { /* ignore */ }
		    try { u.probe.remove(); } catch { /* ignore */ }
		  }
		  if (selection.sceneAnimProgress != null) selection.sceneAnimProgress = null;
		}
		function queueSceneAnimUpgrade(frameUrl) {
		  cancelSceneAnimUpgrade(); // 旧升级终止 (旧壁纸渲染随服务端 res close 取消)
		  // beta场景动画开关: 默认关闭 → scene 壁纸只显示静态帧, 不进入动画化升级。
		  // 关闭状态下即使 sceneFrameUrl 变更 (fpsCap 点击) 也不启动后台渲染。
		  if (selection.betaSceneAnim !== true) return;
		  // fps 取帧率上限 (fpsCap>0 时重渲染对应帧率, 与视频抽帧同款语义)
		  const fps = selection.fpsCap > 0 ? Math.min(30, Math.max(2, selection.fpsCap)) : 12;
		  // 分辨率按屏幕 + devicePixelRatio (上限 1920×1080, CPU 渲染成本受限) —
		  // 提高分辨率避免动画放大模糊 (对比静态帧 3840 全分辨率)
		  const dpr = Math.min(2, window.devicePixelRatio || 1);
		  const vw = Math.min(1920, Math.max(320, Math.round((window.innerWidth || 1920) * dpr)));
		  const vh = Math.min(1080, Math.max(180, Math.round((window.innerHeight || 1080) * dpr)));
		  const q = "?fps=" + fps + "&fmt=mp4&w=" + vw + "&h=" + vh;
		  const animUrl = frameUrl.replace("/scene-frame/", "/scene-anim/") + q;
		  // 渲染进度轮询 (首次分钟级; 缓存命中时第一次轮询即 100)
		  const token = frameUrl.split("/").pop();
		  const progUrl = "/wallpaper-engine/scene-anim-progress/" + token + q;
		  selection.sceneAnimProgress = 0;
		  emit(); // 立即反映新进度 (fpsCap 变更路径的调用方 emit 在前, 这里补一次)
		  let pollTimer = null, maxWait = null;
		  const stopPoll = () => {
		    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		    if (maxWait) { clearTimeout(maxWait); maxWait = null; }
		    if (sceneAnimUpgrade && sceneAnimUpgrade.pollTimer === pollTimer) sceneAnimUpgrade = null;
		    if (selection.sceneAnimProgress != null) { selection.sceneAnimProgress = null; emit(); }
		  };
		  // 渲染完成切换的主动路径: 轮询到 100% 直接切换 — 不依赖 probe 的
		  // onloadeddata (渲染分钟级时浏览器 video 请求长时间挂起, onloadeddata
		  // 可能不触发/被中断 → 之前"渲染后仍显示静态帧")。
		  const trySwitch = () => {
		    if (selection.url && selection.url === frameUrl) {
		      selection.url = animUrl;
		      syncLayers();
		    }
		  };
		  pollTimer = setInterval(async () => {
		    try {
		      const r = await fetch(progUrl, { cache: "no-store" });
		      const j = await r.json();
		      const pct = Number(j && j.percent);
		      selection.sceneAnimProgress = Number.isFinite(pct) ? pct : 100;
		      emit();
		      if (pct >= 100) {
		        clearInterval(pollTimer);
		        if (maxWait) { clearTimeout(maxWait); maxWait = null; }
		        trySwitch();
		        if (selection.sceneAnimProgress != null) { selection.sceneAnimProgress = null; emit(); }
		      }
		    } catch { /* 网络错误: 保持上次进度 */ }
		  }, 1500);
		  // 渲染超时兜底: 8 分钟未完成 → 停止轮询 (进度条消失, 保持静态帧)
		  maxWait = setTimeout(() => {
		    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		    if (selection.sceneAnimProgress != null) { selection.sceneAnimProgress = null; emit(); }
		  }, 8 * 60 * 1000);
		  // probe video: 触发服务端渲染 (probe.src 请求)。必须挂 DOM + load(),
		  // detached video 设 src 不保证加载 → onloadeddata 不触发 (静止根因)。
		  // onloadeddata 是快路径 (渲染快时提前切换); 慢渲染由轮询 100% 兜底。
		  const probe = document.createElement("video");
		  probe.muted = true;
		  probe.preload = "auto";
		  probe.style.cssText = "position:absolute;left:-100000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
		  probe.onloadeddata = () => {
		    trySwitch();
		    stopPoll();
		  };
		  probe.onerror = () => { /* 渲染慢挂起超时 → 保持轮询, 由进度 100 主动切换 */ };
		  probe.src = animUrl;
		  try { document.body.appendChild(probe); probe.load(); } catch { /* ignore */ }
		  sceneAnimUpgrade = { pollTimer, probe, frameUrl, maxWait };
		}

		function buildMedia(sel) {
		  // Scene 壁纸播放形态优先级:
		  //   1. sceneVideo — 场景内嵌 MP4 (作者主分支, 硬件解码 <video>, poster=静态帧)
		  //   2. scene-anim — beta 动画升级 (本分支 CPU 渲染视频, URL 含 /scene-anim/)
		  //   3. 静态帧 img (frameUrl)
		  // 未升级时仍是静态帧 img。
		  const isSceneVideo = sel.type === "scene" && Boolean(sel.sceneVideo);
		  const isSceneAnim = sel.type === "scene" && sel.url && sel.url.indexOf("/scene-anim/") !== -1;
		  const isStill = sel.type === "image" || (sel.type === "scene" && !isSceneVideo && !isSceneAnim);
		  const media = sel.type === "video" || isSceneVideo || isSceneAnim
		    ? document.createElement("video")
		    : isStill
		      ? document.createElement("img")
		      : document.createElement("iframe");
		  // The user-chosen fit mode (覆盖/填充/居中/拉伸) applies to every wallpaper
		  // type — WE media included (the 适配 control used to be uploads-only).
		  // iframes (web wallpapers) don't read object-fit, so they skip the class.
		  const fitClass = " we-media--fit";
		  if (sel.type === "video" || isSceneAnim) {
		    media.src = sel.url;
		    media.autoplay = true;
		    media.loop = true;
		    media.muted = true;
		    media.setAttribute("playsinline", "");
		    // Native playbackRate — hardware-decoded, instant, no reload (and the
		    // videos are muted anyway, so there is no audio to keep in sync).
		    try { media.playbackRate = sel.playbackRate; } catch { /* ignore */ }
		    if (IS_EDGE && sel.edgeCompat !== false) {
		      // Edge: keep the decoder element out of sight (its floating 下载/投屏
		      // toolbar attaches to any VISIBLE <video>), render via <canvas> instead
		      // (see weStartDraw / weDrawFrame). Attributes are belt-and-suspenders.
		      media.setAttribute("disablepictureinpicture", "");
		      media.setAttribute("disableremoteplayback", "");
		      media.style.cssText = "position:absolute;left:-100000px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;";
		      const canvas = document.createElement("canvas");
		      canvas.className = "we-media we-media--canvas" + fitClass;
		      canvas.style.background = "#000";
		      return [media, canvas];
		    }
		    media.className = "we-media" + fitClass;
		  } else if (isSceneVideo) {
		    // Scene animation as <video>: autoplay/loop/muted, poster = the extracted
		    // static frame (shown while the video loads). Hardware-decoded → smooth,
		    // no WebGL context → no freeze.
		    media.src = sel.sceneVideo;
		    media.autoplay = true;
		    media.loop = true;
		    media.muted = true;
		    media.setAttribute("playsinline", "");
		    media.poster = sel.url;   // frameUrl as poster
		    media.className = "we-media" + fitClass;
		    // No embedded video (404) or codec failure → degrade to the static frame.
		    media.addEventListener("error", () => {
		      if (selection.sceneVideo) {
		        selection.sceneVideo = null;
		        try { syncLayers(); emit(); } catch { /* ignore */ }
		      }
		    });
		  } else if (isStill) {
		    media.src = sel.url;
		    media.alt = "";
		    media.draggable = false;
		    media.className = "we-media" + fitClass;
		    // Scene frames are generated on demand; a failed extraction (e.g. an
		    // unsupported texture format) falls back to the project preview image.
		    if (sel.type === "scene" && sel.previewUrl) {
		      media.onerror = () => {
		        if (media.src !== sel.previewUrl) media.src = sel.previewUrl;
		      };
		    }
		  } else {
		    media.src = sel.url;
		    media.setAttribute("frameborder", "0");
		    media.setAttribute("scrolling", "no");
		    // 安全隔离：WE web 壁纸是 workshop 第三方 HTML/JS，而 media 路由与宿主
		    // 同源 —— 不 sandbox 的话壁纸脚本可以 DSH 宿主 origin 身份调用宿主全部
		    // API。allow-scripts 保留动态壁纸能力，但拿到 opaque origin（无
		    // allow-same-origin），无法再冒用宿主身份。
		    media.setAttribute("sandbox", "allow-scripts");
		    media.className = "we-media we-iframe";
		  }
		  return media;
		}

		// ── Occlusion pause (遮挡暂停, WE-style) ────────────────────────────────────
		// Desktop Wallpaper Engine pauses rendering whenever the wallpaper is covered
		// — the main reason its GPU load is ~0 most of the time. Browsers cannot
		// detect window occlusion directly, so we use the two closest proxies:
		// document.hidden (minimized / tab switched away) and window focus loss
		// (another app took the foreground; the wallpaper is likely covered). Pausing
		// the <video> stops decode entirely (rVFC stops → decode engine → 0); on
		// restore, the effective playing state resumes automatically unless the user
		// manually paused. Web/iframe wallpapers cannot be paused from outside — they
		// are only throttled by the browser while the page is hidden.
		let weBattery = null; // BatteryManager from navigator.getBattery (if available)
		function occlusionActive() {
		  if (selection.pauseOnHidden && typeof document !== "undefined" && document.hidden) return true;
		  if (selection.pauseOnBlur && typeof document !== "undefined"
		    && typeof document.hasFocus === "function" && !document.hasFocus()) return true;
		  if (selection.pauseOnBattery && weBattery && !weBattery.charging) return true;
		  return false;
		}
		function isEffectivelyPlaying() {
		  return selection.playing && !occlusionActive();
		}

		// ── Source metadata + frame-skip transcode (抽帧转码) ────────────────────────
		// The decode-side fps cap (帧率上限) is implemented as a HOST re-encode, NOT as
		// playbackRate: playbackRate is a speed multiplier, so capping decode through
		// it would slow the motion. The host transcodes the wallpaper once to the cap
		// fps (4K120 → 4K60, timeline 1.0x, AV1 via NVENC) and caches it; here we play
		// the ORIGINAL immediately (instant first paint) and, while the host runs the
		// one-time transcode, swap to the capped-fps file when it is ready — normal
		// speed + halved decode. 倍速 (playbackRate) keeps working on top of either.
		let mediaInfoToken = "";
		// In-flight marker: while the /media-info probe for this token is pending,
		// maybeUpgradeToTranscoded must NOT fire a transcode request — the probe may
		// come back with fps ≤ cap (no transcode needed). Without this guard every
		// wallpaper selection used to trigger a throwaway host-side ffmpeg run.
		let mediaInfoInFlight = "";
		async function refreshMediaInfo(force) {
		  const token = selection.type === "video" && selection.url
		    ? selection.url.split("/").pop()
		    : null;
		  if (!token || (!force && token === mediaInfoToken)) return;
		  mediaInfoToken = token;
		  mediaInfoInFlight = token;
		  try {
		    const res = await fetch("/wallpaper-engine/media-info/" + encodeURIComponent(token), { cache: "no-store" });
		    const data = await res.json().catch(() => ({}));
		    if (mediaInfoToken === token) {
		      selection.mediaInfo = (data && data.info) || null;
		      // Source fps ≤ cap → no transcode needed; cancel an in-flight upgrade.
		      const mi = selection.mediaInfo;
		      if (mi && mi.fps && mi.fps > 0 && selection.fpsCap > 0 && mi.fps <= selection.fpsCap) {
		        abortTranscodeUpgrade();
		        // Also drop a swapped transcode from a previous LOWER cap, so the
		        // "无需抽帧" hint matches what is actually playing (the original).
		        const layer = document.getElementById(LAYER_ID);
		        const video = layer && layer.querySelector("video");
		        if (video && video.dataset.weTranscoded) revertTranscodedVideo(video);
		        selection.transcodeState = "skipped";
		      }
		    }
		  } catch {
		    if (mediaInfoToken === token) selection.mediaInfo = null;
		  }
		  if (mediaInfoInFlight === token) mediaInfoInFlight = "";
		  // Settle → single re-emit so a deferred transcode decision (see
		  // mediaInfoInFlight) runs against the final mediaInfo, success or failure.
		  if (mediaInfoToken === token) emit();
		}

		let upgradeAbort = null;
		let upgradeToken = "";
		// The fps cap the in-flight upgrade request targets (0 = none). The in-flight
		// latch is keyed by token ONLY in the old code, so switching 24→48 while the
		// 24fps transcode was still running was treated as "already working on it" —
		// the stale 24fps request then completed and swapped the video to a 24fps
		// re-encode while the picker advertised the new cap ("已切换至 48fps 抽帧版").
		// Tracking the cap lets a cap change abort the stale request and start fresh.
		let upgradeFps = 0;
		let upgradePollTimer = null; // progress poller while the transcode fetch pends
		function clearUpgradePoll() {
		  if (upgradePollTimer) { clearInterval(upgradePollTimer); upgradePollTimer = null; }
		}
		function abortTranscodeUpgrade() {
		  clearUpgradePoll();
		  if (upgradeAbort) { upgradeAbort.abort(); upgradeAbort = null; }
		  upgradeToken = "";
		  upgradeFps = 0;
		  selection.transcodeProgress = null;
		}
		// Revert a video that was swapped to a capped-fps transcode back to the source.
		// NOTE: no emit() here — this runs inside syncLayers (already inside an emit
		// cycle); emitting synchronously from a subscriber re-enters the listener chain
		// and recurses until the stack overflows. UI updates ride the outer emit.
		function revertTranscodedVideo(video) {
		  if (!video || !video.dataset.weTranscoded) return;
		  delete video.dataset.weTranscoded;
		  try { video.src = selection.url; video.load(); } catch { /* ignore */ }
		}
		function maybeUpgradeToTranscoded(video, token) {
		  if (!video || !video.isConnected) return;
		  const cap = selection.fpsCap;
		  // Cap off / lowered to 0: revert any swapped video back to the original.
		  if (!cap || cap <= 0) {
		    abortTranscodeUpgrade();
		    if (video.dataset.weTranscoded) {
		      revertTranscodedVideo(video);
		      selection.transcodeState = "idle";
		    }
		    return;
		  }
		  const mi = selection.mediaInfo;
		  if (mi && mi.fps && mi.fps > 0 && mi.fps <= cap) {
		    // Source already at/below the cap — no transcode needed; drop any previously
		    // swapped (lower-cap) version. No in-flight reservation is made, so raising
		    // the cap later can still start one.
		    if (video.dataset.weTranscoded) revertTranscodedVideo(video);
		    selection.transcodeState = "skipped";
		    return;
		  }
		  // mediaInfo probe still in flight for THIS token: defer the decision — the
		  // probe may come back with fps ≤ cap (transcode unnecessary). The settle
		  // emit in refreshMediaInfo re-runs syncLayers and brings us back here.
		  if (!mi && mediaInfoInFlight === token) return;
		  if (video.dataset.weTranscoded === String(cap)) return; // already on this cap
		  // Only an in-flight request for THIS cap counts as "working on it": a request
		  // for a different cap would complete and swap in a stale-fps re-encode while
		  // the picker advertises the current cap (24→48 direct switch bug). The guard
		  // is deliberately NOT conditioned on weTranscoded: the progress poller emits
		  // (→ syncLayers → this function), and with the video already on a transcode
		  // that emit used to abort + re-start the request forever (page freeze).
		  if (upgradeToken === token && upgradeAbort && upgradeFps === cap) return; // already working on this cap
		  abortTranscodeUpgrade();
		  upgradeToken = token;
		  upgradeFps = cap;
		  const ctrl = new AbortController();
		  upgradeAbort = ctrl;
		  selection.transcodeState = "working";
		  selection.transcodeProgress = null;
		  // Progress poller: 500ms interval reading /transcode-progress (download %,
		  // then frame-based transcode % + ETA). Cleared on settle/abort. The timer is
		  // ALSO kept in this closure so THIS request's completion only ever clears its
		  // OWN timer — a stale request must not kill the newer request's poller.
		  const pollProgress = () => {
		    if (ctrl.signal.aborted) return;
		    fetch("/wallpaper-engine/transcode-progress/" + encodeURIComponent(token) + "?fps=" + cap, { cache: "no-store" })
		      .then((r) => r.json().catch(() => ({})))
		      .then((d) => {
		        if (ctrl.signal.aborted) return;
		        if (d && d.phase) {
		          const changed = !selection.transcodeProgress
		            || selection.transcodeProgress.phase !== d.phase
		            || selection.transcodeProgress.percent !== d.percent
		            || selection.transcodeProgress.eta !== d.eta;
		          if (changed) {
		            selection.transcodeProgress = {
		              phase: d.phase, percent: d.percent || 0, source: d.source || "",
		              finalizing: d.finalizing === true, eta: typeof d.eta === "number" ? d.eta : null,
		            };
		            emit();
		          }
		        }
		      })
		      .catch(() => { /* transient poll failure: ignore */ });
		  };
		  clearUpgradePoll();
		  const pollTimer = setInterval(pollProgress, 500);
		  upgradePollTimer = pollTimer;
		  pollProgress();
		  const transcodedUrl = "/wallpaper-engine/transcoded/" + encodeURIComponent(token) + "?fps=" + cap;
		  // Trigger + completion probe: a tiny Range request that blocks until the host
		  // has the transcode cached, then answers 206 with one byte (discarded). The
		  // <video> then streams the SAME url via range requests — no full-file blob is
		  // ever held in memory and playback starts as soon as the first bytes arrive.
		  fetch(transcodedUrl, { signal: ctrl.signal, headers: { Range: "bytes=0-0" } })
		    .then(async (res) => {
		      if (ctrl.signal.aborted) return; // superseded by a newer request
		      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
		      if (!res.ok) { transcodeUpgradeFailed(video, token); return; }
		      try { await res.arrayBuffer(); } catch { /* 1-byte body; discard */ }
		      if (ctrl.signal.aborted) return;
		      if (selection.fpsCap !== cap || !video.isConnected) {
		        // The user changed the cap (or the wallpaper) while this request was in
		        // flight: its output is stale. NEVER swap a stale-fps re-encode in —
		        // drop the request state and re-decide for the CURRENT cap instead.
		        abortTranscodeUpgrade();
		        if (video.isConnected && selection.url && token === selection.url.split("/").pop()) {
		          const cur = selection.fpsCap;
		          if (cur > 0 && video.dataset.weTranscoded === String(cur)) {
		            // Already playing exactly the requested cap (the user switched back
		            // while this request was in flight): just settle as ready.
		            selection.transcodeState = "ready";
		            selection.transcodeProgress = null;
		            emit();
		          } else {
		            maybeUpgradeToTranscoded(video, token);
		          }
		        } else {
		          // The layer/video was rebuilt while this request was in flight (e.g.
		          // Edge 兼容 render-mode toggle, or a wallpaper switch that raced the
		          // abort): re-run syncLayers so the CURRENT video gets its own fresh
		          // upgrade decision — otherwise it would sit on the original (full
		          // decode) until some unrelated emit happened to re-trigger it.
		          emit();
		        }
		        return;
		      }
		      if (selection.url && token === selection.url.split("/").pop()) {
		        video.dataset.weTranscoded = String(cap);
		        const t = video.currentTime;
		        const wasPlaying = isEffectivelyPlaying();
		        // 兜底超时：转码文件损坏 / 元数据异常时 loadedmetadata 可能永远不来，
		        // UI 会永停「转码中」——15s 未就绪按失败回退原片。定时器走 window.*
		        //（headless 验证环境无计时器设施时直接跳过超时兜底）。
		        let metaTimer = null;
		        const clearMetaTimer = () => {
		          if (metaTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
		            window.clearTimeout(metaTimer);
		          }
		          metaTimer = null;
		        };
		        const onErr = () => {
		          clearMetaTimer();
		          if (video.dataset.weTranscoded) {
		            delete video.dataset.weTranscoded;
		            try { video.src = selection.url; video.load(); } catch { /* ignore */ }
		            selection.transcodeState = "fallback";
		            emit();
		          }
		        };
		        video.addEventListener("error", onErr, { once: true });
		        video.src = transcodedUrl;
		        video.load();
		        const onMeta = () => {
		          clearMetaTimer();
		          try { if (t > 0 && t < video.duration) video.currentTime = t; } catch { /* ignore */ }
		          if (wasPlaying) { try { video.play().catch(() => {}); } catch { /* ignore */ } }
		          // Edge canvas：转码 swap 复用同一 <video>，weLoadedOnce 已置位，
		          // 暂停态下补一帧避免画布停在旧画面。
		          weDrawFrame();
		          selection.transcodeState = "ready";
		          selection.transcodeProgress = null;
		          emit(); // syncLayers re-arms the Edge canvas + re-applies rate/play
		        };
		        video.addEventListener("loadedmetadata", onMeta, { once: true });
		        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
		          metaTimer = window.setTimeout(() => {
		            video.removeEventListener("loadedmetadata", onMeta);
		            onErr();
		          }, 15000);
		        }
		      }
		    })
		    .catch(() => {
		      if (ctrl.signal.aborted) return;
		      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
		      transcodeUpgradeFailed(video, token);
		    });
		}

		// A transcode request for the CURRENT cap failed (502 / network / encode
		// error): the documented fallback is to play the ORIGINAL, so revert any
		// swapped transcode (a request only ever runs when the video is on a DIFFERENT
		// cap's transcode or the original, so this restores the honest "原片" state).
		// The in-flight latch (upgradeToken/upgradeAbort/upgradeFps) is deliberately
		// LEFT set: it is what stops the emit-driven syncLayers re-entry from
		// auto-restarting a request that just failed, while a cap change / 无限制
		// switch still clears it and allows a retry.
		function transcodeUpgradeFailed(video, token) {
		  if (video && video.isConnected && video.dataset.weTranscoded) {
		    revertTranscodedVideo(video);
		  }
		  selection.transcodeState = "fallback";
		  selection.transcodeProgress = null;
		  emit();
		}

		function codecLabel(codec) {
		  return { avc1: "H.264", hvc1: "H.265", hev1: "H.265", av01: "AV1", vp09: "VP9", mp4v: "MPEG-4" }[codec] || codec;
		}

		function syncLayers() {
		  // 1. Wallpaper element.
		  const existing = document.getElementById(LAYER_ID);
		  if (selection.url) {
		    const wantKey = selection.type + "\u0000" + selection.url + "\u0000"
		      + (IS_EDGE && selection.edgeCompat !== false ? "canvas" : "video")
		      // Scene wallpapers: the media kind depends on sceneVideo (MP4 <video> vs
		      // static-frame <img>), and the 404 fallback nulls sceneVideo — the key
		      // must reflect it so the fallback rebuilds the layer.
		      + "\u0000" + (selection.sceneVideo || "");
		    const gotKey = existing && existing.dataset.weKey;
		    if (existing && gotKey !== wantKey) {
		      releaseLayerMedia(existing);
		      existing.remove();
		      // Release the previous draw loop: without this, switching from an Edge
		      // canvas video to a non-canvas wallpaper (image/web/scene, or Edge 兼容
		      // turned off) would keep the old hidden <video> referenced and playing
		      // forever — CPU/GPU/battery + memory leak per switch (rotation mixes
		      // types). weStartDraw() re-initialises when a canvas exists again.
		      weStopDraw();
		    }
		    let node = document.getElementById(LAYER_ID);
		    if (!node) {
		      node = document.createElement("div");
		      node.id = LAYER_ID;
		      node.className = "we-layer";
		      node.dataset.weKey = wantKey;
		      const built = buildMedia(selection);
		      if (Array.isArray(built)) for (const el of built) node.appendChild(el);
		      else node.appendChild(built);
		      document.body.appendChild(node);
		    }
		    const canvas = node.querySelector("canvas.we-media--canvas");
		    const video = node.querySelector("video");
		    // Edge-only: drive the canvas mirror from the hidden decoder video.
		    // Incremental guard: every emit (including the 500ms transcode poll) used
		    // to run a FULL weStopDraw + weStartDraw — rebuilding the ResizeObserver,
		    // re-registering rVFC and forcing a getComputedStyle read each time.
		    // Same canvas + same video → the draw loop is already running; skip it.
		    // (自定义壁纸的 objectFit 变更由「适配」按钮直接写 weDrawCtx.fit。)
		    if (canvas && video) {
		      const sameDraw = weDrawCtx && weDrawCtx.canvas === canvas && weDrawCtx.video === video;
		      if (!sameDraw) weStartDraw(canvas, video, canvas.className.indexOf("we-media--fit") !== -1);
		    }
		    if (video) {
		      if (isEffectivelyPlaying()) { try { video.play().catch(() => {}); } catch {} }
		      else video.pause();
		      // Keep the rate in sync on every layer sync (covers rate changes while
		      // the same wallpaper keeps playing — instant, no media reload).
		      try { if (video.playbackRate !== selection.playbackRate) video.playbackRate = selection.playbackRate; } catch { /* ignore */ }
		      // Frame-skip transcode (帧率上限): play the original now, swap to the
		      // capped-fps re-encode when the host finishes it (no-op when cap is 0).
		      if (selection.type === "video" && selection.url) {
		        maybeUpgradeToTranscoded(video, selection.url.split("/").pop());
		      }
		    }
		  } else if (existing) {
		    weStopDraw();
		    releaseLayerMedia(existing);
		    existing.remove();
		  }

		  // 2. Scrim element (always present while a wallpaper is active).
		  const scrim = document.getElementById(SCRIM_ID);
		  if (selection.url) {
		    if (!scrim) {
		      const s = document.createElement("div");
		      s.id = SCRIM_ID;
		      s.className = "we-scrim";
		      document.body.appendChild(s);
		    }
		    document.body.setAttribute(ACTIVE_ATTR, "on");
		  } else {
		    if (scrim) scrim.remove();
		    document.body.removeAttribute(ACTIVE_ATTR);
		  }
		}

		// ── Effect application: push the knobs into CSS variables ───────────────────
		// Scrim immediacy tracking: the inline-write + forced reflow below only runs
		// when the scrim value ACTUALLY changed. It used to run unconditionally on
		// every emit — i.e. twice per slider tick (handler + subscribed applyEffects)
		// and on every 500ms transcode poll — a forced synchronous layout storm.
		let lastScrimCss = "";
		// ── 字体自定义样式注入 ──────────────────────────────────────────────────────
		// <style id="we-font-patch"> 把 body 上注入的 --we-font-* 变量应用到整页文本：
		// - 普通文本吃 字体颜色 / 字重 / 字体族 三项（font-family 走变量，未设时回退
		//   inherit —— 值为 "inherit" 关键字同样合法）；
		// - error/danger/warning 语义元素排除在外并保持系统红字，避免全局染色盖掉
		//   报错提示（排除链沿用 #57 实测通过的版本）。
		// 总开关 fontCustom 关闭时注入整体清空，页面回到 dsh 原生字体外观。
		function applyFontStyles() {
		  try {
		    let st = document.getElementById("we-font-patch");
		    if (!st) {
		      st = document.createElement("style");
		      st.id = "we-font-patch";
		      (document.head || document.documentElement).appendChild(st);
		    }
		    st.textContent = [
		      /* 普通文本：排除错误/危险/警告语义，避免盖掉报错红字 */
		      'body *:not(:has([class*="error" i])):not(:has([class*="danger" i])):not(:has([class*="invalid" i])):not(:has([class*="destructive" i])):not(:has([class*="warning" i])):not([class*="error" i]):not([class*="danger" i]):not([class*="invalid" i]):not([class*="destructive" i]):not([class*="warning" i]):not([data-variant="error"]):not([data-variant="destructive"]):not([data-variant="danger"]) {',
		      '  color:var(--we-font-color, #000) !important;',
		      '  font-weight:var(--we-font-weight, 400) !important;',
		      '  font-family:var(--we-font-family, inherit) !important;',
		      '}',
		    ].join('\n');
		  } catch { /* ignore */ }
		}

		function removeFontStyles() {
		  const st = document.getElementById("we-font-patch");
		  if (st) st.remove();
		}

		function applyEffects() {
		  const s = document.body.style;
		  s.setProperty("--we-scrim-color", "rgba(0,0,0," + selection.scrim + ")");
		  // Border emphasis: the border tokens are low-alpha hairlines; raise their
		  // alpha via a neutral gray so both light and dark themes stay legible.
		  s.setProperty("--we-border-alpha", String(selection.border));
		  // Glass blur strength in px (0 disables the frosted-glass effect).
		  s.setProperty("--we-blur", selection.blur + "px");
		  // iOS liquid glass: the backdrop "colour melt" (saturation) scales with the
		  // blur radius, so the 玻璃 slider drives BOTH frosted depth and how strongly
		  // the wallpaper colour bleeds through the glass (0 blur → no melt). Kept
		  // gentle so the glass stays 通透 (clear) instead of oversaturated.
		  s.setProperty("--we-saturate", String(1.15 + selection.blur * 0.028));
		  s.setProperty("--we-glass-brightness", "1.04");
		  // Wallpaper blur strength in px (blurs the wallpaper itself).
		  s.setProperty("--we-wallpaper-blur", selection.wallpaperBlur + "px");
		  // Background media filter: blur() plus the brightness/contrast/saturate
		  // knobs, omitting untouched terms. Kept "none" while every knob is at its
		  // default (see .we-media above) so no offscreen filter layer is forced on
		  // the wallpaper video/canvas.
		  const filterTerms = [];
		  if (selection.wallpaperBlur > 0) filterTerms.push("blur(" + selection.wallpaperBlur + "px)");
		  if (selection.backgroundBrightness !== 100) filterTerms.push("brightness(" + selection.backgroundBrightness + "%)");
		  if (selection.backgroundContrast !== 100) filterTerms.push("contrast(" + selection.backgroundContrast + "%)");
		  if (selection.backgroundSaturate !== 100) filterTerms.push("saturate(" + selection.backgroundSaturate + "%)");
		  s.setProperty("--we-media-filter", filterTerms.length ? filterTerms.join(" ") : "none");
		  // Compensate for the fringe the blur reveals by scaling the layer up.
		  const scale = (1 + selection.wallpaperBlur * 0.006).toFixed(4);
		  s.setProperty("--we-wallpaper-scale", scale);
		  // Horizontal mirror: composed with the blur-compensation scale on the same
		  // transform (scaleX(-1) is a pure compositor operation).
		  s.setProperty("--we-wallpaper-flip", selection.flip ? "-1" : "1");
		  // Single transform var, "none" when identity (no blur, no flip): an identity
		  // scale(1) scaleX(1) still forces the full-screen wallpaper <video> onto a
		  // transform compositing layer at default — one less always-on layer for the
		  // kiosk window to glitch on (the previous anti-flicker pass left this).
		  s.setProperty("--we-wallpaper-transform",
		    (selection.wallpaperBlur > 0 || selection.flip)
		      ? ("scale(" + scale + ") scaleX(" + (selection.flip ? "-1" : "1") + ")")
		      : "none");
		  // Fit mode for the current wallpaper (consumed by .we-media--fit).
		  s.setProperty("--we-object-fit", selection.objectFit);

		  // Settings-page liquid-glass theming:
		  // - --we-accent: plugin-owned accent color; every fallback below that used
		  //   the shell's brand token (var(--dsw-alias-brand-primary, #4f8cff)) now
		  //   reads --we-accent first, so the 配色 control restyles the whole picker
		  //   and glass highlights without touching the shell theme.
		  s.setProperty("--we-accent", selection.accent);
		  // - --we-glass-alpha: white-overlay alpha of the glass surfaces. The 玻璃透明
		  //   度 slider semantics: higher = MORE transparent (clearer wallpaper shows
		  //   through), lower = closer to solid. 0% → ~0.25 (frosted, solid-ish),
		  //   60% → ~0.03 (nearly invisible glass). The 12% default ≈ the previous
		  //   hardcoded look (~0.15–0.2 white overlay).
		  const glassAlpha = Math.max(0.03, 0.25 - (selection.glassAlpha / 60) * 0.22);
		  s.setProperty("--we-glass-alpha", String(glassAlpha));
		  // - --we-glass-color: glass base tint of the settings window. The stock
		  //   defaults live in CSS (white glass light / deep navy dark); once the user
		  //   picks a color (玻璃颜色), both themes use it.
		  s.setProperty("--we-glass-color", selection.glassColor);
		  // - Master switch for the WHOLE native settings window: when on, the dialog
		  //   (nav + every native section) becomes liquid glass with the accent +
		  //   transparency above. Toggled instantly via a body attribute the scoped
		  //   CSS below keys on; off restores the shell's stock look.
		  if (selection.glassWindow) document.body.setAttribute("data-we-glass-window", "on");
		  else document.body.removeAttribute("data-we-glass-window");

		  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
		  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
		  // 子树（CSS 见下），关闭总开关时侧栏恢复原生外观。
		  s.setProperty("--we-sidebar-blur", selection.sidebarBlur + "px");
		  s.setProperty("--we-sidebar-saturate", String(1.15 + Math.min(selection.sidebarBlur, 60) * 0.028));
		  // 透明度语义：越大越透。0 → alpha 0.32（最实/最密），200 → alpha 0.015（最透）。
		  const sidebarAlpha = Math.max(0.015, 0.32 - (selection.sidebarAlpha / 200) * 0.305);
		  s.setProperty("--we-sidebar-alpha", String(sidebarAlpha));
		  s.setProperty("--we-sidebar-sheen", String(Math.min(1, sidebarAlpha / 0.2236)));
		  s.setProperty("--we-sidebar-color", selection.sidebarColor);
		  if (selection.sidebarGlass) document.body.setAttribute("data-we-sidebar-glass", "on");
		  else document.body.removeAttribute("data-we-sidebar-glass");
		  // 内容面（编辑器/终端）近不透明玻璃底：透明度滑块 0–80 → 不透明度 100%–20%
		  // （越大越透，与玻璃透明度同语义；低于 ~40% 不透明度注释可读性会再次变差，
		  // 留给用户自行权衡）；底色空 = 跟随主题面板色，选定后自定义。
		  // 注意 color-mix 的百分比槽位要求带单位的 token —— 变量值必须含 "%"，
		  // 否则整个 color-mix 失效、底色规则被丢弃（编辑器回退到纯透明毛玻璃）。
		  s.setProperty("--we-content-surface-alpha", Math.max(20, 100 - selection.sidebarContentAlpha) + "%");
		  if (selection.sidebarContentColor) s.setProperty("--we-content-surface-color", selection.sidebarContentColor);
		  else s.removeProperty("--we-content-surface-color");

		  // 字体自定义（#57 精简回归版）：开关关闭 → 清空变量与样式表，恢复原生外观。
		  if (selection.fontCustom) {
		    s.setProperty("--we-font-color", selection.fontColor);
		    s.setProperty("--we-font-weight", String(selection.fontWeight));
		    s.setProperty("--we-font-family", fontFamilyStack(selection.fontFamily));
		    applyFontStyles();
		  } else {
		    s.removeProperty("--we-font-color");
		    s.removeProperty("--we-font-weight");
		    s.removeProperty("--we-font-family");
		    removeFontStyles();
		  }

		  // Scrim immediacy: some composited/kiosk environments do not repaint a
		  // z-index:-1 layer promptly when only an inherited CSS variable changes.
		  // Write the resolved color DIRECTLY onto the scrim element's inline style and
		  // then force a synchronous layout — but ONLY when the value changed (see
		  // lastScrimCss above).
		  const scrimCss = "rgba(0,0,0," + selection.scrim + ")";
		  if (scrimCss !== lastScrimCss) {
		    lastScrimCss = scrimCss;
		    const scrim = document.getElementById(SCRIM_ID);
		    if (scrim) {
		      scrim.style.background = scrimCss;
		    }
		    // Force reflow so a stalled compositor picks up the new value immediately.
		    if (document.body) {
		      void document.body.offsetHeight;
		    }
		  }
		}

		function clearEffects() {
		  const s = document.body.style;
		  s.removeProperty("--we-scrim-color");
		  s.removeProperty("--we-border-alpha");
		  s.removeProperty("--we-blur");
		  s.removeProperty("--we-saturate");
		  s.removeProperty("--we-glass-brightness");
		  s.removeProperty("--we-wallpaper-blur");
		  s.removeProperty("--we-media-filter");
		  s.removeProperty("--we-wallpaper-scale");
		  s.removeProperty("--we-wallpaper-flip");
		  s.removeProperty("--we-object-fit");
		  s.removeProperty("--we-accent");
		  s.removeProperty("--we-glass-alpha");
		  s.removeProperty("--we-glass-color");
		  document.body.removeAttribute("data-we-glass-window");
		  s.removeProperty("--we-sidebar-blur");
		  s.removeProperty("--we-sidebar-saturate");
		  s.removeProperty("--we-sidebar-alpha");
		  s.removeProperty("--we-sidebar-sheen");
		  s.removeProperty("--we-sidebar-color");
		  document.body.removeAttribute("data-we-sidebar-glass");
		  s.removeProperty("--we-content-surface-alpha");
		  s.removeProperty("--we-content-surface-color");
		  s.removeProperty("--we-font-color");
		  s.removeProperty("--we-font-weight");
		  s.removeProperty("--we-font-family");
		  removeFontStyles();
		  const scrim = document.getElementById(SCRIM_ID);
		  if (scrim) scrim.style.background = "";
		  lastScrimCss = "";
		}

		// ── Settings picker ─────────────────────────────────────────────────────────
		// `key` is only needed when a SliderRow sits inside a conditionally-rendered
		// ARRAY (the sidebar-glass group) — React requires keys there.
		function SliderRow(label, min, max, step, value, onInput, suffix, key) {
		  return React.createElement("div", { className: "we-picker__row we-picker__slider-row", key: key },
		    React.createElement("span", { className: "we-picker__hint we-picker__label" }, label),
		    React.createElement("input", {
		      className: "we-picker__slider", type: "range",
		      min: String(min), max: String(max), step: String(step),
		      value: String(value),
		      // accent 填充进度：track 左段着 accent 色（macOS/Linear 式滑块质感），
		      // --we-fill 由当前值算出，emit 重渲染时同步更新。
		      style: { "--we-fill": Math.max(0, Math.min(100, ((Number(value) - min) / (max - min)) * 100)) + "%" },
		      // The visible label is a <span> (not a <label>), so expose it to AT.
		      "aria-label": label,
		      onInput: (e) => onInput(Number(e.target.value)),
		      // onChange stays as a final commit fallback (some engines only fire it
		      // on release); onInput above is what makes the knob feedback instant.
		      onChange: (e) => onInput(Number(e.target.value)),
		    }),
		    React.createElement("span", { className: "we-picker__hint we-picker__value" }, suffix),
		  );
		}

		// ── Vinyl record (黑胶唱片) ─────────────────────────────────────────────────
		// A rotating record disc showing the SELECTED wallpaper's cover as the label —
		// the "CD player" presentation the author liked. Pure presentational: cover =
		// the current wallpaper's preview URL (or null), playing drives the spin.
		// Shown in BOTH settings layouts and in the picker modal head.
		function VinylRecord(props) {
		  const cover = props.cover;
		  const title = props.title || "未选择壁纸";
		  const playing = props.playing === true;
		  const sm = props.sm === true;
		  return React.createElement("div", {
		    className: "we-vinyl" +
		      (playing ? " we-vinyl--playing" : "") +
		      (sm ? " we-vinyl--sm" : ""),
		    title: title,
		  },
		    React.createElement("div", { className: "we-vinyl__cover" },
		      cover
		        ? React.createElement("img", {
		            src: cover, alt: "", loading: "lazy",
		            onError: (e) => { e.target.style.display = "none"; },
		                            onLoad: (e) => { e.target.style.opacity = "1"; },
		          })
		        : React.createElement("span", { className: "we-vinyl__empty" }, "▦"),
		    ),
		    React.createElement("span", { className: "we-vinyl__hole" }),
		  );
		}

		// ── Modal a11y helpers ─────────────────────────────────────────────────────
		// pickerOpener: the「选择壁纸」button — focus returns here when the modal
		// closes. pickerFocusPending: one-shot flag so the modal's initial focus lands
		// exactly once on open (an inline ref callback would re-fire every render).
		let pickerOpener = null;
		let pickerFocusPending = false;
		function modalInitialFocus(el) {
		  if (el && pickerFocusPending) {
		    pickerFocusPending = false;
		    try { el.focus(); } catch { /* ignore */ }
		  }
		}
		// Minimal Tab trap for the picker modal: wraps focus at both ends. Attached as
		// the modal's onKeyDown; ESC is handled separately (capture-phase, global).
		const FOCUSABLE_SEL = "button, select, input, [tabindex]";
		function trapModalTab(e) {
		  if (e.key !== "Tab") return;
		  const nodes = e.currentTarget.querySelectorAll(FOCUSABLE_SEL);
		  const list = Array.prototype.filter.call(nodes, (n) =>
		    !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
		  if (!list.length) return;
		  const first = list[0];
		  const last = list[list.length - 1];
		  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		}
		// Keyboard activation for the div[role="button"] wallpaper cards
		// (Enter / Space → click), shared by the normal / hidden / close cards.
		function cardKeyDown(e) {
		  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
		}

		function WallpaperPicker(props) {
		  // repoPanel: this copy lives inside the rope-dock side panel. While the dock
		  // exists it owns the picker modal portal (repoPanelOwnsModal); the settings
		  // copy suppresses its own so two identical modals never stack.
		  const isRepoPanelCopy = Boolean(props && props.repoPanel);
		  const sel = useStore();
		  const onTogglePlay = () => { selection.playing = !selection.playing; emit(); };
		  const onClear = () => applySelection("");
		  const onRefresh = () => loadInventory();
		  // Filter changes: persist + re-validate so wallpapers outside the selected
		  // categories drop out of the grid/rotation immediately.
		  const onRatingFilterChange = (e) => {
		    selection.contentRatingFilter = e.target.value;
		    persistSelection();
		    revalidateSelection();
		  };
		  const onTypeFilterChange = (e) => {
		    selection.typeFilter = e.target.value;
		    persistSelection();
		    revalidateSelection();
		  };
		  // Card style: classic (CD-rack) vs fixed (overlap-proof).
		  const onLayoutChange = (value) => {
		    selection.pickerLayout = value;
		    persistSelection();
		    emit();
		  };
		  // Edge 兼容渲染开关：关闭后任何浏览器都走原生 <video>。改的是渲染模式，
		  // syncLayers 的 wantKey 已并入模式，emit 会重建壁纸层并立即按新路径生效。
		  const onEdgeCompatChange = (checked) => {
		    selection.edgeCompat = checked;
		    persistSelection();
		    emit();
		  };
		  const onGroupChange = (e) => {
		    selection.rotationGroupId = e.target.value;
		    if (selection.rotationEnabled) {
		      const first = rotationCandidates()[0];
		      if (first) applySelection(first.id);
		      else applySelection("");
		      return;
		    }
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  const onToggleRotation = () => {
		    selection.rotationEnabled = !selection.rotationEnabled;
		    if (selection.rotationEnabled) {
		      if (!selection.rotationGroupId) {
		        const usable = firstUsableGroup();
		        if (usable) selection.rotationGroupId = usable.id;
		      }
		      if (!rotationCandidates().some((w) => w.id === selection.id)) {
		        const first = rotationCandidates()[0];
		        if (first) {
		          applySelection(first.id);
		          return;
		        }
		      }
		    }
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  // Per-group interval: writes straight into the active group so each rotation
		  // list keeps its own switch cadence.
		  const onGroupInterval = (e) => {
		    const group = activeRotationGroup();
		    if (!group) return;
		    group.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval);
		    persistSelection();
		    syncRotationTimer();
		    emit();
		  };
		  const onDeleteGroup = () => {
		    const group = activeRotationGroup();
		    if (!group) return;
		    if (typeof window !== "undefined" && typeof window.confirm === "function") {
		      if (!window.confirm("删除轮播列表「" + group.name + "」？")) return;
		    }
		    deleteGroup(group.id);
		  };

		  // Slider callbacks: keep the stored value in its canonical unit, then emit —
		  // applyEffects is a subscribed listener (see apply()), so emit() applies the
		  // CSS vars synchronously AND re-renders the numeric readouts in one pass.
		  // (Calling applyEffects directly here too used to double-apply every tick.)
		  const onScrim = (pct) => { selection.scrim = pct / 100; persistSelection(); emit(); };
		  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); emit(); };
		  const onBlur = (px) => { selection.blur = px; persistSelection(); emit(); };
		  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); emit(); };
		  const onBackgroundBrightness = (pct) => { selection.backgroundBrightness = pct; persistSelection(); emit(); };
		  const onBackgroundContrast = (pct) => { selection.backgroundContrast = pct; persistSelection(); emit(); };
		  const onBackgroundSaturate = (pct) => { selection.backgroundSaturate = pct; persistSelection(); emit(); };
		  // 配色 (accent color) + 玻璃透明度 (glass transparency) + 玻璃颜色 (glass base
		  // tint): applied instantly through applyEffects() (--we-accent /
		  // --we-glass-alpha / --we-glass-color), persisted so the settings page keeps
		  // its custom look across reloads.
		  const onAccent = (hex) => {
		    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
		    selection.accent = hex;
		    persistSelection(); emit();
		  };
		  const onGlassColor = (hex) => {
		    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
		    selection.glassColor = hex;
		    persistSelection(); emit();
		  };
		  const onGlassAlpha = (pct) => {
		    selection.glassAlpha = clampNum(pct, 0, 60, DEFAULTS.glassAlpha);
		    persistSelection(); emit();
		  };
		  // 侧栏玻璃（dsh-better-sidebar）：独立于会话玻璃的一套细粒度控制，各自立即
		  // 生效并持久化（--we-sidebar-blur / --we-sidebar-alpha / --we-sidebar-color）。
		  const onSidebarBlur = (px) => {
		    selection.sidebarBlur = clampNum(px, 0, 200, DEFAULTS.sidebarBlur);
		    persistSelection(); emit();
		  };
		  const onSidebarAlpha = (pct) => {
		    selection.sidebarAlpha = clampNum(pct, 0, 200, DEFAULTS.sidebarAlpha);
		    persistSelection(); emit();
		  };
		  const onSidebarColor = (hex) => {
		    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
		    selection.sidebarColor = hex;
		    persistSelection(); emit();
		  };
		  // Mascot pull-cord show/hide, persisted with the other toggles.
		  const onRopeVisibilityChange = (e) => {
		    selection.ropeShown = e.target.checked;
		    persistSelection(); emit();
		  };
		  // Mascot form (maid / whale) + scale, persisted with the other rope settings.
		  const onRopeFormChange = (form) => {
		    if (!ROPE_FORM_VALUES.includes(form)) return;
		    selection.ropeForm = form;
		    persistSelection(); emit();
		  };
		  const onRopeScaleChange = (scale) => {
		    selection.ropeScale = clampNum(scale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, DEFAULTS.ropeScale);
		    persistSelection(); emit();
		  };
		  // 内容面（编辑器/终端）近不透明玻璃底：透明度滑块 + 底色（空 = 跟随主题）。
		  const onSidebarContentAlpha = (pct) => {
		    selection.sidebarContentAlpha = clampNum(pct, 0, 80, DEFAULTS.sidebarContentAlpha);
		    persistSelection(); applyEffects(); emit();
		  };
		  const onSidebarContentColor = (hex) => {
		    if (hex === "") {
		      selection.sidebarContentColor = ""; // 跟随主题面板色
		      persistSelection(); applyEffects(); emit();
		      return;
		    }
		    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
		    selection.sidebarContentColor = hex;
		    persistSelection(); applyEffects(); emit();
		  };
		  // 字体自定义（#57 精简回归版）：总开关 + 颜色/字重/字体族，各项立即生效并持久化。
		  const onToggleFontCustom = (v) => {
		    selection.fontCustom = !!v;
		    persistSelection(); applyEffects(); emit();
		  };
		  const onFontColor = (hex) => {
		    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
		    selection.fontColor = hex;
		    persistSelection(); applyEffects(); emit();
		  };
		  const onFontWeight = (v) => {
		    selection.fontWeight = clampNum(v, 100, 900, DEFAULTS.fontWeight);
		    persistSelection(); applyEffects(); emit();
		  };
		  const onFontFamily = (family) => {
		    if (!FONT_FAMILY_VALUES.includes(family)) return;
		    selection.fontFamily = family;
		    persistSelection(); applyEffects(); emit();
		  };

		  // Close the picker modal (ESC / backdrop / close buttons share this path).
		  const closePicker = () => {
		    selection.pickerOpen = false;
		    selection.batchMode = false;
		    selection.batchSelected = [];
		    emit();
		    // Focus restore: return focus to the「选择壁纸」button that opened the
		    // modal (WCAG focus management for dialogs).
		    if (pickerOpener && pickerOpener.isConnected) {
		      try { pickerOpener.focus(); } catch { /* ignore */ }
		    }
		  };
		  // ESC anywhere closes the modal. Capture phase + stopPropagation so the
		  // shell's own ESC handling (which may close the whole settings panel) never
		  // sees the key while our modal is open.
		  React.useEffect(() => {
		    const onKey = (e) => {
		      if (e.key === "Escape" && selection.pickerOpen) {
		        e.stopPropagation();
		        closePicker();
		      }
		    };
		    if (typeof window !== "undefined" && window.addEventListener) {
		      window.addEventListener("keydown", onKey, true);
		      return () => { window.removeEventListener("keydown", onKey, true); };
		    }
		  }, []);
		  // Scroll lock: while the modal is open the settings page behind it must not
		  // scroll (wheel over the modal would otherwise move the background).
		  React.useEffect(() => {
		    if (!sel.pickerOpen || typeof document === "undefined") return undefined;
		    const prev = document.body.style.overflow;
		    document.body.style.overflow = "hidden";
		    return () => { document.body.style.overflow = prev; };
		  }, [sel.pickerOpen]);

		  if (!sel.loaded) {
		    return React.createElement("div", { className: "we-picker" },
		      React.createElement("span", { className: "we-picker__hint" }, "扫描 Wallpaper Engine…"));
		  }
		  if (sel.inventory.error) {
		    return React.createElement("div", { className: "we-picker" },
		      React.createElement("div", { className: "we-picker__error" },
		        "未检测到 Wallpaper Engine：" + sel.inventory.error),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button", onClick: onRefresh, disabled: sel.loading,
		      }, sel.loading ? "刷新中…" : "重试"));
		  }

		  const list = sel.inventory.wallpapers;
		  // Title search (picker modal): narrows the playable grid on top of the
		  // rating/type filters. Case-insensitive substring match.
		  const query = (sel.search || "").trim().toLowerCase();
		  // Only playable Video/Web/Image wallpapers are shown — Scene/Application
		  // cannot be embedded in the web UI, so hiding them keeps the grid useful.
		  // Hidden (soft-deleted) wallpapers leave this list and move to the 已隐藏
		  // section. The rating/type filters further narrow playableList.
		  const playableList = list.filter((w) =>
		    isRotatableWallpaper(w) && !isHiddenWallpaper(w.id)
		    && (!query || String(w.title || "").toLowerCase().indexOf(query) !== -1));
		  // Per-category counts for the two filter dropdowns (playable, non-hidden):
		  // they reflect what is actually available, independent of the active filters.
		  const basePlayable = list.filter((w) => isPlayableType(w) && !isHiddenWallpaper(w.id));
		  // Single-pass aggregation — used to be 10 separate O(n) filters per render
		  // (5 rating options + 5 type options, each a full basePlayable scan).
		  const ratingCounts = { everyone: 0, pg13: 0, mature: 0, unrated: 0 };
		  const typeCounts = { video: 0, web: 0, image: 0, scene: 0 };
		  for (const w of basePlayable) {
		    const r = ratingOf(w);
		    ratingCounts[r] = (ratingCounts[r] || 0) + 1;
		    typeCounts[w.type] = (typeCounts[w.type] || 0) + 1;
		  }
		  // CD-rack mode: compact one-page grid (no pagination) + stronger overlap.
		  const cdMode = sel.pickerLayout === "classic";
		  const hiddenList = hiddenInventoryList();
		  const current = list.find((w) => w.id === sel.id) || null;
		  const uploadedList = list.filter(isUploadedWallpaper);
		  const groups = sel.rotationGroups;
		  const group = activeRotationGroup();
		  const candidates = rotationCandidates();
		  const playableCount = candidates.length;
		  const editing = sel.editing;
		  const INTERVALS = [1, 5, 10, 30, 60, 120];

		  // ── Pagination: big libraries must not render every card at once (hundreds
		  //    of thumbnails per emit make the picker lag). Each list slices to one
		  //    page of PAGE_SIZE cards; the page number clamps automatically when the
		  //    list shrinks (hide/restore/refresh). ──
		  const PAGE_SIZE = 24;
		  function pageSlice(list, page) {
		    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
		    const p = Math.min(Math.max(0, page | 0), pages - 1);
		    return { items: list.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), page: p, pages };
		  }
		  const normalPage = pageSlice(playableList, sel.page);
		  const hiddenPageView = pageSlice(hiddenList, sel.hiddenPage);
		  const editorPageView = pageSlice(playableInventory(), sel.editorPage);
		  const pagerRow = (count, page, pages, onPrev, onNext) =>
		    React.createElement("div", { className: "we-picker__pager" },
		      React.createElement("span", { className: "we-picker__hint" },
		        "共 " + count + " 个 · 第 " + (page + 1) + " / " + pages + " 页"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        disabled: page <= 0,
		        onClick: onPrev,
		      }, "‹ 上一页"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        disabled: page >= pages - 1,
		        onClick: onNext,
		      }, "下一页 ›"),
		    );

		  return React.createElement("div", { className: "we-picker", "data-we-cards": sel.pickerLayout },
		    // ── Card header (mirrors the skin-center's pluginCard header): plugin
		    //    name + live wallpaper count badge + description. ──
		    React.createElement("div", { className: "we-picker__card-head" },
		      React.createElement("span", { className: "we-picker__card-name" }, "Wallpaper Engine"),
		      React.createElement("span", { className: "we-picker__card-badge" }, String(playableList.length)),
		      React.createElement("span", { className: "we-picker__card-desc" }, "本地 Wallpaper Engine 壁纸 · 液态玻璃主题"),
		    ),
		    // ── 字体 (custom typography): 总开关（关 = 恢复 dsh 原生字体） +
		    //    颜色 / 字重 / 字体族，开启时才渲染细节控件。#57 精简回归版。 ──
		    React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__section-head" },
		        React.createElement("span", { className: "we-picker__section-label" }, "字体"),
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "字体自定义"),
		        React.createElement("label", { className: "we-picker__switch", title: "关闭后恢复 dsh 默认字体外观；开启后可调颜色/字重/字体族" },
		          React.createElement("input", {
		            type: "checkbox",
		            checked: sel.fontCustom,
		            onChange: (e) => onToggleFontCustom(e.target.checked),
		          }),
		          React.createElement("span", { className: "we-picker__switch-track" },
		            React.createElement("span", { className: "we-picker__switch-thumb" }),
		          ),
		        ),
		      ),
		      sel.fontCustom && React.createElement(React.Fragment, null,
		        React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
		          React.createElement("span", { className: "we-picker__hint we-picker__label" }, "字体颜色"),
		          React.createElement("label", { className: "we-picker__swatch-custom" },
		            React.createElement("input", {
		              type: "color",
		              value: sel.fontColor,
		              onInput: (e) => onFontColor(e.target.value),
		              onChange: (e) => onFontColor(e.target.value),
		              title: "自定义字体颜色",
		            }),
		            React.createElement("span", { className: "we-picker__hint" }, sel.fontColor),
		          ),
		        ),
		        SliderRow("字重", 100, 900, 50, sel.fontWeight, onFontWeight, String(sel.fontWeight), "font-weight"),
		        // 字体族选择：专用胶囊按钮（.we-picker__font-chip），每个选项用它
		        // 自己的字体渲染预览 —— 按钮上看到的字样即应用后的效果；flex-wrap
		        // 分行排布，7 项（含行楷）不再挤在圆形色板里。
		        React.createElement("div", { className: "we-picker__row we-picker__font-row" },
		          React.createElement("span", { className: "we-picker__hint we-picker__label" }, "字体"),
		          FONT_FAMILY_LABELS.map((f) =>
		            React.createElement("button", {
		              key: f.v,
		              type: "button",
		              className: "we-picker__font-chip" + (sel.fontFamily === f.v ? " we-picker__font-chip--active" : ""),
		              style: { fontFamily: fontFamilyStack(f.v) },
		              title: f.v === "inherit" ? "跟随 dsh 原生字体栈" : FONT_FAMILY_STACKS[f.v],
		              onClick: () => onFontFamily(f.v),
		              "aria-pressed": sel.fontFamily === f.v ? "true" : "false",
		              "aria-label": "字体 " + f.label,
		            }, f.label),
		          ),
		        ),
		      ),
		    ),
		    // ── 外观 (liquid-glass theming): 配色 presets + custom color, and the
		    //    glass 透明度 slider. Applied instantly via --we-accent /
		    //    --we-glass-alpha (applyEffects), persisted in localStorage. ──
		    React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__section-head" },
		        React.createElement("span", { className: "we-picker__section-label" }, "外观"),
		      ),
		      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "配色"),
		        ACCENT_PRESETS.map((hex) => React.createElement("button", {
		          key: hex,
		          className: "we-picker__swatch" + (sel.accent === hex ? " we-picker__swatch--active" : ""),
		          type: "button",
		          style: { background: hex },
		          title: hex,
		          onClick: () => onAccent(hex),
		          "aria-label": "配色 " + hex,
		        })),
		        React.createElement("label", { className: "we-picker__swatch-custom" },
		          React.createElement("input", {
		            type: "color",
		            value: sel.accent,
		            onInput: (e) => onAccent(e.target.value),
		            onChange: (e) => onAccent(e.target.value),
		            title: "自定义配色",
		          }),
		          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
		        ),
		      ),
		      // 玻璃颜色: the settings-window glass BASE tint. Defaults keep the stock
		      // look (white light / deep navy dark); picking any preset or a custom
		      // color tints the whole window glass in BOTH themes.
		      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "玻璃颜色"),
		        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
		          key: hex,
		          className: "we-picker__swatch" + (sel.glassColor === hex ? " we-picker__swatch--active" : ""),
		          type: "button",
		          style: { background: hex },
		          title: hex,
		          onClick: () => onGlassColor(hex),
		          "aria-label": "玻璃颜色 " + hex,
		        })),
		        React.createElement("label", { className: "we-picker__swatch-custom" },
		          React.createElement("input", {
		            type: "color",
		            value: sel.glassColor,
		            onInput: (e) => onGlassColor(e.target.value),
		            onChange: (e) => onGlassColor(e.target.value),
		            title: "自定义玻璃颜色",
		          }),
		          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
		        ),
		      ),
		      SliderRow("玻璃透明度", 0, 60, 5, sel.glassAlpha, onGlassAlpha, sel.glassAlpha + "%"),
		      // 设置窗口液态玻璃 master switch: turns the WHOLE native settings window
		      // (nav + every native section, not just this page) into liquid glass with
		      // the accent + transparency above; off restores the stock shell look.
		      React.createElement("label", { className: "we-picker__rotation-toggle we-picker__window-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.glassWindow,
		          onChange: (e) => {
		            selection.glassWindow = e.target.checked;
		            persistSelection();
		            emit();
		          },
		        }),
		        "设置窗口液态玻璃",
		      ),
		      React.createElement("span", { className: "we-picker__hint" },
		        "整个设置窗口（含 General / 模型 / 插件等全部原生分区）跟随配色与透明度；关闭则恢复原生样式",
		      ),
		      // 侧栏玻璃（dsh-better-sidebar 适配）：与设置窗口玻璃同级的一套独立细粒度
		      // 控制 —— 总开关 + 专用模糊 + 专用透明度 + 玻璃基底色调，全部只作用于
		      // dsh-better-sidebar 子树，不动会话玻璃（玻璃 / 玻璃透明度）的设置。
		      // 仅在 host 检测到 dsh-better-sidebar 已安装且启用时显示（sidebarPresent）。
		      // 开关本体 + 说明始终显示；三个细节滑块（侧栏模糊 / 侧栏透明度 / 侧栏玻璃
		      // 颜色）以「侧栏液态玻璃」开关为前提 —— 关闭时隐藏，开启后随 emit 重渲染
		      // 实时出现（滑块只在毛玻璃生效时有意义）。
		      sel.sidebarPresent && [
		      React.createElement("label", { key: "sidebar-glass-toggle", className: "we-picker__rotation-toggle we-picker__window-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.sidebarGlass,
		          onChange: (e) => {
		            selection.sidebarGlass = e.target.checked;
		            persistSelection();
		            emit();
		          },
		        }),
		        "侧栏液态玻璃",
		      ),
		      React.createElement("span", { key: "sidebar-glass-hint", className: "we-picker__hint" },
		        "dsh-better-sidebar 侧栏（文件 / 终端 / Git 等面板）的毛玻璃适配；关闭则恢复其原生外观",
		      ),
		      ],
		      sel.sidebarPresent && sel.sidebarGlass && [
		      SliderRow("侧栏模糊", 0, 200, 1, sel.sidebarBlur, onSidebarBlur, sel.sidebarBlur + "px", "sb-blur"),
		      SliderRow("侧栏透明度", 0, 200, 1, sel.sidebarAlpha, onSidebarAlpha, sel.sidebarAlpha + "%", "sb-alpha"),
		      React.createElement("div", { key: "sb-color", className: "we-picker__row we-picker__accent-row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "侧栏玻璃颜色"),
		        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
		          key: hex,
		          className: "we-picker__swatch" + (sel.sidebarColor === hex ? " we-picker__swatch--active" : ""),
		          type: "button",
		          style: { background: hex },
		          title: hex,
		          onClick: () => onSidebarColor(hex),
		          "aria-label": "侧栏玻璃颜色 " + hex,
		        })),
		        React.createElement("label", { className: "we-picker__swatch-custom" },
		          React.createElement("input", {
		            type: "color",
		            value: sel.sidebarColor,
		            onInput: (e) => onSidebarColor(e.target.value),
		            onChange: (e) => onSidebarColor(e.target.value),
		            title: "自定义侧栏玻璃颜色",
		          }),
		          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
		        ),
		      ),
		      // 内容面（编辑器 / 终端）近不透明玻璃底：透明度 + 底色。固定调色板
		      // （语法高亮 / ANSI）为不透明底设计，全透毛玻璃下注释灰不可读；这里
		      // 在"玻璃感"与"可读性"之间取平衡——透明度越大越透，底色空 = 跟随主题。
		      SliderRow("内容面透明度", 0, 80, 5, sel.sidebarContentAlpha, onSidebarContentAlpha, sel.sidebarContentAlpha + "%"),
		      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "内容面底色"),
		        React.createElement("button", {
		          className: "we-picker__swatch we-picker__swatch--auto" + (sel.sidebarContentColor === "" ? " we-picker__swatch--active" : ""),
		          type: "button",
		          title: "跟随主题面板色",
		          onClick: () => onSidebarContentColor(""),
		          "aria-label": "内容面底色 跟随主题",
		        }, "主题"),
		        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
		          key: hex,
		          className: "we-picker__swatch" + (sel.sidebarContentColor === hex ? " we-picker__swatch--active" : ""),
		          type: "button",
		          style: { background: hex },
		          title: hex,
		          onClick: () => onSidebarContentColor(hex),
		          "aria-label": "内容面底色 " + hex,
		        })),
		        React.createElement("label", { className: "we-picker__swatch-custom" },
		          React.createElement("input", {
		            type: "color",
		            value: sel.sidebarContentColor || "#1e1f26",
		            onInput: (e) => onSidebarContentColor(e.target.value),
		            onChange: (e) => onSidebarContentColor(e.target.value),
		            title: "自定义内容面底色",
		          }),
		          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
		        ),
		      ),
		      ],
		      // Chat-interface mascot (rope dock): show/hide the pull-cord + repo drawer.
		      React.createElement("label", { className: "we-picker__rotation-toggle we-picker__window-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.ropeShown !== false,
		          onChange: onRopeVisibilityChange,
		        }),
		        "显示吉祥物（聊天顶部拉绳）",
		      ),
		      React.createElement("span", { className: "we-picker__hint" },
		        "关闭后隐藏吉祥物与壁纸仓库抽屉；可随时在本页重新开启",
		      ),
		      // 吉祥物形态（maid = 默认小女仆 / whale = 鲸御姐）与大小，随 ropeShown
		      // 一起位于「外观」分区；关闭时仍可先设定，重新开启即生效。
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "吉祥物形态"),
		        React.createElement("select", {
		          className: "we-picker__playlist-select",
		          value: sel.ropeForm,
		          onChange: (e) => onRopeFormChange(e.target.value),
		          "aria-label": "吉祥物形态",
		          title: "选择吉祥物（聊天顶部拉绳）的形态",
		        },
		        ROPE_FORM_VALUES.map((k) =>
		          React.createElement("option", { key: k, value: k }, ROPE_FORMS[k].label),
		        ),
		        ),
		      ),
		      SliderRow("吉祥物大小", ROPE_SCALE_MIN, ROPE_SCALE_MAX, ROPE_SCALE_STEP,
		        sel.ropeScale, onRopeScaleChange, Math.round(sel.ropeScale * 100) + "%", "rope-scale"),
		    ),
		    // ── Card-style switch: classic (WE's original aspect-ratio 16/9 cards —
		    //    the CD-like look the author liked) vs the rewritten fixed-height
		    //    cards that never overlap in older browsers. The vinyl record beside
		    //    the selection stays in BOTH styles (here + modal head). ──
		    React.createElement("div", { className: "we-picker__row" },
		      React.createElement("span", { className: "we-picker__hint we-picker__label" }, "紧凑布局"),
		      React.createElement("label", { className: "we-picker__switch", title: "紧凑 CD 架：层叠 + 一页到底" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.pickerLayout === "classic",
		          onChange: (e) => onLayoutChange(e.target.checked ? "classic" : "fixed"),
		        }),
		        React.createElement("span", { className: "we-picker__switch-track" },
		          React.createElement("span", { className: "we-picker__switch-thumb" }),
		        ),
		      ),
		      React.createElement("span", { className: "we-picker__hint" },
		        sel.pickerLayout === "classic"
		          ? "CD 架：层叠 + 一页到底"
		          : "常规网格 · 分页"),
		      // Edge 兼容渲染开关：与"紧凑布局"同一行、靠右。仅在 Edge 中生效
		      // （canvas 渲染，避免浏览器自带的「下载 / 投屏」悬浮工具栏）。
		      React.createElement("label", {
		        className: "we-picker__switch we-picker__switch--edge",
		        // 关键布局用内联样式而非插件 CSS：插件样式表按 TAG_ID 去重注入，
		        // 页面若残留旧样式表，新 CSS 规则不会生效（开关会靠左 / 不居中 /
		        // 字号不同）。内联样式始终生效，与样式表注入状态无关。
		        style: { marginLeft: "auto", alignItems: "center", gap: "6px", fontSize: "inherit" },
		        title: "Edge 兼容：视频壁纸改用 canvas 渲染，避免浏览器自带的「下载 / 投屏」悬浮工具栏；关闭则始终使用原生 <video>",
		      },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "Edge 兼容"),
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.edgeCompat !== false,
		          onChange: (e) => onEdgeCompatChange(e.target.checked),
		        }),
		        React.createElement("span", { className: "we-picker__switch-track" },
		          React.createElement("span", { className: "we-picker__switch-thumb" }),
		        ),
		      ),
		    ),
		    // ── 当前壁纸: vinyl record beside the selection, in both card styles. ──
		    React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__current" },
		        React.createElement(VinylRecord, {
		          cover: current && current.preview, title: current ? current.title : "",
		          playing: sel.playing && Boolean(sel.url),
		        }),
		        React.createElement("div", { className: "we-picker__current-info" },
		          React.createElement("div", { className: "we-picker__current-title", title: current ? current.title : "" },
		            sel.id && current ? current.title : "未选择壁纸"),
		          React.createElement("div", { className: "we-picker__current-meta" },
		            current
		              ? ({ video: "视频壁纸", web: "网页壁纸", image: "图片壁纸", scene: "场景壁纸（静态帧）" }[current.type] || "壁纸") + (sel.playing ? " · 播放中" : " · 已暂停")
		              : "尚未选择壁纸"),
		        ),
		        React.createElement("button", {
		          className: "we-picker__btn we-picker__btn--primary", type: "button",
		          ref: (el) => { pickerOpener = el; },
		          onClick: () => {
		            selection.pickerOpen = true;
		            selection.modalView = "normal";
		            pickerFocusPending = true; // 打开后焦点落入模态框（见 modalInitialFocus）
		            emit();
		          },
		        }, "选择壁纸"),
		      ),
		    // ── Wallpaper picker modal. Portalled onto <body>: fixed positioning is
		    //    immune to ancestor transforms/backdrop-filters (the shell's own glass
		    //    effects would otherwise trap it), and z-index 1000 sits above the
		    //    shell overlays. Close: ESC, backdrop click, or the close buttons. ──
		    sel.pickerOpen && (isRepoPanelCopy || !repoPanelOwnsModal) && ReactDOM.createPortal(
		      // repoPanel path: the picker opens as its own right-quarter liquid-glass
		      // window (same recipe as the repo panel), NOT the centred dark dialog that
		      // the settings copy uses. The scrim is a transparent full-screen click
		      // catcher (no dark dim/blur) so picking stays visually continuous.
		      React.createElement("div", { className: isRepoPanelCopy ? "we-repo-panel__modal-scrim" : "we-picker__modal-overlay", onClick: closePicker },
		        React.createElement("div", {
		          className: isRepoPanelCopy ? "we-picker__modal we-picker__modal--panel" : "we-picker__modal",
		          "data-we-cards": sel.pickerLayout,
		          role: "dialog",
		          "aria-modal": "true",
		          "aria-label": "选择壁纸",
		          onClick: (e) => e.stopPropagation(),
		          onKeyDown: trapModalTab,
		        },
		          React.createElement("div", { className: "we-picker__modal-head" },
		            React.createElement("div", { className: "we-picker__modal-head-left" },
		              React.createElement(VinylRecord, {
		                cover: current && current.preview, title: current ? current.title : "",
		                playing: sel.playing && Boolean(sel.url), sm: true,
		              }),
		              React.createElement("span", { className: "we-picker__modal-title" }, "选择壁纸"),
		            ),
		            React.createElement("button", {
		              className: "we-picker__btn", type: "button", onClick: closePicker,
		              // 打开模态框时焦点落在这里（一次性，见 modalInitialFocus）。
		              ref: modalInitialFocus,
		            }, "关闭"),
		          ),
		          React.createElement("div", { className: "we-picker__modal-tabs", role: "tablist" },
		            React.createElement("button", {
		              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? "" : " we-picker__tab--active"),
		              type: "button",
		              role: "tab",
		              "aria-selected": sel.modalView !== "hidden",
		              onClick: () => { selection.modalView = "normal"; emit(); },
		            }, "正常列表（" + playableList.length + "）"),
		            React.createElement("button", {
		              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? " we-picker__tab--active" : ""),
		              type: "button",
		              role: "tab",
		              "aria-selected": sel.modalView === "hidden",
		              onClick: () => { selection.modalView = "hidden"; selection.batchMode = false; selection.batchSelected = []; emit(); },
		            }, "已隐藏（" + hiddenList.length + "）"),
		          ),
		          sel.modalView === "hidden"
		            ? React.createElement("div", { className: "we-picker__modal-body" },
		                hiddenList.length === 0
		                  ? React.createElement("span", { className: "we-picker__hint" }, "没有已隐藏的壁纸")
		                  : React.createElement("div", { className: "we-picker__grid" },
		                      React.createElement("div", { className: "we-picker__row" },
		                        React.createElement("span", { className: "we-picker__hint" },
		                          "已隐藏 " + hiddenList.length + " 张（仅从列表隐藏，不删除源文件）"),
		                        React.createElement("button", {
		                          className: "we-picker__btn", type: "button",
		                          onClick: () => {
		                            if (!window.confirm("恢复全部 " + hiddenList.length + " 张已隐藏壁纸？")) return;
		                            restoreWallpapers(hiddenList.map((w) => w.id));
		                          },
		                        }, "全部恢复"),
		                      ),
		                      (cdMode ? hiddenList : hiddenPageView.items).map((w) => React.createElement("div", {
		                        key: w.id,
		                        className: "we-picker__card we-picker__card--hidden",
		                        role: "button",
		                        tabIndex: 0,
		                        title: w.title,
		                        "aria-label": "恢复并应用 " + w.title,
		                        onClick: () => applySelection(w.id),
		                        // 键盘可达性：正常列表卡片一直有 Enter/Space 处理，
		                        // 已隐藏卡片漏了 —— 补上（共享 cardKeyDown）。
		                        onKeyDown: cardKeyDown,
		                      },
		                      w.preview
		                        ? React.createElement("img", {
		                            src: w.preview, alt: w.title, loading: "lazy",
		                            onError: (e) => { e.target.style.display = "none"; },
		                            onLoad: (e) => { e.target.style.opacity = "1"; },
		                          })
		                        : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
		                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
		                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, "静态帧"),
		                      React.createElement("button", {
		                        className: "we-picker__card-hide", type: "button",
		                        title: "恢复此壁纸",
		                        onClick: (e) => { e.stopPropagation(); restoreWallpapers([w.id]); },
		                      }, "恢复"),
		                      )),
		                    ),
		                    !cdMode && hiddenPageView.pages > 1 && pagerRow(
		                      hiddenList.length, hiddenPageView.page, hiddenPageView.pages,
		                      () => { selection.hiddenPage--; emit(); },
		                      () => { selection.hiddenPage++; emit(); },
		                    ),
		              )
		            : React.createElement("div", { className: "we-picker__modal-body" },
		                React.createElement("div", { className: "we-picker__row" },
		                  React.createElement("span", { className: "we-picker__hint" },
		                    playableList.length + " 个可播放壁纸 · 点击卡片即应用"),
		                  React.createElement("button", {
		                    className: "we-picker__btn", type: "button",
		                    onClick: () => { selection.batchMode = !selection.batchMode; selection.batchSelected = []; emit(); },
		                    disabled: playableList.length === 0,
		                    title: "多选后批量隐藏",
		                  }, selection.batchMode ? "退出批量" : "批量"),
		                ),
		                selection.batchMode && React.createElement("div", { className: "we-picker__row we-picker__batch-bar" },
		                  React.createElement("span", { className: "we-picker__hint" }, "已选 " + selection.batchSelected.length + " 张"),
		                  React.createElement("button", {
		                    className: "we-picker__btn", type: "button",
		                    disabled: selection.batchSelected.length === 0,
		                    onClick: () => {
		                      const n = selection.batchSelected.length;
		                      if (!window.confirm("隐藏选中的 " + n + " 张壁纸？可在「已隐藏」中随时恢复。")) return;
		                      hideWallpapers(selection.batchSelected.slice());
		                      selection.batchMode = false;
		                      selection.batchSelected = [];
		                      emit();
		                    },
		                  }, "批量隐藏"),
		                  React.createElement("button", {
		                    className: "we-picker__btn", type: "button",
		                    onClick: () => { selection.batchMode = false; selection.batchSelected = []; emit(); },
		                  }, "取消"),
		                ),
		                React.createElement("div", { className: "we-picker__row we-picker__filter-row" },
		                  // 标题搜索：几百上千张壁纸时最快的定位方式。输入即过滤
		                  // （重置到第 1 页），与分级/类型过滤叠加。
		                  React.createElement("input", {
		                    className: "we-picker__text we-picker__search", type: "text",
		                    value: sel.search,
		                    placeholder: "搜索壁纸标题…",
		                    "aria-label": "搜索壁纸标题",
		                    onInput: (e) => { selection.search = e.target.value; selection.page = 0; emit(); },
		                  }),
		                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "内容分级"),
		                  React.createElement("select", {
		                    className: "we-picker__playlist-select",
		                    value: sel.contentRatingFilter,
		                    onChange: onRatingFilterChange,
		                    "aria-label": "内容分级",
		                    title: "对应 Wallpaper Engine 的内容分级（project.json contentrating）",
		                  },
		                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
		                  React.createElement("option", { value: "everyone" }, "Everyone / G（" + ratingCounts.everyone + "）"),
		                  React.createElement("option", { value: "pg13" }, "PG13（" + ratingCounts.pg13 + "）"),
		                  React.createElement("option", { value: "mature" }, "Mature / R（" + ratingCounts.mature + "）"),
		                  React.createElement("option", { value: "unrated" }, "未分级（" + ratingCounts.unrated + "）"),
		                  ),
		                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "类型"),
		                  React.createElement("select", {
		                    className: "we-picker__playlist-select",
		                    value: sel.typeFilter,
		                    onChange: onTypeFilterChange,
		                    "aria-label": "类型",
		                    title: "按壁纸类型过滤",
		                  },
		                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
		                  React.createElement("option", { value: "video" }, "视频（" + (typeCounts.video || 0) + "）"),
		                  React.createElement("option", { value: "web" }, "网页（" + (typeCounts.web || 0) + "）"),
		                  React.createElement("option", { value: "image" }, "图片（" + (typeCounts.image || 0) + "）"),
		                  React.createElement("option", { value: "scene" }, "场景（" + (typeCounts.scene || 0) + "）"),
		                  ),
		                ),
		                React.createElement("div", { className: "we-picker__grid" },
		                  // "Close wallpaper" card — equivalent of the old first <option>.
		                  // Rendered as a <div role="button"> like every other card:
		                  // <button> ignores aspect-ratio in several browsers, which
		                  // collapses the cell and lets the "✕ 关闭" label float over
		                  // the adjacent thumbnail.
		                  React.createElement("div", {
		                    className: "we-picker__card" + (sel.id ? "" : " we-picker__card--selected"),
		                    role: "button",
		                    tabIndex: 0,
		                    onClick: onClear,
		                    title: "关闭壁纸",
		                    onKeyDown: cardKeyDown,
		                  },
		                  React.createElement("span", { className: "we-picker__card-close" }, "✕ 关闭"),
		                  ),
		                  playableList.length === 0
		                    ? React.createElement("span", { className: "we-picker__hint" },
		                        query
		                          ? "没有匹配「" + sel.search + "」的壁纸 · 试试缩短关键词或清除过滤"
		                          : "没有可播放的壁纸")
		                    : (cdMode ? playableList : normalPage.items).map((w) => React.createElement("div", {
		                        key: w.id,
		                        className: "we-picker__card" + (w.id === sel.id ? " we-picker__card--selected" : "")
		                          // 批量勾选高亮：此前勾选态只进了 batchSelected，高亮 CSS
		                          // 却挂在 --selected（=当前播放）上，勾了永远不亮。
		                          + (selection.batchMode && selection.batchSelected.indexOf(w.id) >= 0 ? " we-picker__card--checked" : ""),
		                        role: "button",
		                        tabIndex: 0,
		                        title: w.title,
		                        onClick: () => {
		                          if (selection.batchMode) {
		                            const i = selection.batchSelected.indexOf(w.id);
		                            if (i >= 0) selection.batchSelected.splice(i, 1);
		                            else selection.batchSelected.push(w.id);
		                            emit();
		                          } else {
		                            applySelection(w.id);
		                          }
		                        },
		                        onKeyDown: cardKeyDown,
		                      },
		                      w.preview
		                        ? React.createElement("img", {
		                            src: w.preview, alt: w.title, loading: "lazy",
		                            onError: (e) => { e.target.style.display = "none"; },
		                            onLoad: (e) => { e.target.style.opacity = "1"; },
		                          })
		                        : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
		                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
		                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, "静态帧"),
		                      selection.batchMode
		                        ? React.createElement("span", { className: "we-picker__card-check" },
		                            selection.batchSelected.indexOf(w.id) >= 0 ? "✓" : "")
		                        : React.createElement("button", {
		                            className: "we-picker__card-hide", type: "button",
		                            title: "隐藏此壁纸（可在「已隐藏」中恢复）",
		                            onClick: (e) => { e.stopPropagation(); hideWallpapers([w.id]); },
		                          }, "隐藏"),
		                      )),
		                ),
		                !cdMode && normalPage.pages > 1 && pagerRow(
		                  playableList.length, normalPage.page, normalPage.pages,
		                  () => { selection.page--; emit(); },
		                  () => { selection.page++; emit(); },
		                ),
		              ),
		          React.createElement("div", { className: "we-picker__modal-foot" },
		            React.createElement("span", { className: "we-picker__hint" }, "ESC / 点击遮罩关闭"),
		            React.createElement("button", {
		              className: "we-picker__btn", type: "button", onClick: closePicker,
		            }, "关闭"),
		          ),
		        ),
		      ),
		      document.body,
		    ),
		    // ── Playback controls (wallpaper-independent; the thumbnail grid lives in
		    //    the modal above, so these stay within reach). ──
		    React.createElement("div", { className: "we-picker__row" },
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: onTogglePlay, disabled: !sel.url,
		      }, sel.playing ? "暂停" : "播放"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: onClear, disabled: !sel.id,
		      }, "关闭"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: onRefresh, disabled: sel.loading,
		      }, sel.loading ? "刷新中…" : "刷新"),
		    ),
		    ),
		    // ── 自定义壁纸: local JPG/PNG/MP4 as wallpapers. Files are written by the
		    //    host into its plugin-managed directory and served through the same
		    //    media/preview routes (read-A storage: survives restarts, no quota
		    //    limits). Uploads merge into the inventory on the host side. ──
		    React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__section-head" },
		        React.createElement("span", { className: "we-picker__section-label" }, "自定义壁纸"),
		      ),
		      React.createElement("div", { className: "we-picker__uploads" },
		      // Storage location — users can point uploads at a non-system drive
		      // (most people don't want wallpaper files piling up on C:). The host
		      // persists the choice and migrates existing files on change.
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "存储位置"),
		        React.createElement("span", {
		          className: "we-picker__uploads-path",
		        }, sel.inventory.uploadDir || "—"),
		        React.createElement("button", {
		          className: "we-picker__btn", type: "button",
		          disabled: sel.uploading,
		          onClick: () => {
		            selection.editingUploadDir = true;
		            selection.uploadDirDraft = sel.inventory.uploadDir || "";
		            emit();
		          },
		        }, "更改"),
		      ),
		      sel.editingUploadDir && React.createElement("div", { className: "we-picker__row" },
		        React.createElement("input", {
		          className: "we-picker__text", type: "text",
		          value: selection.uploadDirDraft,
		          placeholder: "绝对路径，如 D:\\MyWallpapers",
		          onInput: (e) => { selection.uploadDirDraft = e.target.value; emit(); },
		          onKeyDown: (e) => {
		            if (e.key === "Enter") changeUploadDir(selection.uploadDirDraft, true);
		            if (e.key === "Escape") { selection.editingUploadDir = false; emit(); }
		          },
		        }),
		        React.createElement("button", {
		          className: "we-picker__btn", type: "button",
		          disabled: sel.uploading,
		          onClick: () => changeUploadDir(selection.uploadDirDraft, true),
		        }, "保存"),
		        React.createElement("button", {
		          className: "we-picker__btn", type: "button",
		          onClick: () => { selection.editingUploadDir = false; emit(); },
		        }, "取消"),
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint" },
		          "已有文件会迁移到新位置"),
		        React.createElement("span", { className: "we-picker__hint" },
		          "支持 ~ 表示用户主目录"),
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "自定义"),
		        React.createElement("input", {
		          className: "we-picker__file", type: "file",
		          accept: ".jpg,.jpeg,.png,.mp4",
		          disabled: sel.uploading,
		          onChange: (e) => {
		            const f = e.target.files && e.target.files[0];
		            if (f) uploadWallpaperFile(f);
		            e.target.value = "";
		          },
		        }),
		        sel.uploading && React.createElement("span", { className: "we-picker__hint" }, "上传中…"),
		      ),
		      sel.uploadError && React.createElement("div", { className: "we-picker__error" }, sel.uploadError),
		      sel.uploadNote && React.createElement("div", { className: "we-picker__note" }, sel.uploadNote),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint" }, "已上传 " + uploadedList.length + " 个"),
		        React.createElement("span", { className: "we-picker__hint" }, "格式仅限 JPG / PNG / MP4"),
		      ),
		      uploadedList.length > 0 && React.createElement("div", { className: "we-picker__uploads-list" },
		        uploadedList.map((w) => React.createElement("div", { key: w.id, className: "we-picker__uploads-item" },
		          React.createElement("span", { className: "we-picker__uploads-name", title: w.title }, w.title),
		          React.createElement("span", { className: "we-picker__hint" }, w.type === "video" ? "MP4" : "图片"),
		          React.createElement("button", {
		            className: "we-picker__btn", type: "button",
		            disabled: sel.uploading,
		            onClick: () => {
		              if (!window.confirm("移除自定义壁纸「" + w.title + "」？此操作会删除本地文件，且不可恢复。")) return;
		              removeUploadWallpaper(w.id);
		            },
		          }, "移除"),
		        )),
		      ),
		      ),
		    ),
		    // ── 轮播列表: user-defined carousel lists, each with its own wallpaper
		    //    set, interval and order. Fully client-side (localStorage). ──
		    React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__section-head" },
		        React.createElement("span", { className: "we-picker__section-label" }, "轮播列表"),
		      ),
		      React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
		      React.createElement("select", {
		        className: "we-picker__playlist-select",
		        value: sel.rotationGroupId,
		        onChange: onGroupChange,
		        disabled: groups.length === 0,
		        "aria-label": "轮播列表",
		      },
		      React.createElement("option", { value: "" }, groups.length ? "— 选择轮播列表 —" : "— 暂无轮播列表 —"),
		      ...groups.map((g) => React.createElement("option", {
		        key: g.id, value: g.id,
		      }, g.name + "（" + groupWallpapers(g).length + " 可播放 · " + g.interval + " 分钟）")),
		      ),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: startCreateGroup,
		      }, "新建"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: () => startEditGroup(sel.rotationGroupId),
		        disabled: !sel.rotationGroupId,
		      }, "编辑"),
		      React.createElement("button", {
		        className: "we-picker__btn", type: "button",
		        onClick: onDeleteGroup,
		        disabled: !sel.rotationGroupId,
		      }, "删除"),
		    ),
		    editing && React.createElement("div", { className: "we-picker__editor" },
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "名称"),
		        React.createElement("input", {
		          className: "we-picker__text", type: "text",
		          value: editing.name,
		          "aria-label": "轮播列表名称",
		          onInput: (e) => { editing.name = e.target.value; emit(); },
		        }),
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "间隔"),
		        React.createElement("select", {
		          className: "we-picker__rotation-interval",
		          value: String(editing.interval),
		          onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
		          "aria-label": "轮播间隔",
		        },
		        ...INTERVALS.map((minutes) =>
		          React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
		        )),
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "顺序"),
		        React.createElement("select", {
		          className: "we-picker__playlist-select",
		          value: editing.order,
		          onChange: (e) => { editing.order = e.target.value; emit(); },
		          "aria-label": "轮播顺序",
		        },
		        React.createElement("option", { value: "sequence" }, "顺序"),
		        React.createElement("option", { value: "random" }, "随机"),
		        ),
		      ),
		      React.createElement("div", { className: "we-picker__editor-grid" },
		        playableInventory().length === 0
		          ? React.createElement("span", { className: "we-picker__hint" }, "没有可播放的壁纸")
		          : (cdMode ? playableInventory() : editorPageView.items).map((w) => {
		              const checked = editing.wallpaperIds.indexOf(w.id) >= 0;
		              return React.createElement("button", {
		                key: w.id,
		                className: "we-picker__editor-card" + (checked ? " we-picker__editor-card--checked" : ""),
		                type: "button",
		                title: w.title,
		                "aria-pressed": checked,
		                "aria-label": w.title,
		                onClick: () => {
		                  const i = editing.wallpaperIds.indexOf(w.id);
		                  if (i >= 0) editing.wallpaperIds.splice(i, 1);
		                  else editing.wallpaperIds.push(w.id);
		                  emit();
		                },
		              },
		              w.preview
		                ? React.createElement("img", {
		                    src: w.preview, alt: w.title, loading: "lazy",
		                    onError: (e) => { e.target.style.display = "none"; },
		                            onLoad: (e) => { e.target.style.opacity = "1"; },
		                  })
		                : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
		              checked && React.createElement("span", { className: "we-picker__editor-check" }, "✓"),
		              );
		            }),
		      ),
		      !cdMode && editorPageView.pages > 1 && pagerRow(
		        playableInventory().length, editorPageView.page, editorPageView.pages,
		        () => { selection.editorPage--; emit(); },
		        () => { selection.editorPage++; emit(); },
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint" }, "已选 " + editing.wallpaperIds.length + " 个"),
		        sel.inventory.playlists.length > 0 && React.createElement("select", {
		          className: "we-picker__playlist-select",
		          value: "",
		          onChange: (e) => {
		            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
		            if (p) importPlaylistIntoDraft(p);
		          },
		        },
		        React.createElement("option", { value: "" }, "从 WE 播放列表导入…"),
		        ...sel.inventory.playlists.map((p) => React.createElement("option", {
		          key: p.id, value: p.id,
		        }, p.name + "（" + (p.portableCount || 0) + " 可播放）")),
		        ),
		      ),
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("button", {
		          className: "we-picker__btn", type: "button",
		          onClick: saveEditingGroup,
		        }, "保存"),
		        React.createElement("button", {
		          className: "we-picker__btn", type: "button",
		          onClick: cancelEditGroup,
		        }, "取消"),
		      ),
		    ),
		    React.createElement("div", { className: "we-picker__row we-picker__rotation-row" },
		      React.createElement("label", { className: "we-picker__rotation-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.rotationEnabled,
		          onChange: onToggleRotation,
		          disabled: !sel.rotationGroupId || playableCount < 2,
		        }),
		        "自动轮转",
		      ),
		      React.createElement("select", {
		        className: "we-picker__rotation-interval",
		        value: String(group ? group.interval : DEFAULTS.rotationInterval),
		        onChange: onGroupInterval,
		        disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2,
		        "aria-label": "轮转间隔",
		      },
		      ...INTERVALS.map((minutes) =>
		        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
		      )),
		      !sel.rotationGroupId && React.createElement("span", { className: "we-picker__hint" }, "请先选择或新建一个轮播列表"),
		      sel.rotationGroupId && playableCount < 2 && React.createElement("span", { className: "we-picker__hint" }, "当前列表至少需要 2 个可播放壁纸"),
		    ),
		    ),
		    sel.id && React.createElement("div", { className: "we-picker__section" },
		      React.createElement("div", { className: "we-picker__section-head" },
		        React.createElement("span", { className: "we-picker__section-label" }, "壁纸效果"),
		      ),
		      React.createElement(React.Fragment, null,
		      SliderRow("壁纸模糊", 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
		      SliderRow("亮度", 40, 160, 5, sel.backgroundBrightness, onBackgroundBrightness, sel.backgroundBrightness + "%"),
		      SliderRow("对比度", 40, 200, 5, sel.backgroundContrast, onBackgroundContrast, sel.backgroundContrast + "%"),
		      SliderRow("饱和度", 0, 200, 5, sel.backgroundSaturate, onBackgroundSaturate, sel.backgroundSaturate + "%"),
		      SliderRow("暗化", 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
		      SliderRow("边框", 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%"),
		      SliderRow("玻璃", 0, 60, 1, sel.blur, onBlur, sel.blur + "px"),
		      // beta场景动画: 默认关闭 → scene 壁纸只渲染静态帧 (稳定, 与官方静态帧
		      // 一致); 开启后才启动 scene-anim 视频后台渲染 (CPU 渲染试验性, 可能有
		      // 组件错误)。关闭时若已在播放动画视频 → 回退静态帧并取消进行中的渲染。
		      sel.type === "scene" && React.createElement("div", { className: "we-picker__row" },
		        React.createElement("label", { className: "we-picker__rotation-toggle" },
		          React.createElement("input", {
		            type: "checkbox",
		            checked: sel.betaSceneAnim === true,
		            onChange: (e) => {
		              selection.betaSceneAnim = e.target.checked;
		              const enable = e.target.checked;
		              persistSelection();
		              if (!enable) {
		                // 关闭: 取消动画升级 (渲染任务随 probe abort 取消), 回退静态帧
		                cancelSceneAnimUpgrade();
		                if (sel.type === "scene" && sel.sceneFrameUrl
		                  && selection.url && selection.url.indexOf("/scene-anim/") !== -1) {
		                  selection.url = sel.sceneFrameUrl;
		                  syncLayers();
		                }
		              } else if (sel.type === "scene" && sel.sceneFrameUrl && !sel.sceneVideo) {
		                // 开启: 先把 beta 持久化到宿主端 (宿主 /scene-anim 路由按 config.json
		                // 门控 — 防抖的 PUT 落地前渲染请求会先到宿主 → 403 → 进度卡 0)。
		                // 跳过防抖立即冲刷, 等 PUT 落盘完成 (宿主「响应即已持久化」) 再触发升级。
		                if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
		                writeLocalCache();
		                const p = pushPersisted();
		                (p && typeof p.then === "function" ? p : Promise.resolve())
		                  .then(() => { if (selection.betaSceneAnim && sel.sceneFrameUrl && !sel.sceneVideo) queueSceneAnimUpgrade(sel.sceneFrameUrl); })
		                  .catch(() => { if (selection.betaSceneAnim && sel.sceneFrameUrl && !sel.sceneVideo) queueSceneAnimUpgrade(sel.sceneFrameUrl); });
		              }
		              emit();
		            },
		          }),
		          "beta场景动画",
		        ),
		        React.createElement("span", { className: "we-picker__hint" },
		          "实验性场景壁纸渲染引擎，不要开启（除非你知道自己在干什么）",
		        ),
		      ),
		      // Playback speed — native playbackRate, instant, no media reload. Video
		      // and scene-animation wallpapers (web/iframe wallpapers have no playbackRate).
		      (sel.type === "video" || (sel.type === "scene" && sel.url && sel.url.indexOf("/scene-anim/") !== -1))
		        && React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "倍速"),
		        [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
		          React.createElement("button", {
		            key: rate,
		            className: "we-picker__btn we-picker__rate" + (sel.playbackRate === rate ? " we-picker__rate--active" : ""),
		            type: "button",
		            onClick: () => { selection.playbackRate = rate; persistSelection(); emit(); },
		          }, String(rate).replace(/\.?0+$/, "") + "x"),
		        ),
		      ),
		      // 解码帧率上限（抽帧转码）：host 一次性把源视频重编码为上限帧率（时间线
		      // 1.0x 正常速度，解码占用随帧率线性下降），与倍速解耦。首次转码需等待，
		      // 播放中原片、转好自动切换；无 ffmpeg 自动回退原片。
		      // scene 动画: fps 参数在渲染时决定 (scene-anim ?fps=..), 变更后重渲染。
		      (sel.type === "video" || (sel.type === "scene" && sel.url && sel.url.indexOf("/scene-anim/") !== -1))
		        && React.createElement("div", { className: "we-picker__row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "帧率上限"),
		        FPS_CAP_VALUES.map((cap) =>
		          React.createElement("button", {
		            key: cap,
		            className: "we-picker__btn we-picker__rate" + (sel.fpsCap === cap ? " we-picker__rate--active" : ""),
		            type: "button",
		            onClick: () => {
		              selection.fpsCap = cap; persistSelection(); refreshMediaInfo(true); emit();
		              // scene 动画: fpsCap 变更 → 以新帧率重新渲染动画视频
		              // (sceneVideo 内嵌 MP4 的场景不重渲染 — 硬件解码不受 fpsCap 影响)
		              if (sel.type === "scene" && sel.sceneFrameUrl && !sel.sceneVideo) queueSceneAnimUpgrade(sel.sceneFrameUrl);
		            },
		          }, cap === 0 ? "无限制" : cap + "fps"),
		        ),
		      ),
		      // Scene 动画渲染进度: 首次渲染分钟级, 后台渲染期间显示进度条
		      // (轮询 /scene-anim-progress; 完成或切换壁纸后置 null)。
		      sel.type === "scene" && sel.sceneAnimProgress != null && sel.sceneAnimProgress < 100
		        && React.createElement("div", { className: "we-picker__row we-picker__prog" },
		          React.createElement("div", { className: "we-picker__prog-track" },
		            React.createElement("div", {
		              className: "we-picker__prog-bar",
		              style: { width: Math.max(2, Math.min(100, sel.sceneAnimProgress || 0)) + "%" },
		            }),
		          ),
		          React.createElement("span", { className: "we-picker__hint" },
		            "场景动画渲染中 " + (sel.sceneAnimProgress || 0) + "%",
		          ),
		        ),
		      // Source metadata + transcode status (host moov probe / transcode lifecycle).
		      sel.type === "video" && sel.mediaInfo && React.createElement("span", { className: "we-picker__hint" },
		        "源 " + sel.mediaInfo.width + "×" + sel.mediaInfo.height
		          + (sel.mediaInfo.fps ? " · " + sel.mediaInfo.fps + "fps" : "")
		          + (sel.mediaInfo.codec ? " · " + codecLabel(sel.mediaInfo.codec) : "")
		          + (sel.transcodeState === "working" ? " · 抽帧准备中…"
		            : sel.transcodeState === "ready" ? " · 已切换至 " + sel.fpsCap + "fps 抽帧版（正常速度，解码占用约减半）"
		            : sel.transcodeState === "fallback" ? " · 转码不可用，已回退原片"
		            : sel.transcodeState === "skipped" ? " · 源帧率 ≤ 上限，无需抽帧"
		            : ""),
		      ),
		      // Download / transcode progress bar (polled from /transcode-progress).
		      sel.type === "video" && sel.transcodeState === "working" && sel.transcodeProgress
		        && React.createElement("div", { className: "we-picker__row we-picker__prog" },
		          React.createElement("div", {
		            className: "we-picker__prog-track",
		            role: "progressbar",
		            "aria-label": "转码进度",
		            "aria-valuemin": 0,
		            "aria-valuemax": 100,
		            "aria-valuenow": Math.max(0, Math.min(100, sel.transcodeProgress.percent || 0)),
		          },
		            React.createElement("div", {
		              className: "we-picker__prog-bar",
		              style: { width: Math.max(2, Math.min(100, sel.transcodeProgress.percent || 0)) + "%" },
		            }),
		          ),
		          React.createElement("span", { className: "we-picker__hint" },
		            sel.transcodeProgress.phase === "download"
		              ? "下载 ffmpeg " + (sel.transcodeProgress.percent || 0) + "%"
		              : sel.transcodeProgress.phase === "transcode" && sel.transcodeProgress.finalizing ? "收尾中…"
		              : sel.transcodeProgress.phase === "transcode"
		                ? "转码中 " + (sel.transcodeProgress.percent || 0) + "%"
		                  + (sel.transcodeProgress.eta ? " · 约剩 " + sel.transcodeProgress.eta + " 秒" : "")
		              : sel.transcodeProgress.phase === "done" ? "即将完成…"
		              : "准备中…",
		          ),
		        ),
		      // Horizontal mirror — scaleX(-1), compositor-only; works for video,
		      // web (iframe) and (later) uploaded image wallpapers alike.
		      React.createElement("label", { className: "we-picker__rotation-toggle" },
		        React.createElement("input", {
		          type: "checkbox",
		          checked: sel.flip,
		          onChange: (e) => { selection.flip = e.target.checked; persistSelection(); emit(); },
		        }),
		        "水平翻转",
		      ),
		      // Fit mode — applies to the CURRENT wallpaper whatever its type (WE
		      // video/scene image and custom uploads alike; web/iframe wallpapers
		      // have no object-fit). 覆盖=cover 填充=contain 居中=center 拉伸=fill
		      React.createElement("div", { className: "we-picker__row we-picker__fit-row" },
		        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "适配"),
		        ["cover", "contain", "center", "fill"].map((mode) => {
		          const label = { cover: "覆盖", contain: "填充", center: "居中", fill: "拉伸" }[mode];
		          return React.createElement("button", {
		            key: mode,
		            className: "we-picker__btn we-picker__rate" + (sel.objectFit === mode ? " we-picker__rate--active" : ""),
		            type: "button",
		            title: mode,
		            onClick: () => {
		              selection.objectFit = mode;
		              persistSelection();
		              emit();
		              // Edge canvas 渲染路径的 fit 存在 weDrawCtx 上（syncLayers 的
		              // same-canvas 守卫不会重建 draw loop），直接更新并重绘。
		              if (weDrawCtx) {
		                weDrawCtx.fit = mode;
		                weDrawFrame();
		              }
		            },
		          }, label);
		        }),
		        React.createElement("span", { className: "we-picker__hint" }, "覆盖=cover · 填充=contain · 居中=center · 拉伸=fill"),
		      ),
		      // 遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」）：三个省电开关
		      // 并排一行，说明放下一行 —— 最小化/切页、窗口失焦、电池供电时视频暂停、
		      // 解码归零，回到界面 / 接通电源自动继续。
		      React.createElement("div", { className: "we-picker__row" },
		        React.createElement("label", { className: "we-picker__rotation-toggle" },
		          React.createElement("input", {
		            type: "checkbox",
		            checked: sel.pauseOnHidden,
		            onChange: (e) => { selection.pauseOnHidden = e.target.checked; persistSelection(); emit(); },
		          }),
		          "最小化/切页时暂停",
		        ),
		        React.createElement("label", { className: "we-picker__rotation-toggle" },
		          React.createElement("input", {
		            type: "checkbox",
		            checked: sel.pauseOnBlur,
		            onChange: (e) => { selection.pauseOnBlur = e.target.checked; persistSelection(); emit(); },
		          }),
		          "窗口失焦时暂停",
		        ),
		        React.createElement("label", { className: "we-picker__rotation-toggle" },
		          React.createElement("input", {
		            type: "checkbox",
		            checked: sel.pauseOnBattery,
		            onChange: (e) => { selection.pauseOnBattery = e.target.checked; persistSelection(); emit(); },
		          }),
		          "使用电池时暂停",
		        ),
		      ),
		      React.createElement("span", { className: "we-picker__hint" },
		        "类似 WE 的遮挡暂停：最小化、切到其它应用或使用电池供电时视频暂停、GPU 解码归零；回到界面 / 接通电源自动继续（网页壁纸仅随页面隐藏被浏览器节流）",
		      ),
		      ),
		    ),
		    React.createElement("div", { className: "we-picker__row" },
		      React.createElement("span", { className: "we-picker__hint" },
		        (group
		          ? "列表「" + group.name + "」：" + group.wallpaperIds.length + " 项 · " + playableCount + " 可播放 · 每 " + group.interval + " 分钟 · " + (group.order === "random" ? "随机" : "顺序")
		          : playableList.length + " 个可播放壁纸") +
		        (sel.rotationEnabled ? " · 自动轮转中" : "")),
		    ),
		  );
		}

		// ── Settings section wrapper (first-level page) ─────────────────────────────
		// Mirrors the skin-center's sectionList > pluginCard structure: the picker is
		// rendered inside a liquid-glass card shell so the whole settings page reads
		// as one frosted surface over the wallpaper. Owner props ({ close }) are
		// intentionally ignored — this section never leaves settings.
		function WallpaperPickerSection() {
		  return React.createElement("ul", { className: "we-picker__section-list" },
		    React.createElement("li", { className: "we-picker__card-shell" },
		      React.createElement(WallpaperPicker, null),
		    ),
		  );
		}

		// ── Chat-interface rope dock ────────────────────────────────────────────────
		// A chibi ship-whale maid grips a pull-cord and floats over the chat. Drag it
		// along the top to reposition; on release it snaps back to the TOP edge (and is
		// clamped so it can never be dragged out of view). Drag it DOWNWARD past the
		// threshold to pull the glass wallpaper-repo DRAWER out — it descends from the
		// top of the viewport like a drawer, with a live, finger-following preview
		// while dragging. While open, drag UP / press ESC / click the rope or 收起 to
		// close. The panel hosts <WallpaperPicker/> untouched, so every repo
		// interaction (filters, rotation, uploads, hidden list, classic/fixed card
		// layouts) behaves exactly as in the settings page — zero business logic
		// rewritten.
		//
		// Modal ownership: with both the settings copy and the panel copy mounted,
		// two identical picker modals would stack. The panel copy therefore OWNS the
		// modal whenever the dock exists (repoPanelOwnsModal), and the settings copy
		// suppresses its own portal while the flag is up. Flipping the flag triggers
		// emit() so the settings copy re-renders immediately.
		let repoPanelOwnsModal = false;

		// ── Rope artwork ────────────────────────────────────────────────────────────
		// The pull-cord is the coloured ship-whale maid gripping a rope with both
		// hands, supplied by the user as a transparent-background PNG. It is downscaled
		// to 256×283 (≈4× the 60px rendered box, preserving alpha) and inlined as a
		// base64 data URI so the single-file client bundle stays self-contained. The
		// <img> fills .we-rope__art and uses object-fit: contain.
		const ROPE_IMG = "data:image/png;base64,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";

		// Alternate rope artwork: the full-body whale "onee-san" maid (source 1024×1536,
		// downscaled to 384×576, transparent) — a second selectable mascot form. Taller
		// portrait (aspect 2:3) than the chibi, so its base box below differs; the <img>
		// still fills .we-rope__art with object-fit: contain.
		const ROPE_IMG_WHALE = "data:image/png;base64,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";

		// Rope forms: artwork + a display label + a base box size (before the user
		// scale). The box aspect mirrors the image so object-fit: contain fills it with
		// no letterboxing; the drag/clamp maths read the real rendered box at runtime.
		const ROPE_FORMS = {
		  maid:  { label: "小女仆", img: ROPE_IMG,       w: 52, h: 57 },
		  whale: { label: "鲸御姐", img: ROPE_IMG_WHALE, w: 64, h: 96 },
		};

		const ROPE_OPEN_THRESHOLD = 96;   // px of downward/upward drag that commits open/close (less twitchy)
		const ROPE_PREVIEW_START = 32;    // px of pull before the panel preview starts tracking
		const ROPE_EDGE_INSET = 8;        // resting distance below the snapped top edge
		const ROPE_VIEW_MARGIN = 8;       // hard clamp so the rope can never leave the viewport
		const ROPE_FALLBACK_SIZE = { w: 52, h: 57 }; // matches the CSS box; real size measured at runtime

		// Standard clamping (the shared clampNum is an in-range-or-fallback check).
		function ropeClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

		// Resting rope position, persisted across sessions (viewport-clamped on read).
		// size is the current form's scaled box; it only shapes the first-run centering
		// and the clamp margins, so the initial position adapts to the mascot geometry.
		function readRopePos(size) {
		  const s = size || ROPE_FALLBACK_SIZE;
		  const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
		  const h = (typeof window !== "undefined" && window.innerHeight) || 800;
		  let p = null;
		  try {
		    const raw = localStorage.getItem(ROPE_POS_KEY);
		    if (raw) {
		      const o = JSON.parse(raw);
		      if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) p = { x: o.x, y: o.y };
		    }
		  } catch { /* ignore */ }
		  // Resting position is the TOP edge (any horizontal spot). x stays wherever
		  // the user left it (clamped to the viewport); y is always the top inset.
		  if (!p) p = { x: Math.max(ROPE_EDGE_INSET, Math.round((w - s.w) / 2)), y: ROPE_EDGE_INSET };
		  return {
		    x: ropeClamp(p.x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - s.w - ROPE_VIEW_MARGIN)),
		    y: ropeClamp(p.y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - s.h - ROPE_VIEW_MARGIN)),
		  };
		}

		function RopeDock() {
		  const sel = useStore();
		  const hidden = !sel.ropeShown;
		  const form = ROPE_FORMS[sel.ropeForm] || ROPE_FORMS.maid;
		  const scale = clampNum(sel.ropeScale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, 1);
		  // Selected form's base box scaled by the user's size setting (rounded to px);
		  // written inline so the .we-rope CSS box follows it and ropeSize() reads it.
		  const box = { w: Math.round(form.w * scale), h: Math.round(form.h * scale) };
		  const [open, setOpen] = React.useState(false);
		  const [pos, setPos] = React.useState(() => readRopePos(box));
		  const ropeRef = React.useRef(null);
		  const panelRef = React.useRef(null);
		  const dragRef = React.useRef(null);

		  const ropeSize = () => {
		    const el = ropeRef.current;
		    if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
		    return box;
		  };
		  const clampX = (x) => {
		    const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
		    return ropeClamp(x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - ropeSize().w - ROPE_VIEW_MARGIN));
		  };
		  const clampY = (y) => {
		    const h = (typeof window !== "undefined" && window.innerHeight) || 800;
		    return ropeClamp(y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - ropeSize().h - ROPE_VIEW_MARGIN));
		  };
		  // Live drag preview on the panel: p ∈ [0,1], 1 = fully open. The panel is a
		  // top drawer — it DESCENDS from the top edge (translateY) as it opens.
		  // Written as inline styles (compositor-only props) straight to the DOM —
		  // bypassing React state keeps WallpaperPicker out of the per-pointermove
		  // render path.
		  const applyPreview = (p) => {
		    const el = panelRef.current;
		    if (!el) return;
		    const q = ropeClamp(p, 0, 1);
		    // Follow the pull with a gentle, regulated glide (a set "speed") rather
		    // than a 1:1 snap: the drawer eases after the hand (weighty, not twitchy).
		    // On commit the inline transition is cleared so the slow open/close run
		    // takes over from wherever the hand left the panel.
		    el.style.transition = "transform 440ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 320ms ease";
		    el.style.visibility = "visible";
		    el.style.opacity = String(q);
		    el.style.transform = "translateY(" + (-(1 - q) * 102).toFixed(2) + "%)";
		  };
		  const clearPreview = () => {
		    const el = panelRef.current;
		    if (!el) return;
		    el.style.transition = "";
		    el.style.visibility = "";
		    el.style.opacity = "";
		    el.style.transform = "";
		  };

		  const onRopePointerDown = (e) => {
		    if (e.pointerType === "mouse" && e.button !== 0) return;
		    const el = ropeRef.current;
		    if (!el || dragRef.current) return;
		    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
		    dragRef.current = {
		      id: e.pointerId,
		      startX: e.clientX, startY: e.clientY,
		      baseX: pos.x, baseY: pos.y,
		      lastX: pos.x, lastY: pos.y,
		      moved: false,
		    };
		    el.classList.add("we-rope--dragging");   // kill the settle transition while following the finger
		    el.classList.remove("we-rope--settle");
		    e.preventDefault();
		  };
		  const onRopePointerMove = (e) => {
		    const d = dragRef.current;
		    if (!d || d.id !== e.pointerId) return;
		    const dx = e.clientX - d.startX;
		    const dy = e.clientY - d.startY;
		    if (!d.moved && dx * dx + dy * dy < 9) return; // dead zone: treat jitter as a click
		    d.moved = true;
		    d.lastX = clampX(d.baseX + dx);
		    d.lastY = clampY(d.baseY + dy);
		    const el = ropeRef.current;
		    if (el) { el.style.left = d.lastX + "px"; el.style.top = d.lastY + "px"; }
		    // Follow-hand preview: pull down opens (when closed), push up closes (when open).
		    if (!open && dy > ROPE_PREVIEW_START) {
		      applyPreview((dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
		    } else if (open && dy < -ROPE_PREVIEW_START) {
		      applyPreview(1 - (-dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
		    } else {
		      clearPreview();
		    }
		  };
		  const finishDrag = (clientX, clientY, canceled) => {
		    const d = dragRef.current;
		    const el = ropeRef.current;
		    dragRef.current = null;
		    if (!el) return;
		    el.classList.remove("we-rope--dragging");
		    el.classList.add("we-rope--settle");
		    if (d) {
		      const dy = clientY - d.startY;
		      if (!canceled && !d.moved) setOpen((o) => !o);            // plain click toggles
		      else if (!canceled && !open && dy >= ROPE_OPEN_THRESHOLD) setOpen(true);
		      else if (!canceled && open && dy <= -ROPE_OPEN_THRESHOLD) setOpen(false);
		    }
		    clearPreview(); // committed class transitions continue smoothly from the inline value
		    // Snap to the TOP edge; Y resets to the top inset while X stays wherever
		    // the user dragged it (clamped so the rope is never lost off-screen). The
		    // rope is a pull-cord that hangs from the top, so it always returns there.
		    const x = d ? d.lastX : pos.x;
		    const next = { x: clampX(x), y: ROPE_EDGE_INSET };
		    // Write the snapped coords imperatively TOO: if they happen to equal the
		    // previous React-managed values, React would skip the style diff and the
		    // rope would stay wherever the finger left it instead of settling.
		    if (el) { el.style.left = next.x + "px"; el.style.top = next.y + "px"; }
		    setPos(next);
		    try { localStorage.setItem(ROPE_POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
		  };
		  const onRopeKeyDown = (e) => {
		    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
		  };

		  // ESC anywhere closes the panel — unless the picker modal is open. The
		  // modal's handler sits on WINDOW capture and calls stopPropagation, which
		  // halts the event BEFORE it reaches this DOCUMENT-level capture listener,
		  // so ESC closes the modal first and the panel survives. When no modal is
		  // open the event arrives here and closes the panel.
		  React.useEffect(() => {
		    if (typeof document === "undefined" || !document.addEventListener) return undefined;
		    const onKey = (e) => {
		      if (e.key !== "Escape" || selection.pickerOpen) return;
		      setOpen(false);
		    };
		    document.addEventListener("keydown", onKey, true);
		    return () => document.removeEventListener("keydown", onKey, true);
		  }, []);

		  // Keep the rope inside the viewport when the window shrinks/grows.
		  React.useEffect(() => {
		    if (typeof window === "undefined" || !window.addEventListener) return undefined;
		    const onResize = () => setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
		    window.addEventListener("resize", onResize);
		    return () => window.removeEventListener("resize", onResize);
		  }, []);

		  // When the mascot FORM or SIZE actually changes (bigger box), re-clamp the
		  // position so a larger form (e.g. whale) never ends up half off-screen. The
		  // ref skips the FIRST run (the box is pristine on mount), so the default
		  // path adds no extra setPos/render/paint in the kiosk window — keeping the
		  // markup identical to the build that shipped the lazy-mounted panel.
		  const lastBoxRef = React.useRef(null);
		  React.useEffect(() => {
		    const last = lastBoxRef.current;
		    lastBoxRef.current = box;
		    if (last && (last.w !== box.w || last.h !== box.h)) {
		      setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
		    }
		    // eslint-disable-next-line react-hooks/exhaustive-deps
		  }, [box.w, box.h]);

		  // Claim modal ownership ONLY while the panel is open AND the rope is visible
		  // (its picker is mounted). When closed or hidden the picker is unmounted, so
		  // the settings copy must own the modal again — otherwise 选择壁纸 from settings
		  // would open nothing. emit() keeps the settings copy in sync; hiding while
		  // open also closes the drawer, so ownership never sticks to an invisible panel.
		  React.useEffect(() => {
		    if (hidden) setOpen(false);
		    repoPanelOwnsModal = open && !hidden;
		    emit();
		    return () => { repoPanelOwnsModal = false; emit(); };
		  }, [open, hidden]);

		  // Hidden: render nothing (rope + drawer), but keep the one-time update
		  // notice — it is independent of the mascot and must still surface.
		  if (hidden) {
		    return React.createElement(React.Fragment, null,
		      React.createElement(UpdateNotice, null),
		    );
		  }

		  // Rope style: only emit an explicit box size when it differs from the
		  // stylesheet's default (the 小女仆 at 1× = 52×57). At the default the rope is
		  // exactly CSS-sized, so we leave width/height out — making the default markup
		  // byte-identical to the build that shipped the lazy-mounted panel (no extra
		  // layout/compositing the kiosk window could trip on).
		  const ropeStyle = { top: pos.y + "px", left: pos.x + "px" };
		  if (box.w !== 52 || box.h !== 57) {
		    ropeStyle.width = box.w + "px";
		    ropeStyle.height = box.h + "px";
		  }

		  return React.createElement(React.Fragment, null,
		    React.createElement("div", {
		      ref: ropeRef,
		      className: "we-rope we-rope--settle",
		      style: ropeStyle,
		      role: "button",
		      tabIndex: 0,
		      "aria-label": "壁纸仓库拉绳：沿顶部拖动移动位置，向下拉打开壁纸仓库面板",
		      title: "壁纸仓库 · 沿顶部拖动 / 向下拉打开",
		      onPointerDown: onRopePointerDown,
		      onPointerMove: onRopePointerMove,
		      onPointerUp: (e) => finishDrag(e.clientX, e.clientY, false),
		      onPointerCancel: (e) => finishDrag(e.clientX, e.clientY, true),
		      onKeyDown: onRopeKeyDown,
		    },
		      React.createElement("div", { className: "we-rope__art", "aria-hidden": "true" },
		        React.createElement("img", { className: "we-rope__img", src: form.img, alt: "", draggable: false }),
		      ),
		    ),
		    React.createElement("aside", {
		      ref: panelRef,
		      className: "we-repo-panel" + (open ? " we-repo-panel--open" : ""),
		      "aria-hidden": String(!open),
		      "aria-label": "壁纸仓库面板",
		      // Closed panel must not expose focusable descendants to Tab / AT.
		      inert: open ? undefined : "",
		    },
		      React.createElement("header", { className: "we-repo-panel__head" },
		        React.createElement("span", { className: "we-repo-panel__title" }, "壁纸仓库"),
		        React.createElement("button", {
		          type: "button",
		          tabIndex: open ? 0 : -1,
		          className: "we-picker__btn",
		          onClick: () => setOpen(false),
		        }, "收起"),
		      ),
		      React.createElement("div", { className: "we-repo-panel__body" },
		        // Lazy-mount the picker only while the drawer is open: keeping the
		        // whole WallpaperPicker (spinning vinyl etc.) mounted behind a hidden
		        // full-viewport fixed panel was the biggest new compositing footprint
		        // the rope update added — a driver of the kiosk-window white flash.
		        open ? React.createElement(WallpaperPicker, { repoPanel: true }) : null,
		      ),
		    ),
		    React.createElement(UpdateNotice, null),
		  );
		}

		// ── One-time "what's new" notice ─────────────────────────────────────────────
		// Tells the user what's new once per version — this round: the 字体 custom
		// typography group (master switch + color/weight/family incl. 行楷) and the
		// new 壁纸效果 tuning sliders (亮度/对比度/饱和度). The dismissal version is
		// stored WITH the settings (host file, port-independent) so it survives DSH
		// Desktop's random --port restarts and never re-shows after being closed. Bump
		// NOTICE_VERSION next release to announce something new again.
		const NOTICE_VERSION = "0.6.7";

		function UpdateNotice() {
		  const sel = useStore();
		  // Only render once the host settings (source of truth) are applied, so the
		  // persisted noticeSeen is final. On a fresh port/restart the localStorage
		  // origin is empty (noticeSeen == "") and would briefly flash the notice before
		  // the host GET merges the real value — wait for hostLoaded to avoid that.
		  const show = sel.hostLoaded && sel.noticeSeen !== NOTICE_VERSION;
		  const dismiss = () => {
		    // Persist the dismissed version through the settings pipeline (localStorage
		    // cache + host file). emit() re-renders this component (useStore) to hide it.
		    selection.noticeSeen = NOTICE_VERSION;
		    persistSelection();
		    emit();
		  };
		  if (!show) return null;
		  return React.createElement("div", { className: "we-update-notice", role: "alert" },
		    React.createElement("div", { className: "we-update-notice__title" }, "🎉 新版更新：字体自定义 + 壁纸效果调节条"),
		    React.createElement("div", { className: "we-update-notice__body" },
		      React.createElement("p", null,
		        "设置新增「字体」分区：总开关默认关闭（即原生外观），开启后可调字体颜色、字重与字体族（含雅黑 / 楷体 / 宋体 / 黑体 / 行楷 / 等宽，按钮以各自字体实时预览）。报错红字不受染色影响；点关闭开关即可一键恢复默认。"),
		      React.createElement("p", null,
		        "「壁纸效果」区新增三个调节条：「亮度」「对比度」「饱和度」，配合已有的壁纸模糊 / 暗化等，可让任意壁纸与界面融合得更舒服——全部即时生效、持久保存。"),
		      React.createElement("p", { className: "we-update-notice__hint" },
		        "本提示每个新版本只出现一次，点下方按钮关闭后不再弹出。"),
		    ),
		    React.createElement("button", { className: "we-update-notice__btn we-picker__btn", type: "button", onClick: dismiss }, "知道了"),
		  );
		}

		// ── Styles ──────────────────────────────────────────────────────────────────
		const CSS = `
		  /* Wallpaper layer: a fixed child of <body>, sunk BELOW the app frame. */
		  .we-layer { position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none; }
		  /* Blurring via CSS filter darkens/thins the edges, so the layer is scaled up
		     (--we-wallpaper-scale tracks blur) to hide the transparent fringe the blur
		     would otherwise reveal at the viewport edges. */
		  .we-layer .we-media {
		    width: 100%; height: 100%; object-fit: cover; display: block;
		    background: transparent; border: 0;
		    /* Blur is applied ONLY when > 0 (see --we-media-filter in applyEffects):
		       a permanent blur(0px) would still force an offscreen filter layer on
		       the wallpaper <video>/canvas every frame — a known source of periodic
		       compositing glitches (brief white flash) in Chromium. */
		    filter: var(--we-media-filter, none);
		    /* Single transform var — "none" at default so the full-screen <video> isn't
		       forced onto a transform compositing layer; the blur-compensation scale and
		       the mirror are composed in the SAME var when active. */
		    transform: var(--we-wallpaper-transform, none);
		    transform-origin: center;
		  }
		  /* The 适配 row sets the fit mode for the CURRENT wallpaper (any type);
		     only .we-media--fit reads the variable (iframes have no object-fit). */
		  .we-layer .we-media--fit { object-fit: var(--we-object-fit, cover); }

		  /* Scrim: sits ABOVE the wallpaper (z-index -1 > -2, so it never depends on
		     DOM insertion order — the wallpaper element is re-appended on wallpaper
		     switch and could otherwise slide above the scrim). Below the UI. */
		  .we-scrim {
		    position: fixed; inset: 0; z-index: -1;
		    pointer-events: none;
		    background: var(--we-scrim-color, rgba(0, 0, 0, 0.25));
		  }

		  /* While a wallpaper is active: make the app frame AND sidebar transparent so
		     all columns share the same wallpaper+scrim background, raise border alpha
		     for visibility, and apply the frosted-glass effect to opaque surfaces. */
		  body[data-we-wallpaper] {
		    --dsw-alias-bg-base: transparent;
		    --dsw-specific-sidebar-fill: transparent;
		    /* Border emphasis: neutral gray so it reads on both light and dark themes;
		       alpha is driven by the "边框" slider through --we-border-alpha. */
		    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		  }
		  /* DSH rc.7+ injects the theme palette (design-platform.css) as a plugin-owned
		     stylesheet appended to <head> AFTER this one, so in dark mode the shell's
		     body[data-ds-dark-theme] rules (equal specificity 0,1,1, later in the
		     document) win the cascade and repaint the app frame / sidebar / borders
		     with their opaque dark colors — hiding the wallpaper behind them. Repeat
		     the transparency + border-emphasis overrides under the higher-specificity
		     dark selector (0,2,1) so the wallpaper always wins regardless of stylesheet
		     order. */
		  body[data-ds-dark-theme][data-we-wallpaper] {
		    --dsw-alias-bg-base: transparent;
		    --dsw-specific-sidebar-fill: transparent;
		    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
		  }

		  /* ── Light-scheme text contrast boost ──────────────────────────────────────
		     In light mode the grays (tertiary/caption/secondary) were tuned against a
		     near-white page. Over a busy wallpaper + light scrim they lose contrast, so
		     push the whole gray ramp darker while a wallpaper is active. Primary text
		     is already near-black; we still pin it to pure black for max legibility.
		     (Dark mode is untouched: its white-on-dark text already reads fine.) */
		  body[data-we-wallpaper]:not([data-ds-dark-theme]) {
		    --dsw-alias-label-primary: rgb(0, 0, 0);
		    --dsw-alias-label-primary-dimmed: rgb(10, 10, 12);
		    --dsw-alias-label-secondary: rgb(40, 42, 46);
		    --dsw-alias-label-tertiary: rgb(70, 73, 79);
		    --dsw-alias-label-caption: rgb(110, 114, 120);
		    --dsw-alias-label-dimmed: rgb(50, 52, 56);
		  }

		  /* ── iOS liquid glass ──────────────────────────────────────────────────────
		     The opaque conversation surfaces become translucent glass. The recipe is
		     Apple-like, not a plain blur:
		       - LARGE-radius blur + HIGH saturation + brightness/contrast lift, so the
		         wallpaper colour melts into a soft glow instead of a gray smear
		         (saturation scales with blur in applyEffects: 0 blur → no melt);
		       - a top-weighted specular gradient (background-image) — the sheen is
		         what makes the surface read as "wet glass", not a flat tint;
		       - a light, low-alpha base (not a dark one) so the wallpaper shows through;
		       - a 1px top refraction highlight + 0.5px hairline + soft elevation
		         shadow for "thick glass";
		       - blur radius + saturation both scale off --we-blur / --we-saturate
		         (the 玻璃 slider drives both, so composer, bubbles AND the
		         better-sidebar shell stay in one uniform liquid look).

		     Transparency is driven through the design tokens the surfaces already read
		     (--dsw-specific-input-major on the composer card, --dsw-specific-bubble on
		     message bubbles) rather than through class selectors: CSS-module class
		     names are build hashes and change whenever the shell frontend is rebuilt,
		     which silently kills the effect. backdrop-filter cannot be expressed as a
		     token, so the blur itself still needs an element selector — [data-composer-card]
		     is authored in the shell source and survives rebuilds. Bubbles carry no such
		     attribute, so they fall back to the module-CSS suffix convention; if that
		     ever stops matching the bubble stays translucent, just without the blur. */
		  body[data-we-wallpaper] {
		    --dsw-specific-input-major: rgba(255, 255, 255, var(--we-glass-alpha, 0.15));
		    --dsw-specific-bubble: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.8));
		  }
		  body[data-ds-dark-theme][data-we-wallpaper] {
		    --dsw-specific-input-major: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.4));
		    --dsw-specific-bubble: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.33));
		  }
		  body[data-we-wallpaper] [data-composer-card],
		  body[data-we-wallpaper] [class*="_bubble"] {
		    /* Specular sheen: a top-weighted white gradient turns a flat translucent
		       tint into "wet glass" — kept faint so the wallpaper stays 通透 (clear)
		       instead of glaring. */
		    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
		    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    box-shadow:
		      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
		      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
		      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
		      0 12px 40px rgba(0, 0, 0, var(--we-glass-shadow, 0.12));
		  }
		  /* Note (anti-flicker): the composer/bubbles keep ONLY the backdrop-filter
		     glass. Extra always-on layers (transform/will-change/contain) were removed —
		     they did not stop the white flash and instead added compositing layers. The
		     flash was traced to the rope's permanent CSS filter, which is now gone. */

		  /* ── dsh-better-sidebar glass ──────────────────────────────────────────────
		     The sidebar shell is portalled onto <body> under a stable host attribute
		     "data-dsh-better-sidebar" (set by the plugin's own mount code), so we can
		     target the whole tree without depending on its CSS-module hashes. Its root
		     panels read the opaque --dsw-alias-bg-layer-1 token (hence the "black
		     frame") — give them the SAME clear liquid-glass recipe as the
		     composer/bubbles (faint specular sheen + gentle frosted melt).
		     Unlike the conversation surfaces, the sidebar glass is FULLY independent:
		     the master switch body[data-we-sidebar-glass] (侧栏液态玻璃) gates the whole
		     adaptation, and blur / saturation / transparency / base tint each have
		     their own knob (--we-sidebar-blur / --we-sidebar-saturate /
		     --we-sidebar-alpha / --we-sidebar-color, from 侧栏模糊 / 侧栏透明度 /
		     侧栏玻璃颜色), so the sidebar can be blurrier, clearer, more transparent
		     or tinted however you like without touching the 玻璃 / 玻璃透明度 sliders.
		     Inner chrome surfaces that paint the same opaque tokens get a translucent
		     base too; the blur lives on the root panels (one blur per shell). */
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
		    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.66 * 100%), transparent) !important;
		    /* Specular sheen + refraction highlights follow --we-sidebar-sheen
		       (= min(1, alpha/0.2236)): at default (12%) and any MORE solid setting
		       the sheen keeps the ORIGINAL design strength (0.14/0.04/0.01,
		       0.32/0.08/0.06); only toward transparency does the white glaze fade,
		       so 100% is truly near-transparent instead of pale white. */
		    background-image: linear-gradient(180deg,
		      rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.14)),
		      rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.04)) 38%,
		      rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.01))) !important;
		    -webkit-backdrop-filter: blur(var(--we-sidebar-blur, 16px)) saturate(var(--we-sidebar-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
		    backdrop-filter: blur(var(--we-sidebar-blur, 16px)) saturate(var(--we-sidebar-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
		    box-shadow:
		      inset 0 1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.32)),
		      inset 0 -1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.08)),
		      inset 0 0 0 0.5px rgba(255, 255, 255, calc(var(--we-sidebar-sheen, 1) * 0.06));
		  }
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
		  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
		    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.53 * 100%), transparent) !important;
		  }
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
		    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.33 * 100%), transparent) !important;
		  }
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
		  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
		    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.26 * 100%), transparent) !important;
		  }
		  /* No backdrop-filter support: fall back to near-opaque tinted surfaces so
		     sidebar text never sits directly on a busy wallpaper (same policy as the
		     settings-window glass). The tint still applies. */
		  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
		    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
		      background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) 92%, transparent) !important;
		      backdrop-filter: none !important;
		      -webkit-backdrop-filter: none !important;
		    }
		  }

		  /* ── dsh-better-sidebar CONTENT surfaces: near-opaque tinted glass ─────────
		     The editor (CodeMirror) surface is transparent by design, and the terminal
		     background reads --dsw-alias-bg-base — which we must keep transparent so
		     the wallpaper shows through. Their fixed content palettes (syntax
		     highlighting / ANSI colors) are designed for an OPAQUE backdrop (One
		     Dark/Light, xterm themes): on the fully frosted composite the mid-gray
		     comments etc. lose all contrast (实测注释灰 1.7–2.3:1，看不清).
		     Fully opaque surfaces fix readability but kill the glass look. Balance:
		     a NEAR-OPAQUE TINTED glass plate — the theme's opaque panel color
		     (--dsw-alias-bg-layer-1) at 88% keeps the wallpaper glow bleeding through
		     (still reads as glass) while the composite stays dark/light enough for the
		     the designed content palettes. Tune via the 内容面透明度 / 内容面底色 controls
		     (--we-content-surface-alpha / --we-content-surface-color; color empty =
		     follow the theme panel color). Gated on data-we-wallpaper, NOT the
		     sidebar-glass switch — the terminal turns transparent even with the switch
		     off. .cm-editor / .xterm are library-global class names (stable across the
		     sidebar's builds). */
		  body[data-we-wallpaper] [data-dsh-better-sidebar] .cm-editor,
		  body[data-we-wallpaper] [data-dsh-better-sidebar] .xterm {
		    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--dsw-alias-bg-layer-1, #1e1f26)) var(--we-content-surface-alpha, 88%), transparent) !important;
		  }

		  /* Picker chrome. */
		  .we-picker { display: flex; flex-direction: column; gap: 10px; }
		  .we-picker__select { max-width: 100%; }
		  .we-picker__row { display: flex; gap: 8px; align-items: center; }
		  /* 抽帧转码下载/转码进度条. */
		  .we-picker__prog { gap: 8px; }
		  .we-picker__prog-track {
		    flex: 1; min-width: 0; height: 5px; border-radius: 3px;
		    background: rgba(128, 128, 128, 0.3);
		    overflow: hidden;
		  }
		  .we-picker__prog-bar {
		    height: 100%; border-radius: 3px;
		    background: var(--we-accent, #4f8cff);
		    transition: width 0.4s ease;
		  }
		  /* First-level settings section wrapper (mirrors the skin-center's
		     sectionList): the ul/li carry no default list styling. */
		  .we-picker__section-list { margin: 0; padding: 0; list-style: none; }

		  /* ── WHOLE native settings window → liquid glass (master switch).
		     Keyed on body[data-we-glass-window] (set by applyEffects from the
		     glassWindow preference). The settings dialog is the shell's
		     div[role="dialog"] containing the settings.section outlet anchor
		     (data-slot="settings.section" — stamped by the slot renderer, same anchor
		     the skin-center's semantic layer uses). The dialog reads inherited shell
		     tokens (panel background = --dsw-alias-bg-layer-2, nav active/hover =
		     --dsw-specific-sidebar-nav-item-*, close hover = --dsw-alias-interactive-bg-hover,
		     accents = --dsw-alias-brand-primary), so overriding those tokens ON the
		     dialog element restyles the ENTIRE window — left nav, content header and
		     every native section (General / Models / Plugins / …) — in one shot:
		     translucent glass base + backdrop blur + specular sheen + inner highlight,
		     with the accent color remapped to --we-accent (配色) and all surface alphas
		     driven by --we-glass-alpha (玻璃透明度). Off = stock shell look. ── */
		  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
		    /* Glass surface alphas (light scheme): the base tint is --we-glass-color
		       (玻璃颜色) mixed with transparent at the 玻璃透明度-driven alpha, so the
		       whole window glass can be tinted to any color. Default (no custom color)
		       = white glass, the stock look. */
		    --dsw-alias-bg-layer-1: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent);
		    --dsw-alias-bg-layer-2: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent);
		    --dsw-alias-bg-layer-3: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent);
		    /* Nav + interactive states tinted with the accent. */
		    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent, #4f8cff) 26%, rgba(255, 255, 255, 0.08));
		    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 13%, rgba(255, 255, 255, 0.05));
		    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
		    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
		    /* Whole-dialog accent remap: every native control (links, primary buttons,
		       switches, active tabs, slider fills) follows the 配色 control. */
		    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
		    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
		    --dsw-alias-button-primary-fill: var(--we-accent, #4f8cff);
		    --dsw-alias-button-primary-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 88%, #fff);
		    --dsw-alias-button-primary-dimmed: color-mix(in srgb, var(--we-accent, #4f8cff) 22%, transparent);
		    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
		    /* Frosted finish — the SAME recipe as the conversation surfaces (composer
		       card / bubbles): the blur radius, saturation melt and brightness all
		       read the 玻璃 slider (--we-blur 0–60px, --we-saturate, --we-glass-brightness),
		       so the settings window glass tracks the conversation-bar adjustment range
		       exactly. Plus a specular sheen + inner edge highlight + diffuse shadow
		       (the shell already rounds the panel at 24px). */
		    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    background-image: linear-gradient(
		      180deg,
		      rgba(255, 255, 255, 0.1) 0%,
		      rgba(255, 255, 255, 0.03) 38%,
		      rgba(255, 255, 255, 0.05) 100%
		    );
		    box-shadow:
		      inset 0 1px 0 rgba(255, 255, 255, 0.22),
		      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
		      0 24px 80px rgba(0, 7, 18, 0.35);
		  }
		  /* Dark scheme: deep translucent base instead of white. The default glass
		     color is deep navy; a user-picked 玻璃颜色 overrides it in both themes. */
		  body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
		    --dsw-alias-bg-layer-1: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent);
		    --dsw-alias-bg-layer-2: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent);
		    --dsw-alias-bg-layer-3: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent);
		    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent, #4f8cff) 30%, rgba(255, 255, 255, 0.06));
		    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
		    background-image: linear-gradient(
		      180deg,
		      rgba(255, 255, 255, 0.07) 0%,
		      rgba(255, 255, 255, 0.02) 38%,
		      rgba(255, 255, 255, 0.03) 100%
		    );
		  }
		  /* No backdrop-filter support: fall back to near-opaque glass so text stays
		     readable (same policy as the skin's patches.css). */
		  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		    body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
		      --dsw-alias-bg-layer-1: var(--we-glass-color, #ffffff);
		      --dsw-alias-bg-layer-2: var(--we-glass-color, #ffffff);
		      --dsw-alias-bg-layer-3: var(--we-glass-color, #ffffff);
		    }
		    body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
		      --dsw-alias-bg-layer-1: var(--we-glass-color, #0d1524);
		      --dsw-alias-bg-layer-2: var(--we-glass-color, #0d1524);
		      --dsw-alias-bg-layer-3: var(--we-glass-color, #0d1524);
		    }
		  }

		  /* Section card (mirrors the skin-center's pluginCard): a quiet layer card —
		     translucent token background + hairline border + radius. NO own backdrop
		     blur: the whole settings window is the glass surface (see the
		     body[data-we-glass-window] dialog rules above), so a nested blur would
		     double-frost and look muddy. Without the master switch the card still
		     reads as a subtle layer over the stock panel. */
		  .we-picker__card-shell {
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
		    border-radius: 12px;
		    background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.08));
		    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
		    padding: 14px 16px;
		    transition: border-color 0.16s ease, background-color 0.16s ease;
		  }
		  .we-picker__card-shell:hover { border-color: var(--dsw-alias-label-dimmed, rgba(128, 128, 128, 0.5)); }
		  /* Card header: name + count badge + description (mirrors skin-center). */
		  .we-picker__card-head {
		    display: flex; align-items: baseline; gap: 8px;
		    padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
		  }
		  .we-picker__card-name {
		    font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit);
		  }
		  .we-picker__card-badge {
		    font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary, #6b7280);
		  }
		  .we-picker__card-desc {
		    margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6b7280);
		    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		  }
		  /* 配色 swatches: circular preset buttons + native color picker. The active
		     swatch gets an accent ring so the current choice is obvious at a glance. */
		  .we-picker__accent-row { flex-wrap: wrap; }
		  .we-picker__swatch {
		    width: 20px; height: 20px; padding: 0; border-radius: 50%;
		    border: 2px solid rgba(255, 255, 255, 0.7);
		    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
		    cursor: pointer;
		    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease), box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  .we-picker__swatch:hover { transform: scale(1.12); }
		  .we-picker__swatch--active {
		    box-shadow: 0 0 0 2px var(--we-accent, #4f8cff), 0 0 0 4px rgba(255, 255, 255, 0.5);
		  }
		  /* "跟随主题" auto swatch (内容面底色): no fill, split ring showing both
		     themes so it reads as "use the theme panel color". */
		  .we-picker__swatch--auto {
		    font-size: 10px; line-height: 1; font-weight: 600;
		    color: var(--dsw-alias-label-secondary, #666);
		    background: linear-gradient(135deg, #2a2d35 0 50%, #f2f3f5 50% 100%);
		    display: inline-flex; align-items: center; justify-content: center;
		  }
		  .we-picker__swatch-custom {
		    display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
		  }
		  .we-picker__swatch-custom input[type="color"] {
		    width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%;
		    background: transparent; cursor: pointer;
		  }
		  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
		  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 50%; }
		  /* 字体族选择：胶囊 chip（非圆形色板）——文字选项需要横向空间与自字体
		     预览；选中态用 accent 描边，未选中淡描边 + 悬停提亮。flex-wrap 分行。 */
		  .we-picker__font-row { flex-wrap: wrap; row-gap: 6px; }
		  .we-picker__font-row .we-picker__label { flex-basis: 100%; }
		  .we-picker__font-chip {
		    padding: 3px 12px; border-radius: 999px;
		    border: 1px solid rgba(255, 255, 255, 0.35);
		    background: transparent;
		    color: var(--dsw-alias-label-secondary, #666);
		    font-size: 12px; line-height: 1.5; cursor: pointer;
		    transition: border-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      color var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  .we-picker__font-chip:hover {
		    color: var(--dsw-alias-text-primary, inherit);
		    border-color: rgba(255, 255, 255, 0.65);
		  }
		  .we-picker__font-chip--active,
		  .we-picker__font-chip--active:hover {
		    color: var(--dsw-alias-text-primary, inherit);
		    border-color: var(--we-accent, #4f8cff);
		    box-shadow: 0 0 0 1px var(--we-accent, #4f8cff);
		  }
		  /* Master-switch row (设置窗口液态玻璃) sits on its own line under the 透明度
		     slider so the switch and the hint read as one labelled control. */
		  .we-picker__window-toggle { font-size: 0.82em; }
		  .we-picker__window-toggle + .we-picker__hint { margin-left: 2px; }

		  /* Pagination bar under each paged grid (normal / hidden / group editor).
		     Horizontally centered; as a direct child of the flex modal body it sinks
		     to the bottom when the grid leaves free space (margin-top: auto). */
		  .we-picker__pager {
		    display: flex; gap: 10px; align-items: center; justify-content: center;
		    margin-top: auto; padding-top: 8px; flex-wrap: wrap;
		  }
		  .we-picker__playlist-select { flex: 1; min-width: 0; }
		  .we-picker__filter-row { flex-wrap: wrap; flex-shrink: 0; }
		  .we-picker__filter-row .we-picker__playlist-select { flex: 1 1 130px; }
		  .we-picker__rotation-toggle { display: inline-flex; align-items: center; gap: 6px; }
		  .we-picker__rotation-interval { margin-left: auto; }
		  /* Flat, uniform-height controls. Native <select> renders as a raised "3D"
		     OS widget whose height can shift a pixel on hover; inside tightly packed
		     rows that squeezes the neighbours and, with the cursor near a row edge,
		     oscillates (hover → grow → shift → unhover → shrink → …). Strip the
		     native chrome and PIN the height so no control's intrinsic size can move
		     a row. */
		  .we-picker__btn {
		    cursor: pointer; height: 26px; line-height: 24px; padding: 0 10px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px; background: transparent;
		    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
		    white-space: nowrap;
		  }
		  .we-picker__btn:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
		  .we-picker__btn:disabled { opacity: 0.45; cursor: default; }
		  .we-picker select {
		    appearance: none; -webkit-appearance: none;
		    height: 26px; padding: 0 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px; background: transparent;
		    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
		    cursor: pointer;
		  }
		  .we-picker select:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
		  .we-picker select:disabled { opacity: 0.45; cursor: default; }
		  .we-picker__hint { font-size: 0.8em; opacity: 0.78; }
		  /* 数字读数等宽：页码 / 计数 / fps / 百分比切换时不再跳动。 */
		  .we-picker__pager .we-picker__hint, .we-picker__card-badge, .we-picker__value {
		    font-variant-numeric: tabular-nums;
		  }
		  /* 统一焦点环：accent 色、2px、外偏移（a11y + 跟随配色）。 */
		  .we-picker button:focus-visible, .we-picker select:focus-visible,
		  .we-picker input:focus-visible, .we-picker [role="button"]:focus-visible,
		  .we-picker__modal button:focus-visible, .we-picker__modal select:focus-visible,
		  .we-picker__modal input:focus-visible, .we-picker__modal [role="button"]:focus-visible {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    outline-offset: 2px;
		  }
		  /* Text inputs (搜索 / 路径 / 列表名称): match the flat 26px control style. */
		  .we-picker__text {
		    height: 26px; padding: 0 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px; background: transparent;
		    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
		  }
		  .we-picker__search { flex: 1 1 150px; min-width: 0; }
		  .we-picker__error { font-size: 0.82em; opacity: 0.9; color: #e5534b; }
		  .we-picker__note { font-size: 0.8em; opacity: 0.85; color: var(--we-accent, var(--dsw-alias-brand-primary, #4f8cff)); }

		  /* ── Visual grouping: sections with a hairline divider + quiet label. ── */
		  .we-picker__section { display: flex; flex-direction: column; gap: 8px; }
		  .we-picker__section + .we-picker__section {
		    border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
		    padding-top: 10px;
		  }
		  .we-picker__section-head { display: flex; align-items: center; }
		  .we-picker__section-label {
		    font-size: 0.75em; font-weight: 500; opacity: 0.55;
		    letter-spacing: 0.01em;
		  }

		  /* ── Vinyl record (黑胶唱片): rotating disc with the selected wallpaper's
		     cover as the label. Spins while the wallpaper is playing; pauses
		     otherwise. Shown in both settings layouts and in the modal head. ── */
		  .we-vinyl {
		    position: relative; width: 128px; height: 128px; flex: 0 0 auto;
		    border-radius: 50%;
		    background:
		      repeating-radial-gradient(circle at center, #191920 0 2px, #23232c 2px 4px);
		    box-shadow:
		      0 6px 18px rgba(0, 0, 0, 0.55),
		      inset 0 0 0 1px rgba(255, 255, 255, 0.07);
		    animation: we-vinyl-spin 8s linear infinite;
		    animation-play-state: paused;
		  }
		  .we-vinyl--playing { animation-play-state: running; }
		  .we-vinyl--sm { width: 56px; height: 56px; }
		  .we-vinyl__cover {
		    position: absolute; inset: 24%; border-radius: 50%; overflow: hidden;
		    background: rgba(128, 128, 128, 0.25);
		    border: 2px solid rgba(0, 0, 0, 0.85);
		    box-shadow:
		      0 0 0 2px rgba(255, 255, 255, 0.1),
		      inset 0 0 8px rgba(0, 0, 0, 0.6);
		  }
		  .we-vinyl__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
		  .we-vinyl__empty {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    color: rgba(255, 255, 255, 0.45); font-size: 1.3em;
		  }
		  .we-vinyl__hole {
		    position: absolute; left: 50%; top: 50%;
		    width: 12px; height: 12px; margin: -6px 0 0 -6px;
		    border-radius: 50%; background: #0b0b0e;
		    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9);
		  }
		  .we-vinyl--sm .we-vinyl__hole { width: 6px; height: 6px; margin: -3px 0 0 -3px; }
		  @keyframes we-vinyl-spin {
		    from { transform: rotate(0deg); }
		    to { transform: rotate(360deg); }
		  }
		  @media (prefers-reduced-motion: reduce) {
		    .we-vinyl { animation: none; }
		  }
		  .we-picker__modal-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }

		  /* ── Current-wallpaper card: thumbnail + title + type + primary action. ── */
		  .we-picker__current {
		    display: flex; align-items: center; gap: 10px;
		    padding: 10px; border-radius: 12px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.06));
		  }
		  .we-picker__current-thumb {
		    width: 64px; height: 36px; flex: 0 0 auto;
		    object-fit: cover; border-radius: 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    background: rgba(128, 128, 128, 0.14);
		  }
		  .we-picker__current-thumb--empty {
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.85em; opacity: 0.4;
		  }
		  .we-picker__current-info { flex: 1; min-width: 0; }
		  .we-picker__current-title {
		    font-size: 0.9em; font-weight: 500;
		    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		  }
		  .we-picker__current-meta { font-size: 0.75em; opacity: 0.55; margin-top: 2px; }

		  /* Primary action (选择壁纸): brand accent, restrained — accent is for the
		     main action only, per the product register's "accent ≠ decoration". */
		  .we-picker__btn--primary {
		    color: var(--we-accent, #4f8cff);
		    border-color: var(--we-accent, #4f8cff);
		  }
		  .we-picker__btn--primary:hover {
		    background: var(--we-accent, #4f8cff);
		    color: #fff;
		  }

		  /* Refined range sliders: thin track + circular brand ring thumb. */
		  .we-picker__slider {
		    -webkit-appearance: none; appearance: none;
		    flex: 1; height: 18px; background: transparent; cursor: pointer;
		  }
		  .we-picker__slider::-webkit-slider-runnable-track {
		    height: 4px; border-radius: 2px;
		    /* accent 填充段（0 → --we-fill）+ 灰色剩余段 */
		    background: linear-gradient(to right,
		      var(--we-accent, #4f8cff) var(--we-fill, 0%),
		      var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)) var(--we-fill, 0%));
		  }
		  .we-picker__slider::-webkit-slider-thumb {
		    -webkit-appearance: none; appearance: none;
		    width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
		    background: var(--dsw-alias-bg-layer-1, #fff);
		    border: 2px solid var(--we-accent, #4f8cff);
		    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
		    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  .we-picker__slider:hover::-webkit-slider-thumb { transform: scale(1.15); }
		  .we-picker__slider::-moz-range-track {
		    height: 4px; border-radius: 2px;
		    background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
		  }
		  /* Firefox 的填充段走专用伪元素（不认 webkit 的渐变轨道方案）。 */
		  .we-picker__slider::-moz-range-progress {
		    height: 4px; border-radius: 2px;
		    background: var(--we-accent, #4f8cff);
		  }
		  .we-picker__slider::-moz-range-thumb {
		    width: 14px; height: 14px; border-radius: 50%;
		    background: var(--dsw-alias-bg-layer-1, #fff);
		    border: 2px solid var(--we-accent, #4f8cff);
		    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
		  }
		  /* Native checkboxes tinted with the accent (自动轮转 / 水平翻转). */
		  .we-picker input[type="checkbox"] { accent-color: var(--we-accent, #4f8cff); }
		  .we-picker__rotation-toggle { cursor: pointer; }

		  /* Sliding toggle switch (紧凑布局). Track + thumb slide left/right with a
		     snappy 120ms transition; pinned accent so light themes stay readable. */
		  .we-picker__switch {
		    position: relative; display: inline-flex; cursor: pointer;
		  }
		  .we-picker__switch input {
		    position: absolute; opacity: 0; width: 0; height: 0;
		  }
		  .we-picker__switch-track {
		    position: relative; width: 42px; height: 24px; border-radius: 12px;
		    background: rgba(128, 128, 128, 0.4);
		    transition: background-color var(--we-dur-fast, 120ms) var(--we-ease, ease);
		    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
		  }
		  /* 键盘焦点环：input 视觉隐藏但可聚焦，焦点环落在 track 上。 */
		  .we-picker__switch input:focus-visible + .we-picker__switch-track {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    outline-offset: 2px;
		  }
		  .we-picker__switch input:checked + .we-picker__switch-track {
		    background: var(--we-accent, #4f8cff); /* 跟随「配色」设置，不再硬编码 */
		  }
		  .we-picker__switch-thumb {
		    position: absolute; left: 3px; top: 3px;
		    width: 18px; height: 18px; border-radius: 50%;
		    background: #fff;
		    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
		    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  .we-picker__switch input:checked + .we-picker__switch-track .we-picker__switch-thumb {
		    transform: translateX(18px);
		  }
		  /* Edge 兼容渲染开关：塞在"紧凑布局"同一行，margin-left:auto 使其靠右。 */
		  .we-picker__switch--edge {
		    margin-left: auto; align-items: center; gap: 6px;
		  }

		  /* Custom chevron for the flat selects (appearance: none removed the native
		     arrow; heights stay pinned at 26px so rows can never shift). */
		  .we-picker select {
		    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
		    background-repeat: no-repeat; background-position: right 8px center;
		    padding-right: 24px;
		  }

		  /* Motion tokens: one shared ease (expo-out) + two durations. Modal is
		     portalled onto <body> (outside .we-picker), so the token scope covers both
		     roots. */
		  .we-picker, .we-picker__modal, .we-picker__modal-overlay {
		    --we-ease: cubic-bezier(0.16, 1, 0.3, 1);
		    --we-dur-fast: 120ms;
		    --we-dur: 200ms;
		  }
		  /* Motion: state-only transitions (background/color/border/transform — never
		     layout), token-driven; disabled entirely under prefers-reduced-motion. */
		  .we-picker__btn, .we-picker select, .we-picker__card, .we-picker__editor-card,
		  .we-picker__tab, .we-picker__rate, .we-picker__card-hide {
		    transition:
		      background-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      border-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      color var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease),
		      transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  /* 按压反馈：点击即缩，松手回弹（transform = 合成器属性，不引发布局）。 */
		  .we-picker__btn:active, .we-picker__rate:active, .we-picker__tab:active {
		    transform: scale(0.96);
		  }
		  @media (prefers-reduced-motion: reduce) {
		    .we-picker *, .we-picker__modal, .we-picker__modal *, .we-picker__modal-overlay {
		      transition: none !important;
		      animation: none !important;
		    }
		  }
		  .we-picker__slider-row { display: flex; align-items: center; gap: 8px; }
		  .we-picker__label { min-width: 28px; }
		  .we-picker__value { min-width: 40px; text-align: right; }
		  .we-picker__text { flex: 1; min-width: 0; }
		  .we-picker__editor {
		    display: flex; flex-direction: column; gap: 6px;
		    padding: 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		  }
		  /* Wallpaper thumbnail grid (main picker).
		     Cards use a FIXED height + absolutely-positioned filling <img>, never
		     aspect-ratio: some browsers (old Chromium/WebView) ignore aspect-ratio on
		     cards and let percentage-height images resolve to their intrinsic size,
		     which made previews bleed over the row above. inset:0 + overflow:hidden
		     pins the image inside the card in every engine. */
		  .we-picker__grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		    gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px;
		    /* hover 放大（CD 架 scale 1.12）不得撑出水平滚动条：clip 裁掉溢出且不
		       产生滚动条（hidden 仍可被程序滚动，clip 才是纯裁剪），scrollbar-gutter
		       让垂直滚动条的出现/消失也不再挤压内容 —— 两者一起消除「hover 最后一列
		       → 溢出 → 滚动条 → 宽度变化 → unhover → 回缩」的震荡循环。 */
		    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
		    overflow-x: clip;
		    scrollbar-gutter: stable;
		  }
		  .we-picker__card {
		    position: relative; height: 92px; padding: 0; cursor: pointer;
		    display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		  }
		  .we-picker__card img {
		    position: absolute; inset: 0; width: 100%; height: 100%;
		    object-fit: cover; display: block;
		    /* 加载淡入（onLoad 置 opacity:1）+ hover 微放大（合成器属性）。 */
		    opacity: 0;
		    transition:
		      opacity var(--we-dur, 200ms) ease,
		      transform 300ms var(--we-ease, ease);
		  }
		  /* hover 缩略图缓放大 —— 仅非 CD 架模式（CD 架是卡片整体 scale，叠加会双重放大）。 */
		  .we-picker:not([data-we-cards="classic"]) .we-picker__card:hover img,
		  .we-picker__modal:not([data-we-cards="classic"]) .we-picker__card:hover img {
		    transform: scale(1.06);
		  }
		  /* 编辑器卡片 / 黑胶封面同样加载淡入。 */
		  .we-picker__editor-card img, .we-vinyl__cover img {
		    opacity: 0;
		    transition: opacity var(--we-dur, 200ms) ease;
		  }
		  /* Classic — "CD 架" (CD-rack) card style: cards stack like CD jewel cases
		     on a rack. Each row strongly overlaps the row ABOVE it (the lower card's
		     top covers roughly half of the upper card's bottom — vertical only, never
		     horizontal), with a soft drop shadow for shelf depth. Hovering scales the
		     card up and brings it to the front. Opt-in via the 卡片样式 switch. The
		     modal is PORTALLED onto <body>, so the attribute is scoped on BOTH the
		     settings root and the modal element. The grid gets extra bottom padding
		     so the last row's overlap is not clipped. */
		  .we-picker[data-we-cards="classic"] .we-picker__grid,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__grid {
		    /* Compact CD-rack columns: ~7 cards per row at modal width. 两侧留出
		       8px 让位列：最左/最右列 hover 放大 12%（≈6px/侧）时在让位区内展开，
		       不触碰溢出边界、不被 clip 裁掉。 */
		    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		    padding: 2px 8px 42px;
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__editor-grid,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-grid {
		    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__card,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    height: auto; aspect-ratio: 16 / 9; display: block; overflow: hidden;
		    margin-bottom: -36px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
		    transition: transform 120ms ease, box-shadow 120ms ease;
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__card:hover,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__card:hover {
		    transform: scale(1.12);
		    z-index: 10;
		    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.5);
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__card img,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__card img {
		    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__editor-card,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    height: auto; aspect-ratio: 16 / 10; display: block; overflow: hidden;
		    margin-bottom: -30px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
		    transition: transform 120ms ease, box-shadow 120ms ease;
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__editor-card:hover,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card:hover {
		    transform: scale(1.1);
		    z-index: 10;
		    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5);
		  }
		  .we-picker[data-we-cards="classic"] .we-picker__editor-card img,
		  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card img {
		    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
		  }
		  .we-picker__card--selected {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    outline-offset: -2px;
		    /* 选中即"发光"：accent 色柔光晕，比裸描边更读得出"当前"。 */
		    box-shadow:
		      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
		      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
		  }
		  .we-picker__card-close {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.8em; color: var(--dsw-alias-label-secondary, #888);
		  }
		  .we-picker__card-title {
		    position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
		    font-size: 0.7em; line-height: 1.2; color: #fff;
		    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
		    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
		  }
		  /* Scene-wallpaper "静态帧" badge — top-right under the hide button. */
		  .we-picker__card-badge {
		    position: absolute; top: 4px; right: 4px; z-index: 1;
		    padding: 1px 6px; font-size: 0.62em; line-height: 1.6;
		    border-radius: 4px; color: #fff;
		    background: rgba(30, 90, 160, 0.85);
		  }
		  .we-picker__card-placeholder {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.72em; opacity: 0.55;
		  }
		  /* Per-card "hide" button (soft delete) — top-right overlay. 默认隐去，
		     hover / 键盘聚焦（focus-within）时浮现：网格不常驻一层噪声按钮。 */
		  .we-picker__card-hide {
		    position: absolute; top: 4px; right: 4px; z-index: 2;
		    padding: 2px 7px; font-size: 0.68em; line-height: 1.5;
		    border: 0; border-radius: 4px; cursor: pointer;
		    background: rgba(0, 0, 0, 0.6); color: #fff;
		    opacity: 0;
		  }
		  .we-picker__card:hover .we-picker__card-hide,
		  .we-picker__card:focus-within .we-picker__card-hide { opacity: 1; }
		  .we-picker__card-hide:hover { background: rgba(190, 50, 50, 0.9); }
		  /* Batch-mode selection check — top-left overlay. */
		  .we-picker__card-check {
		    position: absolute; top: 4px; left: 4px; z-index: 2;
		    width: 18px; height: 18px; border-radius: 4px;
		    background: rgba(0, 0, 0, 0.6); color: #fff;
		    font-size: 12px; line-height: 18px; text-align: center;
		  }
		  /* 批量勾选高亮：独立的 --checked class（勾选 ≠ 当前播放的 --selected）。 */
		  .we-picker__card--checked {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    outline-offset: -2px;
		    box-shadow:
		      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
		      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
		  }
		  .we-picker__card--checked .we-picker__card-check {
		    background: var(--we-accent, #4f8cff);
		  }
		  /* Hidden wallpapers view: dimmed cards. */
		  .we-picker__card--hidden { opacity: 0.78; }
		  .we-picker__card--hidden .we-picker__card-title {
		    background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
		  }
		  /* Batch-action bar. */
		  .we-picker__batch-bar {
		    padding: 4px 6px; border-radius: 6px;
		    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		  }
		  /* Current-wallpaper summary (replaces the inline grid in settings). */
		  .we-picker__summary {
		    flex: 1; min-width: 0;
		    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		    font-size: 0.85em; opacity: 0.85;
		  }
		  /* ── Wallpaper picker modal (portalled onto <body>, z-index above the shell
		     overlays). Fixed positioning from a body child is immune to ancestor
		     transforms/backdrop-filters, which would otherwise trap it. ── */
		  .we-picker__modal-overlay {
		    position: fixed; inset: 0; z-index: 1000;
		    display: flex; align-items: center; justify-content: center;
		    background: rgba(0, 0, 0, 0.55);
		    -webkit-backdrop-filter: blur(3px);
		    backdrop-filter: blur(3px);
		    animation: we-overlay-in var(--we-dur, 200ms) var(--we-ease, ease-out);
		  }
		  .we-picker__modal {
		    position: relative; z-index: 1001;
		    width: min(760px, 92vw); max-height: 86vh;
		    display: flex; flex-direction: column; gap: 10px;
		    padding: 16px; border-radius: 14px;
		    background: var(--dsw-alias-bg-layer-1, #202127);
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.25);
		    /* 入场：轻微上浮 + 缩放 settle，expo-out；reduced-motion 由上面的
		       媒体查询统一静止为瞬现。 */
		    animation: we-modal-in 240ms var(--we-ease, ease-out);
		  }
		  @keyframes we-overlay-in { from { opacity: 0; } }
		  @keyframes we-modal-in {
		    from { opacity: 0; transform: translateY(10px) scale(0.98); }
		  }
		  .we-picker__modal-head {
		    display: flex; align-items: center; justify-content: space-between;
		    padding-bottom: 10px;
		    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
		  }
		  .we-picker__modal-title { font-weight: 600; font-size: 0.95em; }
		  .we-picker__modal-tabs { display: flex; gap: 6px; }
		  .we-picker__tab {
		    flex: 1; padding: 0; text-align: center; font-size: 0.82em; cursor: pointer;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px; background: transparent;
		    color: var(--dsw-alias-label-secondary, #888);
		  }
		  .we-picker__tab--active {
		    background: var(--we-accent, #4f8cff);
		    border-color: var(--we-accent, #4f8cff); color: #fff;
		  }
		  .we-picker__modal-body {
		    overflow-y: auto; min-height: 0; flex: 1;
		    display: flex; flex-direction: column; gap: 8px;
		    overscroll-behavior: contain; /* 滚轮不穿透到背后的设置页 */
		    /* modal 里 grid 的 max-height 被放开（见下），真正的滚动容器是这里 ——
		       同样的 hover 放大震荡防护也要落在这层。 */
		    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
		    overflow-x: clip;
		    scrollbar-gutter: stable;
		  }
		  /* The modal is tall enough: let the grid fill it instead of its own 280px
		     internal scroll (the modal body scrolls as a whole). */
		  .we-picker__modal-body .we-picker__grid { max-height: none; }
		  .we-picker__modal-foot { display: flex; align-items: center; justify-content: space-between; }
		  /* Custom-upload section. */
		  .we-picker__uploads {
		    display: flex; flex-direction: column; gap: 6px;
		    padding: 10px; border-radius: 10px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.26));
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
		  }
		  .we-picker__file { flex: 1; min-width: 0; max-width: 260px; font-size: 0.8em; }
		  .we-picker__uploads-list {
		    display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto;
		  }
		  .we-picker__uploads-item {
		    display: flex; align-items: center; gap: 8px;
		    padding: 3px 6px; border-radius: 6px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
		  }
		  .we-picker__uploads-name {
		    flex: 1; min-width: 0;
		    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		    font-size: 0.82em;
		  }
		  .we-picker__uploads-path {
		    flex: 1; min-width: 0;
		    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		    font-size: 0.8em; opacity: 0.85;
		  }
		  /* Playback-rate segmented control (video wallpapers only). Also reused as
		     the 卡片样式 two-button switch (wrapped in .we-picker__seg). */
		  .we-picker__seg { display: flex; gap: 4px; flex: 1; min-width: 0; }
		  .we-picker__rate {
		    flex: 1; padding: 0; text-align: center; font-size: 0.78em;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px; background: transparent; cursor: pointer;
		    color: var(--dsw-alias-label-secondary, #888);
		  }
		  .we-picker__rate + .we-picker__rate { margin-left: 0; }
		  .we-picker__rate--active {
		    background: var(--we-accent, #4f8cff);
		    border-color: var(--we-accent, #4f8cff);
		    color: #fff;
		  }
		  /* Rotation group editor thumbnail grid. */
		  .we-picker__editor-grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		    gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px;
		    /* 同主网格：CD 架 hover 放大不得撑出水平滚动条（防震荡）。 */
		    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
		    overflow-x: clip;
		    scrollbar-gutter: stable;
		  }
		  .we-picker__editor-card {
		    position: relative; height: 80px; padding: 0; cursor: pointer;
		    display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		  }
		  .we-picker__editor-card img {
		    position: absolute; inset: 0; width: 100%; height: 100%;
		    object-fit: cover; display: block;
		  }
		  .we-picker__editor-card--checked {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    outline-offset: -2px;
		  }
		  .we-picker__editor-check {
		    position: absolute; top: 4px; left: 4px; width: 18px; height: 18px;
		    border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #fff;
		    font-size: 12px; line-height: 18px; text-align: center;
		  }

		  /* ── Rope dock: chibi pull-cord + glass repo drawer ────────────────────────
		     The rope floats over the chat (fixed, body-child → immune to ancestor
		     transforms/backdrop-filters, same policy as the picker modal). It snaps to
		     the TOP edge on release (any horizontal spot); the settle class animates
		     that snap via top/left (tiny element, release-only). Dragging removes the
		     settle class so the rope follows the pointer 1:1. Pulling it DOWN draws
		     out the repo panel, which descends from the top like a drawer. Z-order:
		     repo panel 995 < rope 996 (the rope stays grabbable/clickable as the
		     panel's handle while it is out) < repo modal scrim 1003 < repo modal 1004. ── */
		  .we-rope {
		    position: fixed;
		    z-index: 996;
		    width: 52px; height: 57px;
		    box-sizing: border-box;
		    cursor: grab;
		    touch-action: none;              /* keep the pointer stream unbroken */
		    user-select: none; -webkit-user-select: none;
		    outline-offset: 2px;
		  }
		  .we-rope:focus-visible {
		    outline: 2px solid var(--we-accent, #4f8cff);
		    border-radius: 12px;
		  }
		  .we-rope--dragging { cursor: grabbing; }
		  .we-rope--settle {
		    transition:
		      top 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1)),
		      left 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
		  }
		  /* Art box holds the chibi <img>. The PNG is transparent-backed, and
		     object-fit: contain keeps its aspect ratio (no stretch) inside the box.
		     No CSS filter here: a permanent drop-shadow on a fixed element over the
		     wallpaper forces a filter layer that Chromium re-rasterises on any repaint
		     (click/typing) and can momentarily flash white. The chibi's own outline
		     keeps it readable, so we skip the filter entirely. */
		  .we-rope__art {
		    width: 100%; height: 100%;
		    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
		  }
		  .we-rope:hover .we-rope__art { transform: scale(1.06); }
		  .we-rope__art img {
		    display: block; width: 100%; height: 100%;
		    object-fit: contain;
		    pointer-events: none; /* drag/capture stays on the .we-rope box */
		  }

		  /* One-time update notice — a floating glass toast (bottom-center) that tells
		     immersive/kiosk-window users about the white flash and its one fix. High
		     z-index so it sits above the chat; buttons reuse the flat picker style. */
		  .we-update-notice {
		    position: fixed; left: 50%; bottom: 26px; z-index: 1100;
		    transform: translateX(-50%);
		    width: min(600px, 92vw);
		    box-sizing: border-box;
		    display: flex; flex-direction: column; gap: 10px;
		    padding: 16px 18px; border-radius: 14px;
		    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 90%), rgba(24, 28, 40, 0.82));
		    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 40%, rgba(255, 255, 255, 0.01));
		    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(1.2);
		    backdrop-filter: blur(var(--we-blur, 16px)) saturate(1.2);
		    border: 1px solid rgba(255, 255, 255, 0.22);
		    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18);
		    color: inherit;
		    animation: we-notice-in 240ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
		  }
		  @keyframes we-notice-in { from { opacity: 0; transform: translate(-50%, 12px); } }
		  .we-update-notice__title { font-weight: 600; font-size: 0.95em; }
		  .we-update-notice__body { font-size: 0.82em; line-height: 1.5; opacity: 0.92; }
		  .we-update-notice__body p { margin: 0 0 6px; }
		  .we-update-notice__hint { font-size: 0.78em; opacity: 0.6; }
		  /* The notice is a DARK glass card, but .we-picker__btn inherits light-theme
		     tokens (--dsw-alias-border-l2 / --dsw-alias-label-secondary). On the dark card
		     those render as near-black: measured 1.10:1 for the outline and 1.06:1 for the
		     label, so the button looked like floating, unreadable text. Pin light values
		     here so the control stays legible whatever the theme tokens resolve to.
		     Measured after fix: outline 3.11:1, label 4.95:1 (WCAG 4.5 text / 3.0 non-text). */
		  .we-update-notice__btn {
		    align-self: flex-end;
		    color: rgba(255, 255, 255, 0.92);
		    border-color: rgba(255, 255, 255, 0.6);
		  }
		  @media (prefers-reduced-motion: reduce) { .we-update-notice { animation: none !important; } }

		  /* Glass repo side panel — docked right, locked to 1/4 of the viewport,
		     full height, inner body scrolls. Same liquid-glass recipe as the settings
		     window: reads the very same --we-blur / --we-saturate / --we-glass-alpha /
		     --we-glass-color / --we-glass-brightness knobs, so the 玻璃 sliders in
		     settings retint this panel live. Open/close = transform + opacity fade,
		     token-driven; closed keeps visibility hidden (delayed so the fade-out
		     finishes first) with pointer-events off. */
		  .we-repo-panel {
		    position: fixed; top: 0; right: 0;
		    width: 25vw; max-width: 25vw;
		    height: 100vh; height: 100dvh;
		    z-index: 995;
		    display: flex; flex-direction: column;
		    padding: 14px;
		    box-sizing: border-box;
		    transform: translateY(-102%);
		    opacity: 0;
		    visibility: hidden;
		    pointer-events: none;
		    transition:
		      transform 800ms cubic-bezier(0.45, 0, 0.55, 1),
		      opacity 690ms cubic-bezier(0.45, 0, 0.55, 1),
		      visibility 0s linear 800ms;
		  }
		  /* The glass (backdrop-filter + tint + shadow) lives ONLY on the open state:
		     while closed the panel is off-screen and must not allocate a full-viewport
		     backdrop-filter compositing layer (a fixed, always-present backdrop-filter
		     layer is a known Chromium white-flash-on-repaint source). */
		  .we-repo-panel--open {
		    border-left: 1px solid rgba(255, 255, 255, 0.22);
		    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 72%), transparent);
		    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
		    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    box-shadow:
		      inset 1px 0 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
		      inset 0 1px 0 rgba(255, 255, 255, 0.14),
		      -18px 0 44px rgba(0, 0, 0, 0.22);
		    transform: translateY(0);
		    opacity: 1;
		    visibility: visible;
		    pointer-events: auto;
		    transition:
		      transform 800ms cubic-bezier(0.45, 0, 0.55, 1),
		      opacity 690ms cubic-bezier(0.45, 0, 0.55, 1),
		      visibility 0s;
		  }
		  .we-repo-panel__head {
		    display: flex; align-items: center; justify-content: space-between;
		    gap: 8px; flex: 0 0 auto;
		    padding-bottom: 10px;
		    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
		  }
		  .we-repo-panel__title { font-weight: 600; font-size: 0.95em; white-space: nowrap; }
		  /* Body: THE scroll container. Content (the whole WallpaperPicker) grows
		     freely; hover-scale overflow guards mirror the modal body's. */
		  .we-repo-panel__body {
		    flex: 1; min-height: 0;
		    overflow-y: auto;
		    overscroll-behavior: contain;   /* wheel doesn't bleed into the chat behind */
		    scrollbar-gutter: stable;
		    display: flex; flex-direction: column;
		    padding-top: 10px;
		  }
		  .we-repo-panel__body > .we-picker { flex: 1 0 auto; }
		  /* Panel is tall: let grids fill instead of their own internal scroll caps —
		     same release as the modal body uses. Layout styles themselves untouched. */
		  .we-repo-panel .we-picker__grid { max-height: none; }
		  /* Enlarged CD disc inside the panel context only (~1.4×), per design. The
		     cover inset is %-based so it scales along; just resize the spindle hole.
		     The platter stays a solid black vinyl (user asked to keep it black). */
		  .we-repo-panel .we-vinyl {
		    width: 176px; height: 176px;
		    background: repeating-radial-gradient(circle at center, #191920 0 2px, #23232c 2px 4px);
		    box-shadow:
		      0 6px 18px rgba(0, 0, 0, 0.55),
		      inset 0 0 0 1px rgba(255, 255, 255, 0.07);
		  }
		  .we-repo-panel .we-vinyl__hole { width: 16px; height: 16px; margin: -8px 0 0 -8px; }
		  /* While the drawer is closed it is hidden but the picker stays mounted, so
		     the vinyl's spin animation would keep running unseen — constant hidden
		     compositor work that can contend with chat repaints and flash white.
		     Freeze the disc until the drawer actually opens. */
		  .we-repo-panel:not(.we-repo-panel--open) .we-vinyl { animation-play-state: paused; }
		  /* Req: the CD-adjacent current-wallpaper card and the custom-wallpaper
		     partition render as transparent glass instead of the dark surface layer,
		     so the blur behind shows through. */
		  .we-repo-panel .we-picker__current,
		  .we-repo-panel .we-picker__uploads,
		  .we-repo-panel .we-picker__uploads-item { background: transparent !important; }
		  /* Repo-path picker modal → its own right-quarter liquid-glass window instead
		     of the centred dark dialog. A transparent full-screen scrim keeps "click
		     outside to close" + focus containment without dimming the page behind.
		     (z-order: repo panel 995 < rope 996 < scrim 1003 < panel modal 1004.) */
		  .we-repo-panel__modal-scrim {
		    position: fixed; inset: 0; z-index: 1003;
		    background: transparent;
		  }
		  .we-picker__modal--panel {
		    position: fixed; top: 0; right: 0; z-index: 1004;
		    box-sizing: border-box;
		    width: 25vw; max-width: 25vw;
		    height: 100dvh; max-height: 100dvh;
		    border-radius: 0;
		    border: 0; border-left: 1px solid rgba(255, 255, 255, 0.22);
		    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 80%), transparent);
		    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
		    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
		    box-shadow:
		      inset 1px 0 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
		      inset 0 1px 0 rgba(255, 255, 255, 0.14),
		      -18px 0 44px rgba(0, 0, 0, 0.22);
		    animation: we-repo-panel-in 800ms cubic-bezier(0.45, 0, 0.55, 1);
		  }
		  @keyframes we-repo-panel-in {
		    from { transform: translateX(102%); opacity: 0; }
		  }

		  /* No backdrop-filter support: near-opaque tinted surface, same policy as the
		     settings-window/sidebar fallbacks, so panel text stays readable. */
		  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		    .we-repo-panel {
		      background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) 92%, transparent);
		      backdrop-filter: none; -webkit-backdrop-filter: none;
		    }
		    .we-picker__modal--panel {
		      background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) 94%, transparent);
		      backdrop-filter: none; -webkit-backdrop-filter: none;
		    }
		  }
		  @media (prefers-reduced-motion: reduce) {
		    .we-rope--settle, .we-repo-panel, .we-picker__modal--panel, .we-repo-panel__modal-scrim { transition: none !important; }
		    .we-picker__modal--panel { animation: none !important; }
		  }
		`;

		// Bumped v2: force a fresh <style> injection even when a page still carries the
		// old stylesheet tag from a previous bundle (TAG_ID dedupes the injection; a
		// static id would leave stale CSS rules active and new rules missing).
		const TAG_ID = "dsh-wallpaper-engine/styles-v2";
		if (typeof document !== "undefined" &&
		    document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
		  const tag = document.createElement("style");
		  tag.dataset.plugin = "dsh-wallpaper-engine";
		  tag.dataset.pluginCss = TAG_ID;
		  tag.textContent = CSS;
		  document.head.appendChild(tag);
		}

		// ── Plugin exports ──────────────────────────────────────────────────────────
		const inject = ["slots"];

		// Immersive app-window (desktop shortcut → standalone / fullscreen / minimal-ui)
		// windows composite on a different path than a normal tab, and Chromium can
		// flash the WHOLE window white when a backdrop-filter surface re-rasterises
		// over the wallpaper on interaction (click/typing). Detect that mode once and
		// tag <body>; the CSS then drops the frosted blur there (translucent glass),
		// while normal tabs keep the full frosted look.
		function detectAppWindow() {
		  try {
		    if (typeof navigator !== "undefined" && navigator.standalone) return true; // iOS PWA
		    if (typeof window === "undefined") return false;
		    if (typeof window.matchMedia === "function"
		        && (window.matchMedia("(display-mode: standalone)").matches
		          || window.matchMedia("(display-mode: fullscreen)").matches
		          || window.matchMedia("(display-mode: minimal-ui)").matches)) return true;
		    // Desktop-shortcut / kiosk app window: it has NO browser chrome (tabs,
		    // address bar), so the window's outer dimensions equal the inner viewport.
		    // A normal tab's window is always larger than its viewport. This reliably
		    // catches managed/kiosk/--app windows even when display-mode misreports.
		    if (window.outerWidth === window.innerWidth && window.outerHeight === window.innerHeight) return true;
		  } catch { /* ignore */ }
		  return false;
		}

		function apply(ctx) {
		  // Mark immersive/app-window mode so the CSS can stabilise the compositor there.
		  try {
		    if (typeof document !== "undefined" && document.body) {
		      if (detectAppWindow()) document.body.setAttribute("data-we-appwindow", "on");
		      else document.body.removeAttribute("data-we-appwindow");
		    }
		  } catch { /* ignore */ }

		  // 1. Mount the behind-body wallpaper + scrim layers and keep them in sync
		  //    with the selection store. ctx.effect gives fiber-lifetime cleanup.
		  if (ctx.effect) {
		    ctx.effect(() => {
		      const unsub = subscribe(syncLayers);
		      const unsubEffects = subscribe(applyEffects);
		      // Occlusion pause: re-apply the effective playing state whenever the
		      // page hides/shows or the window loses/gains focus (see occlusionActive).
		      // Fires syncLayers → play/pause on the video; decode drops to 0 while
		      // minimized / covered by another app, exactly like desktop WE.
		      const onOcclusionChange = () => emit();
		      let ocListeners = [];
		      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
		        for (const t of ["visibilitychange", "blur", "focus"]) {
		          window.addEventListener(t, onOcclusionChange);
		          ocListeners.push(t);
		        }
		      }
		      // Battery optimization (省电暂停): navigator.getBattery is deprecated but
		      // still functional in Chromium; feature-detected so other engines just
		      // no-op. 'chargingchange' covers plug/unplug; onOcclusionChange re-applies
		      // the effective playing state.
		      let batteryCleanup = null;
		      let disposed = false;
		      if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
		        navigator.getBattery().then((bm) => {
		          // The plugin effect may have been torn down (disable / HMR) while
		          // this promise was pending — registering listeners then would leak.
		          if (disposed) return;
		          weBattery = bm;
		          bm.addEventListener("chargingchange", onOcclusionChange);
		          batteryCleanup = () => bm.removeEventListener("chargingchange", onOcclusionChange);
		          emit(); // already on battery → pause immediately
		        }).catch(() => { /* battery API unavailable: no-op */ });
		      }
		      syncLayers();
		      applyEffects();
		      return () => {
		        disposed = true;
		        unsub();
		        unsubEffects();
		        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
		          for (const t of ocListeners) window.removeEventListener(t, onOcclusionChange);
		        }
		        if (batteryCleanup) { batteryCleanup(); batteryCleanup = null; }
		        weBattery = null;
		        clearRotationTimer();
		        abortTranscodeUpgrade(); // 含 clearUpgradePoll + AbortController.abort（否则卸载后 500ms 轮询永久泄漏）
		        weStopDraw();
		        const node = document.getElementById(LAYER_ID);
		        if (node) { releaseLayerMedia(node); node.remove(); }
		        const scrim = document.getElementById(SCRIM_ID);
		        if (scrim) scrim.remove();
		        clearEffects();
		        document.body.removeAttribute(ACTIVE_ATTR);
		      };
		    });
		  }

		  // 2. Settings page as a FIRST-LEVEL settings section (mirrors the skin-center
		  //    in dsh-web-ui-all: its own nav entry, rendered inside the panel content
		  //    column). The picker renders inside the liquid-glass card shell.
		  if (ctx.slots) {
		    ctx.slots.inject("settings.section", () =>
		      ctx.slots.register(
		        { name: "settings.section", id: "wallpaper-engine", order: 500, label: "Wallpaper Engine" },
		        () => React.createElement(WallpaperPickerSection),
		      ),
		    );
		  }

		  // 3. Chat-interface rope dock: the draggable pull-cord + glass repo side
		  //    panel, portalled onto <body> under its own React root — independent of
		  //    the settings view, floating above the conversation. Feature-detected
		  //    (react-dom without createRoot → skip) so minimal host/mocks stay safe.
		  if (ctx.effect && typeof document !== "undefined" &&
		      typeof ReactDOM !== "undefined" && typeof ReactDOM.createRoot === "function") {
		    ctx.effect(() => {
		      let host = document.getElementById(ROPE_DOCK_ID);
		      if (!host && document.body && typeof document.createElement === "function") {
		        host = document.createElement("div");
		        host.id = ROPE_DOCK_ID;
		        document.body.appendChild(host);
		      }
		      if (!host) return undefined;
		      const root = ReactDOM.createRoot(host);
		      root.render(React.createElement(RopeDock, null));
		      return () => {
		        try { root.unmount(); } catch { /* already gone */ }
		        if (host.parentNode) host.parentNode.removeChild(host);
		      };
		    });
		  }

		  // Settings first (host file, port-independent), then inventory — so the
		  // selection restore inside loadInventory()'s revalidateSelection() sees the
		  // persisted id and can resolve its media URL.
		  loadPersisted().then(loadInventory);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
