window.__ModuleLoader__.load({
	id: "dsh-boot-animation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/diagnostics.ts
		/** Bounded, so a retry loop in a render cannot fill the console. */
		const MAX_ENTRIES = 200;
		const entries = [];
		function formatArgs(args) {
			return args.map((a) => {
				if (typeof a === "object" && a !== null) try {
					return JSON.stringify(a);
				} catch {
					return String(a);
				}
				return String(a);
			}).join(" ");
		}
		function narrate(text) {
			try {
				console.log("[dsh-boot-animation] " + text);
			} catch {}
		}
		/** Record one always-on line. Never throws. */
		function notify(...args) {
			const text = formatArgs(args);
			try {
				entries.push(text);
				while (entries.length > MAX_ENTRIES) entries.shift();
			} catch {}
			narrate(text);
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* ClientStore — the client's ONE source of truth.
		*
		* The 0.2.x client kept this state in four unrelated places: a module-level
		* `activeVersion` fetched once per page, a `src` frozen with `useState` at
		* overlay mount, the library's own local list, and a `fit` value that lived only
		* in localStorage. Nothing could answer "which clip is playing right now", which
		* is why selecting B could keep playing A until a reload.
		*
		* Here every one of those is one field on one object, and the three clip
		* identities are deliberately NOT the same field:
		*
		*   settings.selectedClipId      what the user chose; changes ONLY on select()
		*   conversationClipId           the pin THIS conversation carries, if any. It
		*                                outranks the global choice on the host and is
		*                                never written into selectedClipId — the two are
		*                                different questions ("what do I usually want"
		*                                vs "what does this one conversation want").
		*   playback.clipId              what the <video> element is being pointed at
		*   playback.previewClipId       what the last preview asked for (may equal
		*                                neither of the others, and never persists)
		*
		* A mutation replaces the snapshot object, so `useSyncExternalStore` sees a new
		* reference exactly when something changed — and never otherwise.
		*
		* `playback.nonce` increments on every play request. Without it, asking to play
		* the same clip twice would be a no-op for React (same clipId, same url), and a
		* replay button that does nothing is the bug this guards against.
		*/
		/** The host's default, mirrored so the pre-payload state equals "not loaded yet". */
		const DEFAULT_PLAY_ON_APP_START = true;
		const BASE = "/dsh-boot-animation";
		const LIST_URL = `${BASE}/videos.json`;
		const SELECT_URL = `${BASE}/select`;
		const RESOLVE_URL = `${BASE}/resolve.json`;
		const EMPTY_SETTINGS = {
			selectedClipId: null,
			randomPlayback: false,
			fitMode: "cover",
			playOnAppStart: true
		};
		const IDLE_PLAYBACK = {
			clipId: null,
			previewClipId: null,
			url: null,
			phase: "idle",
			reason: "none",
			nonce: 0,
			message: ""
		};
		/**
		* The media URL for one clip.
		*
		* Addressed by ClipId, with the clip's own content identity pinned as `?v=`.
		* That is what makes "select A, then B, then C" deterministic without a reload:
		* every clip is a different resource, so nothing can be served from the previous
		* clip's cache entry, and a pinned URL is immutable because it cannot go stale.
		*/
		function mediaUrlFor(clip) {
			const path = clip.mediaUrl ?? `${BASE}/media/${encodeURIComponent(clip.id)}`;
			const version = clip.version;
			return typeof version === "string" && version !== "" ? `${path}?v=${encodeURIComponent(version)}` : path;
		}
		var ClientStore = class {
			#snapshot = {
				catalog: null,
				settings: EMPTY_SETTINGS,
				settingsLoaded: false,
				playback: IDLE_PLAYBACK,
				sessionId: null,
				conversationClipId: null,
				loading: false,
				busy: false,
				status: {
					text: "",
					kind: ""
				}
			};
			#listeners = /* @__PURE__ */ new Set();
			subscribe = (listener) => {
				this.#listeners.add(listener);
				return () => {
					this.#listeners.delete(listener);
				};
			};
			getSnapshot = () => this.#snapshot;
			#set(patch) {
				this.#snapshot = {
					...this.#snapshot,
					...patch
				};
				for (const listener of this.#listeners) try {
					listener();
				} catch {}
			}
			/**
			* Which conversation the client is in.
			*
			* Every per-conversation question is answered by the HOST; the client only
			* carries the identity. That is what keeps one implementation of the priority
			* chain, and it is why this is set once per session change rather than being
			* threaded through every call site.
			*
			* Does not fetch: the caller re-reads the catalog (which is where the pin
			* arrives from the host) when the conversation changes.
			*/
			setSession(sessionId) {
				if (this.#snapshot.sessionId === sessionId) return;
				this.#set({ sessionId });
			}
			/** `session=<id>` for a host call, or '' when no conversation is open yet. */
			#sessionParam() {
				const id = this.#snapshot.sessionId;
				return id === null || id === "" ? "" : "session=" + encodeURIComponent(id);
			}
			#listUrl() {
				const param = this.#sessionParam();
				return param === "" ? LIST_URL : LIST_URL + "?" + param;
			}
			/** Read the library and the settings from the host. Safe to call repeatedly. */
			async loadCatalog() {
				this.#set({ loading: true });
				try {
					const response = await fetch(this.#listUrl(), { cache: "no-store" });
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					const data = await response.json();
					this.#set({
						catalog: {
							clips: Array.isArray(data.videos) ? data.videos : [],
							userDir: typeof data.userDir === "string" ? data.userDir : "",
							accepts: Array.isArray(data.accepts) ? data.accepts : []
						},
						settings: {
							selectedClipId: typeof data.selectedClipId === "string" ? data.selectedClipId : null,
							randomPlayback: data.randomPlayback === true,
							fitMode: data.fitMode === "contain" ? "contain" : "cover",
							/**
							* A host that predates 0.4.2 does not send this field. Its behaviour
							* WAS "play once per new conversation", so an old host reads as `false`
							* — the older rule — rather than being handed the new one it does not
							* know about. A 0.4.2+ host always sends an explicit boolean.
							*/
							playOnAppStart: data.playOnAppStart === void 0 ? false : data.playOnAppStart === true
						},
						settingsLoaded: true,
						conversationClipId: typeof data.conversationClipId === "string" ? data.conversationClipId : null,
						loading: false,
						status: {
							text: "",
							kind: ""
						}
					});
					data.videos?.length, data.conversationClipId;
				} catch (error) {
					notify("catalog load failed", String(error));
					this.#set({
						loading: false,
						status: {
							text: "读取片库失败：" + String(error),
							kind: "dba-err"
						}
					});
				}
			}
			/** Everything that reaches the host's selection endpoint goes through here. */
			async #writeSettings(patch, okText) {
				this.#set({ busy: true });
				try {
					const data = await (await fetch(SELECT_URL, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch)
					})).json();
					if (data.ok !== true) {
						this.#set({
							busy: false,
							status: {
								text: "保存失败：" + String(data.error ?? "未知错误"),
								kind: "dba-err"
							}
						});
						return false;
					}
					const previous = this.#snapshot;
					this.#set({
						busy: false,
						/**
						* Only the fields the host actually ANSWERED with.
						*
						* A `scope=conversation` write answers with the pin and nothing else, so
						* a blanket assignment here would blank the global settings every time a
						* user pinned one conversation. The catalog reload below is what makes
						* the final state authoritative.
						*/
						settings: {
							selectedClipId: data.selectedClipId === void 0 ? previous.settings.selectedClipId : typeof data.selectedClipId === "string" ? data.selectedClipId : null,
							randomPlayback: data.randomPlayback === void 0 ? previous.settings.randomPlayback : data.randomPlayback === true,
							fitMode: data.fitMode === void 0 ? previous.settings.fitMode : data.fitMode === "contain" ? "contain" : "cover",
							playOnAppStart: data.playOnAppStart === void 0 ? previous.settings.playOnAppStart : data.playOnAppStart === true
						},
						conversationClipId: data.conversationClipId === void 0 ? previous.conversationClipId : typeof data.conversationClipId === "string" ? data.conversationClipId : null,
						status: {
							text: okText,
							kind: "dba-ok"
						}
					});
					await this.loadCatalog();
					return true;
				} catch (error) {
					this.#set({
						busy: false,
						status: {
							text: "保存失败：" + String(error),
							kind: "dba-err"
						}
					});
					return false;
				}
			}
			/**
			* Choose a clip. The ONLY method that changes `settings.selectedClipId`.
			*
			* Preview deliberately does not call this: previewing a clip you have not
			* chosen must never silently become your choice.
			*/
			async selectClip(clipId) {
				const clip = this.clip(clipId);
				return await this.#writeSettings({ selectedClipId: clipId }, `已选为片头：${clip?.name ?? clipId}`);
			}
			async setRandomPlayback(on) {
				return this.#writeSettings({ randomPlayback: on }, on ? "已开启随机播放" : "已关闭随机播放");
			}
			/**
			* Switch the auto-play rule: once per DSH launch, or once per new conversation.
			*
			* Written to the HOST (`playOnAppStart` in selection.json), not localStorage,
			* so the choice survives a port change and is the same one the decision effect
			* reads back. The host answers with the stored value, which is what the UI
			* shows — the client never keeps its own idea of this setting.
			*/
			async setPlayOnAppStart(on) {
				return this.#writeSettings({ playOnAppStart: on }, on ? "已开启：每次启动 DSH 播一次" : "已关闭：只在新建会话时播一次");
			}
			/**
			* Pin THIS conversation to a clip, or clear its pin with `null`.
			*
			* Deliberately not `selectClip`: a per-conversation pin sits ON TOP of the
			* global choice, so writing it must not overwrite that choice. That separation
			* is the entire point of the layer, and it is why the host keeps the two in
			* different fields.
			*/
			async setConversationClip(clipId) {
				const sessionId = this.#snapshot.sessionId;
				if (sessionId === null) {
					this.#set({ status: {
						text: "还没有打开的会话：先打开一个对话，才能只对它生效",
						kind: "dba-err"
					} });
					return false;
				}
				const clip = clipId === null ? null : this.clip(clipId);
				const okText = clipId === null ? "已取消本会话的固定片头" : "本会话固定播放：" + (clip?.name ?? clipId);
				return this.#writeSettings({
					scope: "conversation",
					sessionId,
					id: clipId
				}, okText);
			}
			async setFitMode(mode) {
				return this.#writeSettings({ fitMode: mode }, mode === "cover" ? "已设为「铺满屏幕」" : "已设为「完整显示」");
			}
			/** One clip from the loaded catalog. */
			clip(clipId) {
				const catalog = this.#snapshot.catalog;
				if (catalog === null) return null;
				return catalog.clips.find((item) => item.id === clipId) ?? null;
			}
			setStatus(text, kind) {
				this.#set({ status: {
					text,
					kind
				} });
			}
			/**
			* Point the player at one clip. THE playback entry point.
			*
			* `reason` is recorded so diagnostics can say why this clip is playing
			* ('preview', 'new-conversation', 'pinned', 'random', 'manual'), and every
			* caller — preview, new conversation, pinned session, random — arrives here.
			*/
			playClip(clipId, reason) {
				const clip = this.clip(clipId);
				if (clip === null) {
					notify("play requested for an unknown clip", {
						clipId,
						reason
					});
					return false;
				}
				const playback = this.#snapshot.playback;
				this.#set({ playback: {
					...playback,
					clipId,
					url: mediaUrlFor(clip),
					phase: "loading",
					reason,
					nonce: playback.nonce + 1,
					message: ""
				} });
				notify("play", {
					clipId,
					reason,
					url: mediaUrlFor(clip)
				});
				return true;
			}
			/**
			* Ask the host which clip should play in a given mode, then play it.
			*
			* The client never decides this itself: `selected`, `active` (which honours
			* random playback) and `random` are all answered by the host's ClipResolver, so
			* there is exactly one implementation of the priority chain and one of the
			* "do not repeat" rule. If the host cannot be reached, this degrades to
			* whatever the catalog already knows rather than failing the overlay.
			*/
			async playMode(mode, reason) {
				try {
					const param = this.#sessionParam();
					const response = await fetch(`${RESOLVE_URL}?mode=${mode}${param === "" ? "" : "&" + param}`, { cache: "no-store" });
					if (response.ok) {
						const data = await response.json();
						if (typeof data.clipId === "string" && data.clipId !== "") return this.playClip(data.clipId, data.how ?? reason);
					}
					notify("resolve fell back to the catalog", { mode });
				} catch (error) {
					notify("resolve failed", String(error));
				}
				const settings = this.#snapshot.settings;
				if (settings.randomPlayback) {
					const pool = this.#snapshot.catalog?.clips ?? [];
					if (pool.length > 0) return this.playClip(pool[0].id, "fallback");
					return false;
				}
				if (settings.selectedClipId !== null) return this.playClip(settings.selectedClipId, "fallback");
				return false;
			}
			/**
			* Preview one specific clip.
			*
			* Records `previewClipId` so the UI can mark what is being auditioned, and
			* plays it — without touching the selection. Previewing B while A is selected
			* must show B and leave A selected.
			*/
			preview(clipId, reason = "preview") {
				const played = this.playClip(clipId, reason);
				if (played) this.#set({ playback: {
					...this.#snapshot.playback,
					previewClipId: clipId
				} });
				return played;
			}
			/** Report the phase the <video> element reached. */
			setPhase(phase, message = "") {
				if (this.#snapshot.playback.phase === phase && this.#snapshot.playback.message === message) return;
				this.#set({ playback: {
					...this.#snapshot.playback,
					phase,
					message
				} });
			}
			/** Stop playback (overlay closed, ended, or skipped). */
			stop() {
				const playback = this.#snapshot.playback;
				if (playback.phase === "idle" && playback.clipId === null) return;
				this.#set({ playback: {
					...playback,
					phase: "idle",
					clipId: null,
					url: null,
					message: ""
				} });
			}
		};
		/** The store as React sees it, without the 1005-line component that used to own it. */
		function useClientStore(store) {
			return (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot);
		}
		//#endregion
		//#region src/client/session.ts
		/**
		* Session binding: which conversation is current, and whether it is new.
		*
		* Two pieces of hard-won knowledge live here and must not be lost:
		*
		* 1. `hooks.session` is a `SessionFace` — `ISession & ObservableSnapshot<SessionSnapshot>`
		*    (see `@deepseek-ai/dsh-api-session-controller`) — so "this conversation has
		*    no turns yet" is `getSnapshot().blank`. Before DSH 0.2.0 the flag was a
		*    `blankBit` field directly on the binding. Reading the field that is no
		*    longer there does not throw, it answers `undefined`, so the failure was
		*    silence: auto-play simply stopped happening. Both shapes are read, and the
		*    face is SUBSCRIBED to rather than sampled once, because the flag arrives on
		*    a nested snapshot that can settle after the binding changes.
		*
		* 2. The pin is per session, keyed by session id, and lives in localStorage.
		*    It is a client concern: the host never learns a session id from this
		*    plugin.
		*
		* 3. THE AUTO-PLAY RECORD IS BOOT-SCOPED, NOT SESSION-SCOPED (0.4.2). Up to
		*    0.4.1 the record was a per-session "already played" list in localStorage,
		*    so the intro ran exactly once per conversation and never again in it — the
		*    field report was "开了一次之后就再也没有见过" / "是个一次性的". A boot
		*    animation has to key off the APPLICATION LAUNCH, so the record now lives in
		*    sessionStorage (`dsh-boot-animation:boot`), which the browser scopes to one
		*    tab and drops when that tab closes. Opening DSH plays it once; the rest of
		*    that launch never replays it. The per-session list survives as the
		*    documented fallback path (`hasPlayed` / `markPlayed`), not as the rule.
		*
		* 4. Storage is never allowed to decide WHETHER the intro can play. Every read
		*    and write goes through `readStore`/`setItem`, which tolerate a Storage that
		*    is missing or throws (private mode, blocked third-party context, quota) and
		*    fall back to module-level memory flags. Without that fallback a blocked
		*    sessionStorage looks like "already played" forever, or like "not played
		*    yet" on every render — both are real risks now that the record decides
		*    playback.
		*/
		/**
		* True when the current conversation still has no turns, from whichever shape
		* the running host exposes.
		*
		* Exported so `scripts/verify-blank.mjs` can exercise THIS shipped function
		* rather than a copy of it. The bug it guards against is a silent one — a field
		* that moved answers `undefined` instead of throwing — so a test that only
		* checked "the bundle built" would not have caught it.
		*/
		function isBlankSession(session) {
			if (session === null || session === void 0) return false;
			if (typeof session.getSnapshot === "function") try {
				const snapshot = session.getSnapshot();
				if (snapshot !== null && typeof snapshot === "object" && "blank" in snapshot) return snapshot.blank === true;
			} catch {}
			return session.blankBit === true;
		}
		/**
		* Resolve the current Session identity across the host shapes this plugin supports.
		*
		* Ported from @windyduan's PR #2. Reading only `props.sessionId` does not throw on
		* a host that moved the identity — it answers `undefined`, so the per-session
		* "already played" record and the pin silently stopped matching. The modern
		* Session face carries `sessionId` in its snapshot; ui-session's current adapter
		* also publishes the same identity as `binding.key`; the old prop stays last as a
		* compatibility fallback.
		*
		* Exported so `scripts/verify-session-id.mjs` exercises THIS shipped function.
		*/
		function resolveSessionId(binding) {
			const session = binding?.hooks?.session;
			let snapshot = null;
			try {
				if (session !== void 0 && typeof session.getSnapshot === "function") snapshot = session.getSnapshot();
			} catch {}
			const candidate = (snapshot !== null && typeof snapshot === "object" && "sessionId" in snapshot ? snapshot.sessionId : void 0) ?? (typeof binding?.key === "string" ? binding.key : void 0) ?? (typeof binding?.props?.sessionId === "string" ? binding.props.sessionId : void 0);
			return typeof candidate === "string" && candidate !== "" ? candidate : null;
		}
		const noopSubscribe = () => () => {};
		/** Subscribe to the current-conversation store, tolerating its absence. */
		function useCurrentSession(store) {
			const binding = (0, react.useSyncExternalStore)(store === null ? noopSubscribe : store.subscribe, store === null ? () => null : store.getSnapshot);
			const session = binding?.hooks?.session;
			const subscribeBlank = (0, react.useCallback)((onChange) => {
				if (session === void 0 || typeof session.subscribe !== "function") return () => {};
				const stop = session.subscribe(onChange);
				return typeof stop === "function" ? stop : () => {};
			}, [session]);
			const isNewConversation = (0, react.useSyncExternalStore)(subscribeBlank, () => isBlankSession(session));
			return {
				sessionId: resolveSessionId(binding),
				isNewConversation
			};
		}
		const SEEN_KEY = "dsh-boot-animation:played";
		const PIN_KEY = "dsh-boot-animation:pinned";
		/** Boot scope: dropped by the browser when the tab (i.e. the DSH launch) closes. */
		const BOOT_KEY = "dsh-boot-animation:boot";
		const MAX_SEEN = 80;
		/**
		* A Storage that may not exist and may throw on any call.
		*
		* `window.sessionStorage` can be *missing* (a host that stubs `window`, a
		* non-browser evaluation of the bundle) and the property access itself throws in
		* some sandboxed contexts, so it is always read through this call rather than at
		* module scope.
		*/
		function readStore(kind) {
			try {
				return (kind === "local" ? window.localStorage : window.sessionStorage) ?? null;
			} catch {
				return null;
			}
		}
		function getItem(kind, key) {
			try {
				const store = readStore(kind);
				return store === null ? null : store.getItem(key);
			} catch {
				return null;
			}
		}
		/** `false` when nothing could be written — the caller then keeps its memory flag. */
		function setItem(kind, key, value) {
			try {
				const store = readStore(kind);
				if (store === null) return false;
				store.setItem(key, value);
				return true;
			} catch {
				return false;
			}
		}
		function removeItem(kind, key) {
			try {
				const store = readStore(kind);
				if (store !== null) store.removeItem(key);
			} catch {}
		}
		/**
		* Memory fallbacks, used only when the real Storage cannot answer.
		*
		* A blocked Storage must not become "never plays" (if the record read back as
		* already-played) nor "plays on every render" (if the record never stuck). One
		* boolean is enough for the boot flag: it is one-way for the life of the tab.
		*/
		let bootPlayedInMemory = false;
		let seenInMemory = [];
		function readSeen() {
			const raw = getItem("local", SEEN_KEY);
			if (raw === null) return seenInMemory.slice();
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
			} catch {
				return [];
			}
		}
		/**
		* Has this conversation already had its intro?
		*
		* Since 0.4.2 the auto-play rule is boot-scoped and no longer asks this — it is
		* kept because it is the per-session memory `markPlayed` writes, and because
		* `scripts/verify-boot-scope.mjs` exercises both as the documented fallback.
		*/
		function hasPlayed(sessionId) {
			return readSeen().includes(sessionId);
		}
		function markPlayed(sessionId) {
			const seen = readSeen();
			if (!seen.includes(sessionId)) seen.push(sessionId);
			while (seen.length > MAX_SEEN) seen.shift();
			if (!setItem("local", SEEN_KEY, JSON.stringify(seen))) seenInMemory = seen;
		}
		/** Has the intro already played in THIS launch of the DSH GUI? */
		function hasBootPlayed() {
			const raw = getItem("session", BOOT_KEY);
			if (raw === null) return bootPlayedInMemory;
			return raw !== "" && raw !== "0";
		}
		/** Record that this launch has had its intro. Called BEFORE `playMode` plays. */
		function markBootPlayed() {
			bootPlayedInMemory = true;
			setItem("session", BOOT_KEY, String(Date.now()));
		}
		/** Forget the boot record — lets a test model a fresh application launch. */
		function clearBootPlayed() {
			bootPlayedInMemory = false;
			removeItem("session", BOOT_KEY);
		}
		function readPinned() {
			const value = getItem("local", PIN_KEY);
			return value === null || value === "" ? null : value;
		}
		function writePinned(sessionId) {
			if (sessionId === null) removeItem("local", PIN_KEY);
			else setItem("local", PIN_KEY, sessionId);
		}
		/**
		* THE when-to-play rule, as one pure function.
		*
		* Three outcomes, in priority order:
		*
		*   1. PINNED     the current conversation is the pinned one and we just entered
		*                 it -> replay. Unaffected by `playOnAppStart` and by any record.
		*   2. APP-START  `playOnAppStart` is on and this launch has not played yet ->
		*                 play once, wherever we are.
		*   3. NEW CONV.  `playOnAppStart` is off -> the original rule: a conversation
		*                 with no turns yet that has not played before.
		*
		* The `settingsLoaded` gate is what keeps the client from guessing: the toggle is
		* the host's, so until the host answers, no rule is applied at all. Guessing
		* either way would play the intro against a user who turned it off.
		*
		* Pure on purpose — `scripts/verify-play-decision.mjs` drives THIS function over
		* the whole matrix instead of inferring the rule from a rendered overlay.
		*/
		function decidePlay(input) {
			if (input.sessionId === null) return {
				action: "none",
				reason: "no conversation yet"
			};
			if (input.pinned !== null && input.pinned === input.sessionId) {
				if (!input.entered) return {
					action: "none",
					reason: "already in the pinned conversation"
				};
				return {
					action: "play",
					reason: "pinned"
				};
			}
			if (!input.settingsLoaded) return {
				action: "none",
				reason: "settings not loaded yet"
			};
			if (input.settings.playOnAppStart) return input.bootPlayed ? {
				action: "none",
				reason: "this launch already played"
			} : {
				action: "play",
				reason: "app-start"
			};
			if (!input.isNewConversation) return {
				action: "none",
				reason: "not a new conversation"
			};
			if (input.sessionPlayed) return {
				action: "none",
				reason: "this conversation already played"
			};
			return {
				action: "play",
				reason: "new-conversation"
			};
		}
		/**
		* Apply a decision's bookkeeping. Called by the effect, never by `decidePlay`,
		* so the pure rule stays pure and side effects stay in one place.
		*/
		function recordDecision(decision, sessionId) {
			if (decision.action !== "play" || decision.reason === "pinned") return;
			if (decision.reason === "app-start") markBootPlayed();
			if (sessionId !== null) markPlayed(sessionId);
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* The stylesheet, injected once.
		*
		* Kept in its own module so `scripts/check-css-template.mjs` has one obvious
		* place to guard: the sheet is a template literal, and a stray backtick inside
		* it ends the literal and breaks the build in a way that leaves the previous
		* bundle in place — which once shipped silently.
		*
		* The layout note is load-bearing: the two fit modes differ ONLY by `object-fit`.
		* An earlier "improvement" that also rewrote the layout mechanics took the overlay
		* fully black in the real app, so it was reverted and is not to be retried.
		*/
		const STYLE_ID = "dsh-boot-animation-style";
		const CSS = `
.dba-root{position:fixed;inset:0;z-index:2147483000;background:#000;
  display:flex;align-items:center;justify-content:center;
  pointer-events:auto;cursor:pointer;overflow:hidden}
.dba-video{width:100%;height:100%;object-fit:contain;background:#000;display:block}
/* The ONLY difference between the fit modes is object-fit.
   Do not "harden" this with position/inset changes: the bar fix does not need
   them, and an overlay that rendered correctly under flex + percentage sizing
   went fully black in the real app the one time the layout mechanics were
   rewritten for no reason. Minimal change, or you trade a cosmetic defect for
   a functional one.
   NOTE: never put a backtick in this block — the whole sheet is a template
   literal, and one backtick ends it. scripts/check-css-template.mjs enforces it. */
.dba-video.dba-cover{object-fit:cover;object-position:center}
.dba-skip{position:absolute;top:20px;right:22px;z-index:2;
  border:1px solid rgba(255,255,255,.42);background:rgba(0,0,0,.42);
  color:#fff;border-radius:999px;padding:6px 16px;font-size:13px;line-height:1.4;
  font-family:inherit;cursor:pointer}
.dba-skip:hover{background:rgba(0,0,0,.66)}
.dba-hint{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);
  z-index:2;color:rgba(255,255,255,.82);font-size:13px;letter-spacing:.06em;
  font-family:inherit;text-shadow:0 1px 8px rgba(0,0,0,.9);
  animation:dba-breathe 2.4s ease-in-out infinite;white-space:nowrap}
@keyframes dba-breathe{0%,100%{opacity:.55}50%{opacity:1}}
.dba-status{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  z-index:2;color:rgba(255,255,255,.88);font-size:14px;letter-spacing:.04em;
  font-family:inherit;text-align:center;max-width:78vw;
  background:rgba(0,0,0,.46);border-radius:10px;padding:10px 18px;
  text-shadow:0 1px 10px rgba(0,0,0,.9)}
.dba-what{position:absolute;top:20px;left:22px;z-index:2;
  color:rgba(255,255,255,.72);font-size:12px;letter-spacing:.04em;
  font-family:inherit;text-shadow:0 1px 8px rgba(0,0,0,.9)}
.dba-pin{display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--dsw-alias-text-secondary,#888);
  font-size:14px;line-height:1;font-family:inherit}
.dba-pin:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-text-primary,#191919)}
.dba-pin.dba-pin-on{color:#07c160;background:rgba(7,193,96,.14)}
.dba-veil{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.46);
  display:flex;align-items:center;justify-content:center;padding:24px}
.dba-lib{width:min(620px,100%);max-height:min(78vh,660px);overflow:auto;
  background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-text-primary,#191919);
  border:1px solid rgba(127,127,127,.28);border-radius:14px;padding:18px 18px 14px;
  box-shadow:0 18px 60px rgba(0,0,0,.34);font-family:inherit;
  font-size:13px;line-height:1.55}
.dba-lib h3{margin:0 0 4px;font-size:15px;font-weight:600}
.dba-lib p{margin:0 0 12px;color:var(--dsw-alias-text-secondary,#777);font-size:12.5px}
.dba-item{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:9px;
  border:1px solid transparent}
.dba-item:hover{background:rgba(127,127,127,.10)}
.dba-item.dba-cur{border-color:rgba(7,193,96,.55);background:rgba(7,193,96,.10)}
/* The per-conversation pin is a DIFFERENT question from the global selection, so
   it gets a different colour rather than competing for the same green. */
.dba-item.dba-ses-cur{border-color:rgba(64,140,255,.55);background:rgba(64,140,255,.10)}
.dba-item .dba-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dba-badge{font-size:11px;padding:1px 7px;border-radius:999px;
  background:rgba(127,127,127,.18);color:var(--dsw-alias-text-secondary,#777);white-space:nowrap}
.dba-badge.dba-b-sel{background:rgba(7,193,96,.16);color:#07974b}
.dba-badge.dba-b-ses{background:rgba(64,140,255,.18);color:#2c6bd6}
.dba-badge.dba-b-prev{background:rgba(64,140,255,.18);color:#2c6bd6}
.dba-badge.dba-b-warn{background:rgba(210,120,40,.18);color:#b46214;cursor:help}
.dba-meta{font-size:11.5px;color:var(--dsw-alias-text-secondary,#999);white-space:nowrap}
.dba-mark{width:14px;text-align:center;color:#07c160;font-weight:700;font-size:12px}
.dba-row-btn{border:1px solid rgba(127,127,127,.34);background:transparent;color:inherit;
  border-radius:7px;padding:3px 10px;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap}
.dba-row-btn:hover{background:rgba(127,127,127,.14)}
.dba-row-btn.dba-go{border-color:rgba(7,193,96,.55);color:#07974b;font-weight:600}
.dba-dir{margin:12px 0 0;padding:9px 10px;border-radius:9px;background:rgba(127,127,127,.10);
  font-size:11.5px;color:var(--dsw-alias-text-secondary,#777);word-break:break-all}
.dba-dir code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;
  color:var(--dsw-alias-text-primary,#333)}
.dba-ses{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:8px 10px;
  border-radius:9px;background:rgba(64,140,255,.10);
  font-size:12px;color:var(--dsw-alias-text-secondary,#777)}
.dba-ses .dba-row-btn{margin-left:auto}
.dba-bar{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.dba-fit{display:flex;align-items:center;gap:8px;margin-top:12px;
  font-size:12px;color:var(--dsw-alias-text-secondary,#777)}
.dba-fit .dba-flex{flex:1}
.dba-fit .dba-note{font-size:11px;opacity:.8}
.dba-btn.dba-btn-on{border-color:rgba(7,193,96,.6);background:rgba(7,193,96,.12);color:#07974b}
.dba-btn{border:1px solid rgba(127,127,127,.34);background:transparent;color:inherit;
  border-radius:8px;padding:5px 14px;font-size:12.5px;font-family:inherit;cursor:pointer}
.dba-btn:hover{background:rgba(127,127,127,.14)}
.dba-btn[disabled]{opacity:.5;cursor:default}
.dba-msg{margin-top:10px;font-size:12px;min-height:16px;color:var(--dsw-alias-text-secondary,#777)}
.dba-msg.dba-err{color:#c0392b}
.dba-msg.dba-ok{color:#07974b}
`;
		/** Inject the sheet once per document. */
		function ensureStyle() {
			try {
				if (document.getElementById("dsh-boot-animation-style") !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
			} catch {}
		}
		//#endregion
		//#region src/client/ui.ts
		/** How long a play attempt may show black before the overlay gives up. */
		const STALL_TIMEOUT_MS = 25e3;
		/** How long an error stays readable before the overlay closes itself. */
		const ERROR_LINGER_MS = 8e3;
		function formatBytes(n) {
			if (!Number.isFinite(n) || n <= 0) return "0 B";
			if (n < 1024) return n + " B";
			if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
			return (n / 1024 / 1024).toFixed(2) + " MB";
		}
		/** Where a clip comes from, as one word a user can act on. */
		const SOURCE_LABEL = {
			yours: "你自己加的",
			embedded: "插件内置",
			env: "环境变量"
		};
		/** Why this clip is on screen, in words. */
		const REASON_LABEL = {
			preview: "预览",
			"new-conversation": "新对话",
			pinned: "钉住的会话",
			random: "随机播放",
			selected: "已选片头",
			active: "当前片头",
			explicit: "指定片段",
			/** The host answered with this conversation's own pin, not the global choice. */
			conversation: "本会话指定",
			fallback: "回退"
		};
		/**
		* The playback surface.
		*
		* It owns no decision: the clip id and the URL come from the store, which got
		* them from the host's resolver or from an explicit preview. Its only job is to
		* drive one <video> element and report what happened.
		*/
		/**
		* Stop a media element completely when the overlay leaves the tree.
		*
		* Ported from @windyduan's PR #2. Detaching a <video> from the DOM does not stop
		* it: HMR, disabling the plugin, or a slot remount all unmount the overlay while
		* the element keeps playing and holding a decoder. `load()` aborts the pending
		* media fetch and releases the decoder.
		*
		* Exported so `scripts/verify-teardown.mjs` exercises THIS shipped function.
		*/
		function releaseVideo(video) {
			try {
				video.pause();
				video.currentTime = 0;
				video.removeAttribute("src");
				video.load();
			} catch {}
		}
		function BootOverlay({ store }) {
			ensureStyle();
			const snapshot = useClientStore(store);
			const { url, nonce, phase, clipId, reason, previewClipId } = snapshot.playback;
			const fit = snapshot.settings.fitMode;
			const [needsTap, setNeedsTap] = (0, react.useState)(false);
			const videoRef = (0, react.useRef)(null);
			const closedRef = (0, react.useRef)(false);
			const close = (0, react.useCallback)(() => {
				closedRef.current = true;
				const video = videoRef.current;
				if (video !== null) try {
					video.pause();
				} catch {}
				if (document.fullscreenElement !== null && document.exitFullscreen !== void 0) document.exitFullscreen().catch(() => {});
				store.stop();
			}, [store]);
			(0, react.useEffect)(() => {
				if (url === null) return void 0;
				const video = videoRef.current;
				if (video === null) return void 0;
				closedRef.current = false;
				setNeedsTap(false);
				video.muted = true;
				const startedAt = performance.now();
				/** One line carrying everything a black-frame report needs. */
				const report = (label) => notify(label, {
					ms: Math.round(performance.now() - startedAt),
					clipId,
					reason,
					readyState: video.readyState,
					networkState: video.networkState,
					src: video.currentSrc || video.src
				});
				const onPlaying = () => {
					store.setPhase("playing");
					report("first frame painted");
				};
				video.addEventListener("playing", onPlaying);
				video.src = url;
				video.load();
				const attempt = video.play();
				if (attempt !== void 0 && typeof attempt.then === "function") attempt.then(() => void 0).catch((error) => {
					setNeedsTap(true);
				});
				const guard = window.setTimeout(() => {
					if (!closedRef.current) {
						store.setPhase("stalled", "视频加载超时");
						report("stalled, giving up after " + String(STALL_TIMEOUT_MS) + "ms");
						close();
					}
				}, STALL_TIMEOUT_MS);
				return () => {
					video.removeEventListener("playing", onPlaying);
					window.clearTimeout(guard);
					releaseVideo(video);
				};
			}, [
				url,
				nonce,
				clipId,
				reason,
				store,
				close
			]);
			if (url === null || phase === "idle") return null;
			const activate = () => {
				const video = videoRef.current;
				if (video === null) return;
				if (needsTap) {
					setNeedsTap(false);
					video.muted = false;
					const attempt = video.play();
					if (attempt !== void 0 && typeof attempt.catch === "function") attempt.catch(() => {});
				} else if (video.muted) video.muted = false;
				if (document.fullscreenElement === null && typeof video.requestFullscreen === "function") video.requestFullscreen().catch(() => {});
			};
			const clip = clipId === null ? null : store.clip(clipId);
			const label = REASON_LABEL[reason] ?? reason;
			return (0, react.createElement)("div", {
				className: "dba-root",
				onClick: activate
			}, (0, react.createElement)("video", {
				ref: videoRef,
				className: fit === "cover" ? "dba-video dba-cover" : "dba-video",
				muted: true,
				autoPlay: true,
				playsInline: true,
				preload: "auto",
				onEnded: close,
				onError: () => {
					const video = videoRef.current;
					notify("video element error", {
						code: video?.error?.code ?? 0,
						message: video?.error?.message ?? "",
						clipId,
						src: video?.currentSrc || url,
						readyState: video?.readyState ?? -1
					});
					store.setPhase("error", "视频加载失败 —— 控制台有 [dsh-boot-animation] 日志");
					window.setTimeout(() => {
						if (!closedRef.current) close();
					}, ERROR_LINGER_MS);
				},
				onClick: (event) => event.stopPropagation()
			}), (0, react.createElement)("div", { className: "dba-what" }, `${label} · ${clip?.name ?? clipId ?? ""}`), phase === "playing" ? null : (0, react.createElement)("div", { className: "dba-status" }, phase === "error" ? snapshot.playback.message || "视频加载失败" : phase === "stalled" ? "视频加载超时" : "正在加载视频…"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-skip",
				onClick: (event) => {
					event.stopPropagation();
					close();
				}
			}, "跳过"), (0, react.createElement)("div", { className: "dba-hint" }, needsTap ? "点击播放" : "点击开启声音 · 全屏", previewClipId !== null && previewClipId === clipId ? " · 预览中" : ""));
		}
		/**
		* The picker.
		*
		* Each row can be PREVIEWED (play it now, change nothing), SELECTED (make it the
		* clip that future overlays play everywhere) or PINNED TO THIS CONVERSATION
		* (make it the clip THIS conversation plays, leaving the global choice alone).
		* Those are three different buttons on purpose: preview and select used to be one
		* click that did the second while looking like the first, which is why "preview"
		* appeared to play the wrong video — and the conversation pin is a third
		* question again, so it gets a third button rather than overloading one.
		*/
		function VideoLibrary({ store, onClose }) {
			ensureStyle();
			const snapshot = useClientStore(store);
			const clips = snapshot.catalog?.clips ?? [];
			const selectedClipId = snapshot.settings.selectedClipId;
			const playingClipId = snapshot.playback.clipId;
			const previewClipId = snapshot.playback.previewClipId;
			const conversationClipId = snapshot.conversationClipId;
			const hasSession = snapshot.sessionId !== null;
			const nameOf = (clipId) => clips.find((item) => item.id === clipId)?.name ?? clipId;
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const busy = snapshot.busy;
			return (0, react.createElement)("div", {
				className: "dba-veil",
				onClick: (event) => {
					if (event.target === event.currentTarget) onClose();
				}
			}, (0, react.createElement)(
				"div",
				{
					className: "dba-lib",
					onClick: (event) => event.stopPropagation()
				},
				(0, react.createElement)("h3", null, "片头片库"),
				(0, react.createElement)("p", null, "「▶ 预览」立刻播这一段（不改你的选择）；「选它」设为全局片头；「仅本会话」只让当前这个会话播它。"),
				(0, react.createElement)("div", { className: "dba-ses" }, hasSession ? conversationClipId === null ? "本会话跟随全局片头。想只给这个会话换一段，点那一行的「仅本会话」。" : "本会话固定播放：" + nameOf(conversationClipId) : "还没有打开的会话：先打开一个对话，才能只对它生效。", conversationClipId === null ? null : (0, react.createElement)("button", {
					type: "button",
					className: "dba-row-btn",
					disabled: busy,
					title: "取消这个会话的固定片头，回到全局选择",
					onClick: () => {
						if (!busy) store.setConversationClip(null);
					}
				}, "取消（回到全局）")),
				...clips.length === 0 ? [(0, react.createElement)("div", { className: "dba-item" }, (0, react.createElement)("span", { className: "dba-nm" }, snapshot.loading ? "（正在读取…）" : "（还没找到任何视频）"))] : clips.map((clip) => (0, react.createElement)("div", {
					key: clip.id,
					className: "dba-item" + (clip.id === selectedClipId ? " dba-cur" : "") + (clip.id === conversationClipId ? " dba-ses-cur" : ""),
					title: clip.file ?? clip.id
				}, (0, react.createElement)("span", { className: "dba-mark" }, clip.id === selectedClipId ? "✓" : ""), (0, react.createElement)("span", { className: "dba-nm" }, clip.name), clip.id === conversationClipId ? (0, react.createElement)("span", { className: "dba-badge dba-b-ses" }, "本会话") : null, clip.id === playingClipId ? (0, react.createElement)("span", { className: "dba-badge dba-b-sel" }, previewClipId === clip.id ? "预览中" : "播放中") : null, clip.legacy ? (0, react.createElement)("span", { className: "dba-badge" }, "原片源") : null, (clip.copies ?? 1) > 1 ? (0, react.createElement)("span", {
					className: "dba-badge",
					title: "这一段在磁盘上有 " + String(clip.copies) + " 份相同的副本，已合并成一条。你的文件没有被删，只是不重复列出。"
				}, "合并 " + String(clip.copies) + " 份重复") : null, (clip.ext === ".mp4" || clip.ext === ".m4v") && clip.faststart === false ? (0, react.createElement)("span", {
					className: "dba-badge dba-b-warn",
					title: "这个文件的索引表(moov)在末尾：浏览器要整段下载完才出画面，容易黑屏。用 ffmpeg -c copy -movflags +faststart 重排一次即可。"
				}, "⚠ 未优化") : null, (0, react.createElement)("span", { className: "dba-badge" }, SOURCE_LABEL[clip.source] ?? clip.source), (0, react.createElement)("span", { className: "dba-meta" }, formatBytes(clip.bytes)), (0, react.createElement)("button", {
					type: "button",
					className: "dba-row-btn",
					title: "立刻播放这一段，不改变你的选择",
					onClick: () => {
						store.preview(clip.id);
					}
				}, "▶ 预览"), (0, react.createElement)("button", {
					type: "button",
					className: "dba-row-btn" + (clip.id === selectedClipId ? "" : " dba-go"),
					disabled: busy || clip.id === selectedClipId,
					title: "设为以后开片头时播放的片段",
					onClick: () => {
						if (!busy) store.selectClip(clip.id);
					}
				}, clip.id === selectedClipId ? "已选" : "选它"), (0, react.createElement)("button", {
					type: "button",
					className: "dba-row-btn" + (clip.id === conversationClipId ? " dba-go" : ""),
					disabled: busy || !hasSession,
					title: hasSession ? "只让当前这个会话播这一段 —— 不改你给其它会话和全局选的那一段" : "先打开一个对话，才能只对它生效",
					onClick: () => {
						if (!busy && hasSession) store.setConversationClip(clip.id);
					}
				}, clip.id === conversationClipId ? "本会话 ✓" : "仅本会话"))),
				(0, react.createElement)("div", { className: "dba-dir" }, "想加自己的片子：把 mp4 放进这个文件夹，再点「刷新」", (0, react.createElement)("br", null), (0, react.createElement)("code", null, snapshot.catalog?.userDir ?? "…")),
				(0, react.createElement)("div", { className: "dba-fit" }, (0, react.createElement)("span", null, "播放方式："), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn" + (snapshot.settings.fitMode === "cover" ? " dba-btn-on" : ""),
					title: "铺满整个窗口，超出部分裁掉 —— 不留黑边",
					onClick: () => void store.setFitMode("cover")
				}, "铺满屏幕"), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn" + (snapshot.settings.fitMode === "contain" ? " dba-btn-on" : ""),
					title: "完整显示整帧，长宽比不匹配时留黑边",
					onClick: () => void store.setFitMode("contain")
				}, "完整显示"), (0, react.createElement)("span", { className: "dba-flex" }), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn" + (snapshot.settings.randomPlayback ? " dba-btn-on" : ""),
					title: "每次开片头时，从所有可播放的片段里随机挑一段（连续两次不会挑到同一段）",
					onClick: () => void store.setRandomPlayback(!snapshot.settings.randomPlayback)
				}, snapshot.settings.randomPlayback ? "🎲 随机播放：开" : "🎲 随机播放：关")),
				/**
				* The when-to-play switch (0.4.2). Its state is the HOST's
				* `playOnAppStart`, read back from `/videos.json` — never a client-side
				* guess — and the label spells out both rules so it cannot mislead.
				*/
				(0, react.createElement)("div", { className: "dba-fit" }, (0, react.createElement)("span", null, "什么时候播："), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn" + (snapshot.settings.playOnAppStart ? " dba-btn-on" : ""),
					title: "每次启动 DSH 应用时播放一次片头；同一轮使用中不重复，下次打开 DSH 再播一次。关掉后只在你新建会话时播一次。被钉住的会话不受这个开关影响，仍然每次进入都重播。",
					onClick: () => void store.setPlayOnAppStart(!snapshot.settings.playOnAppStart)
				}, snapshot.settings.playOnAppStart ? "🚀 每次启动 DSH 时播放一次：开" : "🚀 每次启动 DSH 时播放一次：关（只在新建会话时播）"), (0, react.createElement)("span", { className: "dba-note" }, snapshot.settings.playOnAppStart ? "同一轮使用中不重复；下次打开 DSH 再播" : "只在新建会话时播一次")),
				(0, react.createElement)("div", { className: "dba-bar" }, (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn",
					title: "立刻按当前设置播一次（随机开启时就是从全部片段里随机挑一段）",
					onClick: () => void store.playMode(snapshot.settings.randomPlayback ? "random" : "selected", "active")
				}, "▶ 播一次"), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn",
					onClick: () => void store.loadCatalog()
				}, "刷新"), (0, react.createElement)("button", {
					type: "button",
					className: "dba-btn",
					onClick: onClose
				}, "关闭")),
				(0, react.createElement)("div", { className: "dba-msg " + snapshot.status.kind }, snapshot.status.text)
			));
		}
		/** The pin toggle that lives beside Settings at the sidebar foot. */
		function PinAction({ store, sessionStore, onOpen }) {
			ensureStyle();
			const { sessionId } = useCurrentSession(sessionStore);
			const [pinned, setPinned] = (0, react.useState)(() => readPinned());
			const isPinned = sessionId !== null && pinned === sessionId;
			const toggle = () => {
				const next = isPinned ? null : sessionId;
				writePinned(next);
				setPinned(next);
				if (next !== null) store.setStatus("已把这个会话设为片头会话", "dba-ok");
			};
			const title = isPinned ? "这个会话已设为片头会话：每次打开都会播放片头动画（点击取消）" : "把这个会话设为片头会话：以后每次打开它都会播放片头动画";
			return (0, react.createElement)("span", {
				className: "dba-pin-wrap",
				style: {
					display: "inline-flex",
					alignItems: "center"
				}
			}, (0, react.createElement)("button", {
				type: "button",
				className: isPinned ? "dba-pin dba-pin-on" : "dba-pin",
				title,
				"aria-label": title,
				disabled: sessionId === null,
				onClick: toggle
			}, isPinned ? "🎬" : "🎞"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-pin dba-lib-open",
				title: "片头片库：查看、预览、切换或添加片头视频",
				"aria-label": "打开片头片库",
				onClick: onOpen
			}, "🎛"));
		}
		/**
		* The overlay's host component: the only place the "when to play" rules live.
		*
		* Two rules, and the user picks which one by toggling `playOnAppStart` in the
		* library panel (the value lives on the HOST, in selection.json):
		*
		*   on  (default)  play once per DSH launch, in whatever conversation the app
		*                  opens first — the "boot animation" reading, and the fix for
		*                  the field report 「一次性的」
		*   off            the original rule: once per new conversation, per session
		*
		* A pinned conversation replays on every entry under BOTH rules, and neither
		* rule nor the toggle touches it. The decision itself is `decidePlay` in
		* session.ts — pure, so it can be tested exhaustively; this component only
		* gathers its inputs and calls `playMode`, so there is still exactly one
		* playback path for a pin, a random setting and an auto-play alike.
		*/
		function AppRoot({ store, sessionStore }) {
			const snapshot = useClientStore(store);
			const { sessionId, isNewConversation } = useCurrentSession(sessionStore);
			const [libraryOpen, setLibraryOpen] = (0, react.useState)(false);
			const lastSessionRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				store.setSession(sessionId);
			}, [sessionId, store]);
			(0, react.useEffect)(() => {
				store.loadCatalog();
			}, [store, sessionId]);
			(0, react.useEffect)(() => {
				const handler = () => setLibraryOpen(true);
				libraryOpeners.add(handler);
				return () => {
					libraryOpeners.delete(handler);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (sessionId === null) return;
				const entered = lastSessionRef.current !== sessionId;
				lastSessionRef.current = sessionId;
				const decision = decidePlay({
					sessionId,
					entered,
					settingsLoaded: snapshot.settingsLoaded,
					settings: snapshot.settings,
					pinned: readPinned(),
					isNewConversation,
					bootPlayed: hasBootPlayed(),
					sessionPlayed: hasPlayed(sessionId)
				});
				if (decision.action !== "play") return;
				recordDecision(decision, sessionId);
				decision.reason;
				store.playMode("active", decision.reason);
			}, [
				sessionId,
				isNewConversation,
				snapshot.settingsLoaded,
				snapshot.settings,
				store
			]);
			return (0, react.createElement)(react.Fragment, null, (0, react.createElement)(BootOverlay, { store }), libraryOpen ? (0, react.createElement)(VideoLibrary, {
				store,
				onClose: () => setLibraryOpen(false)
			}) : null);
		}
		/** Openers registered by mounted AppRoots. */
		const libraryOpeners = /* @__PURE__ */ new Set();
		/** Ask whichever AppRoot is mounted to show the picker. */
		function openLibrary() {
			for (const open of libraryOpeners) try {
				open();
			} catch {}
		}
		//#endregion
		//#region src/client/index.ts
		/** The ui-session store, when the host provides one that behaves. */
		function storeOf(ready) {
			const candidate = ready.uiSession?.adapter?.current;
			return candidate !== void 0 && typeof candidate.getSnapshot === "function" && typeof candidate.subscribe === "function" ? candidate : null;
		}
		function apply(ctx) {
			const wire = (ready) => {
				const sessionStore = storeOf(ready);
				const store = new ClientStore();
				ready.uiSession;
				const register = () => {
					ready.slots.inject("shell.overlay", () => ready.slots.register({
						name: "shell.overlay",
						id: "dsh-boot-animation",
						order: 900
					}, () => (0, react.createElement)(AppRoot, {
						store,
						sessionStore
					})));
					ready.slots.inject("sidebar.footer.action", () => ready.slots.register({
						name: "sidebar.footer.action",
						id: "dsh-boot-animation-pin",
						order: 40,
						label: () => "片头动画"
					}, () => (0, react.createElement)(PinAction, {
						store,
						sessionStore,
						onOpen: () => openLibrary()
					})));
				};
				if (typeof ready.effect === "function") ready.effect(register, "dsh-boot-animation: mounts");
				else register();
			};
			if (typeof ctx.inject === "function") {
				ctx.inject(["slots", "uiSession"], wire);
				return;
			}
			if (ctx.slots !== void 0 && ctx.uiSession !== void 0) wire(ctx);
			else notify("idle: host offers no dynamic injection and no uiSession");
		}
		//#endregion
		exports.ClientStore = ClientStore;
		exports.DEFAULT_PLAY_ON_APP_START = DEFAULT_PLAY_ON_APP_START;
		exports.apply = apply;
		exports.clearBootPlayed = clearBootPlayed;
		exports.decidePlay = decidePlay;
		exports.hasBootPlayed = hasBootPlayed;
		exports.hasPlayed = hasPlayed;
		exports.isBlankSession = isBlankSession;
		exports.markBootPlayed = markBootPlayed;
		exports.markPlayed = markPlayed;
		exports.mediaUrlFor = mediaUrlFor;
		exports.readPinned = readPinned;
		exports.recordDecision = recordDecision;
		exports.releaseVideo = releaseVideo;
		exports.resolveSessionId = resolveSessionId;
		exports.writePinned = writePinned;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map