mod bridge;
mod dialogs;
mod util;
mod views;

use bridge::Bridge;
use eframe::egui;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use util::{Palette, Tone};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum View {
    Overview,
    Instances,
    Market,
    Kernels,
    Packs,
    Releases,
    Tasks,
    Profile,
    Achievements,
    Settings,
}

impl View {
    pub const ALL: [View; 10] = [
        View::Overview,
        View::Instances,
        View::Kernels,
        View::Market,
        View::Packs,
        View::Releases,
        View::Profile,
        View::Achievements,
        View::Tasks,
        View::Settings,
    ];

    pub fn label(self) -> &'static str {
        match self {
            View::Overview => "总览",
            View::Instances => "实例管理",
            View::Market => "插件市场",
            View::Kernels => "内核仓库",
            View::Packs => "整合包",
            View::Releases => "发行版本",
            View::Tasks => "任务记录",
            View::Profile => "个人中心",
            View::Achievements => "成就",
            View::Settings => "偏好设置",
        }
    }

    pub fn en(self) -> &'static str {
        match self {
            View::Overview => "Overview",
            View::Instances => "Instances",
            View::Market => "Plugins",
            View::Kernels => "Runtimes",
            View::Packs => "Packs",
            View::Releases => "Releases",
            View::Tasks => "Activity",
            View::Profile => "Profile",
            View::Achievements => "Achievements",
            View::Settings => "Settings",
        }
    }

    pub fn icon(self) -> util::Icon {
        match self {
            View::Overview => util::Icon::Overview,
            View::Instances => util::Icon::Instances,
            View::Kernels => util::Icon::Kernels,
            View::Market => util::Icon::Market,
            View::Packs => util::Icon::Packs,
            View::Releases => util::Icon::Releases,
            View::Profile => util::Icon::Profile,
            View::Achievements => util::Icon::Achievements,
            View::Tasks => util::Icon::Tasks,
            View::Settings => util::Icon::Settings,
        }
    }

    pub fn group(self) -> &'static str {
        match self {
            View::Overview | View::Instances | View::Kernels => "工作空间",
            View::Market | View::Packs | View::Releases => "发现更多",
            _ => "系统",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Skin {
    Pixel,
    Standard,
}

pub struct Notice {
    message: String,
    tone: Tone,
    at: Instant,
}

pub struct Pending {
    pub tag: String,
    pub action: String,
    pub label: String,
    pub instance_id: Option<String>,
}

/// 顺序安装任务：整合包与空投都是“先建实例，再逐个安装引用”。
/// 后台线程本来就是串行队列，这里只需要在每次完成后派发下一条。
pub struct InstallJob {
    pub title: String,
    pub refs: Vec<(String, Option<String>)>,
    pub index: usize,
    pub instance_id: Option<String>,
    pub create: Option<Value>,
    pub ok: usize,
    pub fail: usize,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct GuiPrefs {
    skin: Option<String>,
    hall_url: Option<String>,
    debug: Option<bool>,
    dark: Option<bool>,
}

fn prefs_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("EACLauncher").join("gui-appearance.json"))
}

fn load_prefs() -> GuiPrefs {
    let Some(path) = prefs_path() else {
        return GuiPrefs::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

impl App {
    fn save_prefs(&self) {
        let Some(path) = prefs_path() else { return };
        let prefs = GuiPrefs {
            skin: Some(
                if self.skin == Skin::Pixel {
                    "pixel"
                } else {
                    "standard"
                }
                .into(),
            ),
            hall_url: Some(self.hall_url.clone()),
            debug: Some(self.debug),
            dark: Some(self.dark),
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(raw) = serde_json::to_string_pretty(&prefs) {
            let _ = std::fs::write(path, raw);
        }
    }
}

pub struct App {
    bridge: Option<Bridge>,
    fatal: Option<String>,
    pub view: View,
    pub selected_id: String,
    pub dialog: Option<dialogs::Dialog>,
    notices: Vec<Notice>,
    pub pending: Vec<Pending>,
    pub dark: bool,
    pub skin: Skin,
    pub reduced_motion: bool,
    pub hall_url: String,
    pub debug: bool,
    // 引擎侧目录数据（非 snapshot 的按需查询）
    pub catalog: Option<Value>,
    pub social: Option<Value>,
    pub starred: Vec<String>,
    pub achievements: Option<Value>,
    pub kernel_versions: Option<Value>,
    pub kernel_versions_loading: bool,
    pub kernel_versions_error: String,
    pub releases: Vec<Value>,
    pub release_source: String,
    pub release_loading: bool,
    pub release_error: String,
    pub release_platform: String,
    pub release_prerelease: bool,
    pub release_downloaded: Vec<(String, String)>,
    pub backups: Vec<Value>,
    pub backups_for: String,
    pub backups_error: String,
    pub logs: String,
    pub logs_for: String,
    pub logs_error: String,
    pub logs_loading: bool,
    pub logs_at: Option<Instant>,
    pub logs_follow: bool,
    pub logs_wrap: bool,
    pub usage: Option<Value>,
    pub usage_loading: bool,
    pub usage_error: String,
    pub probe: Option<Value>,
    pub probe_loading: bool,
    pub probe_error: String,
    pub probe_kernel: String,
    pub probe_refs: String,
    pub market_stats: Option<Value>,
    pub discovered: Option<Value>,
    // 各页面的临时筛选状态
    pub instance_tab: String,
    pub instance_query: String,
    pub market_query: String,
    pub market_category: String,
    pub market_source: String,
    pub market_availability: String,
    pub market_visible: usize,
    pub kernel_query: String,
    pub kernel_visible: usize,
    pub task_filter: String,
    pub task_query: String,
    pub ach_category: String,
    pub ach_status: String,
    pub search: String,
    seq: u64,
    appearance_loaded: bool,
    theme_key: Option<(bool, bool)>,
    pub job: Option<InstallJob>,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        let prefs = load_prefs();
        let (bridge, fatal) = match Bridge::start() {
            Ok(bridge) => (Some(bridge), None),
            Err(error) => (None, Some(error)),
        };
        if let Some(bridge) = &bridge {
            // 首次取目录、社交、成就：与 React 版启动时一致。
            bridge.call("catalog", "catalog", "", json!({}));
            bridge.call("social", "github_status", "", json!({}));
            bridge.call("starred", "github_starred", "", json!({}));
            bridge.call("achievements", "achievements", "", json!({}));
            bridge.call("market_stats", "market_stats", "", json!({}));
        }
        Self {
            bridge,
            fatal,
            view: View::Overview,
            selected_id: String::new(),
            dialog: None,
            notices: Vec::new(),
            pending: Vec::new(),
            dark: prefs.dark.unwrap_or(true),
            skin: if prefs.skin.as_deref() == Some("standard") {
                Skin::Standard
            } else {
                Skin::Pixel
            },
            reduced_motion: false,
            hall_url: prefs
                .hall_url
                .unwrap_or_else(|| "http://144.126.133.165:4317".into()),
            debug: prefs.debug.unwrap_or(false),
            catalog: None,
            social: None,
            starred: Vec::new(),
            achievements: None,
            kernel_versions: None,
            kernel_versions_loading: false,
            kernel_versions_error: String::new(),
            releases: Vec::new(),
            release_source: "eac".into(),
            release_loading: false,
            release_error: String::new(),
            release_platform: "all".into(),
            release_prerelease: false,
            release_downloaded: Vec::new(),
            backups: Vec::new(),
            backups_for: String::new(),
            backups_error: String::new(),
            logs: String::new(),
            logs_for: String::new(),
            logs_error: String::new(),
            logs_loading: false,
            logs_at: None,
            logs_follow: true,
            logs_wrap: false,
            usage: None,
            usage_loading: false,
            usage_error: String::new(),
            probe: None,
            probe_loading: false,
            probe_error: String::new(),
            probe_kernel: String::new(),
            probe_refs: String::new(),
            market_stats: None,
            discovered: None,
            instance_tab: "details".into(),
            instance_query: String::new(),
            market_query: String::new(),
            market_category: String::new(),
            market_source: String::new(),
            market_availability: "all".into(),
            market_visible: 60,
            kernel_query: String::new(),
            kernel_visible: 16,
            task_filter: "all".into(),
            task_query: String::new(),
            ach_category: "全部".into(),
            ach_status: "all".into(),
            search: String::new(),
            seq: 0,
            appearance_loaded: false,
            theme_key: None,
            job: None,
        }
    }

    pub fn pal(&self) -> Palette {
        util::palette(self.dark, self.skin == Skin::Pixel)
    }

    pub fn snap(&self) -> Option<Arc<Value>> {
        self.bridge.as_ref()?.snapshot()
    }

    pub fn online(&self) -> bool {
        self.bridge.as_ref().map(Bridge::online).unwrap_or(false)
    }

    pub fn connecting(&self) -> bool {
        self.bridge.as_ref().map(Bridge::connecting).unwrap_or(false)
    }

    pub fn engine_error(&self) -> String {
        self.bridge.as_ref().map(Bridge::error).unwrap_or_default()
    }

    pub fn notify(&mut self, message: impl Into<String>, tone: Tone) {
        self.notices.push(Notice {
            message: message.into(),
            tone,
            at: Instant::now(),
        });
    }

    pub fn run(&mut self, action: &str, payload: Value, label: &str) -> String {
        self.seq += 1;
        let tag = format!("run:{}", self.seq);
        let instance_id = payload
            .get("instanceId")
            .or_else(|| payload.get("id"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.pending.push(Pending {
            tag: tag.clone(),
            action: action.into(),
            label: label.into(),
            instance_id,
        });
        if let Some(bridge) = &self.bridge {
            bridge.call(tag.clone(), action, label, payload);
        }
        tag
    }

    pub fn query(&mut self, tag: &str, action: &str, payload: Value) {
        if let Some(bridge) = &self.bridge {
            bridge.call(tag.to_string(), action, "", payload);
        }
    }

    pub fn selected_instance(&self) -> Option<Value> {
        let snapshot = self.snap()?;
        let items = util::arr(&snapshot, "instances");
        items
            .iter()
            .find(|item| util::s(item, "id") == self.selected_id)
            .or_else(|| items.first())
            .cloned()
    }

    pub fn instance_by_id(&self, id: &str) -> Option<Value> {
        let snapshot = self.snap()?;
        util::arr(&snapshot, "instances")
            .iter()
            .find(|item| util::s(item, "id") == id)
            .cloned()
    }

    pub fn load_kernels(&mut self) {
        if !self.online() || self.kernel_versions_loading {
            return;
        }
        self.kernel_versions_loading = true;
        self.kernel_versions_error.clear();
        self.query("kernel_versions", "kernel_versions", json!({}));
    }

    pub fn load_releases(&mut self, source: &str) {
        if !self.online() {
            return;
        }
        self.release_source = source.into();
        self.release_loading = true;
        self.release_error.clear();
        self.releases.clear();
        self.query(
            &format!("releases:{}", source),
            "releases",
            json!({ "source": source }),
        );
    }

    pub fn load_logs(&mut self, id: &str) {
        if !self.online() || self.logs_loading {
            return;
        }
        self.logs_loading = true;
        self.logs_for = id.into();
        self.logs_at = Some(Instant::now());
        self.query(&format!("logs:{}", id), "instance_logs", json!({ "id": id }));
    }

    pub fn load_backups(&mut self, id: &str) {
        if !self.online() {
            return;
        }
        self.backups_for = id.into();
        self.backups_error.clear();
        self.query(
            &format!("backups:{}", id),
            "list_backups",
            json!({ "id": id }),
        );
    }

    pub fn load_usage(&mut self, refresh: bool) {
        if !self.online() || self.usage_loading {
            return;
        }
        self.usage_loading = true;
        self.usage_error.clear();
        self.query("usage", "usage_profile", json!({ "refresh": refresh }));
    }

    pub fn load_discovered(&mut self) {
        if self.discovered.is_some() || !self.online() {
            return;
        }
        self.query("discover", "discover_local", json!({}));
    }

    /// 启动顺序安装任务；create 为 Some 时先建实例，否则直接装进已有实例。
    pub fn start_install_job(
        &mut self,
        title: String,
        refs: Vec<(String, Option<String>)>,
        create: Option<Value>,
        instance_id: Option<String>,
    ) {
        self.job = Some(InstallJob {
            title,
            refs,
            index: 0,
            instance_id,
            create: create.clone(),
            ok: 0,
            fail: 0,
        });
        if let Some(payload) = create {
            self.seq += 1;
            let tag = format!("job:create:{}", self.seq);
            self.pending.push(Pending {
                tag: tag.clone(),
                action: "create_instance".into(),
                label: "创建整合包实例".into(),
                instance_id: None,
            });
            if let Some(bridge) = &self.bridge {
                bridge.call(tag, "create_instance", "创建整合包实例", payload);
            }
        } else {
            self.job_install_next();
        }
    }

    fn job_install_next(&mut self) {
        let next = self
            .job
            .as_ref()
            .map(|job| (job.index, job.refs.get(job.index).cloned(), job.instance_id.clone()));
        let Some((index, reference, instance_id)) = next else {
            return;
        };
        let Some((reference, sha)) = reference else {
            let Some(job) = self.job.take() else { return };
            if job.fail > 0 {
                self.notify(
                    format!("{}：成功 {} 个，失败 {} 个。", job.title, job.ok, job.fail),
                    Tone::Error,
                );
            } else {
                self.notify(
                    format!("{}：已安装 {} 个插件。", job.title, job.ok),
                    Tone::Success,
                );
            }
            let _ = index;
            return;
        };
        let instance_id = instance_id.unwrap_or_default();
        let label = format!("安装 {}", reference);
        self.seq += 1;
        let tag = format!("job:install:{}", self.seq);
        self.pending.push(Pending {
            tag: tag.clone(),
            action: "install_plugin".into(),
            label: label.clone(),
            instance_id: Some(instance_id.clone()),
        });
        let mut payload = json!({ "instanceId": instance_id, "ref": reference });
        if let Some(sha) = sha {
            payload["expectedSha256"] = json!(sha);
        }
        if let Some(bridge) = &self.bridge {
            bridge.call(tag, "install_plugin", &label, payload);
        }
    }

    fn handle_job_event(&mut self, event: &bridge::Event) -> bool {
        if !event.tag.starts_with("job:") {
            return false;
        }
        self.pending.retain(|item| item.tag != event.tag);
        if event.tag.starts_with("job:create") {
            match &event.result {
                Ok(value) => {
                    let id = util::s(value, "createdInstanceId").to_string();
                    if id.is_empty() {
                        self.notify("引擎未返回新实例，请到实例管理查看。", Tone::Error);
                        self.job = None;
                        return true;
                    }
                    if let Some(job) = &mut self.job {
                        job.instance_id = Some(id);
                    }
                    if let Some(bridge) = &self.bridge {
                        bridge.apply(value.clone());
                    }
                    self.job_install_next();
                }
                Err(error) => {
                    self.notify(error.clone(), Tone::Error);
                    self.job = None;
                }
            }
            return true;
        }
        let ok = event.result.is_ok();
        if let Err(error) = &event.result {
            self.notify(error.clone(), Tone::Error);
        }
        if let Some(job) = &mut self.job {
            if ok {
                job.ok += 1;
            } else {
                job.fail += 1;
            }
            job.index += 1;
        }
        self.job_install_next();
        true
    }

    fn tick(&mut self) {
        self.drain();
        self.prune_notices();

        if self.selected_id.is_empty() {
            if let Some(snapshot) = self.snap() {
                if let Some(first) = util::arr(&snapshot, "instances").first() {
                    self.selected_id = util::s(first, "id").to_string();
                }
            }
        }

        if !self.appearance_loaded {
            if let Some(snapshot) = self.snap() {
                if let Some(settings) = snapshot.get("settings") {
                    self.dark = util::s(settings, "theme") != "light";
                    self.reduced_motion = util::b(settings, "reducedMotion");
                    self.appearance_loaded = true;
                }
            }
        }

        // 控制台每 2 秒跟随一次（与原界面的轮询一致）。
        if matches!(self.view, View::Overview | View::Instances) && self.online() {
            if let Some(instance) = self.selected_instance() {
                let id = util::s(&instance, "id").to_string();
                let due = self
                    .logs_at
                    .map(|at| at.elapsed() > Duration::from_secs(2))
                    .unwrap_or(true);
                if due && !self.logs_loading {
                    self.load_logs(&id);
                }
            }
        }

        if self.view == View::Kernels
            && self.kernel_versions.is_none()
            && !self.kernel_versions_loading
        {
            self.load_kernels();
        }
        if self.view == View::Releases && self.releases.is_empty() && !self.release_loading {
            let source = self.release_source.clone();
            self.load_releases(&source);
        }
        if self.view == View::Profile && self.usage.is_none() && !self.usage_loading {
            self.load_usage(false);
        }
    }

    fn prune_notices(&mut self) {
        self.notices
            .retain(|notice| notice.at.elapsed() < Duration::from_secs(7));
    }

    fn drain(&mut self) {
        let mut events = Vec::new();
        if let Some(bridge) = &self.bridge {
            while let Some(event) = bridge.poll() {
                events.push(event);
            }
        }
        for event in events {
            if self.handle_job_event(&event) {
                continue;
            }
            self.pending.retain(|item| item.tag != event.tag);
            let action = event.action.as_str();
            match action {
                "catalog" => {
                    if let Ok(value) = event.result {
                        self.catalog = Some(value);
                    }
                }
                "github_status" => {
                    if let Ok(value) = event.result {
                        self.social = Some(value);
                    }
                }
                "github_starred" => {
                    if let Ok(value) = event.result {
                        self.starred = util::arr(&value, "repos")
                            .iter()
                            .filter_map(Value::as_str)
                            .map(|repo| repo.to_lowercase())
                            .collect();
                    }
                }
                "achievements" => {
                    if let Ok(value) = event.result {
                        self.achievements = Some(value);
                    }
                }
                "kernel_versions" => {
                    self.kernel_versions_loading = false;
                    match event.result {
                        Ok(value) => self.kernel_versions = Some(value),
                        Err(error) => self.kernel_versions_error = error,
                    }
                }
                "releases" => {
                    self.release_loading = false;
                    match event.result {
                        Ok(value) => self.releases = util::arr(&value, "releases").to_vec(),
                        Err(error) => self.release_error = error,
                    }
                }
                "list_backups" => match event.result {
                    Ok(value) => self.backups = util::arr(&value, "backups").to_vec(),
                    Err(error) => self.backups_error = error,
                },
                "instance_logs" => {
                    self.logs_loading = false;
                    match event.result {
                        Ok(value) => {
                            self.logs = util::s(&value, "text").to_string();
                            self.logs_error.clear();
                        }
                        Err(error) => self.logs_error = error,
                    }
                }
                "usage_profile" => {
                    self.usage_loading = false;
                    match event.result {
                        Ok(value) => self.usage = Some(value),
                        Err(error) => self.usage_error = error,
                    }
                }
                "market_stats" => {
                    if let Ok(value) = event.result {
                        self.market_stats = Some(value);
                    }
                }
                "discover_local" => {
                    if let Ok(value) = event.result {
                        self.discovered = Some(value);
                    }
                }
                "probe_plugins" => {
                    self.probe_loading = false;
                    match event.result {
                        Ok(value) => self.probe = Some(value),
                        Err(error) => self.probe_error = error,
                    }
                }
                "export_instance" => {
                    if let Ok(value) = event.result {
                        let path = util::s(&value, "path");
                        if !path.is_empty() {
                            self.notify(format!("已导出到 {}", path), Tone::Success);
                        }
                    } else if let Err(error) = event.result {
                        self.notify(error, Tone::Error);
                    }
                }
                _ => match event.result {
                    Ok(value) => {
                        if !event.label.is_empty() {
                            self.notify(format!("{} 已完成", event.label), Tone::Success);
                        }
                        if value.get("instances").is_some() {
                            if let Some(bridge) = &self.bridge {
                                bridge.apply(value);
                            }
                        }
                        if matches!(
                            action,
                            "install_kernel" | "remove_kernel" | "register_kernel"
                        ) {
                            self.kernel_versions = None;
                            self.kernel_versions_error.clear();
                            self.load_kernels();
                        }
                    }
                    Err(error) => self.notify(error, Tone::Error),
                },
            }
        }
    }

    fn header(&mut self, ui: &mut egui::Ui, pal: &Palette) {
        ui.horizontal(|ui| {
            ui.add_space(14.0);
            ui.label(
                egui::RichText::new("EAC")
                    .size(17.0)
                    .strong()
                    .color(pal.accent),
            );
            ui.label(
                egui::RichText::new("启动器")
                    .size(13.0)
                    .color(pal.muted),
            );
            ui.label(egui::RichText::new("›").size(13.0).color(pal.muted));
            ui.label(
                egui::RichText::new(self.view.label())
                    .size(13.0)
                    .strong()
                    .color(pal.text),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(14.0);
                let (label, color) = if self.online() {
                    ("● 引擎在线", pal.green)
                } else if self.connecting() {
                    ("● 连接中", pal.yellow)
                } else {
                    ("● 离线", pal.coral)
                };
                ui.label(egui::RichText::new(label).size(11.5).color(color));
                if ui
                    .add(
                        egui::Button::new(
                            egui::RichText::new(if self.dark { "浅色" } else { "深色" })
                                .size(11.5),
                        )
                        .frame(false),
                    )
                    .clicked()
                {
                    self.dark = !self.dark;
                    let theme = if self.dark { "dark" } else { "light" };
                    self.run("save_settings", json!({ "theme": theme }), "保存主题");
                }
                if ui
                    .add(
                        egui::Button::new(
                            egui::RichText::new(if self.skin == Skin::Pixel {
                                "PIXEL"
                            } else {
                                "CALM"
                            })
                            .size(11.5),
                        )
                        .frame(false),
                    )
                    .on_hover_text("切换像素深海 / 简洁工作台皮肤")
                    .clicked()
                {
                    self.skin = if self.skin == Skin::Pixel {
                        Skin::Standard
                    } else {
                        Skin::Pixel
                    };
                }
                let mut search = self.search.clone();
                let response = ui.add_sized(
                    [220.0, 24.0],
                    egui::TextEdit::singleline(&mut search).hint_text("搜索插件…"),
                );
                self.search = search;
                if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    self.market_query = self.search.trim().to_string();
                    self.view = View::Market;
                }
            });
        });
    }

    fn sidebar(&mut self, ui: &mut egui::Ui, pal: &Palette) {
        let height = ui.available_height();
        ui.allocate_ui_with_layout(
            egui::vec2(210.0, height),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("EAC")
                            .size(22.0)
                            .strong()
                            .color(pal.accent),
                    );
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new("启动器")
                                .size(12.0)
                                .strong()
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new("LAUNCHER")
                                .size(8.5)
                                .color(pal.muted),
                        );
                    });
                });
                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("我的工作空间")
                        .size(11.0)
                        .color(pal.muted),
                );
                ui.add_space(6.0);

                let active_tasks = self
                    .snap()
                    .map(|snapshot| {
                        util::arr(&snapshot, "tasks")
                            .iter()
                            .filter(|task| util::s(task, "status") == "running")
                            .count()
                    })
                    .unwrap_or(0);
                let instance_count = self
                    .snap()
                    .map(|snapshot| util::arr(&snapshot, "instances").len())
                    .unwrap_or(0);

                let mut last_group = "";
                for view in View::ALL {
                    if view.group() != last_group {
                        last_group = view.group();
                        ui.add_space(8.0);
                        ui.label(
                            egui::RichText::new(view.group())
                                .size(10.0)
                                .color(pal.muted),
                        );
                    }
                    let selected = self.view == view;
                    let count = if view == View::Tasks {
                        active_tasks
                    } else if view == View::Instances {
                        instance_count
                    } else {
                        0
                    };
                    let mut label = view.label().to_string();
                    if count > 0 {
                        label.push_str(&format!("   {}", count));
                    }
                    let row_h = 34.0;
                    let (rect, response) =
                        ui.allocate_exact_size(egui::vec2(196.0, row_h), egui::Sense::click());
                    let fill = if selected {
                        pal.accent_soft
                    } else if response.hovered() {
                        pal.card
                    } else {
                        egui::Color32::TRANSPARENT
                    };
                    let painter = ui.painter_at(rect);
                    if fill != egui::Color32::TRANSPARENT {
                        painter.rect_filled(rect, egui::CornerRadius::same(10), fill);
                    }
                    let icon_color = if selected { pal.accent } else { pal.muted };
                    util::paint_icon(
                        &painter,
                        egui::pos2(rect.left() + 24.0, rect.center().y),
                        16.0,
                        view.icon(),
                        icon_color,
                    );
                    painter.text(
                        egui::pos2(rect.left() + 42.0, rect.center().y),
                        egui::Align2::LEFT_CENTER,
                        label,
                        egui::FontId::proportional(12.5),
                        if selected { pal.text } else { pal.muted },
                    );
                    if response.clicked() {
                        self.view = view;
                    }
                }

                ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new(if self.online() {
                                "● 本地引擎已连接"
                            } else if self.connecting() {
                                "● 连接引擎中"
                            } else {
                                "● 本地引擎未连接"
                            })
                            .size(11.0)
                            .color(if self.online() { pal.green } else { pal.coral }),
                        );
                    });
                    ui.label(
                        egui::RichText::new("TAURI 已移除 · 原生 GUI")
                            .size(9.5)
                            .color(pal.muted),
                    );
                    ui.add_space(6.0);
                    if util::primary_button(ui, pal, "＋  新建实例").clicked() {
                        self.dialog = Some(dialogs::Dialog::create(None));
                    }
                    ui.add_space(2.0);
                    if util::ghost_button(ui, pal, "连接设置").clicked() {
                        self.dialog = Some(dialogs::Dialog::Connection);
                    }
                    ui.add_space(6.0);
                });
            },
        );
    }

    fn page(&mut self, ui: &mut egui::Ui, pal: &Palette) {
        ui.add_space(8.0);
        match self.view {
            View::Overview => views::overview(self, ui, pal),
            View::Instances => views::instances(self, ui, pal),
            View::Market => views::market(self, ui, pal),
            View::Kernels => views::kernels(self, ui, pal),
            View::Packs => views::packs(self, ui, pal),
            View::Releases => views::releases(self, ui, pal),
            View::Tasks => views::tasks(self, ui, pal),
            View::Profile => views::profile(self, ui, pal),
            View::Achievements => views::achievements(self, ui, pal),
            View::Settings => views::settings(self, ui, pal),
        }
        ui.add_space(24.0);
        ui.separator();
        ui.label(
            egui::RichText::new("EAC / YOUR SPACE, YOUR PACE.")
                .size(10.0)
                .color(pal.muted),
        );
    }

    fn dialogs(&mut self, ctx: &egui::Context, pal: &Palette) {
        dialogs::show(self, ctx, pal);
    }

    fn toasts(&mut self, ctx: &egui::Context, pal: &Palette) {
        if self.notices.is_empty() {
            return;
        }
        egui::Area::new(egui::Id::new("eac-toasts"))
            .anchor(egui::Align2::RIGHT_BOTTOM, egui::vec2(-18.0, -18.0))
            .order(egui::Order::Foreground)
            .show(ctx, |ui| {
                for notice in &self.notices {
                    let color = util::tone_color(pal, notice.tone);
                    egui::Frame::new()
                        .fill(pal.panel)
                        .stroke(egui::Stroke::new(1.0, color))
                        .corner_radius(egui::CornerRadius::same(10))
                        .inner_margin(egui::Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_max_width(360.0);
                            ui.label(
                                egui::RichText::new(&notice.message)
                                    .size(12.0)
                                    .color(pal.text),
                            );
                        });
                }
            });
    }
}

impl eframe::App for App {
    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.save_prefs();
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let pal = self.pal();
        let key = (self.dark, self.skin == Skin::Pixel);
        if self.theme_key != Some(key) {
            util::apply_visuals(ui.ctx(), &pal);
            self.theme_key = Some(key);
        }
        ui.painter()
            .rect_filled(ui.max_rect(), egui::CornerRadius::ZERO, pal.bg);
        ui.ctx()
            .request_repaint_after(Duration::from_millis(400));

        if let Some(error) = &self.fatal {
            ui.vertical_centered(|ui| {
                ui.add_space(80.0);
                ui.label(
                    egui::RichText::new("无法打开本地引擎")
                        .size(22.0)
                        .strong()
                        .color(pal.coral),
                );
                ui.label(egui::RichText::new(error).size(12.0).color(pal.muted));
            });
            return;
        }

        // 原生拖拽：把 .eacpack.json 拖进窗口即可导入（WebView2 的“空投”入口）。
        let dropped = ui.ctx().input(|input| {
            input
                .raw
                .dropped_files
                .iter()
                .find_map(|file| {
                    let path = file.path();
                    if path.as_os_str().is_empty() {
                        None
                    } else {
                        Some(path.to_string_lossy().to_string())
                    }
                })
        });
        if let Some(path) = dropped {
            if path.to_lowercase().ends_with(".json") {
                self.dialog = Some(dialogs::Dialog::import_pack_at(path));
            } else {
                self.notify("只识别 .json / .eacpack.json 整合包清单文件。", Tone::Error);
            }
        }

        self.tick();
        self.header(ui, &pal);
        ui.separator();
        ui.horizontal_top(|ui| {
            self.sidebar(ui, &pal);
            ui.separator();
            let available = ui.available_size();
            ui.allocate_ui_with_layout(
                available,
                egui::Layout::top_down(egui::Align::Min),
                |ui| {
                    egui::ScrollArea::vertical()
                        .auto_shrink([false, false])
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.add_space(16.0);
                                ui.vertical(|ui| {
                                    ui.set_width((ui.available_width() - 24.0).max(320.0));
                                    // 引擎记录减少动态偏好；原生窗口没有大幅位移动画。
                                    let _ = self.reduced_motion;
                                    self.page(ui, &pal);
                                });
                            });
                        });
                },
            );
        });
        self.dialogs(ui.ctx(), &pal);
        self.toasts(ui.ctx(), &pal);
    }
}

fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    for path in [
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/Deng.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simsun.ttc",
    ] {
        if let Ok(bytes) = std::fs::read(path) {
            fonts.font_data.insert(
                "cjk".to_owned(),
                Arc::new(egui::FontData::from_owned(bytes)),
            );
            for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
                fonts
                    .families
                    .entry(family)
                    .or_default()
                    .insert(0, "cjk".to_owned());
            }
            break;
        }
    }
    ctx.set_fonts(fonts);
}

pub fn run() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1440.0, 920.0])
            .with_min_inner_size([1024.0, 680.0])
            .with_title("EAC 启动器"),
        ..Default::default()
    };
    eframe::run_native(
        "EAC 启动器",
        options,
        Box::new(|cc| Ok(Box::new(App::new(cc)))),
    )
}
