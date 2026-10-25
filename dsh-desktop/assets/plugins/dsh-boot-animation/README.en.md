# dsh-boot-animation

A **boot animation** for DSH: when you open a new conversation — or a conversation
you pinned — a video plays full-frame in the app window.

> 中文: [README.md](README.md)

- **Plays once per DSH launch** by default (0.4.2); this is a **switch** you can turn off to
  get the original "once per new conversation" behaviour
- **Or every time** you open a conversation you pinned (one click in the sidebar footer)
- Fills the whole **client window**, skippable, closes itself when it ends
- **Bring your own video** (three ways, below)

## Install

```sh
dsh plugin --profile web add github:NativeDog1/dsh-boot-animation
```

> The built output (`lib/`) is committed and the package has no `prepare`
> lifecycle script, so this installs **without compiling anything** and without
> tripping pnpm's `allowBuilds` build-approval prompt.
> (Once the package is on npm, `dsh plugin --profile web add dsh-boot-animation` works too.)

### Supported DSH versions

| DSH line | Status |
|---|---|
| `0.1.5-rc.x` / `0.1.7-rc.x` | ✅ supported (the desktop app's older core, and the `npm i -g @deepseek-ai/dsh` line) |
| `0.2.0-rc.x` | ✅ supported (the desktop app's newer core, and the `@next` line) |

**This plugin deliberately declares no `@deepseek-ai/dsh-*` `peerDependencies`.**
The host half uses only `ctx.webServer`; the browser half reaches `slots` /
`uiSession` through **dynamic injection**. Nothing statically depends on a host
package, and the direct benefit is that DSH's version gate **can never skip it** —
from 0.2.0 that gate drops a plugin whose `peerDependencies` do not match, and the
symptom is silence: installed, restarted, nothing happens, no error (the market's
own compatibility guard refuses it too). Other plugins need a `^0.1.5-rc.3 ||
^0.2.0-rc.1`-style list to cover both lines; this one does not, and cannot be
skipped for forgetting a line.

The price is tolerating host shape changes ourselves, which the tests guard:
`verify-blank` (13 host shapes), `verify-session-id`, `verify-client-boot`
(11 boot-safety checks). "Is this a brand new conversation", for example, moved in
0.2.0 from `blankBit` on the binding to `session.getSnapshot().blank` — both are
read, and the face is **subscribed to** rather than sampled once.

Then **restart the DSH service once** — bundle layers are assembled at boot:

```sh
# stop the running `dsh web`, then
dsh web
```

### Nothing happens after installing? Do this first

DSH serves client bundles with `cache-control: max-age=31536000, immutable`, and
the `rev` in the URL is a **per-process nonce** that does not change with content.
Your browser therefore keeps the first copy it ever fetched.

Press **Ctrl+Shift+R** (hard reload) in the app window. A plain F5 is not enough.

## Usage

### When it plays is a switch (new in 0.4.2)

The clip library (the **🎛** button at the sidebar foot) has a row that says it plainly:

```
什么时候播：  [ 🚀 每次启动 DSH 时播放一次：开 / 关（只在新建会话时播） ]
```

| Switch | Behaviour |
|---|---|
| **On** (default) | **Once per DSH launch**, in the first conversation you enter. Switching or creating conversations during that launch does not replay it; the next launch plays it again |
| **Off** | The original rule: once per **new conversation**, one record per session |

- The record lives in `sessionStorage` (`dsh-boot-animation:boot`) — tab-scoped and dropped when
  the tab closes — so with the switch on, "once" means once per application launch
- **A pinned conversation is unaffected either way**: it replays on every entry, and the switch
  cannot suppress it
- The switch itself is stored **on the host** (`playOnAppStart` in
  `$DSH_HOME/boot-animation/selection.json`), not in localStorage: localStorage is partitioned per
  origin, so a DSH port change would drop the setting
- The UI shows the value read back **from the host**; until the host answers, the client makes no
  playback decision at all

> Up to 0.4.1 the rule was hard-wired to "once per conversation", which meant the intro played
> once and then never again in that conversation — the field report was "一次性的". 0.4.2 makes it
> your choice and defaults to once-per-launch, so **the default behaviour did change**; turn the
> switch off if you want the old rule.

**Pin a conversation** to replay it on *every* open:

1. Open that conversation
2. Click the **🎞** icon at the sidebar foot (next to Settings)
3. It turns green **🎬** — pinned

Every later entry into that conversation replays the animation, including after
switching away and back, or reloading. Click again to unpin.

> If at startup your active main panel is not the conversation (e.g. some plugin's
> panel is showing), there is no current conversation yet and the pin is disabled.
> Open a conversation first.

### Pin ONE conversation to ONE clip (0.4.0)

The 🎞 pin above decides **when** the animation plays. To decide **which clip a
given conversation plays**, use **「仅本会话」** (*this conversation only*) in the picker:

1. Open that conversation
2. Click **🎛** at the sidebar foot to open the clip library
3. Click **「仅本会话」** on the row you want

That row turns blue and gains a 「本会话」 badge; the top of the panel names the clip
this conversation is fixed to and offers 「取消（回到全局）」 next to it. Only that
conversation plays it — every other conversation, and the global choice you made
elsewhere, are untouched. 「选它」 changes the **global** choice; 「仅本会话」 changes
**this one conversation**. Neither overwrites the other.

Priority: **conversation override → random → global selection → env → `intro.mp4` →
`videos/` → embedded built-ins**. A conversation pin outranks random playback —
pinning a conversation and then being handed a random clip is not what pinning
means — but an explicit `mode=random` request is never overridden.

> If the clip a conversation points at is deleted or moved, that conversation **falls
> back to the global choice** instead of going black, and records
> `conversation-override-stale`; when the file comes back the pin applies again
> (one absence never deletes it).

## Built-in clips and your own video

The plugin is a **library**, not a single slot: it lists every clip it can find,
you pick one, and the choice is remembered.

**Four clips ship with it**, embedded in the code (`lib/clips.data.js`, base64 —
there are no mp4 files on disk for them):

| Name in the picker | Size |
|---|---|
| `DeepSeek 品牌片头` (brand) | 1.2 MB |
| `DeepSeek 赛博朋克片头` (cyberpunk) | 1.8 MB |
| `DeepSeek 数字角色苏醒` (awakening) | 2.5 MB |
| `DeepSeek 启动问题` (startup) | 3.2 MB |

All four are **faststart** remuxes (`moov` before `mdat`), so they play while
still downloading; the embed script refuses any input where it is not.
`media/*.mp4` is only the input to `npm run embed-clips` and is **not published**.

**Your own files still win.** The host re-resolves on every request, so swapping a
file needs no restart:

| Order | Location |
|---|---|
| 1 | the clip picked in the 🎛 library panel (`~/.dsh/boot-animation/selection.json`) |
| 2 | the file named by `DSH_BOOT_ANIMATION` |
| 3 | `~/.dsh/boot-animation/intro.mp4` |
| 4 | the newest file in `~/.dsh/boot-animation/videos/` |
| 5 | the four embedded clips above |

```sh
mkdir -p ~/.dsh/boot-animation/videos
cp my-intro.mp4 ~/.dsh/boot-animation/videos/
```

Then open the **🎛** button at the sidebar foot (next to the 🎞 pin) to pick it.

Check what is in use:

```sh
curl http://127.0.0.1:3080/dsh-boot-animation/status.json
```

## Two browser policies you cannot avoid

Autoplay **with audio** and the **Fullscreen API** both require a user gesture.
So the animation starts **muted** inside a fixed full-frame overlay (already
visually fullscreen), and **one click** unmutes it *and* enters real fullscreen.
If even muted autoplay is refused, a "click to play" state is shown instead of a
black screen.

## What it actually covers (stated plainly)

- The overlay is `position:fixed;inset:0;z-index:2147483000`, covering the **DSH client window** —
  the whole area where you see the sidebar and the conversation
- **It cannot cover the OS screen.** The Windows taskbar, the desktop, and other applications
  stay above it. **This is not a Windows boot splash** and does not replace system startup: it is
  this application's own intro
- The overlay's rectangle equals the viewport pixel for pixel and its four corners plus centre
  hit-test inside it; `scripts/verify-letterbox.mjs` measures exactly that in a real browser
- **Another plugin with a higher z-index will cover us.** `2147483000` is our own value, not a
  global maximum, and host surfaces live in the same range. When something sits on top of the
  intro, that is two overlays disagreeing about layering; this plugin does not rewrite other
  plugins' values and does not claim to always be on top
- The library modal's veil is `2147483200`, deliberately 200 above the overlay: opening the
  library must cover the clip that is playing

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Nothing appears at all | Almost always the cache: **Ctrl+Shift+R** (a plain F5 is not enough), plus restart the DSH service after installing/upgrading |
| It played once and never again | The 0.4.1 bug: "once per conversation". 0.4.2 defaults to once per DSH launch; check the switch in the library is on |
| It never plays (suspect "the script did not take effect") | Check the browser console for `[dsh-boot-animation]`: a line saying `idle: host offers no dynamic injection and no uiSession` means the host is the problem, not the plugin. No plugin output at all means it was not loaded — hard-reload, and confirm it is installed |
| Pinned but still nothing | Check the pin is green, and that you opened the pinned conversation |
| The intro covers one panel instead of the window | Should not happen: the overlay is `position:fixed`, which only degrades if an ancestor has `transform` / `filter` / `perspective` / `contain` / `will-change`. Run `npm run verify:letterbox` to measure it |
| Something is drawn on top of the intro | Another overlay has a higher z-index (ours is `2147483000`). We do not outrank other plugins' overlays and will not raise global layering to do it |
| I want it to cover the taskbar / the whole screen | Not possible and not intended: the scope is the **DSH client window**, not the OS screen |
| Black screen | Open `/dsh-boot-animation/status.json` to see whether a source was found; check the console for a decode error |
| One conversation plays the wrong clip | That conversation may carry a 「仅本会话」 pin: open the picker and press 「取消（回到全局）」 at the top |
| A conversation's pinned clip vanished | The clip it named was moved or deleted — that conversation fell back to the global choice; `status.json` shows `conversation-override-stale` |
| Want to see the decisions | Set `DEBUG = true` at the top of `src/client/index.ts`, rebuild, watch the console |

## Implementation notes

- Seats: `shell.overlay` (frame-wide floating layer, `kind: list`, additive) and
  `sidebar.footer.action` (the pin)
- The current conversation comes from `ctx.uiSession.adapter.current`, a
  React-friendly store whose snapshot is the **resolved descriptor output**
  `{ key, hooks, keyedHooks, props }` — the id is at `props.sessionId` and the
  session snapshot at `hooks.session`
- "Brand new conversation" is `session.getSnapshot().blank` on the modern Session face, with the
  pre-0.2.0 `blankBit` on the binding still read as a fallback
- The when-to-play rule is the pure function `decidePlay` (`src/client/session.ts`), so the whole
  matrix (switch on/off, pinned, settings not yet loaded) is exercised as data by
  `verify-play-decision.mjs` rather than inferred from a rendered overlay
- "Every open" is implemented by watching **entry into** a conversation rather than remembering
  that it played, so a pinned conversation ignores both the launch record and the seen list
- The video route honours **Range** requests; browsers send them for media and
  may refuse to play when a 200 arrives where a 206 was expected

## License

BSD-3-Clause, see [LICENSE](LICENSE). The clips embedded in `lib/clips.data.js`
ship under the same terms.
