window.__ModuleLoader__.load({id:'dsh-plugin-mojobox',factory:function(require){const exports={};
const { createElement: h, useEffect, useState, useRef, useMemo } = require('react');
const actionLabels = {
    install: '新增',
    reuse: '复用',
    update: '可更新',
    'keep-newer': '保留高版本',
    unsupported: '无法执行',
    remove: '可卸载',
    keep: '保留'
};
const resultLabels = {
    running: '执行中',
    pending: '等待',
    installed: '已安装',
    reused: '已复用',
    skipped: '已跳过',
    'dependency-skipped': '依赖未满足',
    failed: '失败',
    unconfirmed: '待核对',
    removed: '已卸载',
    retained: '已保留'
};
const taskLabels = {
    running: '正在安装',
    complete: '安装完成',
    partial: '部分完成',
    failed: '安装未完成',
    interrupted: '安装中断'
};
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
.mojobox .mojobox-pack { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 12px; border: 1px solid var(--mb-border); border-radius: 12px; background: var(--mb-surface); }
.mojobox .mojobox-pack-header { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; }
.mojobox .mojobox-pack-title { min-width: 0; margin: 0; font-size: 13px; font-weight: 500; }
.mojobox .mojobox-pack-title a { display: inline-flex; align-items: flex-start; gap: 4px; color: inherit; text-decoration: none; }
.mojobox .mojobox-pack-title a > span { min-width: 0; }
.mojobox .mojobox-pack-title a:hover { text-decoration: underline; text-underline-offset: 3px; }
.mojobox .mojobox-pack-title svg { flex: none; margin-top: 2px; color: var(--mb-secondary); }
.mojobox .mojobox-pack-header > button { flex: none; min-height: 28px; padding: 2px 12px; font-size: 12px; }
.mojobox .mojobox-pack-byline { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--mb-secondary); font-size: 12px; }
.mojobox .mojobox-pack-byline a { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: inherit; text-decoration: none; }
.mojobox .mojobox-pack-byline a:hover { color: var(--mb-text); text-decoration: underline; }
.mojobox .mojobox-avatar { display: inline-flex; align-items: center; justify-content: center; flex: none; position: relative; width: 16px; height: 16px; border-radius: 4px; overflow: hidden; background: var(--mb-subtle); font-size: 11px; }
.mojobox .mojobox-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.mojobox .mojobox-pack-stats { display: flex; flex-wrap: wrap; gap: 12px; color: var(--mb-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.mojobox .mojobox-pack-stats span { display: inline-flex; align-items: center; gap: 4px; }
.mojobox .mojobox-pack-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 0; font-size: 12px; color: var(--mb-secondary); }
.mojobox .mojobox-pack-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; color: var(--mb-secondary); font-size: 12px; }
.mojobox .mojobox-pack-footer button { min-height: 28px; padding: 2px 4px; border-color: transparent; font-size: 12px; }
.mojobox .mojobox-empty { padding: 24px 16px; text-align: center; color: var(--mb-secondary); }
.mojobox .mojobox-toolbar { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
.mojobox .mojobox-toolbar h3 { margin: 0; font-size: 14px; }
.mojobox .mojobox-categories { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.mojobox .mojobox-categories button[aria-pressed="true"] { background: var(--mb-subtle); border-color: var(--mb-accent); }
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
const refreshIcon = ()=>h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
    }, h('path', {
        d: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 6M4 12l3 6a7 7 0 0 0 11-1'
    }));
const marketIcon = (kind)=>h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
    }, h('path', {
        d: {
            source: 'M15 3h6v6M21 3l-9 9M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4',
            download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
            heat: 'M3 17l6-6 4 4 8-10M15 5h6v6'
        }[kind]
    }));
const formatCount = (value)=>value == null ? '待统计' : value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value);
function apply(ctx) {
    let state = {
        snapshot: null,
        plan: null,
        selected: [],
        working: false,
        pending: '',
        componentPending: '',
        operationRecord: '',
        retrying: false,
        submittedTaskId: '',
        savingLog: false,
        savedLogPath: '',
        catalogWorking: false,
        refreshing: false,
        notice: '',
        error: '',
        connectionError: '',
        view: 'import'
    };
    let disposed = false;
    const lifetime = new AbortController();
    const listeners = new Set();
    const publish = (patch)=>{
        if (disposed) return;
        state = {
            ...state,
            ...patch
        };
        for (const listener of listeners)listener();
    };
    const api = async (action, init)=>{
        const timeout = AbortSignal.timeout(action === 'status' ? 15000 : 120000);
        try {
            const response = await fetch(`api/mojobox/${action}`, {
                ...init,
                signal: AbortSignal.any([
                    lifetime.signal,
                    timeout
                ])
            });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
            return value;
        } catch (error) {
            if (timeout.aborted) throw new Error('请求超时，请检查连接并核对当前任务状态');
            throw error;
        }
    };
    let snapshotKey = '';
    let refreshing;
    const refresh = ()=>{
        return refreshing ??= (async ()=>{
            try {
                const snapshot = await api('status');
                const key = JSON.stringify(snapshot);
                if (key !== snapshotKey) {
                    snapshotKey = key;
                    publish({
                        snapshot,
                        connectionError: '',
                        ...snapshot.records.some((task)=>task.id === state.submittedTaskId) ? {
                            submittedTaskId: ''
                        } : {}
                    });
                } else if (state.connectionError) publish({
                    connectionError: ''
                });
            } catch (error) {
                if (!disposed && state.connectionError !== String(error)) publish({
                    connectionError: String(error)
                });
            }
        })().finally(()=>{
            refreshing = undefined;
        });
    };
    const refreshManually = async ()=>{
        if (state.refreshing) return;
        publish({
            refreshing: true,
            notice: ''
        });
        try {
            await refresh();
            if (!state.connectionError) publish({
                notice: '状态已刷新'
            });
        } finally{
            publish({
                refreshing: false
            });
        }
    };
    const refreshCatalog = async ()=>{
        if (state.catalogWorking) return;
        publish({
            catalogWorking: true,
            notice: '',
            error: ''
        });
        try {
            const catalog = await api('catalog-refresh', {
                method: 'POST'
            });
            if (catalog.error || catalog.stale) throw new Error(catalog.error ?? '目录未核验');
        } catch (error) {
            publish({
                error: `目录检查失败：${String(error)}`
            });
        } finally{
            await refresh();
            publish({
                catalogWorking: false
            });
        }
    };
    const previewRemote = async (id, version)=>{
        if (state.working || state.snapshot?.busy) return;
        publish({
            working: true,
            pending: '正在下载整合包并核对组件…',
            error: '',
            notice: '',
            plan: null
        });
        try {
            const plan = await api('catalog-preview', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    id,
                    version
                })
            });
            publish({
                plan,
                selected: plan.selected,
                view: 'import'
            });
        } catch (error) {
            publish({
                error: `远端包预览失败：${String(error)}`
            });
        } finally{
            await refresh();
            publish({
                working: false,
                pending: ''
            });
        }
    };
    const importFile = async (file)=>{
        if (!file || state.working || state.snapshot?.busy) return;
        publish({
            working: true,
            pending: '正在读取整合包并核对组件…',
            plan: null,
            error: '',
            notice: ''
        });
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error('整合包超过 2 MiB 限制');
            const plan = await api('preview', {
                method: 'POST',
                body: file
            });
            publish({
                plan,
                selected: plan.selected,
                view: 'import'
            });
        } catch (error) {
            publish({
                error: `无法导入：${String(error)}`
            });
        } finally{
            await refresh();
            publish({
                working: false,
                pending: ''
            });
        }
    };
    const replan = async (recordId, failedOnly)=>{
        if (state.working || state.snapshot?.busy) return;
        publish({
            working: true,
            operationRecord: recordId,
            retrying: failedOnly,
            pending: failedOnly ? '正在核对失败项，准备重试…' : '正在检查整合包更新…',
            error: '',
            notice: '',
            plan: null
        });
        try {
            let newer;
            if (!failedOnly) {
                const catalog = await api('catalog-refresh', {
                    method: 'POST'
                });
                if (catalog.error || catalog.stale) throw new Error(catalog.error ?? '目录尚未核验');
                const record = state.snapshot?.records.find((task)=>task.id === recordId);
                newer = catalog.entries.find((entry)=>entry.id === record?.pack.manifest.id && entry.newer);
            }
            const plan = newer ? await api('catalog-preview', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    id: newer.id,
                    version: newer.version
                })
            }) : await api('replan', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    recordId,
                    failedOnly
                })
            });
            publish({
                plan,
                selected: plan.selected,
                view: 'import',
                notice: failedOnly ? '失败项已核对，请确认后重试' : newer ? `发现新版 ${newer.version}，请确认更新项` : '未发现新版整合包，已重新核对当前目标'
            });
        } catch (error) {
            publish({
                error: `${failedOnly ? '准备重试失败' : '核对更新失败'}：${String(error)}`
            });
        } finally{
            await refresh();
            publish({
                working: false,
                pending: '',
                operationRecord: ''
            });
        }
    };
    const controlComponent = async (component, action)=>{
        if (state.working || state.snapshot?.busy || state.submittedTaskId) return;
        publish({
            working: true,
            componentPending: component.name,
            pending: `正在${action === 'delete' ? '删除' : action === 'enable' ? '启用' : '暂停'} ${component.name}…`,
            error: '',
            notice: '',
            plan: null
        });
        try {
            const operation = await api('component', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    name: component.name,
                    action,
                    expected: component.stamp
                })
            });
            publish(operation.status === 'complete' ? {
                notice: `${component.name}：${operation.message}`
            } : {
                error: `${component.name}：${operation.message}`
            });
        } catch (error) {
            publish({
                error: `组件操作未确认：${String(error)}。请刷新核对当前状态，不要重复提交。`
            });
        } finally{
            if (refreshing) await refreshing;
            await refresh();
            publish({
                working: false,
                pending: '',
                componentPending: ''
            });
        }
    };
    const start = async ()=>{
        if (!state.plan || state.working || state.snapshot?.busy) return;
        const removing = state.plan.operation === 'remove';
        publish({
            working: true,
            pending: removing ? '正在提交移除任务…' : '正在提交安装任务…',
            error: '',
            notice: ''
        });
        try {
            const result = await api('start', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    planId: state.plan.id,
                    selected: state.selected
                })
            });
            publish({
                plan: null,
                view: 'installed',
                notice: '',
                submittedTaskId: result.taskId
            });
            await refresh();
        } catch (error) {
            publish({
                plan: null,
                view: 'installed',
                error: `${removing ? '移除' : '安装'}提交未完成确认：${String(error)}。请核对任务记录；需要重试时重新预览，避免重复提交。`
            });
            await refresh();
        } finally{
            publish({
                working: false,
                pending: ''
            });
        }
    };
    ctx.effect(()=>{
        let polling = false;
        let lastPoll = 0;
        const timer = setInterval(()=>{
            if (!listeners.size || polling || document.visibilityState === 'hidden' || Date.now() - lastPoll < (state.snapshot?.busy || state.working ? 1500 : 10000)) return;
            lastPoll = Date.now();
            polling = true;
            void refresh().finally(()=>{
                polling = false;
            });
        }, 1500);
        return ()=>{
            disposed = true;
            clearInterval(timer);
            lifetime.abort();
            listeners.clear();
        };
    });
    function Section() {
        const [view, setView] = useState(state);
        const [detailId, setDetailId] = useState('');
        const [catalogCategory, setCatalogCategory] = useState('function');
        const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
        const [expandedTasks, setExpandedTasks] = useState([]);
        const [componentQuery, setComponentQuery] = useState('');
        const [deleteConfirm, setDeleteConfirm] = useState(null);
        const deleteTitle = useRef(null);
        const deleteTrigger = useRef(null);
        const fileInput = useRef(null);
        useEffect(()=>{
            if (deleteConfirm) {
                deleteTitle.current?.scrollIntoView({
                    block: 'nearest'
                });
                deleteTitle.current?.focus();
            }
        }, [
            deleteConfirm
        ]);
        const planTitle = useRef(null);
        const statusPanel = useRef(null);
        const detailTitle = useRef(null);
        const packGrid = useRef(null);
        const lastOpened = useRef('');
        useEffect(()=>{
            if (detailId) detailTitle.current?.focus();
            else if (lastOpened.current) Array.from(packGrid.current?.querySelectorAll('button') ?? []).find((button)=>button.dataset.packId === lastOpened.current)?.focus();
        }, [
            detailId
        ]);
        useEffect(()=>{
            const target = view.view === 'import' && view.plan ? planTitle.current : view.view === 'installed' ? statusPanel.current : null;
            if (view.view === 'import') target?.scrollIntoView({
                block: 'start'
            });
            target?.focus({
                preventScroll: true
            });
        }, [
            view.plan?.id,
            view.view
        ]);
        useEffect(()=>{
            const listener = ()=>setView(state);
            listeners.add(listener);
            setView(state);
            void refresh();
            void refreshCatalog();
            return ()=>listeners.delete(listener);
        }, []);
        const busy = view.working || view.snapshot?.busy || !!view.submittedTaskId;
        const card = {
            border: '1px solid var(--mb-border)',
            background: 'var(--mb-surface)',
            borderRadius: 12,
            padding: 12,
            marginTop: 12,
            minWidth: 0
        };
        const button = {
            font: 'inherit',
            cursor: 'pointer'
        };
        const catalog = view.snapshot?.catalog;
        const marketEntries = catalog?.entries.filter((entry)=>(entry.category === 'appearance' ? 'appearance' : 'function') === catalogCategory) ?? [];
        const detail = marketEntries.find((entry)=>entry.id === detailId);
        const updates = !catalog?.stale ? catalog?.entries.filter((entry)=>entry.newer && !entry.blocked && view.snapshot?.records.some((task)=>task.pack.manifest.id === entry.id && !task.removedAt)) ?? [] : [];
        const inventory = useMemo(()=>{
            const bundles = new Map();
            const runtime = new Map();
            for (const bundle of view.snapshot?.bundles ?? [])if (bundle.installed || bundle.availability !== 'missing') bundles.set(bundle.name, bundle);
            for (const entry of view.snapshot?.runtime ?? []){
                const rows = runtime.get(entry.moduleName) ?? [];
                rows.push(entry);
                runtime.set(entry.moduleName, rows);
            }
            return {
                bundles,
                runtime
            };
        }, [
            view.snapshot?.bundles,
            view.snapshot?.runtime
        ]);
        const report = ()=>JSON.stringify({
                version: '0.0.1-p3.1',
                hostVersion: view.snapshot?.hostVersion,
                task: view.snapshot?.task,
                records: view.snapshot?.records,
                componentOperation: view.snapshot?.componentOperation,
                catalog,
                pending: view.pending,
                error: view.error,
                connectionError: view.connectionError
            }, null, 2);
        const saveLog = async (task)=>{
            if (state.savingLog) return;
            publish({
                savingLog: true,
                savedLogPath: '',
                notice: '正在保存日志…'
            });
            try {
                const context = {
                    error: view.error.slice(0, 4000),
                    connectionError: view.connectionError.slice(0, 4000),
                    pending: view.pending.slice(0, 4000)
                };
                const result = await api('save-log', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...task ? {
                            taskId: task.id
                        } : {},
                        context
                    })
                });
                publish({
                    notice: '日志已保存',
                    savedLogPath: result.path
                });
            } catch (error) {
                publish({
                    notice: '',
                    error: `保存日志失败，可展开诊断记录复制：${String(error)}`
                });
            } finally{
                publish({
                    savingLog: false
                });
            }
        };
        const removing = view.plan?.operation === 'remove';
        const startBlocked = view.plan?.blocked || (busy ? '请等待当前操作完成' : !removing && !view.selected.length && !view.plan?.items.some((item)=>item.action === 'reuse') ? '请选择至少一个可安装或更新的组件' : '');
        const previewBlocked = busy ? '请等待当前操作完成' : view.catalogWorking ? '正在检查远端目录' : detail?.blocked || (catalog?.stale ? '请先刷新远端目录' : '');
        const packTitle = (entry)=>entry.source ? h('a', {
                href: entry.source,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: '查看原仓库'
            }, h('span', null, entry.name), marketIcon('source')) : entry.name;
        const packIdentity = (entry)=>h('div', {
                className: 'mojobox-pack-byline'
            }, entry.submitter ? h('a', {
                href: `https://github.com/${entry.submitter.login}`,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: '首次投稿者'
            }, h('span', {
                className: 'mojobox-avatar',
                'aria-hidden': true
            }, entry.submitter.login[0].toUpperCase(), h('img', {
                src: `https://avatars.githubusercontent.com/u/${entry.submitter.userId}?s=32`,
                alt: '',
                loading: 'lazy',
                referrerPolicy: 'no-referrer',
                onError: (event)=>{
                    event.currentTarget.hidden = true;
                }
            })), entry.submitter.login) : h('span', null, '投稿者未记录'), h('span', null, `· v${entry.version}`));
        const packStats = (entry)=>h('div', {
                className: 'mojobox-pack-stats'
            }, h('span', {
                title: 'GitHub Release 附件累计下载次数，含重复下载与自动校验'
            }, marketIcon('download'), `下载 ${formatCount(entry.downloadsAll)}`), h('span', {
                title: '热度按近 7 日下载次数计算；数据不足时不记为零'
            }, marketIcon('heat'), `热度 ${formatCount(entry.downloads7d)}`), (entry.statisticsStale || catalog?.stale && entry.statisticsAt) && h('span', {
                title: entry.statisticsAt ? `统计时间 ${new Date(entry.statisticsAt).toLocaleString()}` : '暂无统计时间'
            }, '统计待刷新'));
        const chooseAll = (checked)=>publish({
                selected: checked ? view.plan?.items.filter((item)=>[
                        'install',
                        'update'
                    ].includes(item.action)).map((item)=>item.ref) ?? [] : []
            });
        const filteredComponents = (view.snapshot?.components ?? []).filter((component)=>`${component.name} ${component.description ?? ''} ${component.packs.join(' ')}`.toLowerCase().includes(componentQuery.trim().toLowerCase())).sort((a, b)=>a.name.localeCompare(b.name));
        const protectedComponent = (component)=>!!component.toggleReason && !!component.deleteReason;
        const renderComponent = (component)=>{
            const rows = (component.rows ?? []).flatMap((row)=>(view.snapshot?.runtime ?? []).filter((entry)=>row.entryId ? entry.entryId === row.entryId : entry.moduleName === row.moduleName));
            const active = rows.some((row)=>row.enabled && row.fiberPhase === 'active');
            const failed = !!component.error || rows.some((row)=>row.enabled && row.fiberPhase === 'failed');
            const blocked = busy || !!view.connectionError;
            const pending = view.componentPending === component.name;
            const confirming = deleteConfirm?.name === component.name;
            return h('article', {
                key: component.name,
                className: 'mojobox-component',
                'aria-label': component.name,
                'aria-busy': pending
            }, h('div', null, h('h4', null, component.name), h('p', {
                className: 'mojobox-meta'
            }, component.version ?? '版本待核对')), component.description ? h('details', {
                className: 'mojobox-description'
            }, h('summary', null, h('span', {
                className: 'mojobox-description-text'
            }, component.description), h('span', {
                className: 'mojobox-description-more mojobox-expand'
            }, '展开简介'), h('span', {
                className: 'mojobox-description-more mojobox-collapse'
            }, '收起简介'))) : h('p', {
                className: 'mojobox-description'
            }, '暂无简介'), !!component.packs.length && h('details', {
                className: 'mojobox-source'
            }, h('summary', null, `所属整合包（${component.packs.length}）`), h('p', null, component.packs.join('、'))), (component.toggleReason || component.deleteReason) && h('p', {
                className: 'mojobox-meta'
            }, [
                ...new Set([
                    component.toggleReason,
                    component.deleteReason
                ].filter(Boolean))
            ].join('；')), h('div', {
                className: 'mojobox-component-actions'
            }, h('span', {
                className: 'mojobox-state',
                'data-tone': failed ? 'error' : component.enabled && active ? 'active' : 'neutral'
            }, pending ? '正在处理…' : component.error ? `组件异常：${component.error.code}` : !component.enabled ? '已暂停' : failed ? '加载异常' : active ? '运行中' : '已启用'), h('button', {
                type: 'button',
                role: 'switch',
                className: 'mojobox-switch',
                'aria-checked': component.enabled,
                disabled: blocked || !!component.toggleReason,
                title: component.toggleReason || (component.enabled ? '暂停组件，保留文件与配置' : '启用组件'),
                'aria-label': `${component.enabled ? '暂停' : '启用'} ${component.name}`,
                onClick: ()=>controlComponent(component, component.enabled ? 'pause' : 'enable')
            }, h('span', {
                className: 'mojobox-switch-knob',
                'aria-hidden': true
            })), h('button', {
                style: button,
                className: 'mojobox-danger',
                disabled: blocked || !!component.deleteReason,
                title: component.deleteReason,
                'aria-label': `删除 ${component.name}`,
                onClick: (event)=>{
                    deleteTrigger.current = event.currentTarget;
                    setDeleteConfirm(component);
                }
            }, '删除')), confirming && h('div', {
                role: 'region',
                'aria-label': '删除确认',
                className: 'mojobox-confirm',
                onKeyDown: (event)=>{
                    if (event.key === 'Escape') {
                        setDeleteConfirm(null);
                        deleteTrigger.current?.focus();
                    }
                }
            }, h('h4', {
                ref: deleteTitle,
                tabIndex: -1
            }, `删除 ${deleteConfirm.name}？`), h('p', null, `将从当前客户端卸载 ${deleteConfirm.version ?? ''}。插件私有数据保留；需要时可重新安装。`), !!deleteConfirm.packs.length && h('p', null, `以下整合包会缺少此组件：${deleteConfirm.packs.join('、')}`), h('div', {
                style: {
                    display: 'flex',
                    gap: 8
                }
            }, h('button', {
                style: button,
                disabled: busy,
                onClick: ()=>{
                    setDeleteConfirm(null);
                    deleteTrigger.current?.focus();
                }
            }, '取消'), h('button', {
                style: button,
                className: 'mojobox-danger',
                disabled: busy || !!view.connectionError,
                onClick: ()=>{
                    const component = deleteConfirm;
                    setDeleteConfirm(null);
                    void controlComponent(component, 'delete');
                }
            }, '确认删除'))));
        };
        return h('section', {
            className: 'mojobox',
            'aria-label': 'Mojobox 整合包管理',
            'aria-busy': !!busy
        }, h('style', null, styles), h('div', {
            className: 'mojobox-header'
        }, h('div', {
            className: 'mojobox-heading'
        }, h('h2', null, 'Mojobox'), h('p', {
            className: 'mojobox-meta'
        }, `整合包管理 · 官版 ${view.snapshot?.hostVersion ?? '连接中'}`)), h('button', {
            style: button,
            title: '刷新状态',
            'aria-label': '刷新状态',
            disabled: view.refreshing,
            onClick: refreshManually
        }, refreshIcon(), view.refreshing ? '刷新中…' : '刷新')), h('nav', {
            'aria-label': '整合包视图',
            className: 'mojobox-nav'
        }, ...[
            [
                'import',
                '首页'
            ],
            [
                'catalog',
                '市场'
            ],
            [
                'installed',
                '已安装'
            ],
            [
                'manage',
                '管理'
            ]
        ].map(([id, label])=>h('button', {
                key: id,
                type: 'button',
                style: button,
                'aria-label': label,
                title: id === 'installed' && updates.length ? `${updates.length} 个整合包可更新` : undefined,
                'aria-pressed': view.view === id,
                onClick: ()=>{
                    setDetailId('');
                    setDeleteConfirm(null);
                    publish({
                        view: id
                    });
                    if (id === 'installed' && !busy) void refreshCatalog();
                }
            }, label, id === 'installed' && !!updates.length && h('span', {
                className: 'mojobox-update-count',
                'aria-label': `${updates.length} 个整合包可更新`
            })))), (view.error || view.connectionError || view.pending || view.notice) && h('div', {
            className: 'mojobox-feedback'
        }, view.error && h('p', {
            role: 'alert',
            style: {
                margin: 0
            }
        }, view.error), view.connectionError && h('p', {
            role: 'alert',
            style: {
                margin: 0
            }
        }, `无法读取宿主状态：${view.connectionError}`), (view.pending || view.notice) && h('p', {
            role: 'status',
            'aria-live': 'polite',
            style: {
                margin: 0
            }
        }, view.pending || view.notice), view.savedLogPath && view.notice === '日志已保存' && h('details', {
            style: {
                marginTop: 4,
                fontSize: 12,
                color: 'var(--mb-secondary)'
            }
        }, h('summary', {
            style: {
                cursor: 'pointer'
            }
        }, '查看保存位置'), h('div', {
            style: {
                userSelect: 'text'
            }
        }, view.savedLogPath)), !!view.error && h('button', {
            style: {
                ...button,
                marginTop: 8
            },
            disabled: view.savingLog,
            onClick: ()=>saveLog()
        }, view.savingLog ? '正在保存…' : '保存日志')), view.view === 'catalog' && h('div', null, h('div', {
            className: 'mojobox-toolbar'
        }, h('h3', null, '整合包市场'), h('button', {
            style: button,
            disabled: view.catalogWorking || busy,
            title: '检查远端目录和新版',
            'aria-label': '检查远端目录和新版',
            onClick: refreshCatalog
        }, refreshIcon(), view.catalogWorking ? '检查中…' : '检查更新')), h('nav', {
            className: 'mojobox-categories',
            'aria-label': '资源分类'
        }, ...[
            'function',
            'appearance'
        ].map((category)=>{
            const label = category === 'appearance' ? '外观包' : '功能包';
            const count = (catalog?.entries ?? []).filter((entry)=>(entry.category === 'appearance' ? 'appearance' : 'function') === category).length;
            return h('button', {
                key: category,
                type: 'button',
                'aria-label': label,
                'aria-pressed': catalogCategory === category,
                onClick: ()=>{
                    setDetailId('');
                    setCatalogCategory(category);
                }
            }, `${label} · ${count}`);
        })), h('p', {
            role: 'status',
            style: {
                color: 'var(--mb-secondary)',
                fontSize: 12
            }
        }, `${catalog?.stale ? '缓存快照，需刷新后安装' : catalog ? '已核对远端目录' : '尚无目录'} · 上次成功检查 ${catalog?.checkedAt ? new Date(catalog.checkedAt).toLocaleString() : '暂无'}`), catalog?.error && h('p', {
            role: 'alert',
            style: {
                overflowWrap: 'anywhere'
            }
        }, `目录不可用：${catalog.error}`), h('p', {
            className: 'mojobox-meta',
            role: 'status'
        }, catalog?.metadataLoading ? '正在补充投稿者和下载统计…' : catalog?.metadataError || '下载量为 GitHub 附件下载次数 · 热度为近 7 日下载量'), !marketEntries.length && h('p', {
            className: 'mojobox-empty',
            role: 'status'
        }, `暂无可展示的${catalogCategory === 'appearance' ? '外观包' : '功能包'}；仍可从文件导入`), detail ? h('div', null, h('button', {
            style: button,
            onClick: ()=>setDetailId('')
        }, '返回目录'), h('article', {
            style: card
        }, h('h3', {
            ref: detailTitle,
            tabIndex: -1,
            style: {
                marginTop: 0,
                overflowWrap: 'anywhere'
            }
        }, packTitle(detail), detail.newer ? ' · 有新版' : ''), packIdentity(detail), packStats(detail), h('p', null, detail.description), h('p', {
            style: {
                color: 'var(--mb-secondary)',
                fontSize: 12
            }
        }, `${detail.author} · 内核 ${detail.requires ?? '未声明'} · ${detail.components.length} 个组件 · ${detail.archiveSize.toLocaleString()} B`), detail.installedVersion && h('p', {
            style: {
                fontSize: 12
            }
        }, `本地记录目标 ${detail.installedVersion}`), detail.blocked && h('p', null, detail.blocked), detail.warning && h('p', {
            role: 'note',
            className: 'mojobox-meta'
        }, detail.warning), h('details', null, h('summary', {
            style: {
                cursor: 'pointer'
            }
        }, '包含组件'), ...detail.components.map((plugin)=>h('div', {
                key: plugin.ref,
                style: {
                    fontSize: 12,
                    overflowWrap: 'anywhere',
                    padding: '4px 0'
                }
            }, `${plugin.ref} · ${plugin.version ?? '内置版本'}`))), h('button', {
            style: {
                ...button,
                marginTop: 12
            },
            disabled: !!previewBlocked,
            title: previewBlocked || '下载校验并选择组件',
            'aria-label': `预览 ${detail.name}`,
            onClick: ()=>previewRemote(detail.id, detail.version)
        }, view.working ? '正在准备安装…' : '预览安装'), previewBlocked && h('p', {
            style: {
                fontSize: 12
            }
        }, previewBlocked))) : h('div', {
            ref: packGrid,
            'aria-label': '整合包目录',
            className: 'mojobox-pack-grid'
        }, ...marketEntries.map((entry)=>{
            const blocked = busy ? '请等待当前操作完成' : view.catalogWorking ? '正在检查远端目录' : entry.blocked || (catalog?.stale ? '请先刷新远端目录' : '');
            return h('article', {
                key: entry.id,
                className: 'mojobox-pack'
            }, h('div', {
                className: 'mojobox-pack-header'
            }, h('h4', {
                className: 'mojobox-pack-title'
            }, packTitle(entry)), h('button', {
                type: 'button',
                disabled: !!blocked,
                title: blocked || '下载校验并选择组件',
                'aria-label': `安装 ${entry.name}`,
                onClick: ()=>previewRemote(entry.id, entry.version)
            }, entry.newer ? '更新' : '安装')), packIdentity(entry), packStats(entry), h('p', {
                className: 'mojobox-pack-description'
            }, entry.description), (entry.newer || entry.installedVersion || entry.blocked) && h('span', {
                className: 'mojobox-meta'
            }, entry.blocked || (entry.newer ? '有新版' : `本地目标 ${entry.installedVersion}`)), entry.warning && h('span', {
                className: 'mojobox-meta',
                title: entry.warning
            }, '内核版本待核验'), h('div', {
                className: 'mojobox-pack-footer'
            }, h('span', null, `${entry.components.length} 个组件`), h('button', {
                type: 'button',
                'aria-label': entry.name,
                'data-pack-id': entry.id,
                onClick: ()=>{
                    lastOpened.current = entry.id;
                    setDetailId(entry.id);
                }
            }, '详情')));
        }))), view.view === 'import' && h('div', null, !view.plan && h('div', {
            className: 'mojobox-dropzone',
            role: 'region',
            'aria-label': '拖拽安装整合包',
            'aria-disabled': !!busy,
            onDragOver: (event)=>event.preventDefault(),
            onDrop: (event)=>{
                event.preventDefault();
                if (event.dataTransfer?.files.length !== 1) publish({
                    error: '请每次导入一个整合包'
                });
                else void importFile(event.dataTransfer.files[0]);
            }
        }, h('p', null, '拖入 Mojobox 整合包'), h('button', {
            type: 'button',
            style: button,
            disabled: busy,
            onClick: ()=>fileInput.current?.click()
        }, '选择文件安装'), h('input', {
            ref: fileInput,
            type: 'file',
            tabIndex: -1,
            accept: '.dshpack,.zip',
            disabled: busy,
            'aria-label': '选择 Mojobox 整合包',
            onChange: (event)=>{
                const file = event.target.files?.[0];
                event.target.value = '';
                void importFile(file);
            }
        }), h('p', {
            className: 'mojobox-meta',
            style: {
                margin: '8px 0 0'
            }
        }, '.dshpack / .zip · 最大 2 MiB')), !view.plan && h('p', {
            className: 'mojobox-home-link'
        }, h('a', {
            href: 'https://github.com/lanyun077/EAC-mojobox',
            target: '_blank',
            rel: 'noopener noreferrer'
        }, '访问 Mojobox 主仓库')), view.plan && h('div', {
            style: card
        }, h('div', {
            className: 'mojobox-toolbar'
        }, h('h3', {
            ref: planTitle,
            tabIndex: -1,
            style: {
                scrollMarginTop: 88
            }
        }, `${view.plan.pack.manifest.name} · ${view.plan.pack.manifest.version}`), !removing && h('button', {
            style: button,
            disabled: busy,
            onClick: ()=>publish({
                    plan: null,
                    selected: []
                })
        }, '取消预览')), h('p', null, view.plan.pack.manifest.description ?? '本地导入'), removing && h('div', {
            role: 'note'
        }, h('h4', {
            style: {
                margin: '12px 0 8px'
            }
        }, '移除整合包'), h('p', null, '默认只移除管理记录，保留所有组件。仅勾选你要卸载的插件；它们也可能在导入整合包前就已存在。其他整合包共用的组件会保留。插件私有数据不清理。')), h('p', {
            style: {
                color: 'var(--mb-secondary)'
            }
        }, `${view.plan.source === 'catalog' ? 'Mojobox 远端目录' : '本地导入'} · ${view.plan.pack.manifest.author ?? '作者未声明'} · 内核 ${view.plan.pack.manifest.requires?.dsh ?? '未知'}`), view.plan.blocked && h('p', {
            role: 'alert'
        }, view.plan.blocked), view.plan.warning && h('p', {
            role: 'note'
        }, view.plan.warning), view.plan.items.some((item)=>item.action === 'update') && h('p', {
            role: 'status'
        }, '检测到插件版本过低，是否更新？请勾选要更新的插件，或跳过。'), !removing && h('div', {
            className: 'mojobox-actions'
        }, h('button', {
            style: button,
            disabled: busy,
            onClick: ()=>chooseAll(true)
        }, '全选安装 / 更新项'), h('button', {
            style: button,
            disabled: busy,
            onClick: ()=>chooseAll(false)
        }, '跳过全部')), ...view.plan.items.map((item)=>h('div', {
                key: item.ref,
                style: {
                    borderBottom: '1px solid var(--mb-border)',
                    padding: '12px 0',
                    overflowWrap: 'anywhere'
                }
            }, h('label', null, h('input', {
                type: 'checkbox',
                'aria-label': `选择 ${item.ref}`,
                checked: view.selected.includes(item.ref),
                disabled: busy || !(removing ? [
                    'remove'
                ] : [
                    'install',
                    'update'
                ]).includes(item.action),
                onChange: (event)=>publish({
                        selected: event.target.checked ? [
                            ...view.selected,
                            item.ref
                        ] : view.selected.filter((ref)=>ref !== item.ref)
                    })
            }), ` ${item.ref}`), h('div', null, removing ? `${item.current ?? '未安装'} · ${actionLabels[item.action]}` : `${item.current ?? '未安装'} → ${item.target ?? '未声明'} · ${actionLabels[item.action]}`), h('small', {
                style: {
                    color: 'var(--mb-secondary)'
                }
            }, item.reason), item.warning && h('p', {
                role: 'note',
                className: 'mojobox-meta'
            }, item.warning), !!item.sharedTargets?.length && h('p', {
                style: {
                    fontSize: 12
                }
            }, `共享组件：${item.sharedTargets.map((other)=>`${other.name} 的目标为 ${other.version}`).join('；')}。变更后这些整合包可能与目标不同。`))), h('button', {
            style: {
                ...button,
                marginTop: 16
            },
            disabled: !!startBlocked,
            onClick: start,
            title: startBlocked || '执行所选组件'
        }, view.working ? '正在处理…' : removing ? view.selected.length ? `确认移除并卸载 ${view.selected.length} 个组件` : '仅移除管理记录' : view.selected.length ? `执行所选（${view.selected.length}）` : '核对已安装组件'), removing && h('button', {
            style: {
                ...button,
                marginLeft: 8
            },
            disabled: busy,
            onClick: ()=>publish({
                    plan: null,
                    selected: [],
                    view: 'installed'
                })
        }, '取消移除'), startBlocked && h('p', {
            style: {
                fontSize: 12
            }
        }, startBlocked))), view.view === 'installed' && h('div', {
            ref: statusPanel,
            tabIndex: -1,
            style: {
                scrollMarginTop: 88
            }
        }, h('div', {
            className: 'mojobox-toolbar'
        }, h('h3', null, '已安装整合包'), h('button', {
            style: button,
            disabled: view.catalogWorking || busy,
            onClick: refreshCatalog,
            'aria-label': '检查整合包更新'
        }, refreshIcon(), view.catalogWorking ? '检查中…' : '检查更新')), h('p', {
            className: 'mojobox-meta'
        }, view.catalogWorking ? '正在检查整合包新版…' : catalog?.stale ? '更新信息未核验，请重新检查' : `上次检查 ${catalog?.checkedAt ? new Date(catalog.checkedAt).toLocaleString() : '暂无'}`), !!updates.length && h('div', {
            className: 'mojobox-update',
            role: 'status',
            'aria-label': '整合包更新提醒'
        }, `${updates.length} 个整合包有新版本，可在下方选择更新`), view.submittedTaskId && h('p', {
            role: 'status'
        }, '任务已提交，正在读取进度…'), !view.submittedTaskId && !view.snapshot?.records.length && h('p', null, '尚无通过 Mojobox 管理的整合包'), ...(view.snapshot?.records ?? []).map((task)=>{
            const running = task.status === 'running';
            const removal = task.operation === 'remove';
            const processed = task.items.filter((item)=>![
                    'pending',
                    'running'
                ].includes(item.status)).length;
            const percent = task.items.length ? Math.min(running ? 99 : 100, Math.floor(processed / task.items.length * 100)) : 0;
            const installed = task.items.filter((item)=>item.status === 'installed').length;
            const reused = task.items.filter((item)=>item.status === 'reused').length;
            const failed = task.items.filter((item)=>[
                    'failed',
                    'unconfirmed',
                    'dependency-skipped'
                ].includes(item.status)).length;
            const skipped = task.items.filter((item)=>item.status === 'skipped').length;
            const matched = task.pack.manifest.plugins.filter((item)=>{
                const actual = inventory.bundles.get(item.ref);
                return actual && actual.version === item.version && !actual.error;
            }).length;
            const missing = task.pack.manifest.plugins.filter((item)=>!inventory.bundles.has(item.ref)).length;
            const restarts = task.items.filter((item)=>item.activation === 'restart-required').length;
            const update = !removal && !task.removedAt ? updates.find((entry)=>entry.id === task.pack.manifest.id) : undefined;
            return h('article', {
                key: task.id,
                style: card
            }, h('div', {
                style: {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 16,
                    justifyContent: 'space-between',
                    flexWrap: 'wrap'
                }
            }, h('h3', {
                style: {
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    overflowWrap: 'anywhere'
                }
            }, task.pack.manifest.name), h('span', {
                style: {
                    fontSize: 12,
                    color: 'var(--mb-secondary)'
                }
            }, `目标 ${task.pack.manifest.version}`)), update && h('div', {
                className: 'mojobox-update',
                role: 'status'
            }, h('p', null, `有可用更新：${task.pack.manifest.version} → ${update.version}`), h('button', {
                style: button,
                disabled: !!busy || view.catalogWorking,
                'aria-label': `预览 ${task.pack.manifest.name} 更新`,
                onClick: ()=>previewRemote(update.id, update.version)
            }, `查看更新 ${update.version}`)), h('p', {
                role: 'status',
                'aria-live': 'polite',
                style: {
                    margin: '12px 0 8px'
                }
            }, removal ? task.removedAt ? '已移除管理记录' : running ? `正在移除 · ${percent}%` : '移除未完成，请核对组件结果' : running ? `正在安装 · ${percent}%` : `当前符合目标 ${matched}/${task.pack.manifest.plugins.length}${missing ? ` · 缺少 ${missing} 个组件` : matched < task.pack.manifest.plugins.length ? ' · 存在版本差异或组件异常' : ' · 组件齐全'}`), running && h('div', {
                role: 'progressbar',
                'aria-label': `${task.pack.manifest.name} ${removal ? '移除' : '安装'}进度`,
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': percent,
                'aria-valuetext': `已处理 ${processed}/${task.items.length} 项，按组件计数`,
                style: {
                    height: 8,
                    background: 'var(--mb-subtle)',
                    borderRadius: 4,
                    overflow: 'hidden'
                }
            }, h('div', {
                style: {
                    height: '100%',
                    background: 'var(--mb-accent)',
                    transform: `scaleX(${percent / 100})`,
                    transformOrigin: 'left'
                }
            })), h('p', {
                style: {
                    margin: '8px 0 16px',
                    color: 'var(--mb-secondary)',
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums'
                }
            }, running ? `已处理 ${processed}/${task.items.length} 项 · 按组件计数，下载速度可能影响等待时间` : removal ? `卸载 ${task.items.filter((item)=>item.status === 'removed').length} · 保留 ${task.items.filter((item)=>item.status === 'retained').length} · 异常 ${failed}` : `上次${taskLabels[task.status]} · 安装 ${installed} · 复用 ${reused} · 跳过 ${skipped} · 异常 ${failed}`), !!restarts && !running && h('p', {
                role: 'status'
            }, `${restarts} 个组件需要重启客户端后生效`), !running && h('div', {
                style: {
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap'
                }
            }, !removal && h('button', {
                style: button,
                disabled: busy,
                title: busy ? '请等待当前操作完成' : '检查远端整合包更新并核对组件',
                'aria-label': `核对 ${task.pack.manifest.name} 更新`,
                onClick: ()=>replan(task.id, false)
            }, view.operationRecord === task.id && !view.retrying ? '正在核对…' : '核对更新'), h('button', {
                style: button,
                onClick: ()=>{
                    setComponentQuery('');
                    publish({
                        view: 'manage'
                    });
                }
            }, '管理组件'), task.removedAt && h('button', {
                style: button,
                disabled: busy,
                onClick: ()=>replan(task.id, false)
            }, '重新安装'), !!failed && !removal && h('button', {
                style: button,
                disabled: busy,
                title: busy ? '请等待当前操作完成' : '重新核对失败项，确认后执行',
                onClick: ()=>replan(task.id, true)
            }, view.operationRecord === task.id && view.retrying ? '正在准备重试…' : '重试失败项'), (failed > 0 || task.status !== 'complete') && h('button', {
                style: button,
                disabled: view.savingLog,
                onClick: ()=>saveLog(task)
            }, view.savingLog ? '正在保存…' : '保存日志')), h('details', {
                style: {
                    marginTop: 16
                },
                onToggle: (event)=>setExpandedTasks(event.currentTarget.open ? [
                        ...expandedTasks.filter((id)=>id !== task.id),
                        task.id
                    ] : expandedTasks.filter((id)=>id !== task.id))
            }, h('summary', {
                style: {
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--mb-secondary)'
                }
            }, '组件详情'), expandedTasks.includes(task.id) && h('div', null, ...task.items.map((item)=>{
                const actual = inventory.bundles.get(item.ref);
                const runtime = inventory.runtime.get(item.ref) ?? [];
                const activation = runtime.length && runtime.every((entry)=>!entry.enabled) ? '已停用' : runtime.length && runtime.every((entry)=>!entry.enabled || entry.fiberPhase === 'active') ? '已加载' : '运行状态待核对';
                return h('div', {
                    key: item.ref,
                    style: {
                        padding: '12px 0',
                        borderBottom: '1px solid var(--mb-border)',
                        overflowWrap: 'anywhere'
                    }
                }, h('div', null, `${item.ref} · ${resultLabels[item.status]}`), h('small', null, `实际 ${actual?.version ?? '未确认'} / 目标 ${item.target ?? '未知'} · ${activation}${actual?.version !== item.target ? ' · 与目标不同' : ''}`), h('div', {
                    style: {
                        color: 'var(--mb-secondary)',
                        fontSize: 12
                    }
                }, item.reason));
            })), h('p', {
                style: {
                    fontSize: 12,
                    color: 'var(--mb-secondary)'
                }
            }, '安装结果为历史记录，当前版本来自宿主')));
        })), view.view === 'manage' && h('div', null, h('div', {
            style: {
                display: 'flex',
                alignItems: 'baseline',
                gap: 8
            }
        }, h('h3', {
            style: {
                margin: 0,
                fontSize: 14,
                fontWeight: 500
            }
        }, '组件管理'), h('span', {
            className: 'mojobox-meta'
        }, `${view.snapshot?.components?.length ?? 0} 个组件`)), h('p', {
            className: 'mojobox-meta',
            style: {
                margin: '4px 0 12px'
            }
        }, '开关控制启停，删除前确认影响范围'), h('input', {
            type: 'search',
            className: 'mojobox-search',
            'aria-label': '搜索组件',
            placeholder: '搜索名称或所属整合包',
            value: componentQuery,
            onChange: (event)=>{
                setComponentQuery(event.target.value);
                setDeleteConfirm(null);
            }
        }), view.snapshot?.componentOperation && !view.working && !view.notice && !view.error && h('p', {
            role: 'status',
            className: 'mojobox-meta',
            style: {
                overflowWrap: 'anywhere'
            }
        }, `${view.snapshot.componentOperation.name}：${view.snapshot.componentOperation.message}`), !view.snapshot?.components && h('p', {
            role: 'status',
            className: 'mojobox-empty'
        }, '正在读取组件，请稍候；若持续未显示，请刷新状态'), view.snapshot?.components?.length === 0 && h('p', {
            className: 'mojobox-empty'
        }, '当前没有已安装的组件'), h('div', {
            className: 'mojobox-component-list'
        }, ...filteredComponents.filter((component)=>!protectedComponent(component)).map(renderComponent)), filteredComponents.some(protectedComponent) && h('details', {
            className: 'mojobox-protected',
            open: componentQuery.trim() ? true : undefined
        }, h('summary', null, `受保护组件（${filteredComponents.filter(protectedComponent).length}）`), h('p', {
            className: 'mojobox-meta'
        }, '由宿主或安装来源限制操作，保留在此供核对'), h('div', {
            className: 'mojobox-component-list'
        }, ...filteredComponents.filter(protectedComponent).map(renderComponent))), !!componentQuery.trim() && !!view.snapshot?.components?.length && !filteredComponents.length && h('p', {
            className: 'mojobox-empty'
        }, '未找到匹配组件')), h('details', {
            style: {
                marginTop: 20
            },
            onToggle: (event)=>setDiagnosticsOpen(event.currentTarget.open)
        }, h('summary', {
            style: {
                cursor: 'pointer'
            }
        }, '诊断记录'), diagnosticsOpen && h('button', {
            style: button,
            onClick: async ()=>{
                try {
                    await navigator.clipboard.writeText(report());
                    publish({
                        notice: '诊断已复制'
                    });
                } catch (error) {
                    publish({
                        error: `复制失败，可手动选择下方报告：${String(error)}`
                    });
                }
            }
        }, '复制诊断'), diagnosticsOpen && h('button', {
            style: {
                ...button,
                marginLeft: 8
            },
            disabled: view.savingLog,
            onClick: ()=>saveLog()
        }, view.savingLog ? '正在保存…' : '保存日志'), diagnosticsOpen && h('pre', {
            style: {
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 12,
                maxHeight: 360,
                overflow: 'auto'
            }
        }, report())));
    }
    function AccessSection({ useRemoteAccess }) {
        return useRemoteAccess('pluginManager/installBundle') ? h(Section) : h('p', {
            role: 'status'
        }, '当前连接没有整合包管理权限，请使用本机客户端。');
    }
    ctx.slots.inject('settings.section', ()=>ctx.slots.register({
            name: 'settings.section',
            id: 'mojobox-manager',
            order: 80,
            label: ()=>'Mojobox'
        }, AccessSection));
}
exports.apply = apply;
exports.inject = [
    'slots'
];

return exports;}});
