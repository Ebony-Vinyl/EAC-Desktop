use crate::gui::util::{self, Palette};
use crate::gui::App;
use eframe::egui;
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    Register,
    Import,
    Export,
}

pub enum Dialog {
    Connection,
    Instance {
        id: Option<String>,
        name: String,
        kind: String,
        kernel_id: String,
        workspace: String,
        port: String,
        executable: String,
        error: String,
    },
    CloneInstance {
        instance_id: String,
        name: String,
        error: String,
    },
    Path {
        kind: PathKind,
        path: String,
        instance_id: String,
        error: String,
        result: String,
    },
    InstallKernel {
        version: String,
        error: String,
    },
    Plugin {
        plugin: Option<Value>,
        instance_id: String,
        reference: String,
        error: String,
    },
    Pack {
        pack: Value,
        name: String,
        kernel_id: String,
        error: String,
    },
    Desktop {
        asset: Value,
        kind: String,
        tag: String,
        name: String,
        error: String,
    },
    Confirm {
        title: String,
        message: String,
        label: String,
        action: String,
        payload: Value,
        danger: bool,
        error: String,
    },
    ImportPack {
        path: String,
        manifest: Option<Value>,
        mode: String,
        instance_id: String,
        name: String,
        kernel_id: String,
        picked: Vec<bool>,
        error: String,
    },
    ExportPack {
        instance_id: String,
        name: String,
        author: String,
        description: String,
        path: String,
        error: String,
    },
}

impl Dialog {
    pub fn create(kind: Option<String>) -> Self {
        Dialog::Instance {
            id: None,
            name: String::new(),
            kind: kind.unwrap_or_else(|| "harness".into()),
            kernel_id: String::new(),
            workspace: String::new(),
            port: String::new(),
            executable: String::new(),
            error: String::new(),
        }
    }

    pub fn configure(instance: &Value) -> Self {
        Dialog::Instance {
            id: Some(util::s(instance, "id").to_string()),
            name: util::s(instance, "name").to_string(),
            kind: util::s(instance, "kind").to_string(),
            kernel_id: util::s(instance, "kernelId").to_string(),
            workspace: util::s(instance, "workspace").to_string(),
            port: if util::s(instance, "port").is_empty() {
                String::new()
            } else {
                util::s(instance, "port").to_string()
            },
            executable: util::s(instance, "executable").to_string(),
            error: String::new(),
        }
    }

    pub fn clone_instance(instance: &Value) -> Self {
        Dialog::CloneInstance {
            instance_id: util::s(instance, "id").to_string(),
            name: format!("{} 副本", util::s(instance, "name")),
            error: String::new(),
        }
    }

    pub fn path(kind: PathKind, instance: &Value) -> Self {
        Dialog::Path {
            kind,
            path: String::new(),
            instance_id: util::s(instance, "id").to_string(),
            error: String::new(),
            result: String::new(),
        }
    }

    pub fn install_kernel(version: Option<String>) -> Self {
        Dialog::InstallKernel {
            version: version.unwrap_or_default(),
            error: String::new(),
        }
    }

    pub fn plugin(plugin: Option<Value>, instance_id: Option<String>) -> Self {
        let reference = plugin
            .as_ref()
            .and_then(|value| util::opt(value, "ref"))
            .unwrap_or("")
            .to_string();
        Dialog::Plugin {
            plugin,
            instance_id: instance_id.unwrap_or_default(),
            reference,
            error: String::new(),
        }
    }

    pub fn pack(pack: Value) -> Self {
        Dialog::Pack {
            name: util::s(&pack, "name").to_string(),
            kernel_id: String::new(),
            pack,
            error: String::new(),
        }
    }

    pub fn desktop(asset: Value, kind: &str, tag: &str) -> Self {
        Dialog::Desktop {
            name: format!("{} {}", util::kind_label(kind), tag),
            asset,
            kind: kind.to_string(),
            tag: tag.to_string(),
            error: String::new(),
        }
    }

    pub fn confirm(
        title: &str,
        message: String,
        label: &str,
        action: &str,
        payload: Value,
        danger: bool,
    ) -> Self {
        Dialog::Confirm {
            title: title.into(),
            message,
            label: label.into(),
            action: action.into(),
            payload,
            danger,
            error: String::new(),
        }
    }

    pub fn import_pack() -> Self {
        Dialog::ImportPack {
            path: String::new(),
            manifest: None,
            mode: "new".into(),
            instance_id: String::new(),
            name: String::new(),
            kernel_id: String::new(),
            picked: Vec::new(),
            error: String::new(),
        }
    }

    /// 原生窗口拖入清单时直接读取，等价于 React 版的空投入口。
    pub fn import_pack_at(path: String) -> Self {
        let mut dialog = Dialog::import_pack();
        if let Dialog::ImportPack {
            path: field,
            manifest,
            name,
            picked,
            error,
            ..
        } = &mut dialog
        {
            *field = path.clone();
            match read_manifest(&path) {
                Ok(value) => {
                    *name = util::s(&value, "name").to_string();
                    *picked = util::arr(&value, "plugins").iter().map(|_| true).collect();
                    *manifest = Some(value);
                }
                Err(message) => *error = message,
            }
        }
        dialog
    }

    pub fn export_pack() -> Self {
        Dialog::ExportPack {
            instance_id: String::new(),
            name: String::new(),
            author: String::new(),
            description: String::new(),
            path: String::new(),
            error: String::new(),
        }
    }

    fn title(&self) -> String {
        match self {
            Dialog::Connection => "连接本地引擎".into(),
            Dialog::Instance { id, .. } => {
                if id.is_some() {
                    "配置实例".into()
                } else {
                    "新建实例".into()
                }
            }
            Dialog::CloneInstance { .. } => "克隆实例".into(),
            Dialog::Path { kind, .. } => match kind {
                PathKind::Register => "注册已有内核".into(),
                PathKind::Import => "导入实例".into(),
                PathKind::Export => "导出实例".into(),
            },
            Dialog::InstallKernel { .. } => "安装精确内核版本".into(),
            Dialog::Plugin { plugin, .. } => plugin
                .as_ref()
                .map(|value| format!("安装 {}", util::s(value, "name")))
                .unwrap_or_else(|| "按引用安装插件".into()),
            Dialog::Pack { pack, .. } => format!("配置 {}", util::s(pack, "name")),
            Dialog::Desktop { .. } => "安装便携桌面端".into(),
            Dialog::Confirm { title, .. } => title.clone(),
            Dialog::ImportPack { .. } => "导入整合包清单".into(),
            Dialog::ExportPack { .. } => "从实例导出整合包".into(),
        }
    }

    fn body(&mut self, app: &mut App, ui: &mut egui::Ui, pal: &Palette, close: &mut bool) {
        match self {
            Dialog::Connection => connection(app, ui, pal, close),
            Dialog::Instance {
                id,
                name,
                kind,
                kernel_id,
                workspace,
                port,
                executable,
                error,
            } => instance_dialog(
                app, ui, pal, close, id, name, kind, kernel_id, workspace, port, executable, error,
            ),
            Dialog::CloneInstance {
                instance_id,
                name,
                error,
            } => {
                ui.label(
                    egui::RichText::new("副本拥有独立的实例目录和配置，不与原实例共享可变数据。")
                        .size(11.0)
                        .color(pal.muted),
                );
                ui.add_space(6.0);
                ui.label(egui::RichText::new("副本名称").size(11.0).color(pal.muted));
                ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
                error_line(ui, pal, error);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("取消").clicked() {
                        *close = true;
                    }
                    if util::primary_button(ui, pal, "克隆实例").clicked() {
                        if name.trim().is_empty() {
                            *error = "请填写副本名称。".into();
                        } else {
                            app.run(
                                "clone_instance",
                                json!({ "id": instance_id, "name": name.trim() }),
                                "克隆实例",
                            );
                            *close = true;
                        }
                    }
                });
            }
            Dialog::Path {
                kind,
                path,
                instance_id,
                error,
                result,
            } => {
                let (label, hint) = match kind {
                    PathKind::Register => ("内核包目录", "引擎会验证真实的 DSH 包与 CLI。"),
                    PathKind::Import => (
                        "实例描述文件路径",
                        "填写引擎所在机器上的实例描述文件绝对路径。",
                    ),
                    PathKind::Export => (
                        "导出文件路径",
                        "填写引擎所在机器上的目标文件绝对路径。导出内容不包含凭据。",
                    ),
                };
                ui.label(
                    egui::RichText::new(hint).size(10.5).color(pal.muted),
                );
                ui.add_space(4.0);
                ui.label(egui::RichText::new(label).size(11.0).color(pal.muted));
                ui.add(
                    egui::TextEdit::singleline(path)
                        .desired_width(f32::INFINITY)
                        .hint_text(if *kind == PathKind::Export {
                            "C:\\Exports\\workspace.json"
                        } else {
                            "填写绝对路径"
                        }),
                );
                if *kind == PathKind::Register {
                    app.load_discovered();
                    if let Some(discovered) = &app.discovered {
                        let candidates: Vec<Value> = util::arr(discovered, "kernels")
                            .iter()
                            .filter(|item| util::b(item, "valid") && !util::b(item, "alreadyRegistered"))
                            .cloned()
                            .collect();
                        if !candidates.is_empty() {
                            ui.label(
                                egui::RichText::new(format!(
                                    "本机发现 {} 个可注册候选",
                                    candidates.len()
                                ))
                                .size(10.5)
                                .color(pal.muted),
                            );
                            let mut pick = None;
                            for item in &candidates {
                                if ui
                                    .add(
                                        egui::Button::new(
                                            egui::RichText::new(format!(
                                                "v{}  {}",
                                                util::s(item, "version"),
                                                util::s(item, "directory")
                                            ))
                                            .size(10.5),
                                        )
                                        .frame(false),
                                    )
                                    .clicked()
                                {
                                    pick = Some(util::s(item, "directory").to_string());
                                }
                            }
                            if let Some(pick) = pick {
                                *path = pick;
                            }
                        }
                    }
                }
                if !result.is_empty() {
                    ui.label(
                        egui::RichText::new(format!("导出完成：{}", result))
                            .size(10.5)
                            .color(pal.green),
                    );
                }
                error_line(ui, pal, error);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("取消").clicked() {
                        *close = true;
                    }
                    let action = match kind {
                        PathKind::Register => "register_kernel",
                        PathKind::Import => "import_instance",
                        PathKind::Export => "export_instance",
                    };
                    if util::primary_button(
                        ui,
                        pal,
                        if *kind == PathKind::Register {
                            "注册"
                        } else if *kind == PathKind::Import {
                            "导入"
                        } else {
                            "导出"
                        },
                    )
                    .clicked()
                    {
                        if path.trim().is_empty() {
                            *error = "请填写绝对路径。".into();
                        } else {
                            let payload = match kind {
                                PathKind::Register => json!({ "directory": path.trim() }),
                                PathKind::Import => json!({ "path": path.trim() }),
                                PathKind::Export => json!({
                                    "id": instance_id,
                                    "destination": path.trim()
                                }),
                            };
                            let label = match kind {
                                PathKind::Register => "注册内核",
                                PathKind::Import => "导入实例",
                                PathKind::Export => "导出实例",
                            };
                            app.run(action, payload, label);
                            *close = true;
                        }
                    }
                });
            }
            Dialog::InstallKernel { version, error } => {
                ui.label(
                    egui::RichText::new("从 npm 安装到独立目录，不覆盖已有内核。")
                        .size(10.5)
                        .color(pal.muted),
                );
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new("npm 精确版本")
                        .size(11.0)
                        .color(pal.muted),
                );
                ui.add(
                    egui::TextEdit::singleline(version)
                        .desired_width(f32::INFINITY)
                        .hint_text("major.minor.patch"),
                );
                if let Some(versions) = &app.kernel_versions {
                    let options: Vec<String> = util::arr(versions, "versions")
                        .iter()
                        .filter_map(Value::as_str)
                        .take(30)
                        .map(str::to_string)
                        .collect();
                    if !options.is_empty() {
                        ui.label(
                            egui::RichText::new("可选版本（点选填入）")
                                .size(9.5)
                                .color(pal.muted),
                        );
                        ui.horizontal_wrapped(|ui| {
                            for option in &options {
                                if ui
                                    .add(egui::Button::new(
                                        egui::RichText::new(option).size(9.5),
                                    )
                                    .frame(false))
                                    .clicked()
                                {
                                    *version = option.clone();
                                }
                            }
                        });
                    }
                }
                error_line(ui, pal, error);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("取消").clicked() {
                        *close = true;
                    }
                    if util::primary_button(ui, pal, "安装内核").clicked() {
                        if !valid_version(version) {
                            *error = "请输入完整的 npm 精确版本（major.minor.patch）。".into();
                        } else {
                            app.run(
                                "install_kernel",
                                json!({ "version": version.trim() }),
                                &format!("安装内核 {}", version.trim()),
                            );
                            *close = true;
                        }
                    }
                });
            }
            Dialog::Plugin {
                plugin,
                instance_id,
                reference,
                error,
            } => plugin_dialog(app, ui, pal, close, plugin, instance_id, reference, error),
            Dialog::Pack {
                pack,
                name,
                kernel_id,
                error,
            } => pack_dialog(app, ui, pal, close, pack, name, kernel_id, error),
            Dialog::Desktop {
                asset,
                kind,
                tag,
                name,
                error,
            } => {
                ui.label(
                    egui::RichText::new("下载、校验并解压便携 ZIP，为桌面端创建独立实例。")
                        .size(10.5)
                        .color(pal.muted),
                );
                ui.label(egui::RichText::new("实例名称").size(11.0).color(pal.muted));
                ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
                ui.label(
                    egui::RichText::new(format!(
                        "安装文件：{}",
                        util::s(asset, "name")
                    ))
                    .size(10.5)
                    .color(pal.muted)
                    .monospace(),
                );
                ui.label(
                    egui::RichText::new(if util::opt(asset, "sha256").is_some() {
                        "SHA-256 已提供"
                    } else {
                        "来源未提供 SHA-256；引擎会记录下载文件的实际哈希"
                    })
                    .size(10.0)
                    .color(pal.muted),
                );
                error_line(ui, pal, error);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("取消").clicked() {
                        *close = true;
                    }
                    if util::primary_button(ui, pal, "下载并安装").clicked() {
                        if name.trim().is_empty() {
                            *error = "请填写实例名称。".into();
                        } else {
                            let mut payload = json!({
                                "kind": kind,
                                "name": name.trim(),
                                "url": util::s(asset, "url"),
                                "filename": util::s(asset, "name"),
                            });
                            if let Some(sha) = util::opt(asset, "sha256") {
                                payload["sha256"] = json!(sha);
                            }
                            app.run(
                                "install_desktop",
                                payload,
                                &format!("安装 {}", util::s(asset, "name")),
                            );
                            let _ = tag;
                            *close = true;
                        }
                    }
                });
            }
            Dialog::Confirm {
                message,
                label,
                action,
                payload,
                danger,
                error,
                ..
            } => {
                ui.label(
                    egui::RichText::new(message.as_str())
                        .size(12.0)
                        .color(pal.text),
                );
                error_line(ui, pal, error);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("取消").clicked() {
                        *close = true;
                    }
                    let clicked = if *danger {
                        util::danger_button(ui, pal, label).clicked()
                    } else {
                        util::primary_button(ui, pal, label).clicked()
                    };
                    if clicked {
                        app.run(action, payload.clone(), label);
                        *close = true;
                    }
                });
            }
            Dialog::ImportPack {
                path,
                manifest,
                mode,
                instance_id,
                name,
                kernel_id,
                picked,
                error,
            } => import_pack(
                app,
                ui,
                pal,
                close,
                path,
                manifest,
                mode,
                instance_id,
                name,
                kernel_id,
                picked,
                error,
            ),
            Dialog::ExportPack {
                instance_id,
                name,
                author,
                description,
                path,
                error,
            } => export_pack(
                app,
                ui,
                pal,
                close,
                instance_id,
                name,
                author,
                description,
                path,
                error,
            ),
        }
    }
}

fn valid_version(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')) {
        return false;
    }
    let core = value.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn error_line(ui: &mut egui::Ui, pal: &Palette, error: &str) {
    if !error.is_empty() {
        ui.label(egui::RichText::new(error).size(11.0).color(pal.coral));
    }
}

fn combo(
    ui: &mut egui::Ui,
    id: &str,
    value: &mut String,
    options: &[(String, String)],
    placeholder: &str,
) {
    let label = options
        .iter()
        .find(|(key, _)| key == value)
        .map(|(_, label)| label.clone())
        .unwrap_or_else(|| placeholder.to_string());
    egui::ComboBox::from_id_salt(id)
        .selected_text(egui::RichText::new(label).size(12.0))
        .width(ui.available_width().min(360.0))
        .show_ui(ui, |ui| {
            for (key, label) in options {
                ui.selectable_value(value, key.clone(), label);
            }
        });
}

fn connection(app: &mut App, ui: &mut egui::Ui, pal: &Palette, close: &mut bool) {
    ui.label(
        egui::RichText::new("原生窗口直接调用本地 Rust 引擎，不再经过 WebView2 或 HTTP 桥接。")
            .size(11.0)
            .color(pal.muted),
    );
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new("引擎状态").size(11.0).color(pal.muted));
        util::badge(
            ui,
            pal,
            if app.online() {
                "已连接"
            } else if app.connecting() {
                "连接中"
            } else {
                "未连接"
            },
            if app.online() {
                util::Tone::Accent
            } else {
                util::Tone::Coral
            },
        );
    });
    if !app.engine_error().is_empty() {
        ui.label(
            egui::RichText::new(app.engine_error())
                .size(10.5)
                .color(pal.coral),
        );
    }
    ui.add_space(8.0);
    if ui.button("完成").clicked() {
        *close = true;
    }
}

#[allow(clippy::too_many_arguments)]
fn instance_dialog(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    close: &mut bool,
    id: &Option<String>,
    name: &mut String,
    kind: &mut String,
    kernel_id: &mut String,
    workspace: &mut String,
    port: &mut String,
    executable: &mut String,
    error: &mut String,
) {
    let snapshot = app.snap();
    let kernels: Vec<Value> = snapshot
        .as_ref()
        .map(|value| util::arr(value, "kernels").to_vec())
        .unwrap_or_default();
    if id.is_none() {
        ui.label(egui::RichText::new("独立的实例目录、配置和进程，让不同工作区互不打扰。").size(10.5).color(pal.muted));
    }
    ui.add_space(4.0);
    ui.label(egui::RichText::new("实例名称").size(11.0).color(pal.muted));
    ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
    if id.is_none() {
        ui.label(egui::RichText::new("实例类型").size(11.0).color(pal.muted));
        combo(
            ui,
            "instance-kind",
            kind,
            &[
                ("harness".into(), "Harness".into()),
                ("eac-desktop".into(), "EAC Desktop".into()),
                ("official-desktop".into(), "Official Desktop".into()),
            ],
            "选择类型",
        );
    }
    if kind == "harness" {
        ui.label(egui::RichText::new("已安装内核").size(11.0).color(pal.muted));
        if kernels.is_empty() {
            ui.label(
                egui::RichText::new("暂无已安装内核。请先在内核仓库安装或注册。")
                    .size(10.5)
                    .color(pal.yellow),
            );
        } else {
            let options: Vec<(String, String)> = kernels
                .iter()
                .map(|kernel| {
                    (
                        util::s(kernel, "id").to_string(),
                        format!("{} / {}", util::s(kernel, "version"), util::s(kernel, "id")),
                    )
                })
                .collect();
            if kernel_id.is_empty() {
                if let Some((first, _)) = options.first() {
                    *kernel_id = first.clone();
                }
            }
            combo(ui, "instance-kernel", kernel_id, &options, "请选择已安装内核");
        }
    } else {
        ui.label(
            egui::RichText::new("已有可执行文件")
                .size(11.0)
                .color(pal.muted),
        );
        ui.add(
            egui::TextEdit::singleline(executable)
                .desired_width(f32::INFINITY)
                .hint_text("C:\\Apps\\EAC\\EAC.exe"),
        );
        app.load_discovered();
        if let Some(discovered) = &app.discovered {
            let desktops = util::arr(discovered, "desktops").to_vec();
            if !desktops.is_empty() {
                ui.label(
                    egui::RichText::new("本机发现的可执行文件（点选填入）")
                        .size(9.5)
                        .color(pal.muted),
                );
                ui.horizontal_wrapped(|ui| {
                    for item in desktops.iter().take(6) {
                        if ui
                            .add(egui::Button::new(
                                egui::RichText::new(util::s(item, "name")).size(9.5),
                            )
                            .frame(false))
                            .clicked()
                        {
                            *executable = util::s(item, "path").to_string();
                        }
                    }
                });
            }
        }
    }
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(egui::RichText::new("端口").size(11.0).color(pal.muted));
            ui.add(
                egui::TextEdit::singleline(port)
                    .desired_width(110.0)
                    .hint_text("自动分配"),
            );
        });
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new("工作目录（选填）")
                    .size(11.0)
                    .color(pal.muted),
            );
            ui.add(
                egui::TextEdit::singleline(workspace)
                    .desired_width(ui.available_width())
                    .hint_text("默认托管目录"),
            );
        });
    });
    error_line(ui, pal, error);
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("取消").clicked() {
            *close = true;
        }
        let label = if id.is_some() { "保存配置" } else { "创建实例" };
        if util::primary_button(ui, pal, label).clicked() {
            if name.trim().is_empty() {
                *error = "请为实例填写名称。".into();
                return;
            }
            if kind == "harness" && kernel_id.is_empty() {
                *error = "请先安装或注册内核，再创建 Harness 实例。".into();
                return;
            }
            if !port.trim().is_empty() {
                match port.trim().parse::<u32>() {
                    Ok(value) if (1024..=65535).contains(&value) => {}
                    _ => {
                        *error = "请输入 1024 至 65535 之间的整数端口，或留空自动分配。".into();
                        return;
                    }
                }
            }
            let mut payload = json!({ "name": name.trim() });
            if let Some(id) = id {
                payload["id"] = json!(id);
            } else {
                payload["kind"] = json!(kind);
            }
            if kind == "harness" {
                payload["kernelId"] = json!(kernel_id);
            }
            if !workspace.trim().is_empty() {
                payload["workspace"] = json!(workspace.trim());
            }
            if !port.trim().is_empty() {
                payload["port"] = json!(port.trim().parse::<u32>().unwrap_or(0));
            }
            if kind != "harness" && !executable.trim().is_empty() {
                payload["executable"] = json!(executable.trim());
            }
            app.run(
                if id.is_some() {
                    "update_instance"
                } else {
                    "create_instance"
                },
                payload,
                if id.is_some() { "更新实例配置" } else { "创建独立实例" },
            );
            *close = true;
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn plugin_dialog(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    close: &mut bool,
    plugin: &Option<Value>,
    instance_id: &mut String,
    reference: &mut String,
    error: &mut String,
) {
    let snapshot = app.snap();
    let instances: Vec<Value> = snapshot
        .as_ref()
        .map(|value| util::arr(value, "instances").to_vec())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            util::s(item, "kind") == "harness" && util::s(item, "status") == "stopped"
        })
        .collect();
    let options: Vec<(String, String)> = instances
        .iter()
        .map(|item| (util::s(item, "id").to_string(), util::s(item, "name").to_string()))
        .collect();
    if instance_id.is_empty() {
        if let Some((first, _)) = options.first() {
            *instance_id = first.clone();
        }
    }
    ui.label(
        egui::RichText::new("目标实例（修改插件前请先停止 Harness 实例）")
            .size(11.0)
            .color(pal.muted),
    );
    combo(ui, "plugin-instance", instance_id, &options, "选择已停止的实例");
    ui.label(
        egui::RichText::new("插件精确引用")
            .size(11.0)
            .color(pal.muted),
    );
    if plugin.is_some() {
        ui.label(
            egui::RichText::new(reference.as_str())
                .size(11.5)
                .color(pal.text)
                .monospace(),
        );
    } else {
        ui.add(
            egui::TextEdit::singleline(reference)
                .desired_width(f32::INFINITY)
                .hint_text("package@exact-version 或 repository#commit"),
        );
    }
    if let Some(plugin) = plugin {
        ui.label(
            egui::RichText::new(match util::opt(plugin, "coreRange") {
                Some(range) => format!("声明内核范围：{}。尚未验证兼容性。", range),
                None => "来源未提供经过验证的内核兼容性信息。".into(),
            })
            .size(10.0)
            .color(pal.yellow),
        );
    }
    error_line(ui, pal, error);
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("取消").clicked() {
            *close = true;
        }
        if util::primary_button(ui, pal, "安装到实例").clicked() {
            if instance_id.is_empty() {
                *error = "请选择已停止的 Harness 实例。".into();
                return;
            }
            if reference.trim().is_empty() {
                *error = "请填写插件精确引用。".into();
                return;
            }
            let mut payload = json!({
                "instanceId": instance_id,
                "ref": reference.trim(),
            });
            if let Some(sha) = plugin
                .as_ref()
                .and_then(|value| util::opt(value, "sha256"))
            {
                payload["expectedSha256"] = json!(sha);
            }
            app.run("install_plugin", payload, "安装插件");
            *close = true;
        }
    });
}

fn pack_dialog(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    close: &mut bool,
    pack: &Value,
    name: &mut String,
    kernel_id: &mut String,
    error: &mut String,
) {
    let snapshot = app.snap();
    let kernels: Vec<Value> = snapshot
        .as_ref()
        .map(|value| util::arr(value, "kernels").to_vec())
        .unwrap_or_default();
    let options: Vec<(String, String)> = kernels
        .iter()
        .map(|item| (util::s(item, "id").to_string(), util::s(item, "version").to_string()))
        .collect();
    if kernel_id.is_empty() {
        let declared = util::opt(pack, "kernelVersion");
        let found = kernels
            .iter()
            .find(|item| Some(util::s(item, "version")) == declared)
            .map(|item| util::s(item, "id").to_string())
            .or_else(|| options.first().map(|(id, _)| id.clone()));
        if let Some(found) = found {
            *kernel_id = found;
        }
    }
    let refs = util::arr(pack, "plugins").len();
    ui.label(
        egui::RichText::new(format!(
            "创建独立实例，再按目录顺序逐个安装 {} 个插件引用。",
            refs
        ))
        .size(10.5)
        .color(pal.muted),
    );
    ui.label(egui::RichText::new("实例名称").size(11.0).color(pal.muted));
    ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
    ui.label(egui::RichText::new("已安装内核").size(11.0).color(pal.muted));
    combo(ui, "pack-kernel", kernel_id, &options, "请选择已安装内核");
    if let Some(version) = util::opt(pack, "kernelVersion") {
        ui.label(
            egui::RichText::new(format!("整合包声明内核 {}，其他版本兼容性未知。", version))
                .size(10.0)
                .color(pal.yellow),
        );
    }
    ui.collapsing(egui::RichText::new("查看精确引用").size(10.5), |ui| {
        for item in util::arr(pack, "plugins").iter().take(40) {
            util::code(ui, pal, util::s(item, "ref"));
        }
    });
    error_line(ui, pal, error);
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("取消").clicked() {
            *close = true;
        }
        if util::primary_button(ui, pal, "创建并安装整合包").clicked() {
            if name.trim().is_empty() {
                *error = "请填写实例名称。".into();
                return;
            }
            if kernel_id.is_empty() {
                *error = "请选择已安装内核。".into();
                return;
            }
            let refs: Vec<(String, Option<String>)> = util::arr(pack, "plugins")
                .iter()
                .map(|item| {
                    (
                        util::s(item, "ref").to_string(),
                        util::opt(item, "sha256").map(str::to_string),
                    )
                })
                .collect();
            let create = json!({
                "name": name.trim(),
                "kind": "harness",
                "kernelId": kernel_id,
            });
            app.start_install_job(
                format!("安装整合包「{}」", util::s(pack, "name")),
                refs,
                Some(create),
                None,
            );
            *close = true;
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn import_pack(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    close: &mut bool,
    path: &mut String,
    manifest: &mut Option<Value>,
    mode: &mut String,
    instance_id: &mut String,
    name: &mut String,
    kernel_id: &mut String,
    picked: &mut Vec<bool>,
    error: &mut String,
) {
    ui.label(
        egui::RichText::new("读取本机上的 .eacpack.json 清单；只导入插件引用，不导入插件本体。")
            .size(10.5)
            .color(pal.muted),
    );
    ui.horizontal(|ui| {
        ui.add(
            egui::TextEdit::singleline(path)
                .desired_width(ui.available_width() - 90.0)
                .hint_text("C:\\Packs\\my-pack.eacpack.json"),
        );
        if ui.button("读取").clicked() {
            match read_manifest(path.trim()) {
                Ok(value) => {
                    *name = util::s(&value, "name").to_string();
                    *picked = util::arr(&value, "plugins").iter().map(|_| true).collect();
                    *error = String::new();
                    *manifest = Some(value);
                }
                Err(message) => *error = message,
            }
        }
    });

    let Some(value) = manifest.clone() else {
        error_line(ui, pal, error);
        ui.add_space(8.0);
        if ui.button("取消").clicked() {
            *close = true;
        }
        return;
    };

    ui.add_space(4.0);
    ui.label(
        egui::RichText::new(util::s(&value, "name"))
            .size(14.0)
            .strong()
            .color(pal.text),
    );
    let description = util::s(&value, "description");
    if !description.is_empty() {
        ui.label(
            egui::RichText::new(description)
                .size(10.5)
                .color(pal.muted),
        );
    }
    ui.label(
        egui::RichText::new(format!(
            "by {} · {} 个插件引用{}",
            util::opt(&value, "author").unwrap_or("匿名"),
            util::arr(&value, "plugins").len(),
            util::opt(&value, "kernelVersion")
                .map(|version| format!(" · 声明内核 {}", version))
                .unwrap_or_default()
        ))
        .size(10.0)
        .color(pal.muted),
    );

    ui.add_space(4.0);
    let snapshot = app.snap();
    let stopped: Vec<Value> = snapshot
        .as_ref()
        .map(|snapshot| {
            util::arr(snapshot, "instances")
                .iter()
                .filter(|item| {
                    util::s(item, "kind") == "harness" && util::s(item, "status") == "stopped"
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let kernels: Vec<Value> = snapshot
        .as_ref()
        .map(|snapshot| util::arr(snapshot, "kernels").to_vec())
        .unwrap_or_default();
    ui.horizontal(|ui| {
        if ui
            .add(util::SelectableLabel::new(
                mode == "existing",
                egui::RichText::new("装进已有实例").size(11.0),
            ))
            .clicked()
            && !stopped.is_empty()
        {
            *mode = "existing".into();
        }
        if ui
            .add(util::SelectableLabel::new(
                mode == "new",
                egui::RichText::new("新建独立实例").size(11.0),
            ))
            .clicked()
        {
            *mode = "new".into();
        }
    });
    if mode == "existing" {
        let options: Vec<(String, String)> = stopped
            .iter()
            .map(|item| (util::s(item, "id").to_string(), util::s(item, "name").to_string()))
            .collect();
        if instance_id.is_empty() {
            if let Some((first, _)) = options.first() {
                *instance_id = first.clone();
            }
        }
        combo(ui, "import-instance", instance_id, &options, "选择已停止的实例");
    } else {
        ui.label(egui::RichText::new("新实例名称").size(11.0).color(pal.muted));
        ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
        let options: Vec<(String, String)> = kernels
            .iter()
            .map(|item| (util::s(item, "id").to_string(), util::s(item, "version").to_string()))
            .collect();
        if kernel_id.is_empty() {
            let declared = util::opt(&value, "kernelVersion");
            let found = kernels
                .iter()
                .find(|item| Some(util::s(item, "version")) == declared)
                .map(|item| util::s(item, "id").to_string())
                .or_else(|| options.first().map(|(id, _)| id.clone()));
            if let Some(found) = found {
                *kernel_id = found;
            }
        }
        ui.label(egui::RichText::new("已安装内核").size(11.0).color(pal.muted));
        combo(ui, "import-kernel", kernel_id, &options, "请选择内核");
    }

    ui.add_space(4.0);
    ui.label(
        egui::RichText::new(format!(
            "插件清单 · 已选 {} / {}",
            picked.iter().filter(|value| **value).count(),
            util::arr(&value, "plugins").len()
        ))
        .size(11.0)
        .color(pal.muted),
    );
    egui::ScrollArea::vertical()
        .max_height(200.0)
        .show(ui, |ui| {
            let plugins = util::arr(&value, "plugins").to_vec();
            for (index, item) in plugins.iter().enumerate() {
                if index >= picked.len() {
                    picked.push(true);
                }
                ui.horizontal(|ui| {
                    ui.checkbox(&mut picked[index], "");
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(util::s(item, "name"))
                                .size(11.0)
                                .color(pal.text),
                        );
                        util::code(ui, pal, util::s(item, "ref"));
                    });
                });
            }
        });
    error_line(ui, pal, error);
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("取消").clicked() {
            *close = true;
        }
        if util::primary_button(
            ui,
            pal,
            if mode == "existing" {
                "空投到实例"
            } else {
                "创建并空投"
            },
        )
        .clicked()
        {
            let plugins = util::arr(&value, "plugins").to_vec();
            let refs: Vec<(String, Option<String>)> = plugins
                .iter()
                .enumerate()
                .filter(|(index, _)| picked.get(*index).copied().unwrap_or(true))
                .map(|(_, item)| {
                    (
                        util::s(item, "ref").to_string(),
                        util::opt(item, "sha256").map(str::to_string),
                    )
                })
                .collect();
            if refs.is_empty() {
                *error = "请至少选择一个插件引用。".into();
                return;
            }
            if mode == "existing" {
                if instance_id.is_empty() {
                    *error = "请选择目标实例。".into();
                    return;
                }
                app.start_install_job(
                    format!("空投「{}」", util::s(&value, "name")),
                    refs,
                    None,
                    Some(instance_id.clone()),
                );
            } else {
                if name.trim().is_empty() || kernel_id.is_empty() {
                    *error = "请填写实例名称并选择内核。".into();
                    return;
                }
                app.start_install_job(
                    format!("空投「{}」", util::s(&value, "name")),
                    refs,
                    Some(json!({
                        "name": name.trim(),
                        "kind": "harness",
                        "kernelId": kernel_id,
                    })),
                    None,
                );
            }
            *close = true;
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn export_pack(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    close: &mut bool,
    instance_id: &mut String,
    name: &mut String,
    author: &mut String,
    description: &mut String,
    path: &mut String,
    error: &mut String,
) {
    let snapshot = app.snap();
    let harness: Vec<Value> = snapshot
        .as_ref()
        .map(|snapshot| {
            util::arr(snapshot, "instances")
                .iter()
                .filter(|item| util::s(item, "kind") == "harness")
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let options: Vec<(String, String)> = harness
        .iter()
        .map(|item| {
            (
                util::s(item, "id").to_string(),
                format!(
                    "{}（{} 个插件）",
                    util::s(item, "name"),
                    util::arr(item, "plugins")
                        .iter()
                        .filter(|plugin| !util::s(plugin, "name").starts_with("@deepseek-ai/"))
                        .count()
                ),
            )
        })
        .collect();
    if instance_id.is_empty() {
        if let Some((first, _)) = options.first() {
            *instance_id = first.clone();
        }
    }
    if name.is_empty() {
        if let Some(instance) = harness
            .iter()
            .find(|item| util::s(item, "id") == instance_id)
        {
            *name = format!("{} 的组合", util::s(instance, "name"));
        }
    }
    let instance = harness
        .iter()
        .find(|item| util::s(item, "id") == instance_id);
    let (resolved, unresolved) = instance
        .map(|instance| resolve_instance_refs(instance, &app.catalog))
        .unwrap_or_default();

    ui.label(
        egui::RichText::new("识别实例已安装插件，生成只含引用的清单——别人导入即可复刻。")
            .size(10.5)
            .color(pal.muted),
    );
    ui.label(egui::RichText::new("来源实例").size(11.0).color(pal.muted));
    combo(ui, "export-instance", instance_id, &options, "选择 Harness 实例");
    ui.label(egui::RichText::new("整合包名称").size(11.0).color(pal.muted));
    ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY));
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(egui::RichText::new("作者署名").size(11.0).color(pal.muted));
            ui.add(egui::TextEdit::singleline(author).desired_width(180.0));
        });
        ui.vertical(|ui| {
            ui.label(egui::RichText::new("一句话介绍").size(11.0).color(pal.muted));
            ui.add(egui::TextEdit::singleline(description).desired_width(ui.available_width()));
        });
    });
    ui.label(
        egui::RichText::new(format!(
            "识别结果：{} / {} 可安装引用{}",
            resolved.len(),
            resolved.len() + unresolved.len(),
            if unresolved.is_empty() {
                String::new()
            } else {
                format!(" · {} 个无法匹配", unresolved.len())
            }
        ))
        .size(10.5)
        .color(pal.muted),
    );
    egui::ScrollArea::vertical()
        .max_height(150.0)
        .show(ui, |ui| {
            for item in &resolved {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("•").size(11.0).color(pal.accent));
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(util::s(item, "name"))
                                .size(10.5)
                                .color(pal.text),
                        );
                        util::code(ui, pal, util::s(item, "ref"));
                    });
                });
            }
        });
    ui.label(egui::RichText::new("导出文件路径").size(11.0).color(pal.muted));
    ui.add(
        egui::TextEdit::singleline(path)
            .desired_width(f32::INFINITY)
            .hint_text("C:\\Exports\\my-pack.eacpack.json"),
    );
    error_line(ui, pal, error);
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("取消").clicked() {
            *close = true;
        }
        if util::primary_button(ui, pal, "写出清单文件").clicked() {
            if name.trim().is_empty() {
                *error = "请填写整合包名称。".into();
                return;
            }
            if resolved.is_empty() {
                *error = "没有识别到可导出的插件引用。".into();
                return;
            }
            if path.trim().is_empty() {
                *error = "请填写导出文件路径。".into();
                return;
            }
            let kernel_version = instance.and_then(|instance| {
                let kernel_id = util::s(instance, "kernelId");
                snapshot.as_ref().and_then(|snapshot| {
                    util::arr(snapshot, "kernels")
                        .iter()
                        .find(|kernel| util::s(kernel, "id") == kernel_id)
                        .map(|kernel| util::s(kernel, "version").to_string())
                })
            });
            let mut manifest = json!({
                "format": "eac-pack",
                "version": 1,
                "name": name.trim(),
                "author": if author.trim().is_empty() { "匿名" } else { author.trim() },
                "description": description.trim(),
                "createdAt": chrono::Utc::now().to_rfc3339(),
                "plugins": resolved,
                "unresolved": unresolved,
            });
            if let Some(kernel_version) = kernel_version {
                manifest["kernelVersion"] = json!(kernel_version);
            }
            let mut destination = path.trim().to_string();
            if !destination.to_lowercase().ends_with(".json") {
                destination.push_str(".eacpack.json");
            }
            match std::fs::write(&destination, serde_json::to_string_pretty(&manifest).unwrap_or_default()) {
                Ok(_) => {
                    app.notify(format!("已导出清单到 {}", destination), util::Tone::Success);
                    *close = true;
                }
                Err(write_error) => *error = format!("写入失败：{}", write_error),
            }
        }
    });
}

fn valid_ref(value: &str) -> bool {
    if value.is_empty() || value.len() > 300 || value.starts_with('-') {
        return false;
    }
    if value.starts_with("https://") {
        return true;
    }
    if let Some(rest) = value.strip_prefix("github:") {
        let pieces: Vec<&str> = rest.split('#').next().unwrap_or("").split('/').collect();
        return pieces.len() == 2
            && pieces
                .iter()
                .all(|piece| !piece.is_empty() && *piece != "." && *piece != "..");
    }
    match value.rfind('@') {
        Some(index) if index > 0 => {
            !value[..index].contains(char::is_whitespace) && !value[index + 1..].trim().is_empty()
        }
        _ => false,
    }
}

fn resolve_instance_refs(
    instance: &Value,
    catalog: &Option<Value>,
) -> (Vec<Value>, Vec<Value>) {
    let catalog_plugins: Vec<Value> = catalog
        .as_ref()
        .map(|value| util::arr(value, "plugins").to_vec())
        .unwrap_or_default();
    let mut resolved: Vec<Value> = Vec::new();
    let mut unresolved: Vec<Value> = Vec::new();
    for plugin in util::arr(instance, "plugins") {
        let name = util::s(plugin, "name");
        if name.starts_with("@deepseek-ai/") {
            continue;
        }
        let version = util::s(plugin, "version");
        let source = util::s(plugin, "source");
        let mut reference = String::new();
        let mut sha256: Option<String> = None;
        let mut origin = "installed";
        if valid_ref(source) {
            reference = source.to_string();
        } else {
            let candidates: Vec<&Value> = catalog_plugins
                .iter()
                .filter(|item| {
                    util::s(item, "name") == name
                        && util::b(item, "installable")
                        && util::opt(item, "ref").is_some()
                })
                .collect();
            let matched = candidates
                .iter()
                .find(|item| util::s(item, "version") == version)
                .or_else(|| candidates.first());
            if let Some(matched) = matched {
                reference = util::s(matched, "ref").to_string();
                sha256 = util::opt(matched, "sha256").map(str::to_string);
                origin = "catalog";
            } else if version != "unknown" && !name.is_empty() {
                reference = format!("{}@{}", name, version);
            }
        }
        if reference.is_empty() {
            unresolved.push(json!({
                "name": name,
                "version": version,
                "reason": "目录与实例都没有提供可安装的精确引用"
            }));
            continue;
        }
        if resolved
            .iter()
            .any(|item| util::s(item, "ref") == reference)
        {
            continue;
        }
        let mut item = json!({
            "name": name,
            "version": version,
            "ref": reference,
            "origin": origin,
        });
        if let Some(sha) = sha256 {
            if reference.starts_with("https://") {
                item["sha256"] = json!(sha);
            }
        }
        resolved.push(item);
    }
    (resolved, unresolved)
}

fn read_manifest(path: &str) -> Result<Value, String> {
    if path.trim().is_empty() {
        return Err("请填写清单文件路径。".into());
    }
    let raw = std::fs::read_to_string(path.trim())
        .map_err(|error| format!("读取失败：{}", error))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|error| format!("文件不是有效的 JSON：{}", error))?;
    if util::s(&value, "format") != "eac-pack" || util::i(&value, "version") != 1 {
        return Err("这不是 EAC 整合包清单（缺少 eac-pack 标记）。".into());
    }
    if util::s(&value, "name").trim().is_empty() {
        return Err("整合包缺少有效的名称。".into());
    }
    if !value.get("plugins").map(Value::is_array).unwrap_or(false) {
        return Err("整合包插件列表缺失。".into());
    }
    Ok(value)
}

pub fn show(app: &mut App, ctx: &egui::Context, pal: &Palette) {
    let Some(mut dialog) = app.dialog.take() else {
        return;
    };
    let title = dialog.title();
    let mut close = false;
    egui::Window::new(title)
        .id(egui::Id::new("eac-dialog"))
        .collapsible(false)
        .resizable(false)
        .default_width(520.0)
        .max_height(720.0)
        .scroll(true)
        .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
        .show(ctx, |ui| {
            dialog.body(app, ui, pal, &mut close);
        });
    app.dialog = if close { None } else { Some(dialog) };
}
