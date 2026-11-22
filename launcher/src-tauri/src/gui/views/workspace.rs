use super::instance_actions;
use crate::gui::dialogs::{Dialog, PathKind};
use crate::gui::util::{self, Palette};
use crate::gui::{App, View};
use eframe::egui;
use serde_json::{json, Value};

pub fn overview(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let snapshot = app.snap();
    let instances = snapshot
        .as_ref()
        .map(|value| util::arr(value, "instances").to_vec())
        .unwrap_or_default();
    let kernels = snapshot
        .as_ref()
        .map(|value| util::arr(value, "kernels").to_vec())
        .unwrap_or_default();
    let tasks = snapshot
        .as_ref()
        .map(|value| util::arr(value, "tasks").to_vec())
        .unwrap_or_default();
    let running = instances
        .iter()
        .filter(|instance| util::s(instance, "status") == "running")
        .count();
    let running_tasks: Vec<Value> = tasks
        .iter()
        .filter(|task| util::s(task, "status") == "running")
        .cloned()
        .collect();
    let selected = app.selected_instance();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "YOUR LOCAL WORKSPACE · DEEP BLUE",
                "EAC 启动器.",
                "你的实例、内核与插件，在这里各就各位。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::primary_button(ui, pal, "＋  新建实例").clicked() && app.online() {
                app.dialog = Some(Dialog::create(None));
            }
        });
    });

    // 主控台
    util::card(ui, pal, |ui| {
        if let Some(instance) = &selected {
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new("01 / INSTANCE CONTROL")
                            .size(10.0)
                            .color(pal.muted),
                    );
                    ui.label(
                        egui::RichText::new(util::s(instance, "name"))
                            .size(22.0)
                            .strong()
                            .color(pal.text),
                    );
                    let kernel = util::s(instance, "kernelId");
                    let version = kernels
                        .iter()
                        .find(|item| util::s(item, "id") == kernel)
                        .map(|item| util::s(item, "version").to_string())
                        .unwrap_or_else(|| {
                            if util::s(instance, "kind") == "harness" {
                                "未指定内核".into()
                            } else {
                                "桌面端随附内核".into()
                            }
                        });
                    ui.label(
                        egui::RichText::new(format!(
                            "{} / {}",
                            util::kind_label(util::s(instance, "kind")),
                            version
                        ))
                        .size(12.0)
                        .color(pal.muted),
                    );
                    ui.add_space(6.0);
                    instance_actions(app, ui, pal, instance, false);
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
                    ui.vertical(|ui| {
                        util::status_chip(ui, pal, util::s(instance, "status"));
                        ui.label(
                            egui::RichText::new(format!(
                                "PORT {}",
                                util::s(instance, "port")
                            ))
                            .size(10.5)
                            .color(pal.muted)
                            .monospace(),
                        );
                        if let Some(url) = util::opt(instance, "url") {
                            if util::s(instance, "status") == "running" {
                                ui.hyperlink_to(
                                    egui::RichText::new("打开本地服务").size(11.5),
                                    url,
                                );
                            }
                        }
                    });
                });
            });
        } else {
            ui.vertical_centered(|ui| {
                ui.add_space(12.0);
                ui.label(
                    egui::RichText::new(if app.online() {
                        "从第一个实例开始"
                    } else {
                        "连接你的本地工作空间"
                    })
                    .size(20.0)
                    .strong()
                    .color(pal.text),
                );
                ui.label(
                    egui::RichText::new(if app.online() {
                        if kernels.is_empty() {
                            "先安装或注册一个内核，再创建 Harness 实例。"
                        } else {
                            "创建独立实例，让内核、插件和配置拥有自己的空间。"
                        }
                    } else {
                        "本地引擎未连接，实例信息尚不可用。"
                    })
                    .size(12.0)
                    .color(pal.muted),
                );
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if util::primary_button(
                        ui,
                        pal,
                        if kernels.is_empty() && app.online() {
                            "准备内核"
                        } else {
                            "创建第一个实例"
                        },
                    )
                    .clicked()
                    {
                        if app.online() {
                            if kernels.is_empty() {
                                app.view = View::Kernels;
                            } else {
                                app.dialog = Some(Dialog::create(None));
                            }
                        } else {
                            app.dialog = Some(Dialog::Connection);
                        }
                    }
                    if util::ghost_button(ui, pal, "浏览插件  →").clicked() {
                        app.view = View::Market;
                    }
                });
                ui.add_space(12.0);
            });
        }
    });

    ui.add_space(10.0);
    // 指标
    let metrics = [
        ("全部实例", instances.len(), "独立工作空间"),
        ("正在运行", running, "活跃进程"),
        ("已装内核", kernels.len(), "固定版本"),
        ("进行中", running_tasks.len().max(app.pending.len()), "当前操作"),
    ];
    ui.columns(4, |cols| {
        for (index, (label, value, suffix)) in metrics.iter().enumerate() {
            util::card(&mut cols[index], pal, |ui| {
                ui.label(
                    egui::RichText::new(*label)
                        .size(10.5)
                        .color(pal.muted),
                );
                ui.label(
                    egui::RichText::new(if app.online() {
                        value.to_string()
                    } else {
                        "—".into()
                    })
                    .size(24.0)
                    .strong()
                    .color(pal.text)
                    .monospace(),
                );
                ui.label(
                    egui::RichText::new(if app.online() {
                        (*suffix).to_string()
                    } else {
                        "引擎未连接".into()
                    })
                    .size(10.0)
                    .color(pal.muted),
                );
            });
        }
    });

    ui.add_space(12.0);
    ui.columns(2, |cols| {
        ui_column_instances(&mut cols[0], app, pal, &instances, &selected);
        console(&mut cols[1], app, pal, selected.as_ref(), true);
    });

    if !running_tasks.is_empty() {
        ui.add_space(12.0);
        util::section(ui, pal, "进行中的操作", None);
        for task in running_tasks.iter().take(3) {
            util::task_row(ui, pal, task);
        }
    }

    ui.add_space(12.0);
    ui.columns(2, |cols| {
        for (index, (title, subtitle, view)) in [
            ("内核仓库", "选择一个精确版本", View::Kernels),
            ("插件市场", "发现来源清晰的插件", View::Market),
        ]
        .iter()
        .enumerate()
        {
            util::card(&mut cols[index], pal, |ui| {
                ui.label(
                    egui::RichText::new(*title)
                        .size(14.0)
                        .strong()
                        .color(pal.text),
                );
                ui.label(
                    egui::RichText::new(*subtitle)
                        .size(11.0)
                        .color(pal.muted),
                );
                if util::ghost_button(ui, pal, "打开  →").clicked() {
                    app.view = *view;
                }
            });
        }
    });
}

fn ui_column_instances(
    ui: &mut egui::Ui,
    app: &mut App,
    pal: &Palette,
    instances: &[Value],
    selected: &Option<Value>,
) {
    util::section(ui, pal, "我的实例", Some(format!("{}", instances.len()).as_str()));
    if instances.is_empty() {
        util::empty(
            ui,
            pal,
            if app.online() {
                "还没有实例"
            } else {
                "尚未读取实例"
            },
            if app.online() {
                "新建或导入的实例会显示在这里。"
            } else {
                "连接引擎后查看本机的真实工作空间。"
            },
        );
        return;
    }
    let selected_id = selected
        .as_ref()
        .map(|instance| util::s(instance, "id").to_string())
        .unwrap_or_default();
    for instance in instances {
        let id = util::s(instance, "id").to_string();
        let is_selected = id == selected_id;
        let text = egui::RichText::new(format!(
            "{}   ·   {}",
            util::s(instance, "name"),
            util::kind_label(util::s(instance, "kind"))
        ))
        .size(12.0);
        if ui
            .add_sized(
                [ui.available_width(), 36.0],
                util::SelectableLabel::new(is_selected, text),
            )
            .clicked()
        {
            app.selected_id = id;
        }
    }
}

fn console(
    ui: &mut egui::Ui,
    app: &mut App,
    pal: &Palette,
    instance: Option<&Value>,
    overview: bool,
) {
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("控制台")
                .size(15.0)
                .strong()
                .color(pal.text),
        );
        ui.label(
            egui::RichText::new(
                instance
                    .map(|item| util::s(item, "name").to_string())
                    .unwrap_or_else(|| "未选择实例".into()),
            )
            .size(10.5)
            .color(pal.muted),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if util::ghost_button(ui, pal, "刷新").clicked() {
                app.logs_at = None;
            }
            if util::ghost_button(ui, pal, "复制").clicked() {
                ui.ctx().copy_text(app.logs.clone());
                app.notify("控制台输出已复制。", util::Tone::Success);
            }
        });
    });
    ui.add_space(4.0);
    let height = if overview { 200.0 } else { 340.0 };
    egui::Frame::new()
        .fill(if pal.dark {
            egui::Color32::from_rgb(4, 14, 27)
        } else {
            egui::Color32::from_rgb(238, 243, 250)
        })
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            egui::ScrollArea::vertical()
                .max_height(height)
                .stick_to_bottom(app.logs_follow)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    if !app.logs_error.is_empty() {
                        ui.label(
                            egui::RichText::new(&app.logs_error)
                                .size(11.0)
                                .color(pal.coral),
                        );
                    } else if app.logs.is_empty() {
                        ui.label(
                            egui::RichText::new(if instance.is_none() {
                                "选择或创建一个实例，在这里查看它的输出。"
                            } else if !app.online() {
                                "引擎连接已断开。"
                            } else if app.logs_loading {
                                "正在读取实例日志…"
                            } else {
                                "还没有输出。实例写入日志后会显示在这里。"
                            })
                            .size(11.0)
                            .color(pal.muted),
                        );
                    } else {
                        let text = if app.logs_wrap {
                            app.logs.clone()
                        } else {
                            app.logs.clone()
                        };
                        ui.add(
                            egui::Label::new(
                                egui::RichText::new(text).size(10.5).color(pal.text),
                            )
                            .wrap(),
                        );
                    }
                });
        });
    ui.horizontal(|ui| {
        ui.checkbox(&mut app.logs_wrap, egui::RichText::new("换行").size(11.0));
        ui.checkbox(&mut app.logs_follow, egui::RichText::new("跟随").size(11.0));
        ui.label(
            egui::RichText::new(if app.online() && instance.is_some() {
                "实际进程输出"
            } else {
                "等待实例"
            })
            .size(10.0)
            .color(pal.muted),
        );
    });
}

pub fn instances(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let snapshot = app.snap();
    let all = snapshot
        .as_ref()
        .map(|value| util::arr(value, "instances").to_vec())
        .unwrap_or_default();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "WORKSPACE / INSTANCES",
                "实例管理.",
                "独立配置，固定内核。每一次尝试，都有自己的空间。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::primary_button(ui, pal, "＋  新建实例").clicked() && app.online() {
                app.dialog = Some(Dialog::create(None));
            }
            if util::ghost_button(ui, pal, "导入实例").clicked() && app.online() {
                app.dialog = Some(Dialog::path(PathKind::Import, &Value::Null));
            }
        });
    });

    if all.is_empty() {
        util::empty(
            ui,
            pal,
            if app.online() {
                "从第一个实例开始"
            } else {
                "连接你的本地工作空间"
            },
            if app.online() {
                "先安装内核，再为 Harness 创建独立目录；桌面端也可以从发行版本安装。"
            } else {
                "实例信息由本机引擎提供，连接后显示。"
            },
        );
        return;
    }

    let selected = app.selected_instance();
    let filtered: Vec<Value> = all
        .iter()
        .filter(|instance| {
            let haystack = format!(
                "{} {}",
                util::s(instance, "name"),
                util::kind_label(util::s(instance, "kind"))
            )
            .to_lowercase();
            haystack.contains(&app.instance_query.to_lowercase())
        })
        .cloned()
        .collect();

    let available = ui.available_size();
    ui.horizontal_top(|ui| {
        ui.allocate_ui_with_layout(
            egui::vec2(270.0, available.y),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(format!("INSTANCES / {}", all.len()))
                            .size(10.0)
                            .color(pal.muted),
                    );
                });
                ui.add(
                    egui::TextEdit::singleline(&mut app.instance_query)
                        .hint_text("查找实例…")
                        .desired_width(ui.available_width()),
                );
                ui.add_space(4.0);
                let selected_id = selected
                    .as_ref()
                    .map(|item| util::s(item, "id").to_string())
                    .unwrap_or_default();
                egui::ScrollArea::vertical()
                    .id_salt("instance-list")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        for instance in &filtered {
                            let id = util::s(instance, "id").to_string();
                            let is_selected = id == selected_id;
                            let status = util::s(instance, "status");
                            let text = egui::RichText::new(format!(
                                "{}  {}   {}",
                                if status == "running" { "●" } else { "○" },
                                util::s(instance, "name"),
                                util::kind_label(util::s(instance, "kind"))
                            ))
                            .size(11.5);
                            if ui
                                .add_sized(
                                    [ui.available_width(), 38.0],
                                    util::SelectableLabel::new(is_selected, text),
                                )
                                .clicked()
                            {
                                app.selected_id = id;
                                app.instance_tab = "details".into();
                            }
                        }
                    });
            },
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(ui.available_width(), available.y),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                if let Some(instance) = &selected {
                    detail(ui, app, pal, instance);
                }
            },
        );
    });
}

fn detail(ui: &mut egui::Ui, app: &mut App, pal: &Palette, instance: &Value) {
    let id = util::s(instance, "id").to_string();
    let status = util::s(instance, "status");
    let stopped = status == "stopped" || status == "error";
    let kind = util::s(instance, "kind");

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new(format!(
                    "{} / INSTANCE",
                    util::kind_label(kind).to_uppercase()
                ))
                .size(10.0)
                .color(pal.muted),
            );
            ui.label(
                egui::RichText::new(util::s(instance, "name"))
                    .size(20.0)
                    .strong()
                    .color(pal.text),
            );
            util::status_chip(ui, pal, status);
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            instance_actions(app, ui, pal, instance, false);
        });
    });
    ui.add_space(6.0);

    let tabs = [
        ("details", "详细信息".to_string()),
        (
            "plugins",
            if util::opt(instance, "inventoryError").is_some() {
                "插件（读取异常）".to_string()
            } else {
                format!("插件 ({})", util::arr(instance, "plugins").len())
            },
        ),
        ("backups", "备份".to_string()),
        ("logs", "控制台".to_string()),
    ];
    ui.horizontal(|ui| {
        for (key, label) in &tabs {
            let selected = app.instance_tab == *key;
            if ui
                .add(util::SelectableLabel::new(
                    selected,
                    egui::RichText::new(label).size(12.0),
                ))
                .clicked()
            {
                app.instance_tab = (*key).to_string();
                if *key == "backups" && app.backups_for != id {
                    app.load_backups(&id);
                }
            }
        }
    });
    ui.separator();

    if let Some(error) = util::opt(instance, "inventoryError") {
        ui.label(
            egui::RichText::new(format!("插件清单读取失败：{}", error))
                .size(11.0)
                .color(pal.coral),
        );
    }

    match app.instance_tab.as_str() {
        "plugins" => plugins_tab(ui, app, pal, instance, stopped),
        "backups" => backups_tab(ui, app, pal, instance, stopped),
        "logs" => console(ui, app, pal, Some(instance), false),
        _ => details_tab(ui, app, pal, instance, kind),
    }
}

fn details_tab(ui: &mut egui::Ui, app: &mut App, pal: &Palette, instance: &Value, kind: &str) {
    let snapshot = app.snap();
    let kernel_version = util::s(instance, "kernelId");
    let version = snapshot
        .as_ref()
        .and_then(|value| {
            util::arr(value, "kernels")
                .iter()
                .find(|item| util::s(item, "id") == kernel_version)
                .map(|item| util::s(item, "version").to_string())
        })
        .unwrap_or_else(|| {
            if kind == "harness" {
                "未指定".into()
            } else {
                "桌面端随附内核".into()
            }
        });
    ui.label(
        egui::RichText::new("实例配置")
            .size(13.0)
            .strong()
            .color(pal.text),
    );
    egui::Grid::new("instance-details")
        .num_columns(2)
        .spacing([18.0, 8.0])
        .show(ui, |ui| {
            util::kv(ui, pal, "实例 ID", util::s(instance, "id"));
            ui.end_row();
            util::kv(
                ui,
                pal,
                "内核版本",
                &if kind == "harness" {
                    format!("{}（已固定）", version)
                } else {
                    version.clone()
                },
            );
            ui.end_row();
            util::kv(
                ui,
                pal,
                "端口",
                &if util::s(instance, "port").is_empty() {
                    "未分配".into()
                } else {
                    util::s(instance, "port").to_string()
                },
            );
            ui.end_row();
            util::kv(
                ui,
                pal,
                "进程",
                &if let Some(pid) = instance.get("pid").and_then(Value::as_u64) {
                    format!("PID {}", pid)
                } else if app.online() {
                    "未运行".into()
                } else {
                    "离线时未知".into()
                },
            );
            ui.end_row();
            util::kv(
                ui,
                pal,
                "创建时间",
                &util::date_time(util::s(instance, "createdAt")),
            );
            ui.end_row();
            util::kv(ui, pal, "实例目录", util::s(instance, "home"));
            ui.end_row();
            util::kv(
                ui,
                pal,
                "工作目录",
                if util::s(instance, "workspace").is_empty() {
                    "未设置"
                } else {
                    util::s(instance, "workspace")
                },
            );
            ui.end_row();
            if let Some(executable) = util::opt(instance, "executable") {
                util::kv(ui, pal, "可执行文件", executable);
                ui.end_row();
            }
            if let Some(url) = util::opt(instance, "url") {
                util::kv(ui, pal, "本地服务", url);
                ui.end_row();
            }
        });
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        if util::ghost_button(ui, pal, "打开实例目录").clicked() {
            app.run(
                "open_path",
                json!({ "path": util::s(instance, "home") }),
                "",
            );
        }
        if util::ghost_button(ui, pal, "复制实例 ID").clicked() {
            ui.ctx().copy_text(util::s(instance, "id").to_string());
            app.notify("实例 ID 已复制。", util::Tone::Success);
        }
    });
    ui.add_space(6.0);
    ui.label(
        egui::RichText::new(if kind == "harness" {
            "Harness 实例使用独立配置目录、端口和指定内核，支持完整隔离的多内核并行运行。"
        } else {
            "外部桌面端使用各自随附的内核，可能实施全局单实例限制；只有 Harness 实例支持完整隔离的多内核并行运行。"
        })
        .size(11.0)
        .color(pal.muted),
    );
}

fn plugins_tab(
    ui: &mut egui::Ui,
    app: &mut App,
    pal: &Palette,
    instance: &Value,
    stopped: bool,
) {
    let id = util::s(instance, "id").to_string();
    let plugins = util::arr(instance, "plugins").to_vec();
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("已安装插件")
                .size(13.0)
                .strong()
                .color(pal.text),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if util::ghost_button(ui, pal, "按引用安装").clicked()
                && app.online()
                && stopped
                && util::s(instance, "kind") == "harness"
            {
                app.dialog = Some(Dialog::plugin(None, Some(id.clone())));
            }
        });
    });
    if plugins.is_empty() {
        util::empty(
            ui,
            pal,
            if util::s(instance, "kind") == "harness" {
                "尚未安装插件"
            } else {
                "请在桌面应用内管理插件"
            },
            if util::s(instance, "kind") == "harness" {
                "从目录中选择插件，或使用精确引用安装。"
            } else {
                "启动桌面实例后，在应用内管理它的扩展。"
            },
        );
        return;
    }
    for plugin in &plugins {
        let name = util::s(plugin, "name").to_string();
        let enabled = util::b(plugin, "enabled");
        egui::Frame::new()
            .fill(pal.card)
            .stroke(egui::Stroke::new(1.0, pal.line))
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(&name)
                                .size(12.5)
                                .strong()
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new(format!(
                                "{} / {}",
                                util::s(plugin, "version"),
                                util::s(plugin, "source")
                            ))
                            .size(10.5)
                            .color(pal.muted)
                            .monospace(),
                        );
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if util::ghost_button(ui, pal, "移除").clicked() && app.online() && stopped {
                            app.dialog = Some(Dialog::confirm(
                                "移除此插件？",
                                format!(
                                    "使用官方插件 CLI 从「{}」中移除「{}」。",
                                    util::s(instance, "name"),
                                    name
                                ),
                                "移除插件",
                                "remove_plugin",
                                json!({ "instanceId": id, "name": name }),
                                true,
                            ));
                        }
                        let mut checked = enabled;
                        if ui
                            .checkbox(&mut checked, egui::RichText::new("已启用").size(11.0))
                            .changed()
                            && app.online()
                            && stopped
                        {
                            app.run(
                                "toggle_plugin",
                                json!({ "instanceId": id, "name": name, "enabled": checked }),
                                "切换插件状态",
                            );
                        }
                    });
                });
            });
        ui.add_space(4.0);
    }
}

fn backups_tab(
    ui: &mut egui::Ui,
    app: &mut App,
    pal: &Palette,
    instance: &Value,
    stopped: bool,
) {
    let id = util::s(instance, "id").to_string();
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("实例与配置备份")
                .size(13.0)
                .strong()
                .color(pal.text),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if util::ghost_button(ui, pal, "刷新").clicked() {
                app.load_backups(&id);
            }
            if util::ghost_button(ui, pal, "立即备份").clicked() && app.online() && stopped {
                app.run("snapshot_instance", json!({ "id": id }), "备份实例");
            }
        });
    });
    ui.label(
        egui::RichText::new("备份或恢复配置前，请先停止实例。自动安全点只保留最近 3 份，手动备份保留最近 10 份。")
            .size(11.0)
            .color(pal.muted),
    );
    if !app.backups_error.is_empty() {
        ui.label(
            egui::RichText::new(&app.backups_error)
                .size(11.0)
                .color(pal.coral),
        );
    }
    let backups: Vec<Value> = app
        .backups
        .iter()
        .rev()
        .cloned()
        .collect();
    if backups.is_empty() {
        util::empty(
            ui,
            pal,
            "还没有备份",
            "调整配置前，先为当前状态留一份备份。",
        );
        return;
    }
    for backup in backups {
        let backup_id = util::s(&backup, "id").to_string();
        let kind = util::s(&backup, "kind");
        egui::Frame::new()
            .fill(pal.card)
            .stroke(egui::Stroke::new(1.0, pal.line))
            .corner_radius(egui::CornerRadius::same(6))
            .inner_margin(egui::Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(util::date_time(util::s(&backup, "createdAt")))
                                    .size(12.0)
                                    .strong()
                                    .color(pal.text),
                            );
                            util::badge(
                                ui,
                                pal,
                                if kind == "manual" { "手动" } else { "自动" },
                                if kind == "manual" {
                                    util::Tone::Accent
                                } else {
                                    util::Tone::Neutral
                                },
                            );
                        });
                        util::code(ui, pal, util::s(&backup, "path"));
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if util::ghost_button(ui, pal, "恢复").clicked() && app.online() && stopped {
                            app.dialog = Some(Dialog::confirm(
                                "恢复此备份？",
                                format!(
                                    "将「{}」恢复至 {} 的备份。当前目录和配置将被经过验证的备份内容替换。",
                                    util::s(instance, "name"),
                                    util::date_time(util::s(&backup, "createdAt"))
                                ),
                                "恢复备份",
                                "restore_instance",
                                json!({ "id": id, "backupId": backup_id }),
                                false,
                            ));
                        }
                    });
                });
            });
        ui.add_space(4.0);
    }
}
