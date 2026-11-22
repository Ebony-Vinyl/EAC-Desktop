use crate::gui::util::{self, Palette, Tone};
use crate::gui::{App, View};
use eframe::egui;
use serde_json::{json, Value};

pub fn tasks(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let tasks: Vec<Value> = app
        .snap()
        .map(|snapshot| util::arr(&snapshot, "tasks").iter().rev().cloned().collect())
        .unwrap_or_default();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "SYSTEM / ACTIVITY",
                "任务记录.",
                "每次操作的真实结果，都留在这里。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::ghost_button(ui, pal, "刷新任务").clicked() {
                app.notify("快照每 1.5 秒自动刷新。", Tone::Info);
            }
        });
    });

    if !app.pending.is_empty() {
        ui.label(
            egui::RichText::new(format!("正在执行 {} 个操作", app.pending.len()))
                .size(11.5)
                .color(pal.yellow),
        );
        for item in &app.pending {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(
                    egui::RichText::new(&item.label)
                        .size(12.0)
                        .strong()
                        .color(pal.text),
                );
                ui.label(
                    egui::RichText::new("等待引擎响应")
                        .size(10.5)
                        .color(pal.muted),
                );
            });
        }
        ui.add_space(6.0);
    }

    ui.horizontal_wrapped(|ui| {
        ui.add(
            egui::TextEdit::singleline(&mut app.task_query)
                .hint_text("搜索操作或错误信息…")
                .desired_width(280.0),
        );
        let mut filter = app.task_filter.clone();
        let filter_label = match filter.as_str() {
            "running" => "进行中",
            "completed" => "已完成",
            "failed" => "失败",
            "cancelled" => "已取消",
            _ => "全部状态",
        };
        egui::ComboBox::from_id_salt("task-filter")
            .selected_text(egui::RichText::new(filter_label).size(12.0))
            .show_ui(ui, |ui| {
                for (key, label) in [
                    ("all", "全部状态"),
                    ("running", "进行中"),
                    ("completed", "已完成"),
                    ("failed", "失败"),
                    ("cancelled", "已取消"),
                ] {
                    ui.selectable_value(&mut filter, key.to_string(), label);
                }
            });
        app.task_filter = filter;
        let filtered: Vec<&Value> = tasks
            .iter()
            .filter(|task| {
                (app.task_filter == "all" || util::s(task, "status") == app.task_filter)
                    && format!(
                        "{} {}",
                        util::s(task, "label"),
                        util::s(task, "message")
                    )
                    .to_lowercase()
                    .contains(&app.task_query.to_lowercase())
            })
            .collect();
        ui.label(
            egui::RichText::new(format!("{} 条记录", filtered.len()))
                .size(10.5)
                .color(pal.muted),
        );
    });
    ui.add_space(6.0);

    let filtered: Vec<Value> = tasks
        .iter()
        .filter(|task| {
            (app.task_filter == "all" || util::s(task, "status") == app.task_filter)
                && format!(
                    "{} {}",
                    util::s(task, "label"),
                    util::s(task, "message")
                )
                .to_lowercase()
                .contains(&app.task_query.to_lowercase())
        })
        .cloned()
        .collect();
    if filtered.is_empty() {
        util::empty(
            ui,
            pal,
            if app.online() {
                "一切就绪，还没有操作"
            } else {
                "连接引擎后查看任务"
            },
            "安装、启动、备份与恢复等操作由 Rust 记录，不生成演示进度。",
        );
    } else {
        for task in &filtered {
            util::task_row(ui, pal, task);
            ui.add_space(4.0);
        }
    }
}

pub fn settings(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let snapshot = app.snap();
    let root = snapshot
        .as_ref()
        .map(|value| util::s(value, "root").to_string())
        .unwrap_or_default();
    let platform = snapshot
        .as_ref()
        .map(|value| util::s(value, "platform").to_string())
        .unwrap_or_default();
    let client_configured = snapshot
        .as_ref()
        .and_then(|value| value.get("settings"))
        .map(|settings| !util::s(settings, "githubClientId").is_empty())
        .unwrap_or(false);

    util::heading(
        ui,
        pal,
        "SYSTEM / PREFERENCES",
        "偏好设置.",
        "舒服的界面，清楚的边界。",
    );
    ui.horizontal(|ui| {
        util::badge(
            ui,
            pal,
            if app.online() {
                "由引擎保存"
            } else {
                "外观暂存于本机"
            },
            if app.online() {
                Tone::Accent
            } else {
                Tone::Yellow
            },
        );
        if app.online() {
            ui.label(
                egui::RichText::new("偏好通过本地 Rust 引擎持久化。")
                    .size(10.5)
                    .color(pal.muted),
            );
        }
    });
    ui.add_space(8.0);

    util::section(ui, pal, "外观", None);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(
                egui::RichText::new("界面皮肤")
                    .size(12.5)
                    .strong()
                    .color(pal.text),
            );
            ui.label(
                egui::RichText::new("像素深海与简洁工作台两套配色；选择只影响界面，不改变引擎行为。")
                    .size(10.5)
                    .color(pal.muted),
            );
            ui.horizontal(|ui| {
                let pixel = app.skin == crate::gui::Skin::Pixel;
                if ui
                    .add(util::SelectableLabel::new(
                        pixel,
                        egui::RichText::new("像素深海").size(12.0),
                    ))
                    .clicked()
                {
                    app.skin = crate::gui::Skin::Pixel;
                }
                if ui
                    .add(util::SelectableLabel::new(
                        !pixel,
                        egui::RichText::new("简洁工作台").size(12.0),
                    ))
                    .clicked()
                {
                    app.skin = crate::gui::Skin::Standard;
                }
            });
            ui.separator();
            ui.label(
                egui::RichText::new("主题")
                    .size(12.5)
                    .strong()
                    .color(pal.text),
            );
            ui.label(
                egui::RichText::new("深色是原生窗口默认外观；选择会写回引擎设置。")
                    .size(10.5)
                    .color(pal.muted),
            );
            ui.horizontal(|ui| {
                if ui
                    .add(util::SelectableLabel::new(
                        !app.dark,
                        egui::RichText::new("浅色").size(12.0),
                    ))
                    .clicked()
                {
                    app.dark = false;
                    app.run("save_settings", json!({ "theme": "light" }), "保存主题");
                }
                if ui
                    .add(util::SelectableLabel::new(
                        app.dark,
                        egui::RichText::new("深色").size(12.0),
                    ))
                    .clicked()
                {
                    app.dark = true;
                    app.run("save_settings", json!({ "theme": "dark" }), "保存主题");
                }
            });
            ui.separator();
            let mut reduced = app.reduced_motion;
            if ui
                .checkbox(
                    &mut reduced,
                    egui::RichText::new("减少动态效果").size(12.0),
                )
                .changed()
            {
                app.reduced_motion = reduced;
                app.run(
                    "save_settings",
                    json!({ "reducedMotion": reduced }),
                    "保存动态偏好",
                );
            }
            ui.label(
                egui::RichText::new("降低界面位移和过渡，系统减少动态偏好也会被尊重。")
                    .size(10.0)
                    .color(pal.muted),
            );
        });

    ui.add_space(10.0);
    util::section(ui, pal, "引擎信息", None);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            if !app.online() {
                ui.horizontal(|ui| {
                    util::badge(ui, pal, "引擎未连接", Tone::Coral);
                    if !app.engine_error().is_empty() {
                        ui.label(
                            egui::RichText::new(app.engine_error())
                                .size(10.0)
                                .color(pal.coral),
                        );
                    }
                });
                ui.add_space(4.0);
            }
            ui.label(
                egui::RichText::new("应用数据目录")
                    .size(12.0)
                    .strong()
                    .color(pal.text),
            );
            ui.label(
                egui::RichText::new(if root.is_empty() {
                    "连接引擎后显示真实路径"
                } else {
                    &root
                })
                .size(10.5)
                .color(pal.muted)
                .monospace(),
            );
            ui.horizontal(|ui| {
                if util::ghost_button(ui, pal, "打开目录").clicked() && !root.is_empty() {
                    app.run(
                        "open_path",
                        json!({ "path": root }),
                        "",
                    );
                }
                if util::ghost_button(ui, pal, "复制路径").clicked() && !root.is_empty() {
                    ui.ctx().copy_text(root.clone());
                    app.notify("数据目录已复制。", Tone::Success);
                }
            });
            ui.separator();
            ui.label(
                egui::RichText::new(format!("运行平台：{}", if platform.is_empty() { "尚未连接" } else { &platform }))
                    .size(11.0)
                    .color(pal.muted),
            );
        });

    ui.add_space(10.0);
    util::section(ui, pal, "GitHub 账号", None);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("GitHub 登录")
                        .size(12.5)
                        .strong()
                        .color(pal.text),
                );
                util::badge(ui, pal, "开发中", Tone::Yellow);
            });
            ui.label(
                egui::RichText::new("设备流、令牌登录与 Star 已完成开发并在真机验证，当前版本按发布计划暂不开放；开放后可在插件市场点赞、直接 Star 项目并解锁社交成就。")
                    .size(10.5)
                    .color(pal.muted),
            );
            ui.label(
                egui::RichText::new(if client_configured {
                    "OAuth Client ID 已配置"
                } else {
                    "OAuth Client ID 未配置"
                })
                .size(10.5)
                .color(if client_configured { pal.green } else { pal.yellow }),
            );
        });

    ui.add_space(10.0);
    util::section(ui, pal, "整合包大厅", None);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(
                egui::RichText::new("大厅服务器地址")
                    .size(12.5)
                    .strong()
                    .color(pal.text),
            );
            ui.label(
                egui::RichText::new("启动器只把整合包清单（插件引用列表，不含插件本体）发给你指定的服务器。留空即关闭大厅。")
                    .size(10.5)
                    .color(pal.muted),
            );
            ui.add(
                egui::TextEdit::singleline(&mut app.hall_url)
                    .desired_width(ui.available_width())
                    .hint_text("http://127.0.0.1:4317"),
            );
            ui.label(
                egui::RichText::new(if app.hall_url.trim().is_empty() {
                    "已关闭"
                } else {
                    "已启用（大厅浏览为外部服务，原生版暂不内置）"
                })
                .size(10.0)
                .color(pal.muted),
            );
        });

    ui.add_space(10.0);
    util::section(ui, pal, "应用与更新", None);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("EAC 启动器 · 原生构建 v0.1.0")
                        .size(12.0)
                        .strong()
                        .color(pal.text),
                );
                if util::ghost_button(ui, pal, "查看发行版本").clicked() {
                    app.view = View::Releases;
                    app.load_releases("eac");
                }
            });
            ui.label(
                egui::RichText::new("更新只替换应用本身，实例与内核数据不受影响。原生版通过「发行版本」下载新的安装包。")
                    .size(10.5)
                    .color(pal.muted),
            );
            ui.separator();
            let mut debug = app.debug;
            if ui
                .checkbox(&mut debug, egui::RichText::new("捉虫模式").size(12.0))
                .changed()
            {
                app.debug = debug;
            }
            if app.debug {
                let pending = if app.pending.is_empty() {
                    "无".to_string()
                } else {
                    app.pending
                        .iter()
                        .map(|item| item.label.clone())
                        .collect::<Vec<_>>()
                        .join("、")
                };
                egui::Grid::new("debug-panel")
                    .num_columns(2)
                    .spacing([14.0, 5.0])
                    .show(ui, |ui| {
                        for (key, value) in [
                            ("运行形态", "eframe 原生窗口 / 无 WebView2".to_string()),
                            ("引擎", if app.online() { "在线".into() } else { app.engine_error() }),
                            ("平台", platform.clone()),
                            ("数据目录", root.clone()),
                            ("进行中操作", pending),
                        ] {
                            ui.label(
                                egui::RichText::new(key).size(10.5).color(pal.muted),
                            );
                            ui.label(
                                egui::RichText::new(value)
                                    .size(10.5)
                                    .color(pal.text)
                                    .monospace(),
                            );
                            ui.end_row();
                        }
                    });
            }
        });

    ui.add_space(10.0);
    util::section(ui, pal, "关于 EAC", None);
    ui.horizontal(|ui| {
        if let Some(tex) = &app.icon_tex {
            util::logo(ui, tex, 34.0);
        }
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new("EAC 启动器")
                    .size(13.0)
                    .strong()
                    .color(pal.text),
            );
            ui.label(
                egui::RichText::new("DeepSeek Harness · 独立工作区与插件管理")
                    .size(10.5)
                    .color(pal.muted),
            );
        });
    });
}
