use crate::{
    achievements,
    files::{self, canonical, managed, text},
    model::*,
    process,
    social,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::Write,
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const CATALOG: &str = include_str!("../../resources/catalog.json");
const CLI_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub struct Engine {
    pub(crate) root: PathBuf,
    pub(crate) session: Arc<Mutex<social::Session>>,
}

impl Engine {
    pub fn open() -> Result<Self> {
        let root = match std::env::var_os("EAC_LAUNCHER_HOME") {
            Some(value) if !value.is_empty() => PathBuf::from(value),
            Some(_) => return Err("EAC_LAUNCHER_HOME cannot be empty".into()),
            None => dirs::data_local_dir()
                .ok_or("Cannot find OS application data directory")?
                .join("EACLauncher"),
        };
        Self::at(root)
    }

    pub fn at(root: impl AsRef<Path>) -> Result<Self> {
        fs::create_dir_all(root.as_ref()).map_err(|e| e.to_string())?;
        let root = canonical(root.as_ref())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        for dir in [
            "instances",
            "kernels",
            "backups",
            "trash",
            "cache",
            "locks",
            "logs",
        ] {
            let target = managed(&root, &root.join(dir))?;
            fs::create_dir_all(target).map_err(|e| e.to_string())?;
        }
        let engine = Self {
            root,
            session: Arc::new(Mutex::new(social::Session::default())),
        };
        engine.state(|_| Ok(()))?;
        // trash 只是回滚缓冲；启动时轮换一次，避免长期占用磁盘。
        let _ = engine.prune_trash();
        // 启动次数是真实事件：每次引擎进程打开只记录一次。
        let _ = engine.achievement_event("open", None);
        Ok(engine)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn path(&self, relative: impl AsRef<Path>) -> Result<PathBuf> {
        managed(&self.root, &self.root.join(relative))
    }

    pub(crate) fn state<T>(&self, f: impl FnOnce(&mut State) -> Result<T>) -> Result<T> {
        let _lock = files::lock(&self.path("locks/state.lock")?, true)?;
        let path = self.path("state.json")?;
        let mut state: State = if path.exists() {
            files::read_json(&path)?
        } else {
            State::default()
        };
        for instance in &state.instances {
            files::valid_id(&instance.id)?;
            let expected = self.path(format!("instances/{}/home", instance.id))?;
            if managed(&self.root, Path::new(&instance.home))? != expected {
                return Err(format!("Invalid persisted instance home: {}", instance.id));
            }
        }
        let result = f(&mut state)?;
        files::atomic_json(&path, &state)?;
        Ok(result)
    }

    pub(crate) fn operation_lock(&self, key: &str) -> Result<File> {
        if key.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        {
            return Err("Invalid operation key".into());
        }
        files::lock(&self.path(format!("locks/{key}.lock"))?, false)
    }

    fn instance_lock(&self, id: &str) -> Result<File> {
        files::valid_id(id)?;
        self.operation_lock(&format!("instance-{id}"))
    }

    fn instance(&self, id: &str) -> Result<Instance> {
        files::valid_id(id)?;
        self.state(|state| {
            state
                .instances
                .iter()
                .find(|i| i.id == id)
                .cloned()
                .ok_or_else(|| "Instance not found".into())
        })
    }

    fn kernel(&self, id: &str) -> Result<Kernel> {
        files::valid_id(id)?;
        self.state(|state| {
            state
                .kernels
                .iter()
                .find(|k| k.id == id)
                .cloned()
                .ok_or_else(|| "Kernel not found".into())
        })
    }

    fn stopped(&self, id: &str) -> Result<Instance> {
        let instance = self.instance(id)?;
        let active =
            self.state(|state| Ok(state.processes.get(id).is_some_and(process::tree_alive)))?;
        if active || matches!(instance.status.as_str(), "starting" | "running") {
            return Err("Stop the instance before changing its files or configuration".into());
        }
        Ok(instance)
    }

    pub fn call(&self, action: &str, payload: Value) -> Result<Value> {
        if !payload.is_object() {
            return Err("Payload must be a JSON object".into());
        }
        let tracked = matches!(
            action,
            "install_kernel"
                | "launch_instance"
                | "stop_instance"
                | "install_plugin"
                | "remove_plugin"
                | "toggle_plugin"
                | "clone_instance"
                | "snapshot_instance"
                | "restore_instance"
                | "import_instance"
                | "install_desktop"
                | "install_update"
                | "probe_plugins"
                | "download_asset"
        );
        let task = if tracked {
            let id = new_id();
            self.state(|state| {
                if state.tasks.len() >= 100 {
                    state.tasks.retain(|t| t.status == "running");
                }
                state.tasks.push(Task {
                    id: id.clone(),
                    label: action.replace('_', " "),
                    status: "running".into(),
                    progress: None,
                    message: "Operation started".into(),
                    timestamp: now(),
                });
                Ok(())
            })?;
            Some(id)
        } else {
            None
        };
        let result = self
            .dispatch(action, &payload)
            .map_err(|error| redact_diagnostics(&error));
        if let Some(id) = task {
            self.state(|state| {
                if let Some(task) = state.tasks.iter_mut().find(|task| task.id == id) {
                    task.status = if result.is_ok() {
                        "completed"
                    } else {
                        "failed"
                    }
                    .into();
                    task.progress = if result.is_ok() { Some(1.0) } else { None };
                    task.message = match &result {
                        Ok(_) => "Operation completed".into(),
                        Err(error) => error.clone(),
                    };
                    task.timestamp = now();
                }
                Ok(())
            })?;
        }
        match result {
            Ok(value) if tracked && value.get("instances").is_some() => {
                if let Some(id) = value.get("createdInstanceId").and_then(Value::as_str) {
                    self.created_snapshot(id)
                } else {
                    self.snapshot()
                }
            }
            other => other,
        }
    }

    fn dispatch(&self, action: &str, payload: &Value) -> Result<Value> {
        match action {
            "snapshot" => self.snapshot(),
            "catalog" => serde_json::from_str(CATALOG).map_err(|e| e.to_string()),
            "create_instance" => self.create_instance(payload),
            "update_instance" => self.update_instance(payload),
            "clone_instance" => self.clone_instance(payload),
            "delete_instance" => self.delete_instance(required(payload, "id")?),
            "register_kernel" => self.register_kernel(Path::new(required(payload, "directory")?)),
            "install_kernel" => self.install_kernel(required(payload, "version")?),
            "remove_kernel" => self.remove_kernel(required(payload, "id")?),
            "launch_instance" => self.launch(required(payload, "id")?),
            "stop_instance" => self.stop(required(payload, "id")?),
            "instance_logs" => {
                let instance = self.instance(required(payload, "id")?)?;
                Ok(
                    json!({"text": redact_diagnostics(&process::tail(&self.log(&instance.id)?, 1024 * 1024)?)}),
                )
            }
            "install_plugin" => self.plugin(payload, true),
            "remove_plugin" => self.plugin(payload, false),
            "toggle_plugin" => self.toggle_plugin(payload),
            "snapshot_instance" => {
                let id = required(payload, "id")?;
                let _guard = self.instance_lock(id)?;
                let instance = self.stopped(id)?;
                self.backup_kind(&instance, BackupKind::Manual)?;
                let _ = self.achievement_event("backup_created", None);
                self.snapshot()
            }
            "restore_instance" => self.restore(payload),
            "list_backups" => self.backups(required(payload, "id")?),
            "export_instance" => self.export(payload),
            "import_instance" => self.import(payload),
            "save_settings" => self.settings(payload),
            "open_path" => self.open_path(required(payload, "path")?),
            "open_url" => self.open_url(required(payload, "url")?),
            "kernel_versions" => self.kernel_versions(),
            "discover_local" => self.discover_local(),
            "releases" => self.releases(required(payload, "source")?),
            "download_asset" => self.download_action(payload),
            "install_update" => self.install_update(payload),
            "install_desktop" => self.install_desktop(payload),
            "probe_plugins" => self.probe_plugins(payload),
            "github_status" => self.github_status(),
            "github_refresh" => self.github_refresh(),
            "github_logout" => self.github_logout(),
            "github_login_start" => self.github_login_start(),
            "github_login_poll" => self.github_login_poll(),
            "github_login_token" => self.github_login_token(payload),
            "github_star" => self.github_star(payload),
            "github_starred" => self.github_starred(),
            "market_like" => self.market_like(payload),
            "market_download" => self.market_download(payload),
            "market_stats" => self.market_stats(),
            "achievements" => self.achievements_view(),
            "record_event" => self.record_achievement_event(payload),
            "usage_profile" => self.usage_profile(
                payload
                    .get("refresh")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
            _ => Err(format!("Unknown launcher action: {action}")),
        }
    }

    pub fn snapshot(&self) -> Result<Value> {
        let (mut instances, kernels, tasks, settings, achievements, client_configured) =
            self.state(|state| {
                for instance in &mut state.instances {
                    if let Some(record) = state.processes.get(&instance.id) {
                        if !process::alive(record) {
                            instance.status = "error".into();
                            instance.pid = None;
                            instance.url = None;
                        }
                    } else if matches!(instance.status.as_str(), "starting" | "running") {
                        instance.status = "error".into();
                        instance.pid = None;
                        instance.url = None;
                    }
                }
                let client_configured = social::client_id_preconfigured()
                    || !state.settings.github_client_id.trim().is_empty();
                Ok((
                    state.instances.clone(),
                    state.kernels.clone(),
                    state.tasks.clone(),
                    state.settings.clone(),
                    achievements::summary(&state.achievements),
                    client_configured,
                ))
            })?;
        for instance in &mut instances {
            match self.read_plugins(instance) {
                Ok(plugins) => {
                    instance.plugins = plugins;
                    instance.inventory_error = None;
                }
                Err(error) => {
                    instance.plugins.clear();
                    instance.inventory_error = Some(error);
                }
            }
        }
        Ok(json!({
            "root": text(&self.root),
            "platform": std::env::consts::OS,
            "instances": instances,
            "kernels": kernels,
            "tasks": tasks,
            "settings": settings,
            "social": self.social_summary(client_configured),
            "achievements": achievements
        }))
    }

    fn create_instance(&self, payload: &Value) -> Result<Value> {
        let id = self.create_instance_record(payload)?;
        self.created_snapshot(&id)
    }

    fn created_snapshot(&self, id: &str) -> Result<Value> {
        let mut snapshot = self.snapshot()?;
        snapshot["createdInstanceId"] = json!(id);
        Ok(snapshot)
    }

    fn create_instance_record(&self, payload: &Value) -> Result<String> {
        let name = required(payload, "name")?;
        files::valid_name(name)?;
        let kind = required(payload, "kind")?;
        valid_kind(kind)?;
        let kernel_id = optional(payload, "kernelId")?;
        if kind == "harness" && kernel_id.is_none() {
            return Err("A harness instance needs an explicitly selected installed kernel".into());
        }
        // Serialize reference changes with kernel removal, but never hold this during npm work.
        let _references = self.operation_lock("kernel-references")?;
        if let Some(id) = kernel_id {
            self.kernel(id)?;
        }
        let executable = optional(payload, "executable")?
            .map(validate_executable)
            .transpose()?;
        let id = new_id();
        let port = self.port(payload.get("port"), None)?;
        let base = self.path(format!("instances/{id}"))?;
        let home = base.join("home");
        let workspace = match optional(payload, "workspace")? {
            Some(path) => validate_workspace(path)?,
            None => base.join("workspace"),
        };
        fs::create_dir_all(&home).map_err(|e| e.to_string())?;
        fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let instance = Instance {
            id,
            name: name.into(),
            kind: kind.into(),
            kernel_id: kernel_id.map(str::to_owned),
            port,
            home: text(&home),
            workspace: text(&workspace),
            plugins: Vec::new(),
            inventory_error: None,
            created_at: now(),
            status: "stopped".into(),
            pid: None,
            url: None,
            executable,
        };
        let allocated_id = instance.id.clone();
        self.state(|state| {
            if state.instances.iter().any(|i| i.port == port) {
                return Err("Port is already assigned to another instance".into());
            }
            state.instances.push(instance);
            Ok(())
        })?;
        let _ = self.achievement_event("instance_created", None);
        Ok(allocated_id)
    }

    fn port(&self, requested: Option<&Value>, except: Option<&str>) -> Result<u16> {
        let assigned = self.state(|state| {
            Ok(state
                .instances
                .iter()
                .filter(|i| Some(i.id.as_str()) != except)
                .map(|i| i.port)
                .collect::<BTreeSet<_>>())
        })?;
        if let Some(value) = requested.filter(|v| !v.is_null()) {
            let port = value
                .as_u64()
                .filter(|p| (1024..=65535).contains(p))
                .ok_or("Port must be an integer from 1024 through 65535")?
                as u16;
            if assigned.contains(&port) {
                return Err("Port is already assigned to another instance".into());
            }
            return Ok(port);
        }
        for _ in 0..100 {
            let listener =
                TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            if !assigned.contains(&port) {
                return Ok(port);
            }
        }
        Err("Cannot allocate an unused instance port".into())
    }

    fn update_instance(&self, payload: &Value) -> Result<Value> {
        let id = required(payload, "id")?;
        let _guard = self.instance_lock(id)?;
        let mut instance = self.stopped(id)?;
        let _references = self.operation_lock("kernel-references")?;
        if let Some(name) = optional(payload, "name")? {
            files::valid_name(name)?;
            instance.name = name.into();
        }
        if let Some(kernel_id) = optional(payload, "kernelId")? {
            let kernel = self.kernel(kernel_id)?;
            if instance.kernel_id.as_deref() != Some(kernel_id) {
                self.backup(&instance)?;
            }
            self.preflight(&instance, &kernel)?;
            instance.kernel_id = Some(kernel_id.into());
        }
        if let Some(workspace) = optional(payload, "workspace")? {
            instance.workspace = text(&validate_workspace(workspace)?);
        }
        if payload.get("port").is_some() {
            instance.port = self.port(payload.get("port"), Some(id))?;
        }
        if let Some(executable) = optional(payload, "executable")? {
            instance.executable = Some(validate_executable(executable)?);
        }
        self.state(|state| {
            if state
                .instances
                .iter()
                .any(|i| i.id != id && i.port == instance.port)
            {
                return Err("Port is already assigned".into());
            }
            *state
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("Instance not found")? = instance;
            Ok(())
        })?;
        self.snapshot()
    }

    fn clone_instance(&self, payload: &Value) -> Result<Value> {
        let id = required(payload, "id")?;
        let name = required(payload, "name")?;
        files::valid_name(name)?;
        let _guard = self.instance_lock(id)?;
        let source = self.stopped(id)?;
        let _references = self.operation_lock("kernel-references")?;
        let new_id = new_id();
        let base = self.path(format!("instances/{new_id}"))?;
        let home = base.join("home");
        let old_default = self.path(format!("instances/{id}/workspace"))?;
        let uses_default = old_default.exists()
            && canonical(Path::new(&source.workspace))? == canonical(&old_default)?;
        files::copy_tree(Path::new(&source.home), &home)?;
        let workspace = if uses_default {
            let dest = base.join("workspace");
            files::copy_tree(Path::new(&source.workspace), &dest)?;
            text(&dest)
        } else {
            source.workspace.clone()
        };
        let port = self.port(None, None)?;
        let instance = Instance {
            id: new_id,
            name: name.into(),
            home: text(&home),
            workspace,
            port,
            created_at: now(),
            status: "stopped".into(),
            pid: None,
            url: None,
            ..source
        };
        let allocated_id = instance.id.clone();
        self.state(|state| {
            if state.instances.iter().any(|i| i.port == port) {
                return Err(
                    "Port allocation raced another create; cloned data was retained".into(),
                );
            }
            state.instances.push(instance);
            Ok(())
        })?;
        self.created_snapshot(&allocated_id)
    }

    fn delete_instance(&self, id: &str) -> Result<Value> {
        let _guard = self.instance_lock(id)?;
        self.stopped(id)?;
        let source = self.path(format!("instances/{id}"))?;
        let destination = self.path(format!("trash/instance-{id}-{}", new_id()))?;
        fs::rename(&source, &destination).map_err(|e| e.to_string())?;
        if let Err(error) = self.state(|state| {
            state.instances.retain(|i| i.id != id);
            state.processes.remove(id);
            Ok(())
        }) {
            let rollback = fs::rename(&destination, &source);
            return Err(format!("{error}; deletion rollback: {rollback:?}"));
        }
        // 实例已删除，它的备份不会再被任何 UI 引用；留在磁盘上只会成为无法清理的孤儿数据。
        if let Ok(backups) = self.path(format!("backups/{id}")) {
            let _ = fs::remove_dir_all(&backups);
        }
        let _ = self.prune_trash();
        self.snapshot()
    }

    // trash 只是回滚缓冲：限制条目总数与保留天数，避免长期运行后无限增长。
    fn prune_trash(&self) -> Result<()> {
        const KEEP: usize = 20;
        const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
        let root = self.path("trash")?;
        let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            entries.push((entry.path(), modified));
        }
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        let now = std::time::SystemTime::now();
        for (index, (path, modified)) in entries.into_iter().enumerate() {
            let expired = now.duration_since(modified).is_ok_and(|age| age > MAX_AGE);
            if index >= KEEP || expired {
                let _ = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
            }
        }
        Ok(())
    }

    // 扫描本机常见安装位置，列出可注册的 @deepseek-ai/dsh 内核目录与
    // 可用作桌面端实例的可执行文件。只做轻量检查（清单名/版本/bin 存在），
    // 完整校验仍由 register_kernel 在注册时执行——这里不运行任何命令。
    fn discover_local(&self) -> Result<Value> {
        // 注册表里的路径来自 fs::canonicalize（Windows 带 \\?\ 前缀），归一化后比较。
        let normalize = |value: &str| files::external(Path::new(value)).to_string_lossy().replace('\\', "/");
        let registered: Vec<String> = self.state(|state| {
            Ok(state.kernels.iter().map(|k| normalize(&k.path)).collect())
        })?;
        let mut roots: Vec<(String, PathBuf, usize)> = Vec::new();
        roots.push(("启动器内核目录".into(), self.root.join("kernels"), 1));
        if let Some(home) = dirs::home_dir() {
            for name in [".dsh", ".deepseek", ".deepseek-ai"] {
                roots.push((format!("~/{name}"), home.join(name), 2));
            }
        }
        if let Some(data) = dirs::data_dir() {
            roots.push(("npm 全局包".into(), data.join("npm/node_modules"), 2));
        }
        if let Some(data_local) = dirs::data_local_dir() {
            roots.push(("本机程序目录".into(), data_local.join("Programs"), 2));
        }
        #[cfg(not(windows))]
        roots.push(("npm 全局包".into(), PathBuf::from("/usr/lib/node_modules"), 2));
        if let Ok(custom) = std::env::var("DSH_HOME") {
            roots.push(("DSH_HOME".into(), PathBuf::from(custom), 2));
        }
        let mut kernels: Vec<Value> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        'roots: for (label, root, depth) in roots {
            let Ok(top) = fs::read_dir(&root) else { continue };
            for entry in top.flatten() {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                for probe in std::iter::once(dir.clone()).chain(
                    (depth > 1).then(|| ()).into_iter().flat_map(|_| {
                        fs::read_dir(&dir).into_iter().flatten().filter_map(|e| e.ok().map(|e| e.path()))
                    }),
                ) {
                    if let Some(mut candidate) = self.kernel_candidate(&probe, &label) {
                        let directory = candidate["directory"].as_str().unwrap_or_default().to_string();
                        if seen.insert(directory.clone()) {
                            candidate["alreadyRegistered"] = json!(registered.iter().any(|p| normalize(p) == directory));
                            kernels.push(candidate);
                            if kernels.len() >= 40 {
                                break 'roots;
                            }
                        }
                    }
                }
            }
        }
        kernels.sort_by(|a, b| b["valid"].as_bool().cmp(&a["valid"].as_bool()).then_with(|| a["version"].as_str().cmp(&b["version"].as_str())));
        // 本机已有 DSH 工作区（实例 home 的特征是 profiles/web 目录）：
        // 可在新建实例时直接绑定，不复制、不改动。
        let mut workspaces: Vec<Value> = Vec::new();
        {
            let mut ws_roots: Vec<(String, PathBuf)> = Vec::new();
            if let Some(home) = dirs::home_dir() {
                for name in [".dsh", ".deepseek", ".deepseek-ai"] {
                    ws_roots.push((format!("~/{name}"), home.join(name)));
                }
            }
            if let Ok(custom) = std::env::var("DSH_HOME") {
                ws_roots.push(("DSH_HOME".into(), PathBuf::from(custom)));
            }
            let own_root = self.root.canonicalize().unwrap_or_else(|_| self.root.clone());
            let bound: Vec<String> = self.state(|state| {
                Ok(state
                    .instances
                    .iter()
                    .filter(|i| !i.workspace.is_empty())
                    .map(|i| files::external(Path::new(&i.workspace)).to_string_lossy().replace('\\', "/"))
                    .collect())
            })?;
            let mut seen_ws = std::collections::HashSet::new();
            'ws: for (label, root) in ws_roots {
                let children = fs::read_dir(&root).into_iter().flatten().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir());
                for dir in std::iter::once(root.clone()).chain(children) {
                    if !dir.join("profiles/web").is_dir() {
                        continue;
                    }
                    let Ok(canonical_dir) = canonical(&dir) else { continue };
                    if canonical_dir.starts_with(&own_root) {
                        continue; // 启动器自管的实例目录，不重复收录
                    }
                    let path = files::external(&canonical_dir).to_string_lossy().replace('\\', "/");
                    if !seen_ws.insert(path.clone()) {
                        continue;
                    }
                    let plugin_count = files::read_json::<Value>(&canonical_dir.join("profiles/web/package.json"))
                        .ok()
                        .and_then(|m| m.get("dependencies").and_then(Value::as_object).map(|o| o.len()))
                        .unwrap_or(0);
                    workspaces.push(json!({
                        "path": path,
                        "name": canonical_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "workspace".into()),
                        "pluginCount": plugin_count,
                        "bound": bound.iter().any(|b| *b == path),
                        "foundIn": label,
                    }));
                    if workspaces.len() >= 20 {
                        break 'ws;
                    }
                }
            }
        }
        let mut desktops: Vec<Value> = Vec::new();
        if let Some(data_local) = dirs::data_local_dir() {
            let programs = data_local.join("Programs");
            let Ok(top) = fs::read_dir(&programs) else {
                return Ok(json!({ "kernels": kernels, "workspaces": workspaces, "desktops": desktops }));
            };
            for entry in top.flatten() {
                let Ok(exes) = fs::read_dir(entry.path()) else { continue };
                for exe in exes.flatten() {
                    let path = exe.path();
                    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
                    if !name.to_ascii_lowercase().ends_with(".exe") {
                        continue;
                    }
                    let lowered = name.to_ascii_lowercase();
                    let matched = ["deepseek", "harness", "eac", "dsh"].iter().any(|word| lowered.contains(word));
                    let big = exe.metadata().map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false);
                    if matched && big {
                        desktops.push(json!({
                            "name": name.trim_end_matches(".exe"),
                            "path": path.to_string_lossy(),
                        }));
                        if desktops.len() >= 20 {
                            break;
                        }
                    }
                }
                if desktops.len() >= 20 {
                    break;
                }
            }
        }
        Ok(json!({ "kernels": kernels, "workspaces": workspaces, "desktops": desktops }))
    }

    // 候选目录：本身就是包目录，或是 node_modules/@deepseek-ai/dsh 的父目录。
    fn kernel_candidate(&self, dir: &Path, label: &str) -> Option<Value> {
        for package in [dir.to_path_buf(), dir.join("node_modules/@deepseek-ai/dsh"), dir.join("@deepseek-ai/dsh")] {
            let Ok(manifest) = files::read_json::<Value>(&package.join("package.json")) else { continue };
            if manifest["name"] != "@deepseek-ai/dsh" {
                continue;
            }
            let version = manifest["version"].as_str().unwrap_or("unknown");
            let bin = manifest
                .get("bin")
                .and_then(|bin| bin.as_str().or_else(|| bin.get("dsh").and_then(Value::as_str)))
                .unwrap_or_default();
            let cli = package.join(bin);
            let cli_exists = !bin.is_empty() && cli.is_file();
            let directory = canonical(&package)
                .map(|p| files::external(&p).to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| package.to_string_lossy().replace('\\', "/"));
            return Some(json!({
                "directory": directory,
                "version": version,
                "cliExists": cli_exists,
                "valid": manifest["version"].as_str().is_some() && cli_exists,
                "foundIn": label,
            }));
        }
        None
    }

    // 兼容性探针：把每个插件引用真实安装到目标内核的临时隔离 home，
    // 再用官方内核自带的 evaluatePluginCompatibility 评估结果。
    // 结论只有两种：安装/预检的真实失败信息，或官方评估器给出的兼容问题；绝不猜测。
    fn probe_plugins(&self, payload: &Value) -> Result<Value> {
        let _guard = self.operation_lock("kernel-probe")?;
        let kernel = self.kernel(required(payload, "kernelId")?)?;
        verify_kernel(&kernel)?;
        let refs = payload
            .get("refs")
            .and_then(Value::as_array)
            .ok_or("refs must be an array of plugin references")?;
        if refs.is_empty() || refs.len() > 12 {
            return Err("Provide between 1 and 12 plugin references per probe".into());
        }
        let mut references = Vec::new();
        for value in refs {
            let reference = value.as_str().ok_or("Each ref must be a string")?.trim();
            valid_plugin_ref(reference)?;
            self.check_catalog_block(reference)?;
            if !references.iter().any(|item: &String| item == reference) {
                references.push(reference.to_string());
            }
        }
        let probe_home = self.path(format!("cache/probe-{}", new_id()))?;
        let profile = probe_home.join("profiles/web");
        fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let probe_instance_id = "probe".to_string();
        let workspace = validate_workspace(&dirs::home_dir().map_or_else(|| ".".to_string(), |h| h.to_string_lossy().to_string()))?;
        let mut results: Vec<Value> = Vec::new();
        for reference in &references {
            let mut command = process::command(files::external(Path::new(&kernel.node_path)));
            command.arg(files::external(Path::new(&kernel.cli_path)));
            command
                .args(["plugin", "--profile", "web", "add", reference])
                .env("DSH_HOME", files::external(&probe_home))
                .env("DSH_EAC_DATA_ROOT", files::external(&probe_home.join("eac-desktop")))
                .env("DSH_DESKTOP_USER_DATA_DIR", files::external(&probe_home.join("desktop-user-data")))
                .env("EAC_LAUNCHER_INSTANCE_ID", &probe_instance_id)
                .env("npm_config_store_dir", files::external(&probe_home.join(".pnpm-store")))
                .env("npm_config_cache", files::external(&probe_home.join(".npm-cache")))
                .env("npm_config_package_import_method", "copy")
                .env("npm_config_virtual_store_dir", "node_modules/.pnpm")
                .env_remove("NODE_PATH")
                .env_remove("NODE_OPTIONS")
                .current_dir(files::external(&workspace));
            add_node_path(
                &mut command,
                files::external(Path::new(&kernel.node_path)).as_path(),
                Some(files::external(Path::new(&kernel.path)).as_path()),
            )?;
            let entry = match self.capture(&mut command, Duration::from_secs(240)) {
                Ok(_) => {
                    // 安装成功 → 用官方评估器对刚装好的清单做兼容性评估。
                    let manifests = self.probe_manifests(&profile)?;
                    let mut entry = json!({ "ref": reference, "installOk": true });
                    if manifests.is_empty() {
                        entry["compatible"] = json!(null);
                        entry["note"] = json!("安装成功，但清单中没有可评估的插件依赖");
                    } else {
                        let evaluation = self.probe_evaluate(&kernel, &profile, &manifests, &probe_home, &workspace)?;
                        let issues: Vec<Value> = evaluation
                            .iter()
                            .filter(|item| !item["issue"].is_null())
                            .cloned()
                            .collect();
                        let unknown: Vec<Value> = evaluation
                            .iter()
                            .filter(|item| item["issue"].is_null() && item["known"] != true)
                            .cloned()
                            .collect();
                        entry["compatible"] = json!(issues.is_empty());
                        entry["issues"] = json!(issues);
                        entry["unknown"] = json!(unknown);
                    }
                    entry
                }
                Err(error) => json!({
                    "ref": reference,
                    "installOk": false,
                    "compatible": false,
                    "error": redact_diagnostics(&error.to_string()),
                }),
            };
            results.push(entry);
        }
        let cleanup = fs::remove_dir_all(&probe_home);
        Ok(json!({
            "kernel": { "id": kernel.id, "version": kernel.version },
            "results": results,
            "cleanup": cleanup.is_ok(),
        }))
    }

    // 读取探针 profile 的插件清单（复用 preflight 的读取语义）。
    fn probe_manifests(&self, profile: &Path) -> Result<Vec<Value>> {
        let manifest_path = managed(&self.root, &profile.join("package.json"))?;
        if !manifest_path.exists() {
            return Ok(Vec::new());
        }
        let manifest: Value = files::read_json(&manifest_path)?;
        let mut manifests = Vec::new();
        for field in ["dependencies", "devDependencies", "optionalDependencies"] {
            if let Some(deps) = manifest.get(field).and_then(Value::as_object) {
                for name in deps.keys() {
                    valid_package_name(name)?;
                    let metadata_path = managed(&self.root, &profile.join("node_modules").join(name).join("package.json"))?;
                    if metadata_path.exists() {
                        manifests.push(files::read_json::<Value>(&metadata_path)?);
                    }
                }
            }
        }
        Ok(manifests)
    }

    // 官方评估器：与 preflight 完全相同的脚本与参数，仅作用于探针目录。
    fn probe_evaluate(&self, kernel: &Kernel, profile: &Path, manifests: &[Value], home: &Path, workspace: &Path) -> Result<Vec<Value>> {
        let script = r#"
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [anchor, version, raw, profile] = process.argv.slice(1);
const require = createRequire(pathToFileURL(anchor));
const {evaluatePluginCompatibility, readProfileCompatibility} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')));
const exemptions = typeof readProfileCompatibility === 'function' ? readProfileCompatibility(profile).exemptions : {};
const manifests = JSON.parse(raw);
const results = manifests.map(m => ({
  name: m.name,
  known: Object.keys(m.peerDependencies ?? {}).some(k => k === '@deepseek-ai/dsh' || k.startsWith('@deepseek-ai/dsh-')),
  issue: evaluatePluginCompatibility(m, exemptions, version) ?? null
}));
console.log(JSON.stringify(results));
"#;
        let mut command = process::command(files::external(Path::new(&kernel.node_path)));
        command
            .args(["--input-type=module", "--eval", script])
            .arg(files::external(&Path::new(&kernel.path).join("package.json")))
            .arg(&kernel.version)
            .arg(serde_json::to_string(manifests).map_err(|e| e.to_string())?)
            .arg(files::external(profile))
            .env("DSH_HOME", files::external(home))
            .env("DSH_EAC_DATA_ROOT", files::external(&home.join("eac-desktop")))
            .env("DSH_DESKTOP_USER_DATA_DIR", files::external(&home.join("desktop-user-data")))
            .env("npm_config_store_dir", files::external(&home.join(".pnpm-store")))
            .env("npm_config_cache", files::external(&home.join(".npm-cache")))
            .env_remove("NODE_PATH")
            .env_remove("NODE_OPTIONS")
            .current_dir(files::external(workspace));
        add_node_path(
            &mut command,
            files::external(Path::new(&kernel.node_path)).as_path(),
            Some(files::external(Path::new(&kernel.path)).as_path()),
        )?;
        let output = self.capture(&mut command, Duration::from_secs(60))?;
        serde_json::from_str(output.trim())
            .map_err(|error| format!("Official compatibility evaluator failed: {error}"))
    }

    fn register_kernel(&self, directory: &Path) -> Result<Value> {
        let _guard = self.operation_lock("kernel-references")?;
        let kernel = self.inspect_kernel(directory, "registered-local")?;
        self.state(|state| {
            if state.kernels.iter().any(|k| k.path == kernel.path) {
                return Err("That kernel directory is already registered".into());
            }
            state.kernels.push(kernel);
            Ok(())
        })?;
        let _ = self.achievement_event("kernel_added", None);
        self.snapshot()
    }

    pub(crate) fn inspect_kernel(&self, directory: &Path, source: &str) -> Result<Kernel> {
        let directory = canonical(directory)?;
        let candidates = [
            directory.clone(),
            directory.join("node_modules/@deepseek-ai/dsh"),
            directory.join("@deepseek-ai/dsh"),
        ];
        let package = candidates
            .into_iter()
            .find(|dir| {
                files::read_json::<Value>(&dir.join("package.json"))
                    .is_ok_and(|v| v["name"] == "@deepseek-ai/dsh")
            })
            .ok_or("Directory contains no actual @deepseek-ai/dsh package")?;
        let package = canonical(&package)?;
        let manifest: Value = files::read_json(&package.join("package.json"))?;
        let version = required(&manifest, "version")?;
        exact_version(version)?;
        let bin = manifest
            .get("bin")
            .and_then(|bin| bin.as_str().or_else(|| bin.get("dsh")?.as_str()))
            .ok_or("DSH package has no dsh bin")?;
        let cli = managed(&package, &package.join(bin))?;
        if !cli.is_file() {
            return Err("DSH CLI bin does not exist".into());
        }
        let node = discover_node()?;
        let output = self.capture(
            process::command(files::external(&node))
                .arg(files::external(&cli))
                .arg("--version"),
            Duration::from_secs(30),
        )?;
        if output.trim() != version {
            return Err(format!(
                "Kernel manifest is {version}, but CLI --version returned {:?}",
                output.trim()
            ));
        }
        Ok(Kernel {
            id: new_id(),
            version: version.into(),
            path: text(&package),
            node_path: text(&node),
            cli_path: text(&cli),
            installed_at: now(),
            source: source.into(),
            fingerprint: Some(kernel_fingerprint(&package, &cli)?),
        })
    }

    fn install_kernel(&self, version: &str) -> Result<Value> {
        exact_version(version)?;
        let _guard = self.operation_lock(&format!("kernel-{version}"))?;
        let present = self.state(|state| {
            Ok(state
                .kernels
                .iter()
                .any(|k| k.version == version && k.source == "npm"))
        })?;
        if present {
            return Err("This exact npm kernel version is already installed".into());
        }
        let node = discover_node()?;
        let npm = discover_npm(&node)?;
        let base = self.path(format!("kernels/{version}"))?;
        if base.exists() {
            return Err("Version directory already exists; it will never be overwritten".into());
        }
        let staging = self.path(format!("kernels/.staging-{}", new_id()))?;
        fs::create_dir(&staging).map_err(|e| e.to_string())?;
        files::atomic_json(
            &staging.join("package.json"),
            &json!({"name":"eac-isolated-kernel","version":"1.0.0","private":true}),
        )?;
        let log = self.path(format!("logs/kernel-{}.log", new_id()))?;
        let mut command = process::command(&node);
        command
            .arg(files::external(&npm))
            .args(["install", "--save-exact", "--no-audit", "--no-fund"])
            .arg("--registry=https://registry.npmjs.org")
            .arg(format!("@deepseek-ai/dsh@{version}"))
            .current_dir(files::external(&staging))
            .env("DSH_HOME", files::external(&staging.join(".install-home")))
            .env(
                "npm_config_cache",
                files::external(&self.path("cache/npm")?),
            );
        add_node_path(&mut command, &node, None)?;
        if let Err(error) = process::run(command, &log, CLI_TIMEOUT) {
            let retained = self.retain_failed(&staging, "kernel")?;
            return Err(format!(
                "{error}; failed install retained at {}",
                retained.display()
            ));
        }
        let checked = self.inspect_kernel(&staging, "npm");
        if !checked
            .as_ref()
            .is_ok_and(|kernel| kernel.version == version)
        {
            let retained = self.retain_failed(&staging, "kernel")?;
            return Err(format!(
                "Installed kernel validation failed: {}; retained at {}",
                checked
                    .err()
                    .unwrap_or_else(|| "npm returned a different version".into()),
                retained.display()
            ));
        }
        let _references = self.operation_lock("kernel-references")?;
        fs::rename(&staging, &base).map_err(|e| e.to_string())?;
        let kernel = self.inspect_kernel(&base, "npm")?;
        self.state(|state| {
            state.kernels.push(kernel);
            Ok(())
        })?;
        let _ = self.achievement_event("kernel_added", None);
        self.snapshot()
    }

    fn remove_kernel(&self, id: &str) -> Result<Value> {
        let _guard = self.operation_lock("kernel-references")?;
        let kernel = self.kernel(id)?;
        let backup_root = self.path("backups")?;
        for instance_dir in fs::read_dir(backup_root).map_err(|e| e.to_string())? {
            let instance_dir = instance_dir.map_err(|e| e.to_string())?;
            if !instance_dir
                .file_type()
                .map_err(|e| e.to_string())?
                .is_dir()
            {
                continue;
            }
            for backup in fs::read_dir(instance_dir.path()).map_err(|e| e.to_string())? {
                let manifest = backup
                    .map_err(|e| e.to_string())?
                    .path()
                    .join("manifest.json");
                if manifest.exists() {
                    let manifest: BackupManifest =
                        files::read_json(&managed(&self.root, &manifest)?)?;
                    if manifest.kernel_id.as_deref() == Some(id) {
                        return Err("A recovery backup still references this core; keep it installed to preserve rollback".into());
                    }
                }
            }
        }
        self.state(|state| {
            if state
                .instances
                .iter()
                .any(|i| i.kernel_id.as_deref() == Some(id))
            {
                return Err("Kernel is referenced by an instance".into());
            }
            // Removal unregisters local kernels; launcher-owned npm files remain recoverable.
            state.kernels.retain(|k| k.id != kernel.id);
            Ok(())
        })?;
        self.snapshot()
    }

    fn log(&self, id: &str) -> Result<PathBuf> {
        files::valid_id(id)?;
        self.path(format!("instances/{id}/launcher.log"))
    }

    fn append_log(&self, id: &str, message: &str) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log(id)?)
            .map_err(|e| e.to_string())?;
        writeln!(file, "\n[{}] {message}", now()).map_err(|e| e.to_string())
    }

    fn dsh_command(&self, instance: &Instance, kernel: &Kernel) -> Result<Command> {
        verify_kernel(kernel)?;
        let home = self.path(format!("instances/{}/home", instance.id))?;
        let mut command = process::command(files::external(Path::new(&kernel.node_path)));
        command.arg(files::external(Path::new(&kernel.cli_path)));
        self.isolate_command(&mut command, instance, &home, Some(kernel))?;
        Ok(command)
    }

    fn isolate_command(
        &self,
        command: &mut Command,
        instance: &Instance,
        home: &Path,
        kernel: Option<&Kernel>,
    ) -> Result<()> {
        command
            .env("DSH_HOME", files::external(home))
            .env(
                "DSH_EAC_DATA_ROOT",
                files::external(&home.join("eac-desktop")),
            )
            .env(
                "DSH_DESKTOP_USER_DATA_DIR",
                files::external(&home.join("desktop-user-data")),
            )
            .env("EAC_LAUNCHER_INSTANCE_ID", &instance.id)
            .env(
                "npm_config_store_dir",
                files::external(&home.join(".pnpm-store")),
            )
            .env(
                "npm_config_cache",
                files::external(&home.join(".npm-cache")),
            )
            .env("npm_config_package_import_method", "copy")
            .env("npm_config_virtual_store_dir", "node_modules/.pnpm")
            .env_remove("NODE_PATH")
            .env_remove("NODE_OPTIONS")
            .current_dir(files::external(&validate_workspace(&instance.workspace)?));
        if instance.kind != "harness" {
            let roaming = home.join("native-settings/roaming");
            let local = home.join("native-settings/local");
            fs::create_dir_all(&roaming).map_err(|e| e.to_string())?;
            fs::create_dir_all(&local).map_err(|e| e.to_string())?;
            command
                .env("APPDATA", files::external(&roaming))
                .env("LOCALAPPDATA", files::external(&local))
                .env("XDG_CONFIG_HOME", files::external(&roaming));
        }
        if let Some(kernel) = kernel {
            add_node_path(
                command,
                files::external(Path::new(&kernel.node_path)).as_path(),
                Some(files::external(Path::new(&kernel.path)).as_path()),
            )?;
        }
        Ok(())
    }

    fn launch(&self, id: &str) -> Result<Value> {
        let _guard = self.instance_lock(id)?;
        self.snapshot()?;
        let instance = self.stopped(id)?;
        let mut command;
        if instance.kind == "harness" {
            let kernel = self.kernel(
                instance
                    .kernel_id
                    .as_deref()
                    .ok_or("Instance has no kernel")?,
            )?;
            self.preflight(&instance, &kernel)?;
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, instance.port))
                .map_err(|e| format!("Assigned port {} is unavailable: {e}", instance.port))?;
            drop(listener);
            command = self.dsh_command(&instance, &kernel)?;
            command.args([
                "--profile",
                "web",
                "--host",
                "127.0.0.1",
                "--no-open",
                "--port",
                &instance.port.to_string(),
            ]);
        } else {
            let other_native = self.state(|state| {
                Ok(state.instances.iter().any(|other| {
                    other.id != id
                        && other.kind == instance.kind
                        && state
                            .processes
                            .get(&other.id)
                            .is_some_and(process::tree_alive)
                }))
            })?;
            if other_native {
                return Err("This native desktop enforces a shared application identity. Stop its other desktop instance first, or use isolated Harness instances for parallel work.".into());
            }
            let executable = validate_executable(instance.executable.as_deref().ok_or(
                "Register an installed desktop executable first; installers are download only",
            )?)?;
            command = process::command(files::external(Path::new(&executable)));
            self.isolate_command(&mut command, &instance, Path::new(&instance.home), None)?;
            command.arg(format!(
                "--user-data-dir={}",
                files::external(&Path::new(&instance.home).join("desktop-user-data")).display()
            ));
        }
        self.append_log(id, "Starting owned instance process")?;
        let (mut child, record) = process::spawn(command, &self.log(id)?)?;
        let saved = self.state(|state| {
            let item = state
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("Instance not found")?;
            item.status = "starting".into();
            item.pid = Some(record.pid);
            item.url = None;
            state.processes.insert(id.into(), record.clone());
            Ok(())
        });
        if let Err(error) = saved {
            let cleanup = process::stop(&record);
            return Err(format!("{error}; process cleanup: {cleanup:?}"));
        }
        let readiness = self.wait_ready(&instance, &record, &mut child);
        if let Err(error) = &readiness {
            let cleanup = process::stop(&record);
            self.state(|state| {
                let item = state
                    .instances
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or("Instance not found")?;
                item.status = "error".into();
                item.pid = if process::tree_alive(&record) {
                    Some(record.pid)
                } else {
                    None
                };
                item.url = None;
                if !process::tree_alive(&record) {
                    state.processes.remove(id);
                }
                Ok(())
            })?;
            return Err(format!(
                "{error}; process cleanup: {}; log:\n{}",
                cleanup.err().unwrap_or_else(|| "completed".into()),
                process::tail(&self.log(id)?, 24 * 1024)?
            ));
        }
        self.state(|state| {
            let item = state
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("Instance not found")?;
            item.status = "running".into();
            item.url = readiness.as_ref().ok().and_then(Clone::clone);
            Ok(())
        })?;
        let running = self.state(|state| {
            Ok(state
                .instances
                .iter()
                .filter(|item| item.status == "running")
                .count())
        })?;
        let _ = self.achievement_event("instance_launched", Some(&running.to_string()));
        self.snapshot()
    }

    fn wait_ready(
        &self,
        instance: &Instance,
        record: &OwnedProcess,
        child: &mut std::process::Child,
    ) -> Result<Option<String>> {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!("Instance exited during startup: {status}"));
            }
            if !process::tree_alive(record) {
                return Err("Instance process identity was lost".into());
            }
            if instance.kind != "harness" {
                if process::desktop_window_ready(record) {
                    return Ok(None);
                }
            }
            if let Some(url) = self.web_ready_url(instance)? {
                let accepted = client.get(&url).send().is_ok_and(|response| {
                    if response.status().is_success() {
                        return true;
                    }
                    if response.status() != reqwest::StatusCode::SEE_OTHER {
                        return false;
                    }
                    let Some(location) = response
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|v| v.to_str().ok())
                    else {
                        return false;
                    };
                    let Ok(base) = url::Url::parse(&url) else {
                        return false;
                    };
                    let Ok(target) = base.join(location) else {
                        return false;
                    };
                    if target.origin() != base.origin() {
                        return false;
                    }
                    let cookies = response
                        .headers()
                        .get_all(reqwest::header::SET_COOKIE)
                        .iter()
                        .filter_map(|v| v.to_str().ok())
                        .filter_map(|v| v.split(';').next())
                        .collect::<Vec<_>>()
                        .join("; ");
                    if cookies.is_empty() {
                        return false;
                    }
                    client
                        .get(target)
                        .header(reqwest::header::COOKIE, cookies)
                        .send()
                        .is_ok_and(|page| page.status().is_success())
                });
                if accepted && process::tree_alive(record) {
                    return Ok(Some(url));
                }
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "No successful HTTP readiness response on port {} within 90 seconds",
                    instance.port
                ));
            }
            thread::sleep(Duration::from_millis(250));
        }
    }

    fn web_ready_url(&self, instance: &Instance) -> Result<Option<String>> {
        let log = process::tail(&self.log(&instance.id)?, 64 * 1024)?;
        let current = log
            .rsplit("Starting owned instance process")
            .next()
            .unwrap_or("");
        for line in current.lines().rev() {
            let Some(raw) = line.trim().strip_prefix("dsh web: ") else {
                continue;
            };
            let url =
                url::Url::parse(raw).map_err(|e| format!("DSH printed an invalid web URL: {e}"))?;
            if url.scheme() != "http"
                || url.host_str() != Some("127.0.0.1")
                || url.port() != Some(instance.port)
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_none()
                || url.fragment().is_some()
            {
                return Err("DSH printed an unexpected web URL; startup was not trusted".into());
            }
            return Ok(Some(url.to_string()));
        }
        Ok(None)
    }

    fn stop(&self, id: &str) -> Result<Value> {
        let _guard = self.instance_lock(id)?;
        self.instance(id)?;
        let record = self.state(|state| Ok(state.processes.get(id).cloned()))?;
        if let Some(record) = &record {
            process::stop(record)?;
        }
        self.state(|state| {
            let instance = state
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("Instance not found")?;
            instance.status = "stopped".into();
            instance.pid = None;
            instance.url = None;
            state.processes.remove(id);
            Ok(())
        })?;
        self.snapshot()
    }

    fn read_plugins(&self, instance: &Instance) -> Result<Vec<Plugin>> {
        let profile = self.path(format!("instances/{}/home/profiles/web", instance.id))?;
        let manifest_path = managed(&self.root, &profile.join("package.json"))?;
        if !manifest_path.exists() {
            return Ok(Vec::new());
        }
        let manifest: Value = files::read_json(&manifest_path)?;
        let bundles = manifest
            .pointer("/dsh/profile/bundles")
            .and_then(Value::as_array);
        let mut plugins = Vec::new();
        for field in ["dependencies", "devDependencies", "optionalDependencies"] {
            if let Some(dependencies) = manifest.get(field).and_then(Value::as_object) {
                for (name, source) in dependencies {
                    valid_package_name(name)?;
                    let package = managed(&profile, &profile.join("node_modules").join(name))?;
                    let metadata_path = managed(&profile, &package.join("package.json"))?;
                    let metadata = if metadata_path.exists() {
                        files::read_json::<Value>(&metadata_path)?
                    } else {
                        Value::Null
                    };
                    plugins.push(Plugin {
                        id: name.clone(),
                        name: name.clone(),
                        // No invented installed version for an interrupted dependency install.
                        version: metadata["version"].as_str().unwrap_or("unknown").into(),
                        enabled: bundles
                            .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(name))),
                        source: source
                            .as_str()
                            .ok_or("Invalid dependency reference")?
                            .into(),
                        core_range: metadata
                            .pointer("/peerDependencies/@deepseek-ai~1dsh")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    });
                }
            }
        }
        plugins.sort_by(|a, b| a.name.cmp(&b.name));
        plugins.dedup_by(|a, b| a.name == b.name);
        Ok(plugins)
    }

    fn preflight(&self, instance: &Instance, kernel: &Kernel) -> Result<()> {
        verify_kernel(kernel)?;
        let plugins = self.read_plugins(instance)?;
        if plugins.is_empty() {
            return Ok(());
        }
        let profile = self.path(format!("instances/{}/home/profiles/web", instance.id))?;
        let mut manifests = Vec::new();
        for plugin in plugins {
            if !plugin.enabled {
                continue;
            }
            let path = managed(
                &profile,
                &profile
                    .join("node_modules")
                    .join(&plugin.name)
                    .join("package.json"),
            )?;
            if path.exists() {
                manifests.push(files::read_json::<Value>(&path)?);
            }
        }
        let script = r#"
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [anchor, version, raw, profile] = process.argv.slice(1);
const require = createRequire(pathToFileURL(anchor));
const {evaluatePluginCompatibility, readProfileCompatibility} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')));
const exemptions = typeof readProfileCompatibility === 'function' ? readProfileCompatibility(profile).exemptions : {};
const manifests = JSON.parse(raw);
const results = manifests.map(m => ({
  name: m.name,
  known: Object.keys(m.peerDependencies ?? {}).some(k => k === '@deepseek-ai/dsh' || k.startsWith('@deepseek-ai/dsh-')),
  issue: evaluatePluginCompatibility(m, exemptions, version) ?? null
}));
console.log(JSON.stringify(results));
"#;
        let mut command = process::command(files::external(Path::new(&kernel.node_path)));
        command
            .args(["--input-type=module", "--eval", script])
            .arg(files::external(
                &Path::new(&kernel.path).join("package.json"),
            ))
            .arg(&kernel.version)
            .arg(serde_json::to_string(&manifests).map_err(|e| e.to_string())?)
            .arg(files::external(&profile));
        self.isolate_command(
            &mut command,
            instance,
            Path::new(&instance.home),
            Some(kernel),
        )?;
        let output = self.capture(&mut command, Duration::from_secs(30))?;
        let results: Vec<Value> = serde_json::from_str(output.trim())
            .map_err(|e| format!("Official compatibility evaluator failed: {e}"))?;
        let incompatible: Vec<_> = results.iter().filter(|r| !r["issue"].is_null()).collect();
        if !incompatible.is_empty() {
            return Err(format!(
                "Official DSH compatibility preflight rejected kernel {}: {}",
                kernel.version,
                json!(incompatible)
            ));
        }
        let unknown: Vec<_> = results
            .iter()
            .filter(|r| r["known"] != true)
            .map(|r| &r["name"])
            .collect();
        if !unknown.is_empty() {
            self.append_log(
                &instance.id,
                &format!(
                    "Compatibility unknown (no DSH peer range): {}",
                    json!(unknown)
                ),
            )?;
        }
        Ok(())
    }

    fn plugin(&self, payload: &Value, install: bool) -> Result<Value> {
        let id = required(payload, "instanceId")?;
        let _guard = self.instance_lock(id)?;
        let instance = self.stopped(id)?;
        if instance.kind != "harness" {
            return Err("Official web-profile plugin operations require a harness instance".into());
        }
        let kernel = self.kernel(instance.kernel_id.as_deref().ok_or("No selected kernel")?)?;
        let backup = self.backup(&instance)?;
        let mut installed_key: Option<String> = None;
        let result: Result<()> = (|| {
            let mut command = self.dsh_command(&instance, &kernel)?;
            command.args(["plugin", "--profile", "web"]);
            if install {
                let reference = required(payload, "ref")?;
                valid_plugin_ref(reference)?;
                self.check_catalog_block(reference)?;
                installed_key = Some(achievement_plugin_key(reference));
                let expected = optional(payload, "expectedSha256")?;
                let reference = if let Some(hash) = expected {
                    if !reference.starts_with("https://") {
                        return Err("expectedSha256 requires an HTTPS tarball; a registry/git ref has no stable archive bytes".into());
                    }
                    let file = self.download(reference, "plugin.tgz", Some(hash))?;
                    format!(
                        "file:{}",
                        files::external(Path::new(required(&file, "path")?))
                            .to_string_lossy()
                            .replace('\\', "/")
                    )
                } else {
                    reference.into()
                };
                command.arg("add").arg(reference);
            } else {
                let name = required(payload, "name")?;
                valid_package_name(name)?;
                if !self.read_plugins(&instance)?.iter().any(|p| p.name == name) {
                    return Err("Plugin is not installed in this instance".into());
                }
                command.arg("remove").arg(name);
            }
            self.append_log(
                id,
                if install {
                    "Official CLI plugin add"
                } else {
                    "Official CLI plugin remove"
                },
            )?;
            process::run(command, &self.log(id)?, CLI_TIMEOUT)?;
            self.preflight(&instance, &kernel)?;
            Ok(())
        })();
        if let Err(error) = result {
            let rollback = self.restore_home(&instance, &backup);
            self.state(|state| {
                if let Some(item) = state.instances.iter_mut().find(|i| i.id == id) {
                    if rollback.is_err() {
                        item.status = "error".into();
                    }
                }
                Ok(())
            })?;
            return Err(format!(
                "{error}; profile rollback: {}; recovery backup: {}",
                rollback
                    .err()
                    .unwrap_or_else(|| "completed from full file backup".into()),
                backup.path
            ));
        }
        if let Some(key) = installed_key {
            if let Err(error) = self.achievement_event("plugin_installed", Some(&key)) {
                let _ = self.append_log(id, &format!("Achievement update failed: {error}"));
            }
        }
        self.snapshot()
    }

    fn check_catalog_block(&self, reference: &str) -> Result<()> {
        let catalog: Value = serde_json::from_str(CATALOG).map_err(|e| e.to_string())?;
        if let Some(plugins) = catalog["plugins"].as_array() {
            for plugin in plugins {
                if (plugin["ref"].as_str() == Some(reference)
                    || plugin["name"].as_str() == Some(reference))
                    && plugin["installable"] == false
                {
                    return Err(format!(
                        "Catalog blocks installation: {}",
                        plugin["description"]
                    ));
                }
            }
        }
        Ok(())
    }

    fn toggle_plugin(&self, payload: &Value) -> Result<Value> {
        let id = required(payload, "instanceId")?;
        let name = required(payload, "name")?;
        valid_package_name(name)?;
        let enabled = payload
            .get("enabled")
            .and_then(Value::as_bool)
            .ok_or("enabled must be boolean")?;
        let _guard = self.instance_lock(id)?;
        let instance = self.stopped(id)?;
        if instance.kind != "harness" {
            return Err("Manage native desktop plugins from their own application".into());
        }
        if !self
            .read_plugins(&instance)?
            .iter()
            .any(|plugin| plugin.name == name)
        {
            return Err("Plugin is not installed in this instance".into());
        }
        let kernel = self.kernel(instance.kernel_id.as_deref().ok_or("No selected kernel")?)?;
        verify_kernel(&kernel)?;
        let backup = self.backup(&instance)?;
        let script = r#"
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [anchor, profileDir, name, enabled] = process.argv.slice(1);
const require = createRequire(pathToFileURL(anchor));
const { readProfilePlugins, writeProfileBundles } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')));
const inventory = readProfilePlugins({binName:'eac-launcher', profileDir, installAnchor:anchor});
if (!inventory.dependencies.some(plugin => plugin.name === name && plugin.bundle)) throw new Error('This package declares no switchable plugin bundle');
const bundles = (inventory.manifest.dsh?.profile?.bundles ?? []).filter(item => item !== name);
if (enabled === 'true') bundles.push(name);
writeProfileBundles(profileDir, inventory.manifest, bundles);
"#;
        let mut command = process::command(files::external(Path::new(&kernel.node_path)));
        command
            .args(["--input-type=module", "--eval", script])
            .arg(files::external(
                &Path::new(&kernel.path).join("package.json"),
            ))
            .arg(files::external(
                &Path::new(&instance.home).join("profiles/web"),
            ))
            .arg(name)
            .arg(enabled.to_string());
        self.isolate_command(
            &mut command,
            &instance,
            Path::new(&instance.home),
            Some(&kernel),
        )?;
        let result = process::run(command, &self.log(id)?, Duration::from_secs(60))
            .and_then(|_| self.preflight(&instance, &kernel));
        if let Err(error) = result {
            let rollback = self.restore_home(&instance, &backup);
            return Err(format!(
                "{error}; profile rollback: {}",
                rollback.err().unwrap_or_else(|| "completed".into())
            ));
        }
        self.snapshot()
    }

    fn backup(&self, instance: &Instance) -> Result<Backup> {
        self.backup_kind(instance, BackupKind::Automatic)
    }

    // 备份是完整 home 副本，必须限流：自动安全点只保留最近几份，用户手动备份
    // 保留更多。轮换在写入成功后执行，失败时不影响本次备份的可用性。
    fn backup_kind(&self, instance: &Instance, kind: BackupKind) -> Result<Backup> {
        let id = new_id();
        let base = self.path(format!("backups/{}/{id}", instance.id))?;
        files::copy_tree(Path::new(&instance.home), &base.join("home"))?;
        let created_at = now();
        files::atomic_json(
            &base.join("manifest.json"),
            &BackupManifest {
                schema_version: 1,
                instance_id: instance.id.clone(),
                kernel_id: instance.kernel_id.clone(),
                created_at: created_at.clone(),
                kind,
            },
        )?;
        let _ = self.prune_backups(&instance.id, kind);
        Ok(Backup {
            id,
            created_at,
            path: text(&base),
            kind,
        })
    }

    // 每类备份的保留数量。自动安全点在每次插件操作前都会产生，是磁盘增长的主因。
    fn backup_keep(kind: BackupKind) -> usize {
        match kind {
            BackupKind::Automatic => 3,
            BackupKind::Manual => 10,
        }
    }

    fn prune_backups(&self, id: &str, kind: BackupKind) -> Result<()> {
        let keep = Self::backup_keep(kind);
        let mut same_kind: Vec<(String, String)> = self
            .backup_entries(id)?
            .into_iter()
            .filter(|(_, manifest)| manifest.kind == kind)
            .map(|(backup_id, manifest)| (backup_id, manifest.created_at))
            .collect();
        same_kind.sort_by(|a, b| b.1.cmp(&a.1));
        for (backup_id, _) in same_kind.into_iter().skip(keep) {
            let path = self.path(format!("backups/{id}/{backup_id}"))?;
            let _ = fs::remove_dir_all(&path);
        }
        Ok(())
    }

    // 读取实例全部完整备份（跳过中断的复制：没有 manifest 的目录）。
    fn backup_entries(&self, id: &str) -> Result<Vec<(String, BackupManifest)>> {
        let base = self.path(format!("backups/{id}"))?;
        let mut entries = Vec::new();
        if !base.exists() {
            return Ok(entries);
        }
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let backup_id = entry.file_name().to_string_lossy().into_owned();
            if files::valid_id(&backup_id).is_err() {
                continue;
            }
            let path = managed(&base, &entry.path())?;
            let manifest_path = managed(&base, &path.join("manifest.json"))?;
            if !manifest_path.is_file() {
                continue;
            }
            let manifest: BackupManifest = files::read_json(&manifest_path)?;
            if manifest.schema_version != 1 || manifest.instance_id != id {
                return Err("Backup manifest does not belong to this instance".into());
            }
            entries.push((backup_id, manifest));
        }
        entries.sort_by(|a, b| b.1.created_at.cmp(&a.1.created_at));
        Ok(entries)
    }

    fn backups(&self, id: &str) -> Result<Value> {
        self.instance(id)?;
        let mut backups = Vec::new();
        for (backup_id, manifest) in self.backup_entries(id)? {
            backups.push(Backup {
                id: backup_id.clone(),
                created_at: manifest.created_at,
                path: text(&self.path(format!("backups/{id}/{backup_id}"))?),
                kind: manifest.kind,
            });
        }
        Ok(json!({"backups": backups}))
    }

    fn restore(&self, payload: &Value) -> Result<Value> {
        let id = required(payload, "id")?;
        let backup_id = required(payload, "backupId")?;
        files::valid_id(backup_id)?;
        let _guard = self.instance_lock(id)?;
        let instance = self.stopped(id)?;
        let path = self.path(format!("backups/{id}/{backup_id}"))?;
        let manifest: BackupManifest = files::read_json(&self.path(path.join("manifest.json"))?)?;
        if manifest.schema_version != 1 || manifest.instance_id != id {
            return Err("Backup ownership or schema version mismatch".into());
        }
        let _references = self.operation_lock("kernel-references")?;
        if let Some(kernel_id) = &manifest.kernel_id {
            self.kernel(kernel_id)?;
        }
        // 被替换下来的当前 home 会移入 trash（可回滚），因此不再额外生成一份
        // 完整备份——那样一次恢复会同时占用两份全量磁盘空间。
        self.restore_home(
            &instance,
            &Backup {
                id: backup_id.into(),
                created_at: manifest.created_at,
                path: text(&path),
                kind: manifest.kind,
            },
        )?;
        self.state(|state| {
            let item = state
                .instances
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("Instance not found")?;
            item.kernel_id = manifest.kernel_id;
            item.status = "stopped".into();
            Ok(())
        })?;
        self.snapshot()
    }

    fn restore_home(&self, instance: &Instance, backup: &Backup) -> Result<()> {
        files::valid_id(&backup.id)?;
        let base = self.path(format!("backups/{}/{}", instance.id, backup.id))?;
        if managed(&self.root, Path::new(&backup.path))? != base {
            return Err("Backup path does not match its ID".into());
        }
        let manifest: BackupManifest =
            files::read_json(&managed(&base, &base.join("manifest.json"))?)?;
        if manifest.instance_id != instance.id || manifest.schema_version != 1 {
            return Err("Invalid backup manifest".into());
        }
        let staged = self.path(format!("instances/{}/restore-{}", instance.id, new_id()))?;
        files::copy_tree(&managed(&base, &base.join("home"))?, &staged)?;
        let home = self.path(format!("instances/{}/home", instance.id))?;
        let retained = self.path(format!("trash/pre-restore-{}-{}", instance.id, new_id()))?;
        fs::rename(&home, &retained).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&staged, &home) {
            let rollback = fs::rename(&retained, &home);
            return Err(format!(
                "Restore replacement failed: {error}; rollback: {rollback:?}; retained: {}",
                retained.display()
            ));
        }
        // Links were created for the staging location. Relocate them after the directory move.
        files::rebase_links(&home, &staged)?;
        Ok(())
    }

    fn export(&self, payload: &Value) -> Result<Value> {
        let id = required(payload, "id")?;
        let _guard = self.instance_lock(id)?;
        let instance = self.stopped(id)?;
        let destination = PathBuf::from(required(payload, "destination")?);
        if !destination.is_absolute() || destination.exists() {
            return Err("Export destination must be a new absolute JSON file path".into());
        }
        if !destination.parent().is_some_and(Path::is_dir) {
            return Err("Export parent directory must exist".into());
        }
        let mut plugins = Vec::new();
        for plugin in self.read_plugins(&instance)? {
            exact_version(&plugin.version)
                .map_err(|_| format!("Cannot export unresolved plugin {}", plugin.name))?;
            let registry_source = plugin.source == plugin.version
                || plugin.source == format!("^{}", plugin.version)
                || plugin.source == format!("~{}", plugin.version);
            if !registry_source {
                return Err(format!("{} was installed from an archive, local path or Git source. Export cannot substitute an npm package with the same name. Keep its full backup until its immutable source is available.", plugin.name));
            }
            plugins.push(PortablePlugin {
                r#ref: format!("{}@{}", plugin.name, plugin.version),
            });
        }
        let descriptor = Descriptor {
            schema_version: 1,
            name: instance.name,
            kind: instance.kind,
            kernel_version: instance
                .kernel_id
                .map(|id| self.kernel(&id).map(|k| k.version))
                .transpose()?,
            plugins,
        };
        // Only package identities leave the home: no env, tokens, config, paths or logs.
        files::atomic_json(&destination, &descriptor)?;
        Ok(json!({"path": text(&destination)}))
    }

    fn import(&self, payload: &Value) -> Result<Value> {
        let descriptor: Descriptor = files::read_json(Path::new(required(payload, "path")?))?;
        if descriptor.schema_version != 1 || descriptor.plugins.len() > 256 {
            return Err("Unsupported descriptor version or too many plugins".into());
        }
        files::valid_name(&descriptor.name)?;
        valid_kind(&descriptor.kind)?;
        for plugin in &descriptor.plugins {
            valid_registry_exact(&plugin.r#ref)?;
        }
        let kernel_id = if let Some(version) = &descriptor.kernel_version {
            exact_version(version)?;
            Some(self.state(|state| {
                state
                    .kernels
                    .iter()
                    .find(|k| &k.version == version)
                    .map(|k| k.id.clone())
                    .ok_or_else(|| {
                        format!("Install or register exact kernel {version} before importing")
                    })
            })?)
        } else {
            None
        };
        let id = self.create_instance_record(
            &json!({"name": descriptor.name,"kind":descriptor.kind,"kernelId":kernel_id}),
        )?;
        for plugin in descriptor.plugins {
            if let Err(error) = self.plugin(&json!({"instanceId":id,"ref":plugin.r#ref}), true) {
                return Err(format!("Import partially completed in instance {id}; earlier plugins remain installed. {error}"));
            }
        }
        self.created_snapshot(&id)
    }

    fn settings(&self, payload: &Value) -> Result<Value> {
        let theme = optional(payload, "theme")?;
        if theme.is_some_and(|value| !matches!(value, "system" | "light" | "dark")) {
            return Err("Theme must be system, light or dark".into());
        }
        let reduced = payload
            .get("reducedMotion")
            .map(|v| v.as_bool().ok_or("reducedMotion must be boolean"))
            .transpose()?;
        let client_id = payload
            .get("githubClientId")
            .map(|value| {
                let value = value
                    .as_str()
                    .ok_or("githubClientId must be a string")?
                    .trim();
                if value.is_empty() {
                    return Ok(String::new());
                }
                if value.len() < 6
                    || value.len() > 100
                    || !value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                    })
                {
                    return Err("githubClientId format is invalid".to_string());
                }
                Ok(value.to_string())
            })
            .transpose()?;
        self.state(|state| {
            if let Some(theme) = theme {
                state.settings.theme = theme.into();
            }
            if let Some(reduced) = reduced {
                state.settings.reduced_motion = reduced;
            }
            if let Some(client_id) = &client_id {
                state.settings.github_client_id = client_id.clone();
            }
            Ok(())
        })?;
        self.snapshot()
    }

    fn open_path(&self, path: &str) -> Result<Value> {
        let path = managed(&self.root, Path::new(path))?;
        if !path.exists() {
            return Err("Path does not exist".into());
        }
        open_external(&text(&path))?;
        Ok(json!({"ok":true}))
    }

    fn open_url(&self, raw: &str) -> Result<Value> {
        let url = url::Url::parse(raw).map_err(|e| e.to_string())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || raw.chars().any(char::is_control)
        {
            return Err("Only HTTP(S) URLs without embedded credentials may be opened".into());
        }
        open_external(url.as_str())?;
        Ok(json!({"ok":true}))
    }

    pub(crate) fn capture(&self, command: &mut Command, timeout: Duration) -> Result<String> {
        // Keep output in a file: inherited pipes from descendants cannot hang the caller.
        let file =
            tempfile::NamedTempFile::new_in(self.path("logs")?).map_err(|e| e.to_string())?;
        let log = file.path().to_owned();
        // Move out a prepared command without shell reconstruction.
        let mut owned = process::command(command.get_program());
        owned.args(command.get_args());
        if let Some(cwd) = command.get_current_dir() {
            owned.current_dir(cwd);
        }
        for (key, value) in command.get_envs() {
            if let Some(value) = value {
                owned.env(key, value);
            } else {
                owned.env_remove(key);
            }
        }
        process::run(owned, &log, timeout)?;
        process::tail(&log, 4 * 1024 * 1024)
    }

    pub(crate) fn retain_failed(&self, path: &Path, label: &str) -> Result<PathBuf> {
        let path = managed(&self.root, path)?;
        let destination = self.path(format!("trash/failed-{label}-{}", new_id()))?;
        fs::rename(&path, &destination).map_err(|e| {
            format!(
                "Failed work retained at {} (move to trash failed: {e})",
                path.display()
            )
        })?;
        Ok(destination)
    }
}

pub(crate) fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("{key} must be a nonempty string"))
}

pub(crate) fn optional<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value)),
        _ => Err(format!("{key} must be a nonempty string")),
    }
}

pub(crate) fn exact_version(version: &str) -> Result<()> {
    let parsed = semver::Version::parse(version)
        .map_err(|_| "An exact npm semver is required (no tags, ranges or prefixes)".to_string())?;
    if parsed.to_string() != version || version.len() > 100 {
        return Err("Version must use canonical exact semver".into());
    }
    Ok(())
}

fn kernel_fingerprint(package: &Path, cli: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for file in [package.join("package.json"), cli.to_path_buf()] {
        hash.update(fs::read(&file).map_err(|e| format!("Read core identity: {e}"))?);
    }
    for ancestor in package.ancestors().take(5) {
        for name in ["package-lock.json", "pnpm-lock.yaml"] {
            let lockfile = ancestor.join(name);
            if lockfile.is_file() {
                hash.update(fs::read(&lockfile).map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn redact_diagnostics(text: &str) -> String {
    static TOKENS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    TOKENS
        .get_or_init(|| {
            regex::Regex::new(r"(?i)(token=|bearer\s+)[A-Za-z0-9._~+/-]+")
                .expect("static token pattern")
        })
        .replace_all(text, "${1}[REDACTED]")
        .into_owned()
}

fn verify_kernel(kernel: &Kernel) -> Result<()> {
    let package = Path::new(&kernel.path);
    let manifest: Value = files::read_json(&package.join("package.json"))?;
    if manifest["name"] != "@deepseek-ai/dsh" || manifest["version"] != kernel.version {
        return Err("The registered core changed on disk. Register its new version separately; existing bindings were not upgraded.".into());
    }
    if let Some(expected) = &kernel.fingerprint {
        let actual = kernel_fingerprint(package, Path::new(&kernel.cli_path))?;
        if &actual != expected {
            return Err("Core CLI or dependency lockfile changed after registration. Re-register the runtime instead of silently changing this instance.".into());
        }
    }
    Ok(())
}

fn valid_kind(kind: &str) -> Result<()> {
    if matches!(kind, "harness" | "eac-desktop" | "official-desktop") {
        Ok(())
    } else {
        Err("Invalid instance kind".into())
    }
}

fn validate_workspace(path: &str) -> Result<PathBuf> {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("Workspace must be an existing absolute directory".into());
    }
    canonical(path)
}

fn validate_executable(path: &str) -> Result<String> {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("Executable must be an existing absolute file path".into());
    }
    #[cfg(windows)]
    if path
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("exe"))
    {
        return Err("Desktop executable must be an installed .exe, not a shell script".into());
    }
    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if [
        "setup",
        "installer",
        "dsh-latest-windows",
        "unins",
        "uninstall",
    ]
    .iter()
    .any(|word| filename.contains(word))
    {
        return Err("Installers cannot be launched as desktop instances. Download only, then register the installed application EXE".into());
    }
    Ok(text(&canonical(path)?))
}

fn valid_package_name(name: &str) -> Result<()> {
    let pieces: Vec<_> = name.split('/').collect();
    let valid = if name.starts_with('@') {
        pieces.len() == 2 && pieces[0].len() > 1 && !pieces[1].is_empty()
    } else {
        pieces.len() == 1 && !name.is_empty()
    };
    if !valid
        || name.len() > 214
        || pieces.iter().any(|piece| {
            let piece = piece.trim_start_matches('@');
            piece.starts_with(['.', '-'])
                || !piece
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        })
    {
        return Err("Invalid npm package name".into());
    }
    Ok(())
}

fn valid_registry_exact(reference: &str) -> Result<()> {
    let (name, version) = reference
        .rsplit_once('@')
        .ok_or("Portable plugin needs name@exactVersion")?;
    valid_package_name(name)?;
    exact_version(version)
}

// 成就按“同一个插件”去重：npm 引用去掉版本，GitHub 引用去掉提交，
// tarball 去掉查询串与片段；不做网络请求，也不猜测包身份。
fn achievement_plugin_key(reference: &str) -> String {
    if let Some(repo) = reference.strip_prefix("github:") {
        return repo.split('#').next().unwrap_or(repo).to_string();
    }
    if reference.starts_with("https://") {
        return reference
            .split(['?', '#'])
            .next()
            .unwrap_or(reference)
            .to_string();
    }
    reference
        .rsplit_once('@')
        .filter(|(name, _)| !name.is_empty())
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| reference.to_string())
}

fn valid_plugin_ref(reference: &str) -> Result<()> {
    if reference.len() > 4096
        || reference.starts_with('-')
        || reference
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Invalid plugin reference".into());
    }
    if reference.starts_with("https://") {
        crate::network::validate_download_url(reference)?;
        return Ok(());
    }
    if let Some(repo) = reference.strip_prefix("github:") {
        let repo = repo.split('#').next().unwrap_or("");
        let pieces: Vec<_> = repo.split('/').collect();
        if pieces.len() == 2
            && pieces.iter().all(|p| {
                !p.is_empty()
                    && *p != "."
                    && *p != ".."
                    && p.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            })
        {
            return Ok(());
        }
        return Err("Invalid GitHub plugin reference".into());
    }
    let name = reference
        .rsplit_once('@')
        .filter(|(name, _)| !name.is_empty())
        .map(|(name, _)| name)
        .unwrap_or(reference);
    valid_package_name(name)
}

fn discover_node() -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("EAC_NODE_PATH") {
        candidates.push(PathBuf::from(path));
    }
    for root in runtime_roots() {
        candidates.push(root.join(if cfg!(windows) {
            "node.exe"
        } else {
            "bin/node"
        }));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&paths)
                .map(|path| path.join(if cfg!(windows) { "node.exe" } else { "node" })),
        );
    }
    for candidate in candidates.into_iter().filter(|p| p.is_file()) {
        let output = process::command(&candidate)
            .arg("--version")
            .output()
            .map_err(|e| e.to_string())?;
        let version = String::from_utf8_lossy(&output.stdout);
        if output.status.success()
            && version
                .trim()
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                .is_some_and(|major| major >= 24)
        {
            return canonical(&candidate);
        }
    }
    Err("Node.js 24 or newer was not found; put node on PATH or set EAC_NODE_PATH".into())
}

fn discover_npm(node: &Path) -> Result<PathBuf> {
    let mut candidates = vec![node
        .parent()
        .ok_or("Invalid node path")?
        .join("node_modules/npm/bin/npm-cli.js")];
    candidates.push(
        node.parent()
            .ok_or("Invalid node path")?
            .join("../lib/node_modules/npm/bin/npm-cli.js"),
    );
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&paths).map(|p| p.join("node_modules/npm/bin/npm-cli.js")),
        );
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "npm-cli.js not found beside Node or PATH npm; install npm with Node".into())
}

fn add_node_path(command: &mut Command, node: &Path, package: Option<&Path>) -> Result<()> {
    let mut paths = vec![files::external(node.parent().ok_or("Invalid Node path")?)];
    for root in runtime_roots() {
        let bin = root.join("tools/node_modules/.bin");
        if bin.is_dir() {
            paths.push(files::external(&bin));
        }
    }
    // Prefer a complete pnpm on the caller's PATH; official CLI owns how it invokes pnpm.
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    if let Some(package) = package {
        for ancestor in package.ancestors() {
            let bin = ancestor.join("node_modules/.bin");
            if bin.is_dir() {
                paths.push(bin);
            }
        }
    }
    command.env(
        "PATH",
        std::env::join_paths(paths).map_err(|e| e.to_string())?,
    );
    Ok(())
}

fn runtime_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = std::env::var_os("EAC_RUNTIME_DIR") {
        roots.push(PathBuf::from(root));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            roots.push(parent.join("runtime"));
            roots.push(parent.join("../Resources/runtime"));
            roots.push(parent.join("../lib/EAC 启动器/runtime"));
        }
    }
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime"));
    roots
}

fn open_external(target: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = target.encode_utf16().chain([0]).collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err(format!("System open failed: {}", result as isize));
        }
    }
    #[cfg(not(windows))]
    {
        let program = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        process::command(program)
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_engine() -> (tempfile::TempDir, Engine) {
        let home = tempfile::tempdir().unwrap();
        let engine = Engine::at(home.path()).unwrap();
        (home, engine)
    }

    #[test]
    fn instance_homes_are_independent_and_persist() {
        let (_root, engine) = test_engine();
        let first = engine
            .call(
                "create_instance",
                json!({"name":"One","kind":"official-desktop"}),
            )
            .unwrap();
        let first = first["instances"][0].clone();
        let second = engine
            .call(
                "create_instance",
                json!({"name":"Two","kind":"official-desktop"}),
            )
            .unwrap();
        let second = second["instances"]
            .as_array()
            .unwrap()
            .iter()
            .find(|instance| instance["name"] == "Two")
            .unwrap()
            .clone();
        assert_ne!(first["home"], second["home"]);
        fs::write(
            Path::new(first["home"].as_str().unwrap()).join("marker.txt"),
            "one",
        )
        .unwrap();
        assert!(!Path::new(second["home"].as_str().unwrap())
            .join("marker.txt")
            .exists());
        let reopened = Engine::at(engine.root()).unwrap();
        assert_eq!(
            reopened.snapshot().unwrap()["instances"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn create_clone_and_import_return_their_exact_allocated_id() {
        let (_root, engine) = test_engine();
        let created = engine
            .call(
                "create_instance",
                json!({"name":"Original","kind":"official-desktop"}),
            )
            .unwrap();
        let id = created["createdInstanceId"].as_str().unwrap();
        assert_eq!(created["instances"][0]["id"], id);
        engine
            .call(
                "create_instance",
                json!({"name":"Unrelated","kind":"official-desktop"}),
            )
            .unwrap();
        let cloned = engine
            .call("clone_instance", json!({"id":id,"name":"Clone"}))
            .unwrap();
        let allocated = cloned["createdInstanceId"].as_str().unwrap();
        let instance = cloned["instances"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == allocated)
            .unwrap();
        assert_eq!(instance["name"], "Clone");
        let descriptor = engine.root().join("descriptor.json");
        files::atomic_json(&descriptor, &json!({"schemaVersion":1,"name":"Imported","kind":"official-desktop","kernelVersion":null,"plugins":[]})).unwrap();
        let imported = engine
            .call("import_instance", json!({"path":descriptor}))
            .unwrap();
        let allocated = imported["createdInstanceId"].as_str().unwrap();
        let instance = imported["instances"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == allocated)
            .unwrap();
        assert_eq!(instance["name"], "Imported");
    }

    #[test]
    fn snapshot_and_restore_replaces_real_home() {
        let (_root, engine) = test_engine();
        let created = engine
            .call(
                "create_instance",
                json!({"name":"Restore","kind":"official-desktop"}),
            )
            .unwrap();
        let instance = created["instances"]
            .as_array()
            .unwrap()
            .first()
            .unwrap()
            .clone();
        let home = Path::new(instance["home"].as_str().unwrap());
        fs::write(home.join("state.txt"), "before").unwrap();
        engine
            .call("snapshot_instance", json!({"id":instance["id"]}))
            .unwrap();
        fs::write(home.join("state.txt"), "after").unwrap();
        let backups = engine
            .call("list_backups", json!({"id":instance["id"]}))
            .unwrap();
        let backup_id = backups["backups"][0]["id"].as_str().unwrap();
        engine
            .call(
                "restore_instance",
                json!({"id":instance["id"],"backupId":backup_id}),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(home.join("state.txt")).unwrap(),
            "before"
        );
    }

    #[test]
    fn managed_paths_and_archive_entries_reject_traversal() {
        let (_root, engine) = test_engine();
        assert!(engine
            .call(
                "open_path",
                json!({"path":engine.root().join("..").to_string_lossy()})
            )
            .is_err());
        for entry in [
            "../escape",
            r"..\escape",
            "/absolute",
            r"C:\absolute",
            "a/../../b",
        ] {
            assert!(files::archive_path(entry).is_err(), "{entry}");
        }
    }

    #[test]
    fn damaged_inventory_does_not_disable_other_instances() {
        let (_root, engine) = test_engine();
        let id = engine
            .create_instance_record(&json!({"name":"Broken","kind":"official-desktop"}))
            .unwrap();
        let profile = engine
            .path(format!("instances/{id}/home/profiles/web"))
            .unwrap();
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("package.json"), b"{malformed").unwrap();
        engine
            .create_instance_record(&json!({"name":"Healthy","kind":"official-desktop"}))
            .unwrap();
        let state = engine.snapshot().unwrap();
        assert_eq!(state["instances"].as_array().unwrap().len(), 2);
        assert!(state["instances"][0]["inventoryError"].as_str().is_some());
        assert!(state["instances"][1].get("inventoryError").is_none());
    }

    #[test]
    fn clone_preserves_an_external_workspace_and_copies_home() {
        let (_root, engine) = test_engine();
        let workspace = tempfile::tempdir().unwrap();
        let id = engine
            .create_instance_record(
                &json!({"name":"Custom","kind":"official-desktop","workspace":workspace.path()}),
            )
            .unwrap();
        let first = engine.instance(&id).unwrap();
        fs::write(Path::new(&first.home).join("marker"), b"original").unwrap();
        let state = engine
            .clone_instance(&json!({"id":id,"name":"Clone"}))
            .unwrap();
        let clone = &state["instances"][1];
        assert_eq!(
            clone["workspace"],
            text(&canonical(workspace.path()).unwrap())
        );
        assert_ne!(clone["home"], first.home);
        assert_eq!(
            fs::read(Path::new(clone["home"].as_str().unwrap()).join("marker")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn changed_registered_core_is_rejected() {
        let (_root, engine) = test_engine();
        let package = engine.path("kernels/fingerprint-test").unwrap();
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join("package.json"),
            br#"{"name":"@deepseek-ai/dsh","version":"1.0.0"}"#,
        )
        .unwrap();
        let cli = package.join("bin.js");
        fs::write(&cli, b"original cli").unwrap();
        let kernel = Kernel {
            id: new_id(),
            version: "1.0.0".into(),
            path: text(&package),
            node_path: "unused".into(),
            cli_path: text(&cli),
            installed_at: now(),
            source: "registered-local".into(),
            fingerprint: Some(kernel_fingerprint(&package, &cli).unwrap()),
        };
        verify_kernel(&kernel).unwrap();
        fs::write(&cli, b"changed cli").unwrap();
        assert!(verify_kernel(&kernel).is_err());
    }

    #[test]
    fn backups_keep_old_kernel_registration_alive() {
        let (_root, engine) = test_engine();
        let core = Kernel {
            id: new_id(),
            version: "1.0.0".into(),
            path: "unused".into(),
            node_path: "unused".into(),
            cli_path: "unused".into(),
            installed_at: now(),
            source: "registered-local".into(),
            fingerprint: None,
        };
        engine
            .state(|state| {
                state.kernels.push(core.clone());
                Ok(())
            })
            .unwrap();
        let id = engine
            .create_instance_record(
                &json!({"name":"Backup","kind":"official-desktop","kernelId":core.id}),
            )
            .unwrap();
        engine.backup(&engine.instance(&id).unwrap()).unwrap();
        engine
            .state(|state| {
                state.instances[0].kernel_id = None;
                Ok(())
            })
            .unwrap();
        assert!(engine
            .remove_kernel(&core.id)
            .unwrap_err()
            .contains("backup"));
        assert_eq!(
            engine.snapshot().unwrap()["kernels"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    // 自动安全点在每次插件操作前产生；磁盘占用必须被限制住。
    #[test]
    fn automatic_backups_rotate_and_manual_ones_are_kept_longer() {
        let (_root, engine) = test_engine();
        let id = engine
            .create_instance_record(&json!({"name":"Rotate","kind":"official-desktop"}))
            .unwrap();
        let instance = engine.instance(&id).unwrap();
        for _ in 0..8 {
            engine.backup_kind(&instance, BackupKind::Automatic).unwrap();
        }
        let automatic = engine.backup_entries(&id).unwrap();
        assert_eq!(automatic.len(), 3, "automatic safety points must rotate");
        assert!(automatic
            .iter()
            .all(|(_, manifest)| manifest.kind == BackupKind::Automatic));

        for _ in 0..14 {
            engine.backup_kind(&instance, BackupKind::Manual).unwrap();
        }
        let entries = engine.backup_entries(&id).unwrap();
        let manual = entries.iter().filter(|(_, m)| m.kind == BackupKind::Manual).count();
        let auto = entries.iter().filter(|(_, m)| m.kind == BackupKind::Automatic).count();
        assert_eq!(manual, 10, "manual backups keep a longer history");
        assert_eq!(auto, 3, "automatic rotation is independent of manual ones");
    }

    // 删除实例后，它的备份目录不能再作为孤儿数据留在磁盘上。
    #[test]
    fn deleting_an_instance_removes_its_backups() {
        let (_root, engine) = test_engine();
        let id = engine
            .create_instance_record(&json!({"name":"Delete","kind":"official-desktop"}))
            .unwrap();
        let instance = engine.instance(&id).unwrap();
        engine.backup_kind(&instance, BackupKind::Manual).unwrap();
        let backups = engine.path(format!("backups/{id}")).unwrap();
        assert!(backups.exists());

        engine.call("delete_instance", json!({"id":id})).unwrap();
        assert!(
            !backups.exists(),
            "instance backups must not survive instance deletion"
        );
    }

    // 中断的复制不产生 manifest，不能被当作可用备份，也不应阻塞轮换。
    #[test]
    fn interrupted_backup_directories_are_ignored() {
        let (_root, engine) = test_engine();
        let id = engine
            .create_instance_record(&json!({"name":"Partial","kind":"official-desktop"}))
            .unwrap();
        let partial = engine
            .path(format!("backups/{id}/{}", new_id()))
            .unwrap();
        fs::create_dir_all(partial.join("home")).unwrap();
        assert!(engine.backup_entries(&id).unwrap().is_empty());
        let instance = engine.instance(&id).unwrap();
        engine.backup_kind(&instance, BackupKind::Automatic).unwrap();
        assert_eq!(engine.backup_entries(&id).unwrap().len(), 1);
    }

    // trash 只是回滚缓冲，条目数量必须有上限。
    #[test]
    fn trash_is_rotated_to_a_bounded_size() {
        let (_root, engine) = test_engine();
        let trash = engine.path("trash").unwrap();
        for index in 0..26 {
            let entry = trash.join(format!("entry-{index}"));
            fs::create_dir_all(&entry).unwrap();
            fs::write(entry.join("file.txt"), "x").unwrap();
        }
        engine.prune_trash().unwrap();
        let remaining = fs::read_dir(&trash).unwrap().count();
        assert!(remaining <= 20, "trash kept {remaining} entries");
    }
}
