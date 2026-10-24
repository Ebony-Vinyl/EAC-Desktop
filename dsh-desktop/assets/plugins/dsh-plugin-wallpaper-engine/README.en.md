# dsh-plugin-wallpaper-engine

[English](README.en.md) | [中文](README.md)

> 🆕 Never used the command line? Start here: **[beginner-friendly guide →](README.beginner.md)** (a simplified walkthrough in Chinese for users who have never touched a terminal).

A DSH bundle that turns your **Wallpaper Engine** wallpapers into the **background of the DSH web GUI** (`dsh web`).

> ✅ **Improved: occasional full-screen white flash in immersive windows** (v0.6.4, keeps full frosted glass)
> Older builds could flash the **whole window white** when you clicked the dialog or typed in an **immersive fullscreen window** opened via a **desktop shortcut** (standalone / kiosk) — under **hardware acceleration**, Chromium's compositor occasionally paints the backdrop white while it re-composites over the wallpaper.
> **v0.6.4 keeps reducing the compositing layers**: the repo panel is lazy-mounted when closed, the rope has no permanent filter, and the wallpaper media no longer forces a transform compositing layer by default — whilst **keeping the full frosted glass**. Normal browser tabs are unaffected and keep the full frosted glass + hardware acceleration.
> The plugin shows a one-time notice (once per version) about this.

It discovers the Wallpaper Engine install on your machine, lists its wallpapers, and renders them behind the DSH chat interface with an iOS-style **liquid glass** effect: Video (`.mp4`) plays live, Web/HTML loads in an iframe, and **Scene wallpapers are re-rendered as full-scene frames by the built-in renderer (object tree / textures / particles / shader effects)**. Since v0.2 it also adds:

- **Modal wallpaper picker** — the thumbnail grid lives in a popup modal, so the settings page stays compact;
- **Hide / restore (soft delete)** — hide wallpapers you don't want, restore them anytime; no source files are touched;
- **Playback speed** — six native presets from 0.5x to 2x, instant, no media reload;
- **Horizontal flip** — mirror the image (video / web / uploaded images);
- **Custom uploads** — use your own local JPG / PNG / MP4 as a wallpaper, with a configurable storage location and fit modes;
- **Scene full-scene frames** (v0.6) — Scene wallpapers are fully replayed by a pure-JS scene renderer (object tree / textures / particles / shader effects) instead of being an unusable "not playable" entry.
- **Liquid-glass settings page** (v0.3.1) — the settings UI is now a **first-level settings page** (following the dsh-web-ui-all skin-center design): the whole page is a customizable liquid-glass card with **accent color** (6 presets + a custom color picker) and **glass transparency** (0–60%). Both apply instantly and persist.
- **Whole-settings-window liquid glass** (v0.3.2) — one click turns the **entire native DSH settings window** (dialog + left nav + ALL native sections: General / Models / Plugins / …) into liquid glass with your custom accent + transparency. With the「设置窗口液态玻璃」master switch on, the window background, nav active/hover, buttons, switches and links all follow the chosen accent and transparency; off restores the stock look.
- **Unified glass tuning** (v0.3.3–v0.3.5) — the settings-window glass blur shares the SAME adjustment as the conversation bar: the **玻璃** (glass) slider (0–60 px) drives the blur radius of both the settings window and the composer/bubbles, with an identical saturation/brightness/contrast recipe. A new **玻璃颜色** (glass color) control lets you tint the glass BASE itself (6 presets + custom picker; defaults white in light / deep navy in dark; once picked, both themes use that color) — **配色** styles the interactive elements, **玻璃颜色** styles the glass itself.
- **Settings persisted to a host file** (v0.4.0) — all settings (selected wallpaper, accent, transparency, layout, rotation, hidden, speed/flip, …) are now stored in `~/.dsh-wallpaper-engine/config.json` instead of browser localStorage, so they survive restarts, port changes (including DSH Desktop's random `--port 0` loopback port), browser-data clears and browser switches. Legacy localStorage config is migrated automatically on first launch.
- **Edge-compatible rendering** — Edge (and only Edge) paints its built-in "download / cast" media-overlay toolbar over any *visible* `<video>` element, and there is no official switch to disable it. On Edge, video wallpapers are therefore rendered onto a `<canvas>` by default to keep that toolbar away. A new「Edge 兼容」toggle (right-aligned on the 紧凑布局 row, on by default) turns this off and falls back to the native `<video>` in every browser.
- **Media-stream handle fix + async scan** (v0.4.1) — media/preview/scene-frame streams now release their file handles immediately when the client disconnects (fixes handles accumulating with every wallpaper switch/refresh, and Windows locking that prevented deleting/moving a wallpaper file). The wallpaper-library scan is fully async (fs.promises thread pool), so it no longer blocks the event loop (noticeably faster startup on WSL / big libraries). **WSL support**: Steam roots mounted under `/mnt/<drive>` are auto-detected, so a Harness running inside WSL can discover a Windows Wallpaper Engine install.
- **Occlusion pause (battery-saving trio)** — like Wallpaper Engine's "pause when covered": pause the video wallpaper on minimize / tab-switch, on window focus loss, and/or on battery power, dropping the decoder engine to zero; it resumes automatically when you come back (web/iframe wallpapers are only throttled by the browser while hidden). Each toggle persists.
- **Decode frame-rate cap (frame-skip transcode)** — high-fps sources (e.g. 4K120 H.264) are the dominant GPU cost (~60% Video Decode at 1.0x on a 4060). The **帧率上限** control (unlimited / 60 / 48 / 30 / 24 fps) has the host re-encode the wallpaper ONCE to the capped fps (timeline stays 1.0x normal speed, fully decoupled from 倍速) as **4K-preserving AV1**, with a **live download/transcode progress bar**; measured 4K120→24fps drops GPU from ~60% to **~15%**. ffmpeg is provisioned in three tiers: explicit path → **auto-download** (npmmirror + GitHub dual-source race, cross-platform asset table verified) → system PATH.
- **Wallpaper-effect tuning sliders** (v0.6.x) — the **壁纸效果** area gains three new sliders: **亮度 / 对比度 / 饱和度** (wallpaper media filter), alongside wallpaper blur / scrim etc., so any wallpaper can be blended comfortably with the UI. All apply instantly and persist.
- **Custom typography** (v0.6.7) — a new **字体** section in settings. The master switch defaults to off (stock dsh look); once enabled you can tune **font color / weight (100–900) / family** (default · YaHei · KaiTi · SimSun · SimHei · 行楷 Xingkai · monospace, each chip previewed in its own font). Error/danger/warning text keeps its system red; toggling the switch off restores defaults in one click.

![Wallpaper showcase](docs/images/showcase.png)

> Wallpaper + scrim + iOS liquid glass rendered behind the DSH GUI.

## Which wallpaper types are supported?

Wallpaper Engine wallpapers come in four types:

| Type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | Wallpaper Engine's own 3D engine | ✅ Full-scene frame — a pure-JS scene renderer (object tree / textures / particles / shader effects), see below |
| **Video** | a plain `.mp4` file | ✅ Yes — plays in a `<video>` tag |
| **Web** | a Chromium (`webwallpaper64.exe`) host for HTML | ✅ Yes — loads in an `<iframe>` |
| **Application** | an injected external window | ❌ No |

A Scene wallpaper's 3D scene is fully replayed by the plugin's **pure-JS scene
renderer** (`lib/scene-renderer.js`, built from linux-wallpaperengine / repkg
reverse-engineering): it parses `scene.pkg`'s object tree and renders every
image layer (with CPU implementations of shader effects like waterwaves /
waterripple / shake), the puppet skeletal meshes (bind pose), and the particle
systems (emitters / initializers / operators / sprite drawing). Scene cards carry
a 「静态帧」 badge in the picker.

> **Expected result**: the renderer outputs a 3840×2160 full-scene frame
> (background + water + back hair + character + umbrella + particles), close to
> the original for photographic, illustration and animation-screenshot scenes.
> On failure (pure shader/procedural scenes, exotic texture formats) it falls
> back to the older main-texture extractor, then to the workshop preview image
> (`preview.jpg`) — expected behaviour, not a defect.

### Scene rendering: how it works

- **Object tree**: parses `scene.pkg` (PKGV container + LZ4 entry chains) or a
  loose `scene.json` directory, topologically sorts every object (image /
  particle / text / sound) by dependencies / parent.
- **image layers**: loads the material main textures (RGBA8888 / DXT1/3/5 …),
  positions them in scene coordinates (origin / scale / angle accumulated down
  the parent chain), and applies alpha / brightness.
- **puppet meshes**: MDL (MDLV) mesh + bind-pose rasterization (software
  raster + bilinear UV sampling + alpha compositing), so skeletal models like
  the character / back hair display correctly.
- **shader effect chain**: waterwaves (incl. the dual-wave DUALWAVES product) /
  waterripple / shake are implemented in the CPU with the exact shader math;
  mask textures are supported.
- **particle systems**: boxrandom / sphererandom emitters, color / size / alpha /
  lifetime / velocity / rotation initializers, movement / alphafade / sizechange /
  turbulence / oscillate* operators, and sprite drawing.
- **Cache**: results are cached at `~/.dsh-wallpaper-engine/cache/frames/`
  keyed by `<version>_<path>_<mtime>` (override with `DSH_WE_CACHE_DIR`);
  workshop updates and renderer upgrades invalidate the frame automatically.
  First render takes ~3–4s, then near-instant on cache hit.

## How it works

- **Host half** (`lib/index.js`): a Cordis plugin that
  1. locates the Wallpaper Engine install by reading Steam's `libraryfolders.vdf`
     (so it works even when Steam is on a non-default drive),
  2. enumerates wallpapers from `projects/defaultprojects`, `projects/myprojects`,
     and `steamapps/workshop/content/431960/*`,
  3. registers same-origin HTTP routes on the DSH webserver so the browser half
     can fetch data and stream media directly:
     - `GET /wallpaper-engine/inventory` → JSON list of wallpapers
     - `GET /wallpaper-engine/media/<token>` → video / HTML (Range supported)
     - `GET /wallpaper-engine/preview/<token>` → preview image
     - `GET /wallpaper-engine/scene-frame/<token>` → scene full-scene frame (pure-JS renderer output 3840×2160, falls back to main-texture extraction, PNG disk-cached)
     - `POST /wallpaper-engine/upload` → upload a custom wallpaper (JPG / PNG / MP4, raw bytes)
     - `POST /wallpaper-engine/remove` → remove an uploaded wallpaper
     - `POST /wallpaper-engine/upload-dir` → change the upload directory (persisted to `~/.dsh-wallpaper-engine/config.json`, migrates existing files)
     - `GET /wallpaper-engine/settings` → read plugin settings (v0.4.0)
     - `PUT /wallpaper-engine/settings` → save plugin settings (v0.4.0, written to `~/.dsh-wallpaper-engine/config.json`)
     - `GET /wallpaper-engine/media-info/<token>` → media metadata (resolution / codec / fps / duration, from a moov probe)
     - `GET /wallpaper-engine/transcoded/<token>?fps=N` → frame-skip transcode stream (one-time ffmpeg re-encode, disk-cached)
     - `GET /wallpaper-engine/transcode-progress/<token>?fps=N` → download / transcode progress (progress-bar polling)
- **Client half** (`lib/client.js`): a browser module that fetches the inventory
  and renders the selected wallpaper into a fixed layer *behind* the app columns,
  plus a **first-level settings page** "Wallpaper Engine" (liquid-glass card,
  picker modal, hide/restore, playback speed / flip, accent color + glass
  transparency, and custom-upload management).
- **Custom-upload storage**: uploaded files are written to a plugin-managed local
  directory (default `~/.dsh-wallpaper-engine/uploads`, changeable from the
  settings UI) and served through the same `/media` + `/preview` routes as WE
  media — identical pipeline, survives restarts, no browser quota limits.

## Settings persistence (v0.4.0)

**All your settings (selected wallpaper, colors, transparency, layout, rotation,
hidden wallpapers, playback speed / flip, …) are stored in a host-side file
since v0.4.0 — no longer in browser localStorage.**

- **Where**: `~/.dsh-wallpaper-engine/config.json` (the same file that stores
  the upload-directory preference). Concrete locations:
  - Windows: `C:\Users\<your-user>\.dsh-wallpaper-engine\config.json`
  - WSL / Linux / macOS: `~/.dsh-wallpaper-engine/config.json`
- **Why**: settings used to live in browser localStorage, which is isolated by
  *origin* (scheme + host + **port**). DSH Desktop starts the harness on a
  **random port every launch**, so each start looked like a brand-new storage
  space and every setting fell back to defaults (plain web on a fixed port was
  unaffected). Storing on the host makes persistence port-independent.
- **What you get**: settings survive restarts, port changes, browser-data
  clears, browser switches and private windows.
- **Migration**: config saved by older versions in localStorage is **migrated
  automatically on first launch** — nothing to do.
- **Behavior change to know**: on one machine, multiple browsers (e.g. Chrome
  and Edge) or devices pointing at the same dsh now **share one configuration**
  (previously each had its own). If you roll back to an older version, it still
  reads the localStorage cache copy, so nothing is lost.
- **Writes**: every settings change is persisted automatically (debounced
  200 ms); if the file is corrupted the plugin falls back to defaults and does
  not overwrite your file.

## Install

### For users (published version, recommended)

If you simply want to use the plugin, install the published package from npm:

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

Then restart `dsh web` and open **Settings → Wallpaper Engine**.

> **macOS users**: Wallpaper Engine has no macOS client. The macOS line of this
> plugin (WaifuX + loose-media support) is maintained by Jerry and published as
> a separate npm package:
>
> ```sh
> dsh plugin --profile web add dsh-plugin-wallpaper-engine-mac
> ```
>
> Repo: https://github.com/ruijiaang-lab/dsh-wallpaper-engine

### For developers (running your own copy)

**For most people you can skip this section.** You only need it if you want to
work on the plugin's code yourself. The steps below assume you know what a command
line and a *repository* (a code folder that is under Git version control) are.

**1. Get the code (`checkout`)**

> *What "checkout" means:* it just means "download/get a copy of the source code
> into a folder on your machine." Typically you click **Code → Download ZIP** on
> this GitHub page and unzip it, or clone it with Git:
>
> ```sh
> git clone https://github.com/elysia395/dsh-wallpaper-engine.git
> ```
>
> After this you have a folder that contains `package.json`, `lib/`, `src/`, and
> `cordis.patch.yml`. That folder is what the rest of this section calls
> **the plugin folder**.

**2. Install it using its folder path (`link:`)**

> *What `link:` means here:* it tells `dsh` (which forwards the command to `pnpm`)
> to make a *link* to your local plugin folder instead of downloading a package
> from the internet. The benefit: when you edit the code and rebuild, the change
> shows up without reinstalling.

Replace `<插件文件夹绝对路径>` below with the **full path of your plugin folder**
(the "address bar" path you see when you open that folder in Explorer / your file
manager):

```sh
dsh plugin --profile web add link:<插件文件夹绝对路径>
```

**Concrete example** — if your plugin folder is at a path like `D:\dev\dsh-wallpaper-engine`:

```sh
dsh plugin --profile web add link:D:\dev\dsh-wallpaper-engine
```

You can also use a relative path if your shell's current directory is already the
folder's parent:

```sh
dsh plugin --profile web add link:./dsh-wallpaper-engine
```

> **Which exact path to fill in?** It must be the **folder that contains
> `package.json`** — not the path to `package.json` itself, and not any file inside.
> It is the same value you would paste into Explorer's address bar to open that folder.

> Why prefer `link:` over `file:`? `link:` creates a live link to your source
> folder, so edits to `src/client.js` + `npm run build` take effect without
> reinstalling; `file:` packs a static snapshot, which needs a re-add after every
> change. Both work for a first install.

Then restart `dsh web`. The host plugin becomes a bundle layer and the client
plugin auto-loads (`dsh.client.immediately: true`).

If your machine has Steam installed in a non-standard location, the host auto-detects
via `libraryfolders.vdf`. Nothing further is required.

## Usage

1. Open `dsh web` → the DSH GUI.
2. Open **Settings** and pick **Wallpaper Engine** from the left navigation (a first-level settings page, its own nav entry).
3. Click **选择壁纸** to open the picker modal, then click a Video/Web/Scene wallpaper (or an uploaded image/video) in the thumbnail grid. It appears behind the app; close the modal via the backdrop, ESC, or the close button. Application wallpapers cannot be embedded in the web UI and are hidden from the grid.
4. Use **暂停/播放** to pause a video wallpaper, and **关闭** to clear it.
   The choice is remembered in your browser's `localStorage` (key
   `dsh-wallpaper-engine:selection`).

![Settings UI overview](docs/images/features.png)

> The settings page: the liquid-glass card (外观 accent/transparency), the current-wallpaper card, plus the 自定义壁纸 / 轮播列表 / 壁纸效果 sections.

![Wallpaper picker modal](docs/images/wallpaper-library.png)

> The picker modal: browse every wallpaper thumbnail, batch-hide, and restore from the hidden tab.

### Hide & restore (soft delete)

Every wallpaper card has a **隐藏** button in its top-right corner — it only removes the wallpaper from the list, **never touches the source file**. Restore any wallpaper from the **已隐藏** tab in the modal (single restore or **全部恢复**); the **批量** button in the modal toolbar enters multi-select mode to hide several at once. Hidden state is persisted in `localStorage` (survives refresh/restart); hiding the currently playing wallpaper doesn't interrupt playback, and automatic rotation skips hidden wallpapers.

### Content-rating & type filters

Above the thumbnail grid in the picker modal there are two dropdowns that
reproduce Wallpaper Engine's own categorisation:

- **内容分级** (content rating) — reads each wallpaper's `contentrating` field
  from `project.json` (WE's workshop tags G / PG13 / R): **全部** (all) /
  **Everyone (G, default)** / **PG13** (parental guidance) / **Mature (R)** /
  **未分级** (unrated — wallpapers without the field, typically local projects
  or custom uploads).
- **类型** (type) — filters by the embeddable type: **全部** (all) / **视频**
  (video) / **网页** (web) / **图片** (image, custom uploads).

Every option shows how many playable wallpapers currently match. Wallpapers
outside the selected categories are dropped from the grid, the rotation editor
and the rotation candidates — they are never auto-selected or rotated either.
The choice persists in browser `localStorage`; the default is **Everyone**,
mirroring Wallpaper Engine's conservative first-run stance.

> Note: the rating is read from each wallpaper file's `contentrating` field —
> the same rating WE's client shows — but the plugin does **not** follow the
> adult-content switch inside the Wallpaper Engine client (it scans the disk
> directly and bypasses WE's configuration).

### Card style & vinyl record

- **紧凑布局 (compact layout)**: a sliding toggle at the top of the settings
  page. ON gives the **CD-rack** look — cards stack like CD jewel cases
  (each row's top covers the row above, vertical only), hovering scales the
  card up and brings it to the front, the grid is tighter (~7 cards per row)
  and shows everything on ONE page with no pagination. OFF is the regular
  grid (fixed-height overlap-proof cards with pagination, default). The
  choice persists in `localStorage`.
- **黑胶唱片 (vinyl record)**: next to the wallpaper selection there is a
  **rotating vinyl record** that uses the selected wallpaper's cover as the
  record label — it spins while the wallpaper plays and stops when paused
  (animation is disabled under `prefers-reduced-motion`). A small record also
  sits in the picker modal head. The vinyl shows in **both** card styles.

![Compact wallpaper library (CD-rack layout)](docs/images/compact-wallpaper-library.png)

> Compact layout: the CD-rack stacked grid, hover scales the card to the front, everything on one page.

![Rotating vinyl record](docs/images/vinyl-record.gif)

> Vinyl record: the selected wallpaper's cover as the record label, spinning while playing, stopped on pause.

### Playback speed & horizontal flip

With a video wallpaper selected, the **壁纸效果** area shows the **倍速** presets (0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x) — driven by the browser's native `playbackRate`, instant, no reload or black flash (wallpaper videos are muted, so there is no audio to keep in sync). The **水平翻转** toggle mirrors the image via CSS `scaleX(-1)` — it works for video, web, and uploaded images/videos alike, with zero main-thread cost.

### Occlusion pause (battery-saving trio)

Like Wallpaper Engine's "pause when covered" — the main reason desktop WE is ~0 GPU most of the time. Browsers cannot detect window occlusion directly, so the plugin uses the three closest signals (toggles in the **壁纸效果** area, instant + persisted):

| Toggle | Default | Behavior |
|---|---|---|
| **最小化/切页时暂停** (pause on minimize/tab-switch) | on | pauses the video when the page is hidden (minimized / tab switched away); the decoder drops to zero — explicit `pause`, since browser throttling alone does not guarantee stopped decoding |
| **窗口失焦时暂停** (pause on focus loss) | off | pauses when another app takes focus (the wallpaper is likely covered) |
| **使用电池时暂停** (pause on battery) | off | pauses while on battery via `navigator.getBattery` (no-op in browsers without it) |

Playback resumes automatically when you come back / regain focus / plug in (unless you paused manually). Video wallpapers only — web (iframe) wallpapers cannot be paused from outside and are only throttled by the browser while the page is hidden.

### Decode frame-rate cap (frame-skip transcode)

High-fps sources (e.g. 4K120 H.264) dominate GPU decode (~60% Video Decode at 1.0x on a 4060). The **帧率上限** control (unlimited / 60 / 48 / 30 / 24 fps) has the host re-encode the wallpaper ONCE to the capped frame rate via ffmpeg — the timeline stays **1.0x normal speed** and stays fully decoupled from 倍速 — output is **4K-preserving AV1** (NVDEC decode throughput for AV1 is roughly 2× H.264), cached under `~/.dsh-wallpaper-engine/cache/transcodes/`.

- The original plays **first**, and the app swaps to the transcoded file when ready; the settings page shows a **live progress bar** (downloading ffmpeg % → transcoding % with an estimated-seconds-readout → finalizing → switch). First run takes a few tens of seconds (including a possible one-time ffmpeg download); afterwards the same wallpaper opens instantly.
- Sources at/below the cap are skipped; transcode failures transparently fall back to the original — nothing else is affected.
- Measured: 4K120 → 24fps AV1 drops GPU from ~60% to **~15%**.
- Cached per path+mtime+cap, so rotation pays the cost once per wallpaper.

**ffmpeg provisioning (three tiers, auto-detected in order)**:

| Tier | Notes |
|---|---|
| **Explicit** | `DSH_WE_FFMPEG` env var pointing at any ffmpeg binary, or drop one into the plugin dir as `./ffmpeg/ffmpeg(.exe)` — both take priority |
| **Auto-download** | with no local ffmpeg, the first use downloads a pinned single-file build for the platform (Windows x64 / Linux x64·arm64 / macOS x64·arm64 etc., asset table verified) from a **dual-source race**: `npmmirror` (fast in CN) vs GitHub release (fast elsewhere), first success wins — streamed to disk, magic-byte/size verified, 5-minute per-source timeout, cached at `~/.dsh-wallpaper-engine/ffmpeg/`. `DSH_WE_FFMPEG_URL` overrides the source (self-hosted mirror / proxy). |
| **System PATH** | falls back to a bare `ffmpeg`; if none exists the wallpaper silently stays on the original |

> Transcoding uses **NVENC** (`av1_nvenc`, falling back to `h264_nvenc`) and requires an NVIDIA GPU + driver; without one the feature auto-disables (or falls back to slow software H.264). No ffmpeg or a failed transcode simply disables the feature — no side effects.

### Custom wallpapers

The **自定义壁纸** section uploads local images (JPG / PNG) or videos (MP4) as wallpapers:

- **Storage location**: files default to `~/.dsh-wallpaper-engine/uploads` (your home directory — usually the C: drive). Click **更改** to move storage to any drive (absolute path, `~` supported); existing files migrate automatically and the choice persists across restarts — recommended for users who don't want wallpaper data on the system drive.
- **Format limit**: JPG / PNG / MP4 only; validated twice (browser + host) with a clear error message.
- **Fit modes**: 覆盖 (cover) / 填充 (contain) / 居中 (center) / 拉伸 (fill) — applied to custom wallpapers only (WE wallpapers keep their intended cover framing).
- **Management**: each upload can be **移除** (confirm dialog, deletes the local file); uploaded wallpapers also support hide/restore, playback speed, and flip.
- **Deduplication**: re-uploading an identical file is detected by content (SHA-256) and returns the existing entry — no duplicate copies pile up in the library.

### Automatic rotation (轮播列表)

Rotation runs over **user-defined carousel lists** (轮播列表). Create any number of lists with **新建**, pick Video/Web wallpapers into each from the inventory, give each list its own switch interval (1, 5, 10, 30, 60 or 120 minutes) and order (顺序/随机), then enable **自动轮转** on the list you want active. Lists are persisted in your browser's `localStorage` and are fully client-side — rotation never depends on Wallpaper Engine's own `config.json` playlist paths.

At least two playable Video/Web wallpapers per list are required; manual changes reset the next timer; each list keeps its own cadence, so you can have one list switching every 5 minutes and another every 30. On first run, the first playable Wallpaper Engine playlist is imported automatically as a list so the feature works out of the box; **从 WE 播放列表导入** inside the editor imports any other playlist into the list being edited. Application wallpapers cannot be embedded in the web UI, so they are automatically excluded from rotation and hidden from the picker.

### Liquid-glass appearance (whole settings window + accent + transparency)

The **外观** (appearance) area at the top of the settings page controls the look
of the **entire native DSH settings window** (following the dsh-web-ui-all
skin-center design):

| Control | What it controls | Range | Default |
|---|---|---|---|
| **设置窗口液态玻璃** (settings-window glass) | Master switch: turns the whole settings window (dialog + left nav + all native sections) into liquid glass | on / off | on |
| **配色** (accent) | Theme color: buttons, switches, links, nav active, sliders and glass highlights inside the window all follow it | 6 presets + custom color picker | `#4f8cff` classic blue |
| **玻璃颜色** (glass color) | The BASE TINT of the settings-window glass itself (not just transparency) | 6 presets + custom color picker | white (light) / deep navy (dark) |
| **玻璃透明度** (glass transparency) | Opacity of the glass surfaces (settings window, composer, bubbles, sidebar panels) | 0–60 % | 12 % |

> With the master switch on, **every native section** (General / Models /
> Plugins / …) and the left nav become one liquid-glass + accent look — the
> plugin overrides the shell tokens scoped to the settings dialog, so nothing
> outside the window is touched. The settings-window glass blur uses the SAME
> adjustment range as the conversation bar: the **玻璃** (glass) slider (0–60 px)
> drives the blur radius of both the settings window and the composer/bubbles,
> with an identical saturation/brightness/contrast recipe; **玻璃颜色** sets the
> base tint of the glass itself (defaults white in light / deep navy in dark;
> once picked, both themes use that color), and the **玻璃透明度** control sets
> the transparency — higher lets the wallpaper colour show through more clearly,
> lower approaches solid. Browsers without `backdrop-filter` automatically fall
> back to a high-opacity solid so text stays readable. All controls apply
> instantly and persist in `localStorage`.

![Liquid-glass settings window](docs/images/liquid-glass-window.png)

> Liquid glass: the whole settings window unified as glass, following accent, glass color and glass transparency.

### Mascot (chat pull-cord)

At the bottom of the **外观** (appearance) area is a mascot control group for the chat **pull-cord** (a draggable rope pinned to the top edge; pulling it down slides out the **wallpaper repo** drawer):

| Control | What it does | Range | Default |
|---|---|---|---|
| **显示吉祥物** (show mascot) | Whether the pull-cord mascot and its wallpaper-repo drawer render | on / off | on |
| **吉祥物形态** (mascot form) | Switch artwork: default **小女仆** (near-square chibi) or **鲸御姐** (portrait 2:3 full-body) | 小女仆 / 鲸御姐 | 小女仆 |
| **吉祥物大小** (mascot size) | Scale the mascot (the rope box follows the ratio; drag / snap geometry adapts automatically) | 0.5×–2.5× | 1× |

> Both artworks are inlined as base64 (transparent background) at build time, so the single-file client bundle stays self-contained. **Size** changes only the rope's own box; the wallpaper-repo drawer below is unaffected. Settings apply instantly and persist to the host-side config file.

### Custom typography

The settings page has a dedicated **字体** (typography) section placed before **外观**. The **master switch defaults to off** — the UI keeps the stock dsh typography with zero injected styling; turn it on to apply the three knobs below. Every change applies instantly and persists:

| Control | What it does | Range / options | Default |
|---|---|---|---|
| **字体自定义** | Master switch: off = fully restore the stock dsh fonts (one-click reset) | on / off | off |
| **字体颜色** | Global text tint | custom color picker | `#000000` |
| **字重** | Global font weight | 100–900 (step 50) | 400 |
| **字体** | Font family switch | default · YaHei · KaiTi · SimSun · SimHei · 行楷 (Xingkai) · monospace | default |

> Each **字体** chip renders in its own font (WYSIWYG preview); 行楷 maps to `STXingkai` (falls back to KaiTi when not installed, `Xingkai SC` on macOS). Error / danger / warning elements keep their system red color — global tinting never overrides them.

### The seven sliders

While a wallpaper is active, seven sliders let you tune how it blends with the UI:

| Slider | What it controls | Range | Default |
|---|---|---|---|
| **壁纸模糊** (wallpaper blur) | Blurs the wallpaper itself | 0–60 px | 0 |
| **亮度** (brightness) | Wallpaper brightness (media filter) | 40–160 % | 100 % |
| **对比度** (contrast) | Wallpaper contrast (media filter) | 40–200 % | 100 % |
| **饱和度** (saturate) | Wallpaper saturation (media filter) | 0–200 % | 100 % |
| **暗化** (scrim) | Darkens the overlay between wallpaper and text | 0–90 % | 25 % |
| **边框** (border) | Raises border/divider contrast | 0–90 % | 35 % |
| **玻璃** (glass) | Blur radius of the frosted-glass panels (composer, bubbles) | 0–60 px | 24 |

> **Light vs. dark mode** — Wallpapers differ wildly in colour and brightness, so
> there is no one mode that fits every wallpaper. Switch DSH's theme between
> **light** and **dark** to find which suits the current wallpaper. If text or
> hairlines become hard to read on a bright or busy wallpaper, raise the
> **暗化 / 边框** sliders, or use **亮度** to tame an overly bright wallpaper
> (and optionally add a little **壁纸模糊**) until it is comfortable. All seven
> sliders apply instantly — no page refresh needed.

## Configuration

There is no model-visible tool or prompt text. The bundle adds zero tokens to the
agent. Selection, hidden state, and rotation lists live in browser `localStorage`;
no durable DSH settings are written. The only on-disk data is the **custom-upload
files** (in the directory you chose) and `~/.dsh-wallpaper-engine/config.json`
(~100 bytes) that remembers that directory.

**Environment variables**:

| Variable | Purpose |
|---|---|
| `DSH_WE_FFMPEG` | explicit ffmpeg executable path (highest priority in the resolution chain) |
| `DSH_WE_FFMPEG_URL` | replaces the auto-download source (self-hosted mirror / proxy) |
| `DSH_WE_CACHE_DIR` | overrides the cache root (transcode cache / scene-frame cache) |
| `DSH_WE_STEAM_ROOT` | explicit Steam root(s) (comma/semicolon separated, Windows or /mnt paths; fallback when registry/auto-detection misses) |

## dsh-better-sidebar compatibility

The liquid-glass effect is specifically adapted for dsh-better-sidebar's panels
(frost, specular highlight, and layer hierarchy are unified), so the sidebar and
the conversation area share the same wallpaper + scrim background and read as one
continuous surface.

The **外观** section exposes a set of **sidebar glass** controls independent of the
conversation glass (they target only the dsh-better-sidebar subtree; browsers
without `backdrop-filter` fall back to a near-opaque fill):

| Control | What it controls | Range | Default |
|---|---|---|---|
| **侧栏液态玻璃** | Master switch: frost the sidebar panels | On / off | On |
| **侧栏模糊** | Blur radius of the sidebar frost | 0–200 px | 16 |
| **侧栏透明度** | Sidebar glass density (**higher = clearer**: 0 densest / 200 clearest) | 0–200 % | 120 % |
| **侧栏玻璃颜色** | Sidebar glass **base tint** | 6 presets + custom picker | `#ffffff` white |

> Sidebar glass is a separate set of knobs from the settings-window glass: the
> conversation「玻璃」slider only drives the composer/bubbles, while the sidebar
> sliders drive the sidebar. The sidebar defaults to a fairly clear glass (so it
> matches the wallpaper instead of glowing white); editor/terminal content
> surfaces have their own near-opaque fill + transparency controls to keep text
> readable in the narrow panels.

![dsh-better-sidebar compatibility](docs/images/better-sidebar.png)

## Limitations

- Application wallpapers cannot be embedded and are hidden from the thumbnail
  picker and rotation candidates. Their live render remains Wallpaper Engine's
  desktop job. Scene wallpapers are re-rendered to a full-scene static frame
  (see above) — the only dynamic (animated particle / water) effects are frozen
  in that frame.
- The browser must be able to autoplay muted `<video>` (DSH runs on loopback; muted
  autoplay is allowed by modern browsers).
- Media is served from your local Wallpaper Engine install paths; the host only
  serves files it has already enumerated (no arbitrary filesystem exposure).
  Custom uploads likewise stay on your machine — nothing is uploaded to any server.
- **The frame-skip transcode depends on ffmpeg and NVIDIA NVENC** (`av1_nvenc` →
  `h264_nvenc` fallback): without ffmpeg (including unavailable auto-download,
  e.g. musl/Alpine or other uncovered platforms) or an NVIDIA GPU, the fps cap
  auto-disables and wallpapers keep playing the original — nothing else is affected.
- **Occlusion pause applies to video wallpapers only**: web (iframe) wallpapers
  cannot be paused from outside and are only throttled by the browser when hidden.
- The picker is English/Chinese mixed (this bundle is not yet wired into DSH's
  locale namespaces).

## Development / rebuild

Before contributing code, read the [contribution guide](CONTRIBUTING.md). Send Windows, WSL, and shared cross-platform changes to `main`; send macOS, WaifuX, and loose-media changes to `dsh-wallpaper-engine-mac`, maintained by [Jerry (@ruijiaang-lab)](https://github.com/ruijiaang-lab).

The host half (`lib/index.js`) is plain ESM with no build step. The client half
(`lib/client.js`) is a **compiled artifact** produced from the canonical source
`src/client.js` by `scripts/build-client.mjs`, which emits the exact
`window.__ModuleLoader__.load({ id, factory })` envelope the DSH module loader
consumes (the same shape `tsdown` emits for in-box client packages).

```sh
npm run build                  # regenerate lib/client.js from src/client.js
npm run verify                 # materialize the emitted bundle and assert its exports
node scripts/verify-scene.mjs  # scene static-frame extraction / scene-frame route self-test (incl. synthetic fixtures)
```

Edit `src/client.js`, then `npm run build`. Do not hand-edit `lib/client.js`.
`npm install`/`pnpm install` runs `prepare` → `build` automatically, so a
fresh checkout always ships a current `lib/client.js`.

The host↔browser contract is plain same-origin HTTP, so the two halves are
developed independently: rebuild the host by restarting `dsh web`, and rebuild
the client with `npm run build` before re-running `dsh web`.
