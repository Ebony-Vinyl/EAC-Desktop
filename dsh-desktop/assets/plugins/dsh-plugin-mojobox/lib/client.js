window.__ModuleLoader__.load({id:'dsh-plugin-mojobox',factory:function(require){const exports={};
const { createElement: h, useEffect, useState, useRef, useMemo } = require("react");
const actionLabels = { install: "\u65B0\u589E", reuse: "\u590D\u7528", update: "\u53EF\u66F4\u65B0", "keep-newer": "\u4FDD\u7559\u9AD8\u7248\u672C", unsupported: "\u65E0\u6CD5\u6267\u884C", remove: "\u53EF\u5378\u8F7D", keep: "\u4FDD\u7559" };
const resultLabels = { running: "\u6267\u884C\u4E2D", pending: "\u7B49\u5F85", installed: "\u5DF2\u5B89\u88C5", reused: "\u5DF2\u590D\u7528", skipped: "\u5DF2\u8DF3\u8FC7", "dependency-skipped": "\u4F9D\u8D56\u672A\u6EE1\u8DB3", failed: "\u5931\u8D25", unconfirmed: "\u5F85\u6838\u5BF9", removed: "\u5DF2\u5378\u8F7D", retained: "\u5DF2\u4FDD\u7559" };
const taskLabels = { running: "\u6B63\u5728\u5B89\u88C5", complete: "\u5B89\u88C5\u5B8C\u6210", partial: "\u90E8\u5206\u5B8C\u6210", failed: "\u5B89\u88C5\u672A\u5B8C\u6210", interrupted: "\u5B89\u88C5\u4E2D\u65AD" };
const styles = `
.mojobox {
  --mb-text: var(--dsw-alias-label-primary, light-dark(#24262a,#e8e8eb));
  --mb-secondary: var(--dsw-alias-label-secondary, light-dark(#62656d,#a9abb3));
  --mb-border: var(--dsw-alias-settings-card-stroke, light-dark(#dedfe3,#3b3c42));
  --mb-surface: var(--dsw-alias-settings-card-fill, light-dark(#fff,#232428));
  --mb-subtle: var(--dsw-alias-bg-layer-2, light-dark(#f3f4f6,#2e3035));
  --mb-accent: var(--dsw-alias-state-business-primary, light-dark(#245ec4,#94b9ff));
  --mb-danger: var(--dsw-alias-state-error-primary, light-dark(#ac302d,#f29c95));
  --mb-success: var(--dsw-alias-state-success-primary, light-dark(#237a48,#63c68c));
  container-type: inline-size; box-sizing: border-box; width: 100%; max-width: 960px;
  padding: 16px; color: var(--mb-text); line-height: 1.5; font-size: 13px; overflow-wrap: anywhere;
}
.mojobox * { box-sizing: border-box; }
.mojobox :is(input,button,a,summary) { max-width: 100%; }
.mojobox :is(h2,h3,h4) { font-weight: 500; }
.mojobox button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 32px; padding: 4px 12px; border: 1px solid var(--mb-border); border-radius: 8px; background: transparent; color: inherit; line-height: 1.5; }
.mojobox button:hover:not(:disabled) { background: var(--mb-subtle); }
.mojobox :is(button,summary,input,a):focus-visible { outline: 2px solid var(--mb-accent); outline-offset: 3px; }
.mojobox button:disabled { opacity: .5; cursor: default; }
.mojobox summary { cursor: pointer; }
.mojobox .mojobox-header { display: flex; align-items: center; gap: 12px; }
.mojobox .mojobox-heading { flex: 1; min-width: 0; }
.mojobox .mojobox-heading h2 { margin: 0; font-size: 20px; line-height: 1.4; }
.mojobox .mojobox-meta { color: var(--mb-secondary); font-size: 12px; margin: 4px 0 0; }
.mojobox .mojobox-nav { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 4px; margin: 16px 0; padding-bottom: 8px; border-bottom: 1px solid var(--mb-border); }
.mojobox .mojobox-nav button { min-width: 0; min-height: 32px; padding: 4px 8px; border: none; white-space: nowrap; }
.mojobox .mojobox-nav button[aria-pressed="true"] { background: var(--mb-subtle); color: var(--mb-text); box-shadow: inset 0 -2px var(--mb-accent); }
.mojobox .mojobox-feedback { padding: 8px 12px; margin: 12px 0; border: 1px solid var(--mb-border); border-radius: 8px; background: var(--mb-surface); overflow-wrap: anywhere; }
.mojobox [role="alert"] { color: var(--mb-danger); }
.mojobox .mojobox-search { width: 100%; min-width: 0; min-height: 32px; padding: 6px 12px; border: 1px solid var(--mb-border); border-radius: 8px; font: inherit; color: inherit; background: var(--mb-surface); }
.mojobox .mojobox-component-list { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,208px),1fr)); align-items: stretch; gap: 8px; margin-top: 12px; }
.mojobox .mojobox-component { display: flex; flex-direction: column; gap: 8px; padding: 12px; min-width: 0; border: 1px solid var(--mb-border); border-radius: 12px; background: var(--mb-surface); overflow-wrap: anywhere; }
.mojobox .mojobox-component h4 { margin: 0; font-size: 13px; line-height: 1.5; }
.mojobox .mojobox-component-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 4px; }
.mojobox .mojobox-component-actions button:not([role="switch"]) { margin-left: auto; min-height: 28px; padding: 4px; border-color: transparent; font-size: 12px; }
.mojobox .mojobox-description { font-size: 12px; color: var(--mb-secondary); margin: 0; }
.mojobox .mojobox-description summary { list-style: none; }
.mojobox .mojobox-description summary::-webkit-details-marker { display: none; }
.mojobox .mojobox-description-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.mojobox .mojobox-description[open] .mojobox-description-text { display: block; }
.mojobox .mojobox-description-more { display: inline-block; margin-top: 4px; font-size: 12px; }
.mojobox .mojobox-description .mojobox-collapse, .mojobox .mojobox-description[open] .mojobox-expand { display: none; }
.mojobox .mojobox-description[open] .mojobox-collapse { display: inline; }
.mojobox .mojobox-description summary:hover { color: var(--mb-text); }
.mojobox .mojobox-state { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--mb-secondary); }
.mojobox .mojobox-state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.mojobox .mojobox-state[data-tone="active"] { color: var(--mb-success); }
.mojobox .mojobox-state[data-tone="error"] { color: var(--mb-danger); }
.mojobox .mojobox-switch { position: relative; flex: none; width: 36px; min-height: 20px; height: 20px; padding: 0; border: 1px solid var(--mb-border); border-radius: 12px; background: var(--mb-subtle); cursor: pointer; transition: background-color .15s ease; }
.mojobox .mojobox-switch[aria-checked="true"] { background: var(--mb-success); border-color: var(--mb-success); }
.mojobox .mojobox-switch:hover:not(:disabled) { background: var(--mb-secondary); }
.mojobox .mojobox-switch[aria-checked="true"]:hover:not(:disabled) { background: var(--mb-success); filter: brightness(.92); }
.mojobox .mojobox-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0003; transition: transform .15s ease; }
.mojobox .mojobox-switch[aria-checked="true"] .mojobox-switch-knob { transform: translateX(16px); }
.mojobox .mojobox-danger { color: var(--mb-danger); }
.mojobox .mojobox-confirm { padding: 8px; border: 1px solid var(--mb-danger); border-radius: 4px; }
.mojobox .mojobox-confirm p { margin: 8px 0; font-size: 12px; }
.mojobox .mojobox-protected { margin-top: 16px; color: var(--mb-secondary); }
.mojobox .mojobox-protected > summary { font-size: 13px; }
.mojobox .mojobox-pack-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,208px),1fr)); gap: 8px; margin-top: 12px; }
.mojobox .mojobox-pack { flex-direction: column; align-items: stretch; justify-content: flex-start; text-align: left; min-width: 0; padding: 12px; border: 1px solid var(--mb-border); border-radius: 12px; font: inherit; color: inherit; background: var(--mb-surface); cursor: pointer; overflow-wrap: anywhere; }
.mojobox .mojobox-pack-title { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; font-weight: 500; }
.mojobox .mojobox-pack-title > :first-child { min-width: 0; }
.mojobox .mojobox-pack-title .mojobox-meta { flex: 0 1 auto; min-width: 0; max-width: 40%; margin: 0; text-align: right; font-weight: 400; font-variant-numeric: tabular-nums; }
.mojobox .mojobox-pack p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 0; font-size: 12px; color: var(--mb-secondary); }
.mojobox .mojobox-pack > .mojobox-meta { margin-top: auto; }
.mojobox .mojobox-empty { padding: 24px 16px; text-align: center; color: var(--mb-secondary); }
.mojobox .mojobox-toolbar { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
.mojobox .mojobox-toolbar h3 { margin: 0; font-size: 14px; }
.mojobox .mojobox-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.mojobox .mojobox-update-count { width: 6px; height: 6px; flex: none; background: var(--mb-accent); border-radius: 50%; }
.mojobox .mojobox-update { margin-top: 12px; padding: 8px 12px; border: 1px solid var(--mb-border); border-left: 2px solid var(--mb-accent); border-radius: 8px; background: var(--mb-subtle); }
.mojobox .mojobox-update p { margin: 0 0 8px; }
.mojobox .mojobox-dropzone { padding: 24px 16px; border: 1px dashed var(--mb-border); border-radius: 12px; background: var(--mb-surface); text-align: center; }
.mojobox .mojobox-dropzone p { margin: 0 0 12px; }
.mojobox .mojobox-dropzone input { position: absolute; width: 1px; height: 1px; padding: 0; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
.mojobox .mojobox-home-link { margin: 12px 0 0; text-align: center; }
.mojobox .mojobox-home-link a { color: var(--mb-accent); text-underline-offset: 3px; }
.mojobox .mojobox-source { font-size: 12px; color: var(--mb-secondary); }
.mojobox .mojobox-source p { margin: 4px 0 0; }
@media (prefers-reduced-motion: reduce) { .mojobox .mojobox-switch, .mojobox .mojobox-switch-knob { transition: none; } }
`;
const refreshIcon = () => h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 6M4 12l3 6a7 7 0 0 0 11-1" }));
function apply(ctx) {
  let state = { snapshot: null, plan: null, selected: [], working: false, pending: "", componentPending: "", operationRecord: "", retrying: false, submittedTaskId: "", savingLog: false, savedLogPath: "", catalogWorking: false, refreshing: false, notice: "", error: "", connectionError: "", view: "import" };
  let disposed = false;
  const lifetime = new AbortController();
  const listeners = /* @__PURE__ */ new Set();
  const publish = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const api = async (action, init) => {
    const timeout = AbortSignal.timeout(action === "status" ? 15e3 : 12e4);
    try {
      const response = await fetch(`api/mojobox/${action}`, { ...init, signal: AbortSignal.any([lifetime.signal, timeout]) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      return value;
    } catch (error) {
      if (timeout.aborted) throw new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5\u5E76\u6838\u5BF9\u5F53\u524D\u4EFB\u52A1\u72B6\u6001");
      throw error;
    }
  };
  let snapshotKey = "";
  let refreshing;
  const refresh = () => {
    return refreshing ??= (async () => {
      try {
        const snapshot = await api("status");
        const key = JSON.stringify(snapshot);
        if (key !== snapshotKey) {
          snapshotKey = key;
          publish({ snapshot, connectionError: "", ...snapshot.records.some((task) => task.id === state.submittedTaskId) ? { submittedTaskId: "" } : {} });
        } else if (state.connectionError) publish({ connectionError: "" });
      } catch (error) {
        if (!disposed && state.connectionError !== String(error)) publish({ connectionError: String(error) });
      }
    })().finally(() => {
      refreshing = void 0;
    });
  };
  const refreshManually = async () => {
    if (state.refreshing) return;
    publish({ refreshing: true, notice: "" });
    try {
      await refresh();
      if (!state.connectionError) publish({ notice: "\u72B6\u6001\u5DF2\u5237\u65B0" });
    } finally {
      publish({ refreshing: false });
    }
  };
  const refreshCatalog = async () => {
    if (state.catalogWorking) return;
    publish({ catalogWorking: true, notice: "", error: "" });
    try {
      const catalog = await api("catalog-refresh", { method: "POST" });
      if (catalog.error || catalog.stale) throw new Error(catalog.error ?? "\u76EE\u5F55\u672A\u6838\u9A8C");
    } catch (error) {
      publish({ error: `\u76EE\u5F55\u68C0\u67E5\u5931\u8D25\uFF1A${String(error)}` });
    } finally {
      await refresh();
      publish({ catalogWorking: false });
    }
  };
  const previewRemote = async (id, version) => {
    if (state.working || state.snapshot?.busy) return;
    publish({ working: true, pending: "\u6B63\u5728\u4E0B\u8F7D\u6574\u5408\u5305\u5E76\u6838\u5BF9\u7EC4\u4EF6\u2026", error: "", notice: "", plan: null });
    try {
      const plan = await api("catalog-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, version }) });
      publish({ plan, selected: plan.selected, view: "import" });
    } catch (error) {
      publish({ error: `\u8FDC\u7AEF\u5305\u9884\u89C8\u5931\u8D25\uFF1A${String(error)}` });
    } finally {
      await refresh();
      publish({ working: false, pending: "" });
    }
  };
  const importFile = async (file) => {
    if (!file || state.working || state.snapshot?.busy) return;
    publish({ working: true, pending: "\u6B63\u5728\u8BFB\u53D6\u6574\u5408\u5305\u5E76\u6838\u5BF9\u7EC4\u4EF6\u2026", plan: null, error: "", notice: "" });
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("\u6574\u5408\u5305\u8D85\u8FC7 2 MiB \u9650\u5236");
      const plan = await api("preview", { method: "POST", body: file });
      publish({ plan, selected: plan.selected, view: "import" });
    } catch (error) {
      publish({ error: `\u65E0\u6CD5\u5BFC\u5165\uFF1A${String(error)}` });
    } finally {
      await refresh();
      publish({ working: false, pending: "" });
    }
  };
  const replan = async (recordId, failedOnly) => {
    if (state.working || state.snapshot?.busy) return;
    publish({ working: true, operationRecord: recordId, retrying: failedOnly, pending: failedOnly ? "\u6B63\u5728\u6838\u5BF9\u5931\u8D25\u9879\uFF0C\u51C6\u5907\u91CD\u8BD5\u2026" : "\u6B63\u5728\u68C0\u67E5\u6574\u5408\u5305\u66F4\u65B0\u2026", error: "", notice: "", plan: null });
    try {
      let newer;
      if (!failedOnly) {
        const catalog = await api("catalog-refresh", { method: "POST" });
        if (catalog.error || catalog.stale) throw new Error(catalog.error ?? "\u76EE\u5F55\u5C1A\u672A\u6838\u9A8C");
        const record = state.snapshot?.records.find((task) => task.id === recordId);
        newer = catalog.entries.find((entry) => entry.id === record?.pack.manifest.id && entry.newer);
      }
      const plan = newer ? await api("catalog-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: newer.id, version: newer.version }) }) : await api("replan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId, failedOnly }) });
      publish({ plan, selected: plan.selected, view: "import", notice: failedOnly ? "\u5931\u8D25\u9879\u5DF2\u6838\u5BF9\uFF0C\u8BF7\u786E\u8BA4\u540E\u91CD\u8BD5" : newer ? `\u53D1\u73B0\u65B0\u7248 ${newer.version}\uFF0C\u8BF7\u786E\u8BA4\u66F4\u65B0\u9879` : "\u672A\u53D1\u73B0\u65B0\u7248\u6574\u5408\u5305\uFF0C\u5DF2\u91CD\u65B0\u6838\u5BF9\u5F53\u524D\u76EE\u6807" });
    } catch (error) {
      publish({ error: `${failedOnly ? "\u51C6\u5907\u91CD\u8BD5\u5931\u8D25" : "\u6838\u5BF9\u66F4\u65B0\u5931\u8D25"}\uFF1A${String(error)}` });
    } finally {
      await refresh();
      publish({ working: false, pending: "", operationRecord: "" });
    }
  };
  const controlComponent = async (component, action) => {
    if (state.working || state.snapshot?.busy || state.submittedTaskId) return;
    publish({ working: true, componentPending: component.name, pending: `\u6B63\u5728${action === "delete" ? "\u5220\u9664" : action === "enable" ? "\u542F\u7528" : "\u6682\u505C"} ${component.name}\u2026`, error: "", notice: "", plan: null });
    try {
      const operation = await api("component", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: component.name, action, expected: component.stamp }) });
      publish(operation.status === "complete" ? { notice: `${component.name}\uFF1A${operation.message}` } : { error: `${component.name}\uFF1A${operation.message}` });
    } catch (error) {
      publish({ error: `\u7EC4\u4EF6\u64CD\u4F5C\u672A\u786E\u8BA4\uFF1A${String(error)}\u3002\u8BF7\u5237\u65B0\u6838\u5BF9\u5F53\u524D\u72B6\u6001\uFF0C\u4E0D\u8981\u91CD\u590D\u63D0\u4EA4\u3002` });
    } finally {
      if (refreshing) await refreshing;
      await refresh();
      publish({ working: false, pending: "", componentPending: "" });
    }
  };
  const start = async () => {
    if (!state.plan || state.working || state.snapshot?.busy) return;
    const removing = state.plan.operation === "remove";
    publish({ working: true, pending: removing ? "\u6B63\u5728\u63D0\u4EA4\u79FB\u9664\u4EFB\u52A1\u2026" : "\u6B63\u5728\u63D0\u4EA4\u5B89\u88C5\u4EFB\u52A1\u2026", error: "", notice: "" });
    try {
      const result = await api("start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: state.plan.id, selected: state.selected }) });
      publish({ plan: null, view: "installed", notice: "", submittedTaskId: result.taskId });
      await refresh();
    } catch (error) {
      publish({ plan: null, view: "installed", error: `${removing ? "\u79FB\u9664" : "\u5B89\u88C5"}\u63D0\u4EA4\u672A\u5B8C\u6210\u786E\u8BA4\uFF1A${String(error)}\u3002\u8BF7\u6838\u5BF9\u4EFB\u52A1\u8BB0\u5F55\uFF1B\u9700\u8981\u91CD\u8BD5\u65F6\u91CD\u65B0\u9884\u89C8\uFF0C\u907F\u514D\u91CD\u590D\u63D0\u4EA4\u3002` });
      await refresh();
    } finally {
      publish({ working: false, pending: "" });
    }
  };
  ctx.effect(() => {
    let polling = false;
    let lastPoll = 0;
    const timer = setInterval(() => {
      if (!listeners.size || polling || document.visibilityState === "hidden" || Date.now() - lastPoll < (state.snapshot?.busy || state.working ? 1500 : 1e4)) return;
      lastPoll = Date.now();
      polling = true;
      void refresh().finally(() => {
        polling = false;
      });
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
      lifetime.abort();
      listeners.clear();
    };
  });
  function Section() {
    const [view, setView] = useState(state);
    const [detailId, setDetailId] = useState("");
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [expandedTasks, setExpandedTasks] = useState([]);
    const [componentQuery, setComponentQuery] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const deleteTitle = useRef(null);
    const deleteTrigger = useRef(null);
    const fileInput = useRef(null);
    useEffect(() => {
      if (deleteConfirm) {
        deleteTitle.current?.scrollIntoView({ block: "nearest" });
        deleteTitle.current?.focus();
      }
    }, [deleteConfirm]);
    const planTitle = useRef(null);
    const statusPanel = useRef(null);
    const detailTitle = useRef(null);
    const packGrid = useRef(null);
    const lastOpened = useRef("");
    useEffect(() => {
      if (detailId) detailTitle.current?.focus();
      else if (lastOpened.current) Array.from(packGrid.current?.querySelectorAll("button") ?? []).find((button2) => button2.dataset.packId === lastOpened.current)?.focus();
    }, [detailId]);
    useEffect(() => {
      const target = view.view === "import" && view.plan ? planTitle.current : view.view === "installed" ? statusPanel.current : null;
      if (view.view === "import") target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    }, [view.plan?.id, view.view]);
    useEffect(() => {
      const listener = () => setView(state);
      listeners.add(listener);
      setView(state);
      void refresh();
      void refreshCatalog();
      return () => listeners.delete(listener);
    }, []);
    const busy = view.working || view.snapshot?.busy || !!view.submittedTaskId;
    const card = { border: "1px solid var(--mb-border)", background: "var(--mb-surface)", borderRadius: 12, padding: 12, marginTop: 12, minWidth: 0 };
    const button = { font: "inherit", cursor: "pointer" };
    const catalog = view.snapshot?.catalog;
    const detail = catalog?.entries.find((entry) => entry.id === detailId);
    const updates = !catalog?.stale ? catalog?.entries.filter((entry) => entry.newer && !entry.blocked && view.snapshot?.records.some((task) => task.pack.manifest.id === entry.id && !task.removedAt)) ?? [] : [];
    const inventory = useMemo(() => {
      const bundles = /* @__PURE__ */ new Map();
      const runtime = /* @__PURE__ */ new Map();
      for (const bundle of view.snapshot?.bundles ?? []) if (bundle.installed || bundle.availability !== "missing") bundles.set(bundle.name, bundle);
      for (const entry of view.snapshot?.runtime ?? []) {
        const rows = runtime.get(entry.moduleName) ?? [];
        rows.push(entry);
        runtime.set(entry.moduleName, rows);
      }
      return { bundles, runtime };
    }, [view.snapshot?.bundles, view.snapshot?.runtime]);
    const report = () => JSON.stringify({ version: "0.0.1-p3.0", hostVersion: view.snapshot?.hostVersion, task: view.snapshot?.task, records: view.snapshot?.records, componentOperation: view.snapshot?.componentOperation, catalog, pending: view.pending, error: view.error, connectionError: view.connectionError }, null, 2);
    const saveLog = async (task) => {
      if (state.savingLog) return;
      publish({ savingLog: true, savedLogPath: "", notice: "\u6B63\u5728\u4FDD\u5B58\u65E5\u5FD7\u2026" });
      try {
        const context = { error: view.error.slice(0, 4e3), connectionError: view.connectionError.slice(0, 4e3), pending: view.pending.slice(0, 4e3) };
        const result = await api("save-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...task ? { taskId: task.id } : {}, context }) });
        publish({ notice: "\u65E5\u5FD7\u5DF2\u4FDD\u5B58", savedLogPath: result.path });
      } catch (error) {
        publish({ notice: "", error: `\u4FDD\u5B58\u65E5\u5FD7\u5931\u8D25\uFF0C\u53EF\u5C55\u5F00\u8BCA\u65AD\u8BB0\u5F55\u590D\u5236\uFF1A${String(error)}` });
      } finally {
        publish({ savingLog: false });
      }
    };
    const removing = view.plan?.operation === "remove";
    const startBlocked = view.plan?.blocked || (busy ? "\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210" : !removing && !view.selected.length && !view.plan?.items.some((item) => item.action === "reuse") ? "\u8BF7\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u53EF\u5B89\u88C5\u6216\u66F4\u65B0\u7684\u7EC4\u4EF6" : "");
    const previewBlocked = busy ? "\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210" : view.catalogWorking ? "\u6B63\u5728\u68C0\u67E5\u8FDC\u7AEF\u76EE\u5F55" : detail?.blocked || (catalog?.stale ? "\u8BF7\u5148\u5237\u65B0\u8FDC\u7AEF\u76EE\u5F55" : "");
    const chooseAll = (checked) => publish({ selected: checked ? view.plan?.items.filter((item) => ["install", "update"].includes(item.action)).map((item) => item.ref) ?? [] : [] });
    const filteredComponents = (view.snapshot?.components ?? []).filter((component) => `${component.name} ${component.description ?? ""} ${component.packs.join(" ")}`.toLowerCase().includes(componentQuery.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    const protectedComponent = (component) => !!component.toggleReason && !!component.deleteReason;
    const renderComponent = (component) => {
      const rows = (component.rows ?? []).flatMap((row) => (view.snapshot?.runtime ?? []).filter((entry) => row.entryId ? entry.entryId === row.entryId : entry.moduleName === row.moduleName));
      const active = rows.some((row) => row.enabled && row.fiberPhase === "active");
      const failed = !!component.error || rows.some((row) => row.enabled && row.fiberPhase === "failed");
      const blocked = busy || !!view.connectionError;
      const pending = view.componentPending === component.name;
      const confirming = deleteConfirm?.name === component.name;
      return h(
        "article",
        { key: component.name, className: "mojobox-component", "aria-label": component.name, "aria-busy": pending },
        h("div", null, h("h4", null, component.name), h("p", { className: "mojobox-meta" }, component.version ?? "\u7248\u672C\u5F85\u6838\u5BF9")),
        component.description ? h("details", { className: "mojobox-description" }, h(
          "summary",
          null,
          h("span", { className: "mojobox-description-text" }, component.description),
          h("span", { className: "mojobox-description-more mojobox-expand" }, "\u5C55\u5F00\u7B80\u4ECB"),
          h("span", { className: "mojobox-description-more mojobox-collapse" }, "\u6536\u8D77\u7B80\u4ECB")
        )) : h("p", { className: "mojobox-description" }, "\u6682\u65E0\u7B80\u4ECB"),
        !!component.packs.length && h("details", { className: "mojobox-source" }, h("summary", null, `\u6240\u5C5E\u6574\u5408\u5305\uFF08${component.packs.length}\uFF09`), h("p", null, component.packs.join("\u3001"))),
        (component.toggleReason || component.deleteReason) && h("p", { className: "mojobox-meta" }, [...new Set([component.toggleReason, component.deleteReason].filter(Boolean))].join("\uFF1B")),
        h(
          "div",
          { className: "mojobox-component-actions" },
          h("span", { className: "mojobox-state", "data-tone": failed ? "error" : component.enabled && active ? "active" : "neutral" }, pending ? "\u6B63\u5728\u5904\u7406\u2026" : component.error ? `\u7EC4\u4EF6\u5F02\u5E38\uFF1A${component.error.code}` : !component.enabled ? "\u5DF2\u6682\u505C" : failed ? "\u52A0\u8F7D\u5F02\u5E38" : active ? "\u8FD0\u884C\u4E2D" : "\u5DF2\u542F\u7528"),
          h("button", {
            type: "button",
            role: "switch",
            className: "mojobox-switch",
            "aria-checked": component.enabled,
            disabled: blocked || !!component.toggleReason,
            title: component.toggleReason || (component.enabled ? "\u6682\u505C\u7EC4\u4EF6\uFF0C\u4FDD\u7559\u6587\u4EF6\u4E0E\u914D\u7F6E" : "\u542F\u7528\u7EC4\u4EF6"),
            "aria-label": `${component.enabled ? "\u6682\u505C" : "\u542F\u7528"} ${component.name}`,
            onClick: () => controlComponent(component, component.enabled ? "pause" : "enable")
          }, h("span", { className: "mojobox-switch-knob", "aria-hidden": true })),
          h("button", {
            style: button,
            className: "mojobox-danger",
            disabled: blocked || !!component.deleteReason,
            title: component.deleteReason,
            "aria-label": `\u5220\u9664 ${component.name}`,
            onClick: (event) => {
              deleteTrigger.current = event.currentTarget;
              setDeleteConfirm(component);
            }
          }, "\u5220\u9664")
        ),
        confirming && h(
          "div",
          { role: "region", "aria-label": "\u5220\u9664\u786E\u8BA4", className: "mojobox-confirm", onKeyDown: (event) => {
            if (event.key === "Escape") {
              setDeleteConfirm(null);
              deleteTrigger.current?.focus();
            }
          } },
          h("h4", { ref: deleteTitle, tabIndex: -1 }, `\u5220\u9664 ${deleteConfirm.name}\uFF1F`),
          h("p", null, `\u5C06\u4ECE\u5F53\u524D\u5BA2\u6237\u7AEF\u5378\u8F7D ${deleteConfirm.version ?? ""}\u3002\u63D2\u4EF6\u79C1\u6709\u6570\u636E\u4FDD\u7559\uFF1B\u9700\u8981\u65F6\u53EF\u91CD\u65B0\u5B89\u88C5\u3002`),
          !!deleteConfirm.packs.length && h("p", null, `\u4EE5\u4E0B\u6574\u5408\u5305\u4F1A\u7F3A\u5C11\u6B64\u7EC4\u4EF6\uFF1A${deleteConfirm.packs.join("\u3001")}`),
          h(
            "div",
            { style: { display: "flex", gap: 8 } },
            h("button", { style: button, disabled: busy, onClick: () => {
              setDeleteConfirm(null);
              deleteTrigger.current?.focus();
            } }, "\u53D6\u6D88"),
            h("button", { style: button, className: "mojobox-danger", disabled: busy || !!view.connectionError, onClick: () => {
              const component2 = deleteConfirm;
              setDeleteConfirm(null);
              void controlComponent(component2, "delete");
            } }, "\u786E\u8BA4\u5220\u9664")
          )
        )
      );
    };
    return h(
      "section",
      { className: "mojobox", "aria-label": "Mojobox \u6574\u5408\u5305\u7BA1\u7406", "aria-busy": !!busy },
      h("style", null, styles),
      h(
        "div",
        { className: "mojobox-header" },
        h("div", { className: "mojobox-heading" }, h("h2", null, "Mojobox"), h("p", { className: "mojobox-meta" }, `\u6574\u5408\u5305\u7BA1\u7406 \xB7 \u5B98\u7248 ${view.snapshot?.hostVersion ?? "\u8FDE\u63A5\u4E2D"}`)),
        h("button", { style: button, title: "\u5237\u65B0\u72B6\u6001", "aria-label": "\u5237\u65B0\u72B6\u6001", disabled: view.refreshing, onClick: refreshManually }, refreshIcon(), view.refreshing ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0")
      ),
      h(
        "nav",
        { "aria-label": "\u6574\u5408\u5305\u89C6\u56FE", className: "mojobox-nav" },
        ...[["import", "\u9996\u9875"], ["catalog", "\u5E02\u573A"], ["installed", "\u5DF2\u5B89\u88C5"], ["manage", "\u7BA1\u7406"]].map(([id, label]) => h("button", {
          key: id,
          type: "button",
          style: button,
          "aria-label": label,
          title: id === "installed" && updates.length ? `${updates.length} \u4E2A\u6574\u5408\u5305\u53EF\u66F4\u65B0` : void 0,
          "aria-pressed": view.view === id,
          onClick: () => {
            setDetailId("");
            setDeleteConfirm(null);
            publish({ view: id });
            if (id === "installed" && !busy) void refreshCatalog();
          }
        }, label, id === "installed" && !!updates.length && h("span", { className: "mojobox-update-count", "aria-label": `${updates.length} \u4E2A\u6574\u5408\u5305\u53EF\u66F4\u65B0` })))
      ),
      (view.error || view.connectionError || view.pending || view.notice) && h(
        "div",
        { className: "mojobox-feedback" },
        view.error && h("p", { role: "alert", style: { margin: 0 } }, view.error),
        view.connectionError && h("p", { role: "alert", style: { margin: 0 } }, `\u65E0\u6CD5\u8BFB\u53D6\u5BBF\u4E3B\u72B6\u6001\uFF1A${view.connectionError}`),
        (view.pending || view.notice) && h("p", { role: "status", "aria-live": "polite", style: { margin: 0 } }, view.pending || view.notice),
        view.savedLogPath && view.notice === "\u65E5\u5FD7\u5DF2\u4FDD\u5B58" && h("details", { style: { marginTop: 4, fontSize: 12, color: "var(--mb-secondary)" } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u4FDD\u5B58\u4F4D\u7F6E"), h("div", { style: { userSelect: "text" } }, view.savedLogPath)),
        !!view.error && h("button", { style: { ...button, marginTop: 8 }, disabled: view.savingLog, onClick: () => saveLog() }, view.savingLog ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u65E5\u5FD7")
      ),
      view.view === "catalog" && h(
        "div",
        null,
        h(
          "div",
          { className: "mojobox-toolbar" },
          h("h3", null, "\u6574\u5408\u5305\u5E02\u573A"),
          h("button", { style: button, disabled: view.catalogWorking || busy, title: "\u68C0\u67E5\u8FDC\u7AEF\u76EE\u5F55\u548C\u65B0\u7248", "aria-label": "\u68C0\u67E5\u8FDC\u7AEF\u76EE\u5F55\u548C\u65B0\u7248", onClick: refreshCatalog }, refreshIcon(), view.catalogWorking ? "\u68C0\u67E5\u4E2D\u2026" : "\u68C0\u67E5\u66F4\u65B0")
        ),
        h("p", { role: "status", style: { color: "var(--mb-secondary)", fontSize: 12 } }, `${catalog?.stale ? "\u7F13\u5B58\u5FEB\u7167\uFF0C\u9700\u5237\u65B0\u540E\u5B89\u88C5" : catalog ? "\u5DF2\u6838\u5BF9\u8FDC\u7AEF\u76EE\u5F55" : "\u5C1A\u65E0\u76EE\u5F55"} \xB7 \u4E0A\u6B21\u6210\u529F\u68C0\u67E5 ${catalog?.checkedAt ? new Date(catalog.checkedAt).toLocaleString() : "\u6682\u65E0"}`),
        catalog?.error && h("p", { role: "alert", style: { overflowWrap: "anywhere" } }, `\u76EE\u5F55\u4E0D\u53EF\u7528\uFF1A${catalog.error}`),
        !catalog?.entries.length && h("p", null, "\u6682\u65E0\u53EF\u5C55\u793A\u7684\u6574\u5408\u5305\uFF1B\u4ECD\u53EF\u4ECE\u6587\u4EF6\u5BFC\u5165"),
        detail ? h(
          "div",
          null,
          h("button", { style: button, onClick: () => setDetailId("") }, "\u8FD4\u56DE\u76EE\u5F55"),
          h(
            "article",
            { style: card },
            h("h3", { ref: detailTitle, tabIndex: -1, style: { marginTop: 0, overflowWrap: "anywhere" } }, `${detail.name} \xB7 ${detail.version}${detail.newer ? " \xB7 \u6709\u65B0\u7248" : ""}`),
            h("p", null, detail.description),
            h("p", { style: { color: "var(--mb-secondary)", fontSize: 12 } }, `${detail.author} \xB7 \u5185\u6838 ${detail.requires ?? "\u672A\u58F0\u660E"} \xB7 ${detail.components.length} \u4E2A\u7EC4\u4EF6 \xB7 ${detail.archiveSize.toLocaleString()} B`),
            detail.installedVersion && h("p", { style: { fontSize: 12 } }, `\u672C\u5730\u8BB0\u5F55\u76EE\u6807 ${detail.installedVersion}`),
            detail.blocked && h("p", null, detail.blocked),
            h("details", null, h("summary", { style: { cursor: "pointer" } }, "\u5305\u542B\u7EC4\u4EF6"), ...detail.components.map((plugin) => h("div", { key: plugin.ref, style: { fontSize: 12, overflowWrap: "anywhere", padding: "4px 0" } }, `${plugin.ref} \xB7 ${plugin.version ?? "\u5185\u7F6E\u7248\u672C"}`))),
            h("button", { style: { ...button, marginTop: 12 }, disabled: !!previewBlocked, title: previewBlocked || "\u4E0B\u8F7D\u6821\u9A8C\u5E76\u9009\u62E9\u7EC4\u4EF6", "aria-label": `\u9884\u89C8 ${detail.name}`, onClick: () => previewRemote(detail.id, detail.version) }, view.working ? "\u6B63\u5728\u51C6\u5907\u5B89\u88C5\u2026" : "\u9884\u89C8\u5B89\u88C5"),
            previewBlocked && h("p", { style: { fontSize: 12 } }, previewBlocked)
          )
        ) : h(
          "div",
          { ref: packGrid, "aria-label": "\u6574\u5408\u5305\u76EE\u5F55", className: "mojobox-pack-grid" },
          ...(catalog?.entries ?? []).map((entry) => h(
            "button",
            {
              key: entry.id,
              type: "button",
              className: "mojobox-pack",
              "aria-label": entry.name,
              "data-pack-id": entry.id,
              title: entry.name,
              onClick: () => {
                lastOpened.current = entry.id;
                setDetailId(entry.id);
              }
            },
            h("span", { className: "mojobox-pack-title" }, h("span", null, entry.name), h("span", { className: "mojobox-meta" }, entry.version)),
            h("p", null, entry.description),
            h("span", { className: "mojobox-meta" }, `${entry.components.length} \u4E2A\u7EC4\u4EF6 \xB7 ${entry.author}`),
            (entry.newer || entry.installedVersion || entry.blocked) && h("span", { className: "mojobox-meta" }, entry.blocked || (entry.newer ? "\u6709\u65B0\u7248" : `\u672C\u5730\u76EE\u6807 ${entry.installedVersion}`))
          ))
        )
      ),
      view.view === "import" && h(
        "div",
        null,
        !view.plan && h(
          "div",
          {
            className: "mojobox-dropzone",
            role: "region",
            "aria-label": "\u62D6\u62FD\u5B89\u88C5\u6574\u5408\u5305",
            "aria-disabled": !!busy,
            onDragOver: (event) => event.preventDefault(),
            onDrop: (event) => {
              event.preventDefault();
              if (event.dataTransfer?.files.length !== 1) publish({ error: "\u8BF7\u6BCF\u6B21\u5BFC\u5165\u4E00\u4E2A\u6574\u5408\u5305" });
              else void importFile(event.dataTransfer.files[0]);
            }
          },
          h("p", null, "\u62D6\u5165 Mojobox \u6574\u5408\u5305"),
          h("button", { type: "button", style: button, disabled: busy, onClick: () => fileInput.current?.click() }, "\u9009\u62E9\u6587\u4EF6\u5B89\u88C5"),
          h("input", { ref: fileInput, type: "file", tabIndex: -1, accept: ".dshpack,.zip", disabled: busy, "aria-label": "\u9009\u62E9 Mojobox \u6574\u5408\u5305", onChange: (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void importFile(file);
          } }),
          h("p", { className: "mojobox-meta", style: { margin: "8px 0 0" } }, ".dshpack / .zip \xB7 \u6700\u5927 2 MiB")
        ),
        !view.plan && h("p", { className: "mojobox-home-link" }, h("a", { href: "https://github.com/lanyun077/EAC-mojobox", target: "_blank", rel: "noopener noreferrer" }, "\u8BBF\u95EE Mojobox \u4E3B\u4ED3\u5E93")),
        view.plan && h(
          "div",
          { style: card },
          h(
            "div",
            { className: "mojobox-toolbar" },
            h("h3", { ref: planTitle, tabIndex: -1, style: { scrollMarginTop: 88 } }, `${view.plan.pack.manifest.name} \xB7 ${view.plan.pack.manifest.version}`),
            !removing && h("button", { style: button, disabled: busy, onClick: () => publish({ plan: null, selected: [] }) }, "\u53D6\u6D88\u9884\u89C8")
          ),
          h("p", null, view.plan.pack.manifest.description ?? "\u672C\u5730\u5BFC\u5165"),
          removing && h("div", { role: "note" }, h("h4", { style: { margin: "12px 0 8px" } }, "\u79FB\u9664\u6574\u5408\u5305"), h("p", null, "\u9ED8\u8BA4\u53EA\u79FB\u9664\u7BA1\u7406\u8BB0\u5F55\uFF0C\u4FDD\u7559\u6240\u6709\u7EC4\u4EF6\u3002\u4EC5\u52FE\u9009\u4F60\u8981\u5378\u8F7D\u7684\u63D2\u4EF6\uFF1B\u5B83\u4EEC\u4E5F\u53EF\u80FD\u5728\u5BFC\u5165\u6574\u5408\u5305\u524D\u5C31\u5DF2\u5B58\u5728\u3002\u5176\u4ED6\u6574\u5408\u5305\u5171\u7528\u7684\u7EC4\u4EF6\u4F1A\u4FDD\u7559\u3002\u63D2\u4EF6\u79C1\u6709\u6570\u636E\u4E0D\u6E05\u7406\u3002")),
          h("p", { style: { color: "var(--mb-secondary)" } }, `${view.plan.source === "catalog" ? "Mojobox \u8FDC\u7AEF\u76EE\u5F55" : "\u672C\u5730\u5BFC\u5165"} \xB7 ${view.plan.pack.manifest.author ?? "\u4F5C\u8005\u672A\u58F0\u660E"} \xB7 \u5185\u6838 ${view.plan.pack.manifest.requires?.dsh ?? "\u672A\u77E5"}`),
          view.plan.blocked && h("p", { role: "alert" }, view.plan.blocked),
          view.plan.items.some((item) => item.action === "update") && h("p", { role: "status" }, "\u68C0\u6D4B\u5230\u63D2\u4EF6\u7248\u672C\u8FC7\u4F4E\uFF0C\u662F\u5426\u66F4\u65B0\uFF1F\u8BF7\u52FE\u9009\u8981\u66F4\u65B0\u7684\u63D2\u4EF6\uFF0C\u6216\u8DF3\u8FC7\u3002"),
          !removing && h("div", { className: "mojobox-actions" }, h("button", { style: button, disabled: busy, onClick: () => chooseAll(true) }, "\u5168\u9009\u5B89\u88C5 / \u66F4\u65B0\u9879"), h("button", { style: button, disabled: busy, onClick: () => chooseAll(false) }, "\u8DF3\u8FC7\u5168\u90E8")),
          ...view.plan.items.map((item) => h(
            "div",
            { key: item.ref, style: { borderBottom: "1px solid var(--mb-border)", padding: "12px 0", overflowWrap: "anywhere" } },
            h("label", null, h("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${item.ref}`, checked: view.selected.includes(item.ref), disabled: busy || !(removing ? ["remove"] : ["install", "update"]).includes(item.action), onChange: (event) => publish({ selected: event.target.checked ? [...view.selected, item.ref] : view.selected.filter((ref) => ref !== item.ref) }) }), ` ${item.ref}`),
            h("div", null, removing ? `${item.current ?? "\u672A\u5B89\u88C5"} \xB7 ${actionLabels[item.action]}` : `${item.current ?? "\u672A\u5B89\u88C5"} \u2192 ${item.target ?? "\u672A\u58F0\u660E"} \xB7 ${actionLabels[item.action]}`),
            h("small", { style: { color: "var(--mb-secondary)" } }, item.reason),
            !!item.sharedTargets?.length && h("p", { style: { fontSize: 12 } }, `\u5171\u4EAB\u7EC4\u4EF6\uFF1A${item.sharedTargets.map((other) => `${other.name} \u7684\u76EE\u6807\u4E3A ${other.version}`).join("\uFF1B")}\u3002\u53D8\u66F4\u540E\u8FD9\u4E9B\u6574\u5408\u5305\u53EF\u80FD\u4E0E\u76EE\u6807\u4E0D\u540C\u3002`)
          )),
          h("button", { style: { ...button, marginTop: 16 }, disabled: !!startBlocked, onClick: start, title: startBlocked || "\u6267\u884C\u6240\u9009\u7EC4\u4EF6" }, view.working ? "\u6B63\u5728\u5904\u7406\u2026" : removing ? view.selected.length ? `\u786E\u8BA4\u79FB\u9664\u5E76\u5378\u8F7D ${view.selected.length} \u4E2A\u7EC4\u4EF6` : "\u4EC5\u79FB\u9664\u7BA1\u7406\u8BB0\u5F55" : view.selected.length ? `\u6267\u884C\u6240\u9009\uFF08${view.selected.length}\uFF09` : "\u6838\u5BF9\u5DF2\u5B89\u88C5\u7EC4\u4EF6"),
          removing && h("button", { style: { ...button, marginLeft: 8 }, disabled: busy, onClick: () => publish({ plan: null, selected: [], view: "installed" }) }, "\u53D6\u6D88\u79FB\u9664"),
          startBlocked && h("p", { style: { fontSize: 12 } }, startBlocked)
        )
      ),
      view.view === "installed" && h(
        "div",
        { ref: statusPanel, tabIndex: -1, style: { scrollMarginTop: 88 } },
        h(
          "div",
          { className: "mojobox-toolbar" },
          h("h3", null, "\u5DF2\u5B89\u88C5\u6574\u5408\u5305"),
          h("button", { style: button, disabled: view.catalogWorking || busy, onClick: refreshCatalog, "aria-label": "\u68C0\u67E5\u6574\u5408\u5305\u66F4\u65B0" }, refreshIcon(), view.catalogWorking ? "\u68C0\u67E5\u4E2D\u2026" : "\u68C0\u67E5\u66F4\u65B0")
        ),
        h("p", { className: "mojobox-meta" }, view.catalogWorking ? "\u6B63\u5728\u68C0\u67E5\u6574\u5408\u5305\u65B0\u7248\u2026" : catalog?.stale ? "\u66F4\u65B0\u4FE1\u606F\u672A\u6838\u9A8C\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5" : `\u4E0A\u6B21\u68C0\u67E5 ${catalog?.checkedAt ? new Date(catalog.checkedAt).toLocaleString() : "\u6682\u65E0"}`),
        !!updates.length && h("div", { className: "mojobox-update", role: "status", "aria-label": "\u6574\u5408\u5305\u66F4\u65B0\u63D0\u9192" }, `${updates.length} \u4E2A\u6574\u5408\u5305\u6709\u65B0\u7248\u672C\uFF0C\u53EF\u5728\u4E0B\u65B9\u9009\u62E9\u66F4\u65B0`),
        view.submittedTaskId && h("p", { role: "status" }, "\u4EFB\u52A1\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u8BFB\u53D6\u8FDB\u5EA6\u2026"),
        !view.submittedTaskId && !view.snapshot?.records.length && h("p", null, "\u5C1A\u65E0\u901A\u8FC7 Mojobox \u7BA1\u7406\u7684\u6574\u5408\u5305"),
        ...(view.snapshot?.records ?? []).map((task) => {
          const running = task.status === "running";
          const removal = task.operation === "remove";
          const processed = task.items.filter((item) => !["pending", "running"].includes(item.status)).length;
          const percent = task.items.length ? Math.min(running ? 99 : 100, Math.floor(processed / task.items.length * 100)) : 0;
          const installed = task.items.filter((item) => item.status === "installed").length;
          const reused = task.items.filter((item) => item.status === "reused").length;
          const failed = task.items.filter((item) => ["failed", "unconfirmed", "dependency-skipped"].includes(item.status)).length;
          const skipped = task.items.filter((item) => item.status === "skipped").length;
          const matched = task.pack.manifest.plugins.filter((item) => {
            const actual = inventory.bundles.get(item.ref);
            return actual && actual.version === item.version && !actual.error;
          }).length;
          const missing = task.pack.manifest.plugins.filter((item) => !inventory.bundles.has(item.ref)).length;
          const restarts = task.items.filter((item) => item.activation === "restart-required").length;
          const update = !removal && !task.removedAt ? updates.find((entry) => entry.id === task.pack.manifest.id) : void 0;
          return h(
            "article",
            { key: task.id, style: card },
            h(
              "div",
              { style: { display: "flex", alignItems: "baseline", gap: 16, justifyContent: "space-between", flexWrap: "wrap" } },
              h("h3", { style: { margin: 0, fontSize: 14, fontWeight: 500, overflowWrap: "anywhere" } }, task.pack.manifest.name),
              h("span", { style: { fontSize: 12, color: "var(--mb-secondary)" } }, `\u76EE\u6807 ${task.pack.manifest.version}`)
            ),
            update && h(
              "div",
              { className: "mojobox-update", role: "status" },
              h("p", null, `\u6709\u53EF\u7528\u66F4\u65B0\uFF1A${task.pack.manifest.version} \u2192 ${update.version}`),
              h("button", { style: button, disabled: !!busy || view.catalogWorking, "aria-label": `\u9884\u89C8 ${task.pack.manifest.name} \u66F4\u65B0`, onClick: () => previewRemote(update.id, update.version) }, `\u67E5\u770B\u66F4\u65B0 ${update.version}`)
            ),
            h("p", { role: "status", "aria-live": "polite", style: { margin: "12px 0 8px" } }, removal ? task.removedAt ? "\u5DF2\u79FB\u9664\u7BA1\u7406\u8BB0\u5F55" : running ? `\u6B63\u5728\u79FB\u9664 \xB7 ${percent}%` : "\u79FB\u9664\u672A\u5B8C\u6210\uFF0C\u8BF7\u6838\u5BF9\u7EC4\u4EF6\u7ED3\u679C" : running ? `\u6B63\u5728\u5B89\u88C5 \xB7 ${percent}%` : `\u5F53\u524D\u7B26\u5408\u76EE\u6807 ${matched}/${task.pack.manifest.plugins.length}${missing ? ` \xB7 \u7F3A\u5C11 ${missing} \u4E2A\u7EC4\u4EF6` : matched < task.pack.manifest.plugins.length ? " \xB7 \u5B58\u5728\u7248\u672C\u5DEE\u5F02\u6216\u7EC4\u4EF6\u5F02\u5E38" : " \xB7 \u7EC4\u4EF6\u9F50\u5168"}`),
            running && h(
              "div",
              { role: "progressbar", "aria-label": `${task.pack.manifest.name} ${removal ? "\u79FB\u9664" : "\u5B89\u88C5"}\u8FDB\u5EA6`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, "aria-valuetext": `\u5DF2\u5904\u7406 ${processed}/${task.items.length} \u9879\uFF0C\u6309\u7EC4\u4EF6\u8BA1\u6570`, style: { height: 8, background: "var(--mb-subtle)", borderRadius: 4, overflow: "hidden" } },
              h("div", { style: { height: "100%", background: "var(--mb-accent)", transform: `scaleX(${percent / 100})`, transformOrigin: "left" } })
            ),
            h("p", { style: { margin: "8px 0 16px", color: "var(--mb-secondary)", fontSize: 12, fontVariantNumeric: "tabular-nums" } }, running ? `\u5DF2\u5904\u7406 ${processed}/${task.items.length} \u9879 \xB7 \u6309\u7EC4\u4EF6\u8BA1\u6570\uFF0C\u4E0B\u8F7D\u901F\u5EA6\u53EF\u80FD\u5F71\u54CD\u7B49\u5F85\u65F6\u95F4` : removal ? `\u5378\u8F7D ${task.items.filter((item) => item.status === "removed").length} \xB7 \u4FDD\u7559 ${task.items.filter((item) => item.status === "retained").length} \xB7 \u5F02\u5E38 ${failed}` : `\u4E0A\u6B21${taskLabels[task.status]} \xB7 \u5B89\u88C5 ${installed} \xB7 \u590D\u7528 ${reused} \xB7 \u8DF3\u8FC7 ${skipped} \xB7 \u5F02\u5E38 ${failed}`),
            !!restarts && !running && h("p", { role: "status" }, `${restarts} \u4E2A\u7EC4\u4EF6\u9700\u8981\u91CD\u542F\u5BA2\u6237\u7AEF\u540E\u751F\u6548`),
            !running && h(
              "div",
              { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
              !removal && h("button", { style: button, disabled: busy, title: busy ? "\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210" : "\u68C0\u67E5\u8FDC\u7AEF\u6574\u5408\u5305\u66F4\u65B0\u5E76\u6838\u5BF9\u7EC4\u4EF6", "aria-label": `\u6838\u5BF9 ${task.pack.manifest.name} \u66F4\u65B0`, onClick: () => replan(task.id, false) }, view.operationRecord === task.id && !view.retrying ? "\u6B63\u5728\u6838\u5BF9\u2026" : "\u6838\u5BF9\u66F4\u65B0"),
              h("button", { style: button, onClick: () => {
                setComponentQuery("");
                publish({ view: "manage" });
              } }, "\u7BA1\u7406\u7EC4\u4EF6"),
              task.removedAt && h("button", { style: button, disabled: busy, onClick: () => replan(task.id, false) }, "\u91CD\u65B0\u5B89\u88C5"),
              !!failed && !removal && h("button", { style: button, disabled: busy, title: busy ? "\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210" : "\u91CD\u65B0\u6838\u5BF9\u5931\u8D25\u9879\uFF0C\u786E\u8BA4\u540E\u6267\u884C", onClick: () => replan(task.id, true) }, view.operationRecord === task.id && view.retrying ? "\u6B63\u5728\u51C6\u5907\u91CD\u8BD5\u2026" : "\u91CD\u8BD5\u5931\u8D25\u9879"),
              (failed > 0 || task.status !== "complete") && h("button", { style: button, disabled: view.savingLog, onClick: () => saveLog(task) }, view.savingLog ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u65E5\u5FD7")
            ),
            h(
              "details",
              { style: { marginTop: 16 }, onToggle: (event) => setExpandedTasks(event.currentTarget.open ? [...expandedTasks.filter((id) => id !== task.id), task.id] : expandedTasks.filter((id) => id !== task.id)) },
              h("summary", { style: { cursor: "pointer", fontSize: 12, color: "var(--mb-secondary)" } }, "\u7EC4\u4EF6\u8BE6\u60C5"),
              expandedTasks.includes(task.id) && h("div", null, ...task.items.map((item) => {
                const actual = inventory.bundles.get(item.ref);
                const runtime = inventory.runtime.get(item.ref) ?? [];
                const activation = runtime.length && runtime.every((entry) => !entry.enabled) ? "\u5DF2\u505C\u7528" : runtime.length && runtime.every((entry) => !entry.enabled || entry.fiberPhase === "active") ? "\u5DF2\u52A0\u8F7D" : "\u8FD0\u884C\u72B6\u6001\u5F85\u6838\u5BF9";
                return h(
                  "div",
                  { key: item.ref, style: { padding: "12px 0", borderBottom: "1px solid var(--mb-border)", overflowWrap: "anywhere" } },
                  h("div", null, `${item.ref} \xB7 ${resultLabels[item.status]}`),
                  h("small", null, `\u5B9E\u9645 ${actual?.version ?? "\u672A\u786E\u8BA4"} / \u76EE\u6807 ${item.target ?? "\u672A\u77E5"} \xB7 ${activation}${actual?.version !== item.target ? " \xB7 \u4E0E\u76EE\u6807\u4E0D\u540C" : ""}`),
                  h("div", { style: { color: "var(--mb-secondary)", fontSize: 12 } }, item.reason)
                );
              })),
              h("p", { style: { fontSize: 12, color: "var(--mb-secondary)" } }, "\u5B89\u88C5\u7ED3\u679C\u4E3A\u5386\u53F2\u8BB0\u5F55\uFF0C\u5F53\u524D\u7248\u672C\u6765\u81EA\u5BBF\u4E3B")
            )
          );
        })
      ),
      view.view === "manage" && h(
        "div",
        null,
        h("div", { style: { display: "flex", alignItems: "baseline", gap: 8 } }, h("h3", { style: { margin: 0, fontSize: 14, fontWeight: 500 } }, "\u7EC4\u4EF6\u7BA1\u7406"), h("span", { className: "mojobox-meta" }, `${view.snapshot?.components?.length ?? 0} \u4E2A\u7EC4\u4EF6`)),
        h("p", { className: "mojobox-meta", style: { margin: "4px 0 12px" } }, "\u5F00\u5173\u63A7\u5236\u542F\u505C\uFF0C\u5220\u9664\u524D\u786E\u8BA4\u5F71\u54CD\u8303\u56F4"),
        h("input", { type: "search", className: "mojobox-search", "aria-label": "\u641C\u7D22\u7EC4\u4EF6", placeholder: "\u641C\u7D22\u540D\u79F0\u6216\u6240\u5C5E\u6574\u5408\u5305", value: componentQuery, onChange: (event) => {
          setComponentQuery(event.target.value);
          setDeleteConfirm(null);
        } }),
        view.snapshot?.componentOperation && !view.working && !view.notice && !view.error && h("p", { role: "status", className: "mojobox-meta", style: { overflowWrap: "anywhere" } }, `${view.snapshot.componentOperation.name}\uFF1A${view.snapshot.componentOperation.message}`),
        !view.snapshot?.components && h("p", { role: "status", className: "mojobox-empty" }, "\u6B63\u5728\u8BFB\u53D6\u7EC4\u4EF6\uFF0C\u8BF7\u7A0D\u5019\uFF1B\u82E5\u6301\u7EED\u672A\u663E\u793A\uFF0C\u8BF7\u5237\u65B0\u72B6\u6001"),
        view.snapshot?.components?.length === 0 && h("p", { className: "mojobox-empty" }, "\u5F53\u524D\u6CA1\u6709\u5DF2\u5B89\u88C5\u7684\u7EC4\u4EF6"),
        h("div", { className: "mojobox-component-list" }, ...filteredComponents.filter((component) => !protectedComponent(component)).map(renderComponent)),
        filteredComponents.some(protectedComponent) && h(
          "details",
          { className: "mojobox-protected", open: componentQuery.trim() ? true : void 0 },
          h("summary", null, `\u53D7\u4FDD\u62A4\u7EC4\u4EF6\uFF08${filteredComponents.filter(protectedComponent).length}\uFF09`),
          h("p", { className: "mojobox-meta" }, "\u7531\u5BBF\u4E3B\u6216\u5B89\u88C5\u6765\u6E90\u9650\u5236\u64CD\u4F5C\uFF0C\u4FDD\u7559\u5728\u6B64\u4F9B\u6838\u5BF9"),
          h("div", { className: "mojobox-component-list" }, ...filteredComponents.filter(protectedComponent).map(renderComponent))
        ),
        !!componentQuery.trim() && !!view.snapshot?.components?.length && !filteredComponents.length && h("p", { className: "mojobox-empty" }, "\u672A\u627E\u5230\u5339\u914D\u7EC4\u4EF6")
      ),
      h(
        "details",
        { style: { marginTop: 20 }, onToggle: (event) => setDiagnosticsOpen(event.currentTarget.open) },
        h("summary", { style: { cursor: "pointer" } }, "\u8BCA\u65AD\u8BB0\u5F55"),
        diagnosticsOpen && h("button", { style: button, onClick: async () => {
          try {
            await navigator.clipboard.writeText(report());
            publish({ notice: "\u8BCA\u65AD\u5DF2\u590D\u5236" });
          } catch (error) {
            publish({ error: `\u590D\u5236\u5931\u8D25\uFF0C\u53EF\u624B\u52A8\u9009\u62E9\u4E0B\u65B9\u62A5\u544A\uFF1A${String(error)}` });
          }
        } }, "\u590D\u5236\u8BCA\u65AD"),
        diagnosticsOpen && h("button", { style: { ...button, marginLeft: 8 }, disabled: view.savingLog, onClick: () => saveLog() }, view.savingLog ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u65E5\u5FD7"),
        diagnosticsOpen && h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 360, overflow: "auto" } }, report())
      )
    );
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "mojobox-manager", order: 80, label: () => "Mojobox" }, Section));
}
exports.apply = apply;
exports.inject = ["slots"];

return exports;}});
