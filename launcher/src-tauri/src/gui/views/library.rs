use crate::gui::dialogs::{Dialog, PathKind};
use crate::gui::util::{self, Palette, Tone};
use crate::gui::App;
use eframe::egui;
use serde_json::{json, Value};

fn combo(ui: &mut egui::Ui, id: &str, value: &mut String, options: &[(String, String)]) {
    let label = options
        .iter()
        .find(|(key, _)| key == value)
        .map(|(_, label)| label.clone())
        .unwrap_or_default();
    egui::ComboBox::from_id_salt(id)
        .selected_text(egui::RichText::new(label).size(12.0))
        .width(150.0)
        .show_ui(ui, |ui| {
            for (key, label) in options {
                ui.selectable_value(value, key.clone(), label);
            }
        });
}

fn stat_for(stats: &Option<Value>, id: &str, key: &str, field: &str) -> i64 {
    let Some(stats) = stats else { return 0 };
    stats
        .get("downloads")
        .and_then(|downloads| downloads.get(key))
        .and_then(Value::as_array)
        .and_then(|list| list.iter().find(|item| util::s(item, "id") == id))
        .map(|item| util::i(item, field))
        .unwrap_or(0)
}

pub fn market(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let catalog = app.catalog.clone();
    let plugins: Vec<Value> = catalog
        .as_ref()
        .map(|value| util::arr(value, "plugins").to_vec())
        .unwrap_or_default();
    let sources: Vec<Value> = catalog
        .as_ref()
        .map(|value| util::arr(value, "sources").to_vec())
        .unwrap_or_default();
    let install_target = app.snap().is_some_and(|snapshot| {
        util::arr(&snapshot, "instances").iter().any(|instance| {
            util::s(instance, "kind") == "harness" && util::s(instance, "status") == "stopped"
        })
    });

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "DISCOVER / PLUGINS",
                "插件市场.",
                "让工作区更合心意。每一份插件，都有迹可循。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::ghost_button(ui, pal, "按引用安装").clicked()
                && app.online()
                && install_target
            {
                app.dialog = Some(Dialog::plugin(None, None));
            }
        });
    });

    // 分类
    let categories: Vec<String> = {
        let mut list: Vec<String> = plugins
            .iter()
            .map(|plugin| {
                util::opt(plugin, "category")
                    .unwrap_or("未分类")
                    .to_string()
            })
            .collect();
        list.sort();
        list.dedup();
        list
    };

    ui.horizontal_wrapped(|ui| {
        let mut query = app.market_query.clone();
        let response = ui.add(
            egui::TextEdit::singleline(&mut query)
                .hint_text("搜索插件、功能、关键词…")
                .desired_width(300.0),
        );
        app.market_query = query;
        if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
            app.run("record_event", json!({ "event": "market_search" }), "");
        }
        let mut source = app.market_source.clone();
        let mut source_options = vec![("".to_string(), "所有来源".to_string())];
        source_options.extend(
            sources
                .iter()
                .map(|item| (util::s(item, "id").to_string(), util::s(item, "name").to_string())),
        );
        combo(ui, "market-source", &mut source, &source_options);
        app.market_source = source;
        let mut availability = app.market_availability.clone();
        combo(
            ui,
            "market-availability",
            &mut availability,
            &[
                ("all".into(), "全部条目".into()),
                ("installable".into(), "可安装".into()),
                ("unavailable".into(), "仅收录".into()),
            ],
        );
        app.market_availability = availability;
    });

    ui.horizontal_wrapped(|ui| {
        let all_active = app.market_category.is_empty();
        if ui
            .add(util::SelectableLabel::new(
                all_active,
                egui::RichText::new(format!("全部 {}", plugins.len())).size(11.5),
            ))
            .clicked()
        {
            app.market_category.clear();
        }
        for category in &categories {
            let active = app.market_category == *category;
            if ui
                .add(util::SelectableLabel::new(
                    active,
                    egui::RichText::new(category).size(11.5),
                ))
                .clicked()
            {
                app.market_category = category.clone();
            }
        }
    });

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(match (
                catalog.is_some(),
                catalog.as_ref().map(|value| util::s(value, "updatedAt")),
            ) {
                (true, Some(at)) if !at.is_empty() => format!(
                    "● 引擎目录 · 同步于 {}",
                    util::date_time(at)
                ),
                (true, _) => "● 引擎目录".to_string(),
                _ => "○ 目录尚未加载".to_string(),
            })
            .size(10.5)
            .color(pal.muted),
        );
    });

    let filtered: Vec<Value> = plugins
        .iter()
        .filter(|plugin| {
            let haystack = format!(
                "{} {} {} {}",
                util::s(plugin, "name"),
                util::s(plugin, "description"),
                util::opt(plugin, "category").unwrap_or(""),
                util::s(plugin, "id")
            )
            .to_lowercase();
            let words_ok = app
                .market_query
                .to_lowercase()
                .split_whitespace()
                .all(|word| haystack.contains(word));
            let category = util::opt(plugin, "category").unwrap_or("未分类");
            let category_ok = app.market_category.is_empty() || app.market_category == category;
            let source_ok = app.market_source.is_empty() || {
                let source = util::s(plugin, "source");
                source == app.market_source
                    || sources.iter().any(|item| {
                        util::s(item, "id") == app.market_source
                            && source.starts_with(&format!("{}/", util::s(item, "url")))
                    })
            };
            let installable = util::b(plugin, "installable") && util::opt(plugin, "ref").is_some();
            let availability_ok = match app.market_availability.as_str() {
                "installable" => installable,
                "unavailable" => !installable,
                _ => true,
            };
            words_ok && category_ok && source_ok && availability_ok
        })
        .cloned()
        .collect();

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(format!("{} 个条目", filtered.len()))
                .size(11.0)
                .color(pal.muted),
        );
        if ui
            .add(egui::Button::new(
                egui::RichText::new("重置筛选").size(11.0).color(pal.accent),
            )
            .frame(false))
            .clicked()
        {
            app.market_query.clear();
            app.market_category.clear();
            app.market_source.clear();
            app.market_availability = "all".into();
        }
        ui.label(
            egui::RichText::new("兼容性以实际验证为准")
                .size(10.0)
                .color(pal.muted),
        );
    });

    // 本地热榜
    if let Some(stats) = &app.market_stats {
        let week = util::arr(stats, "downloads")
            .iter()
            .find(|item| util::s(item, "id") == "week")
            .map(|item| util::arr(item, "downloads").to_vec())
            .unwrap_or_default();
        if week.is_empty() {
            ui.label(
                egui::RichText::new("本地热榜：还没有下载记录。")
                    .size(10.5)
                    .color(pal.muted),
            );
        } else {
            ui.horizontal_wrapped(|ui| {
                ui.label(egui::RichText::new("本周下载").size(10.5).color(pal.muted));
                for item in week.iter().take(6) {
                    let id = util::s(item, "id");
                    let name = plugins
                        .iter()
                        .find(|plugin| util::s(plugin, "id") == id)
                        .map(|plugin| util::s(plugin, "name").to_string())
                        .unwrap_or_else(|| id.to_string());
                    util::badge(
                        ui,
                        pal,
                        &format!("{} ×{}", name, util::i(item, "downloads")),
                        Tone::Neutral,
                    );
                }
            });
        }
    }

    if filtered.is_empty() {
        util::empty(
            ui,
            pal,
            if plugins.is_empty() {
                "目录中暂无插件"
            } else {
                "没有找到匹配的插件"
            },
            if plugins.is_empty() {
                "目录准备好后，真实条目会显示在这里。"
            } else {
                "试试其他关键词，或更换筛选条件。"
            },
        );
    } else {
        let visible: Vec<Value> = filtered
            .iter()
            .take(app.market_visible)
            .cloned()
            .collect();
        let cols = ((ui.available_width() / 280.0).floor() as usize).clamp(1, 3);
        for chunk in visible.chunks(cols) {
            ui.columns(cols, |columns| {
                for (index, plugin) in chunk.iter().enumerate() {
                    plugin_card(&mut columns[index], app, pal, plugin, install_target);
                }
            });
        }
        if filtered.len() > app.market_visible {
            if util::ghost_button(
                ui,
                pal,
                &format!(
                    "加载更多 · 剩余 {} 条",
                    filtered.len() - app.market_visible
                ),
            )
            .clicked()
            {
                app.market_visible += 60;
            }
        }
    }

    ui.add_space(12.0);
    util::section(ui, pal, "目录来源", Some(format!("{} 个来源", sources.len()).as_str()));
    for source in &sources {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(util::s(source, "name"))
                    .size(12.0)
                    .strong()
                    .color(pal.text),
            );
            if let Some(url) = util::opt(source, "url") {
                ui.hyperlink_to(egui::RichText::new("来源").size(10.5), url);
            }
        });
        ui.label(
            egui::RichText::new(util::s(source, "description"))
                .size(10.5)
                .color(pal.muted),
        );
    }
}

fn plugin_card(
    ui: &mut egui::Ui,
    app: &mut App,
    pal: &Palette,
    plugin: &Value,
    install_target: bool,
) {
    let id = util::s(plugin, "id").to_string();
    let installable = util::b(plugin, "installable") && util::opt(plugin, "ref").is_some();
    let downloads = stat_for(&app.market_stats, &id, "week", "downloads");
    let likes = app
        .market_stats
        .as_ref()
        .map(|stats| {
            util::arr(stats, "likes")
                .iter()
                .find(|item| util::s(item, "id") == id)
                .map(|item| util::i(item, "likes"))
                .unwrap_or(0)
        })
        .unwrap_or(0);
    util::card(ui, pal, |ui| {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new("⬡")
                    .size(18.0)
                    .color(pal.accent),
            );
            util::badge(
                ui,
                pal,
                util::opt(plugin, "category").unwrap_or("未分类"),
                Tone::Neutral,
            );
        });
        ui.label(
            egui::RichText::new(util::s(plugin, "name"))
                .size(14.0)
                .strong()
                .color(pal.text),
        );
        ui.label(
            egui::RichText::new(format!(
                "{}  {}",
                util::opt(plugin, "version").unwrap_or("版本未知"),
                util::opt(plugin, "license").unwrap_or("")
            ))
            .size(10.5)
            .color(pal.muted)
            .monospace(),
        );
        ui.label(
            egui::RichText::new(if util::s(plugin, "description").is_empty() {
                "来源未提供描述。"
            } else {
                util::s(plugin, "description")
            })
            .size(11.5)
            .color(pal.text),
        );
        if let Some(range) = util::opt(plugin, "coreRange") {
            ui.label(
                egui::RichText::new(format!("内核范围 {} · 兼容性未知", range))
                    .size(10.0)
                    .color(pal.yellow),
            );
        }
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("下载 {} · 点赞 {}", downloads, likes))
                    .size(10.0)
                    .color(pal.muted),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if util::primary_button(ui, pal, "安装").clicked()
                    && installable
                    && install_target
                    && app.online()
                {
                    app.dialog = Some(Dialog::plugin(Some(plugin.clone()), None));
                }
            });
        });
        ui.horizontal(|ui| {
            if util::ghost_button(ui, pal, "点赞").clicked() {
                app.notify("GitHub 登录功能正在开发中，敬请期待。", Tone::Info);
            }
            if util::ghost_button(ui, pal, "★ Star").clicked() {
                app.notify("GitHub 登录功能正在开发中，敬请期待。", Tone::Info);
            }
            if !installable {
                ui.label(
                    egui::RichText::new("仅收录")
                        .size(10.0)
                        .color(pal.muted),
                );
            }
        });
    });
}

pub fn packs(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let catalog = app.catalog.clone();
    let packs_list: Vec<Value> = catalog
        .as_ref()
        .map(|value| util::arr(value, "packs").to_vec())
        .unwrap_or_default();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "DISCOVER / PACKS",
                "整合包.",
                "复刻别人的组合，或把你的一键分享给所有人。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::primary_button(ui, pal, "从实例导出").clicked() && app.online() {
                app.dialog = Some(Dialog::export_pack());
            }
            if util::ghost_button(ui, pal, "导入清单文件").clicked() {
                app.dialog = Some(Dialog::import_pack());
            }
        });
    });

    ui.label(
        egui::RichText::new(
            "把 .eacpack.json 清单拖进窗口即可空投；也可以使用「导入清单文件」。整合包只携带插件引用，不携带插件本体。",
        )
        .size(10.5)
        .color(pal.muted),
    );
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(format!("目录整合包 {}", packs_list.len()))
                .size(12.0)
                .strong()
                .color(pal.text),
        );
        ui.label(
            egui::RichText::new("玩家大厅由外部大厅服务器提供，可在偏好设置中配置地址。")
                .size(10.0)
                .color(pal.muted),
        );
    });
    ui.add_space(6.0);

    if packs_list.is_empty() {
        util::empty(
            ui,
            pal,
            "暂无整合包",
            "目录提供整合包后，会在这里展示真实组合。",
        );
        return;
    }
    let kernels = app
        .snap()
        .map(|snapshot| util::arr(&snapshot, "kernels").len())
        .unwrap_or(0);
    for pack in &packs_list {
        ui.push_id(util::s(pack, "id"), |ui| {
        util::card(ui, pal, |ui| {
            let refs = util::arr(pack, "plugins");
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(util::s(pack, "name"))
                        .size(15.0)
                        .strong()
                        .color(pal.text),
                );
                util::badge(
                    ui,
                    pal,
                    &format!("{} 个引用", refs.len()),
                    Tone::Neutral,
                );
            });
            ui.label(
                egui::RichText::new(util::s(pack, "description"))
                    .size(11.5)
                    .color(pal.muted),
            );
            ui.label(
                egui::RichText::new(match util::opt(pack, "kernelVersion") {
                    Some(version) => format!("声明内核 {}", version),
                    None => "未声明内核版本 · 兼容性未知".into(),
                })
                .size(10.5)
                .color(pal.yellow),
            );
            ui.collapsing(egui::RichText::new("查看精确引用").size(10.5), |ui| {
                for item in refs.iter().take(40) {
                    util::code(ui, pal, util::s(item, "ref"));
                }
            });
            if util::primary_button(ui, pal, "创建独立实例").clicked()
                && app.online()
                && kernels > 0
            {
                app.dialog = Some(Dialog::pack(pack.clone()));
            }
        });
        });
        ui.add_space(8.0);
    }
}

pub fn kernels(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let snapshot = app.snap();
    let installed: Vec<Value> = snapshot
        .as_ref()
        .map(|value| util::arr(value, "kernels").to_vec())
        .unwrap_or_default();
    let instances: Vec<Value> = snapshot
        .as_ref()
        .map(|value| util::arr(value, "instances").to_vec())
        .unwrap_or_default();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "WORKSPACE / RUNTIMES",
                "内核仓库.",
                "一个版本，一个目录。升级由你决定。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::primary_button(ui, pal, "＋ 安装精确版本").clicked() && app.online() {
                app.dialog = Some(Dialog::install_kernel(None));
            }
            if util::ghost_button(ui, pal, "注册已有内核").clicked() && app.online() {
                app.dialog = Some(Dialog::path(PathKind::Register, &Value::Null));
            }
        });
    });

    util::section(ui, pal, "已安装内核", Some(format!("{} 个版本", installed.len()).as_str()));
    if installed.is_empty() {
        util::empty(
            ui,
            pal,
            if app.online() {
                "还没有安装内核"
            } else {
                "连接后查看本机内核"
            },
            "安装一个官方 npm 精确版本，或注册已经存在的真实 DSH 目录。",
        );
    } else {
        for kernel in &installed {
            let id = util::s(kernel, "id").to_string();
            let references = instances
                .iter()
                .filter(|instance| util::s(instance, "kernelId") == id)
                .count();
            egui::Frame::new()
                .fill(pal.card)
                .stroke(egui::Stroke::new(1.0, pal.line))
                .corner_radius(egui::CornerRadius::same(10))
                .inner_margin(egui::Margin::same(10))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.vertical(|ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    egui::RichText::new(util::s(kernel, "version"))
                                        .size(13.0)
                                        .strong()
                                        .color(pal.text)
                                        .monospace(),
                                );
                                util::badge(ui, pal, "已安装", Tone::Accent);
                                ui.label(
                                    egui::RichText::new(format!("{} 个实例引用", references))
                                        .size(10.0)
                                        .color(pal.muted),
                                );
                            });
                            util::code(ui, pal, util::s(kernel, "path"));
                            ui.label(
                                egui::RichText::new(format!(
                                    "{} / {}",
                                    util::s(kernel, "source"),
                                    util::date_time(util::s(kernel, "installedAt"))
                                ))
                                .size(10.0)
                                .color(pal.muted),
                            );
                        });
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if util::ghost_button(ui, pal, "移除").clicked()
                                && references == 0
                                && app.online()
                            {
                                app.dialog = Some(Dialog::confirm(
                                    "移除内核？",
                                    format!(
                                        "移除 {} 的独立安装目录。只有未被实例引用的内核可以移除。",
                                        util::s(kernel, "version")
                                    ),
                                    "移除内核",
                                    "remove_kernel",
                                    json!({ "id": id }),
                                    true,
                                ));
                            }
                            if util::ghost_button(ui, pal, "打开").clicked() {
                                app.run(
                                    "open_path",
                                    json!({ "path": util::s(kernel, "path") }),
                                    "",
                                );
                            }
                        });
                    });
                });
            ui.add_space(4.0);
        }
    }

    ui.add_space(10.0);
    util::section(ui, pal, "内核兼容性探针", Some("结论来自官方评估器"));
    ui.horizontal_wrapped(|ui| {
        let options: Vec<(String, String)> = installed
            .iter()
            .map(|kernel| {
                (
                    util::s(kernel, "id").to_string(),
                    format!("内核 {}", util::s(kernel, "version")),
                )
            })
            .collect();
        if app.probe_kernel.is_empty() {
            if let Some((id, _)) = options.last() {
                app.probe_kernel = id.clone();
            }
        }
        let mut kernel = app.probe_kernel.clone();
        combo(ui, "probe-kernel", &mut kernel, &options);
        app.probe_kernel = kernel;
        if util::ghost_button(ui, pal, "带入现有实例插件").clicked() {
            let mut refs: Vec<String> = Vec::new();
            for instance in &instances {
                for plugin in util::arr(instance, "plugins") {
                    let name = util::s(plugin, "name");
                    if name.starts_with("@deepseek-ai/") {
                        continue;
                    }
                    let source = util::s(plugin, "source");
                    if !source.is_empty() && !refs.contains(&source.to_string()) {
                        refs.push(source.to_string());
                    }
                }
            }
            if refs.is_empty() {
                app.notify("现有实例里还没有可复制的插件引用。", Tone::Info);
            } else {
                app.probe_refs = refs.join("\n");
            }
        }
        if util::primary_button(ui, pal, "开始探测").clicked() && app.online() {
            let refs: Vec<String> = app
                .probe_refs
                .split(['\n', ',', ';', ' '])
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(12)
                .map(str::to_string)
                .collect();
            if app.probe_kernel.is_empty() {
                app.probe_error = "请选择用于探测的内核。".into();
            } else if refs.is_empty() {
                app.probe_error = "请填写至少一个插件引用（每行一个）。".into();
            } else {
                app.probe_error.clear();
                app.probe_loading = true;
                app.probe = None;
                app.query(
                    "probe",
                    "probe_plugins",
                    json!({ "kernelId": app.probe_kernel, "refs": refs }),
                );
            }
        }
    });
    ui.add(
        egui::TextEdit::multiline(&mut app.probe_refs)
            .desired_rows(3)
            .desired_width(ui.available_width())
            .hint_text("每行一个插件引用，如：\nsome-plugin@1.2.0\nhttps://github.com/owner/repo"),
    );
    ui.label(
        egui::RichText::new("每个引用会真实安装到所选内核的临时隔离目录（不触碰你的实例），随后由官方评估器给出结论。单次最多 12 条。")
            .size(10.0)
            .color(pal.muted),
    );
    if !app.probe_error.is_empty() {
        ui.label(
            egui::RichText::new(&app.probe_error)
                .size(11.0)
                .color(pal.coral),
        );
    }
    if app.probe_loading {
        ui.spinner();
    }
    if let Some(probe) = &app.probe {
        let version = probe
            .get("kernel")
            .map(|kernel| util::s(kernel, "version"))
            .unwrap_or("");
        ui.label(
            egui::RichText::new(format!("目标内核 {}", version))
                .size(11.0)
                .color(pal.muted),
        );
        for item in util::arr(probe, "results") {
            let compatible = item.get("compatible").and_then(Value::as_bool);
            let install_ok = util::b(item, "installOk");
            let (label, tone) = if !install_ok {
                ("安装失败", Tone::Coral)
            } else {
                match compatible {
                    Some(true) => ("官方评估兼容", Tone::Green),
                    Some(false) => ("官方评估不兼容", Tone::Coral),
                    None => ("无法评估", Tone::Neutral),
                }
            };
            ui.horizontal_wrapped(|ui| {
                util::badge(ui, pal, label, tone);
                util::code(ui, pal, util::s(item, "ref"));
                if let Some(error) = util::opt(item, "error") {
                    ui.label(
                        egui::RichText::new(error).size(10.0).color(pal.coral),
                    );
                }
            });
        }
    }

    ui.add_space(10.0);
    util::section(ui, pal, "官方 npm 版本", None);
    ui.horizontal(|ui| {
        ui.add(
            egui::TextEdit::singleline(&mut app.kernel_query)
                .hint_text("查找精确版本…")
                .desired_width(260.0),
        );
        if util::ghost_button(ui, pal, "刷新官方版本").clicked() {
            app.kernel_versions = None;
            app.load_kernels();
        }
        if app.kernel_versions_loading {
            ui.spinner();
        }
    });
    if !app.kernel_versions_error.is_empty() {
        ui.label(
            egui::RichText::new(&app.kernel_versions_error)
                .size(11.0)
                .color(pal.coral),
        );
    }
    if let Some(versions) = &app.kernel_versions {
        let tags = versions.get("tags").cloned().unwrap_or_else(|| json!({}));
        let list: Vec<String> = util::arr(versions, "versions")
            .iter()
            .filter_map(Value::as_str)
            .filter(|version| {
                version
                    .to_lowercase()
                    .contains(&app.kernel_query.to_lowercase())
            })
            .map(str::to_string)
            .collect();
        if list.is_empty() {
            util::empty(ui, pal, "未找到此版本", "也可以在安装对话框中输入完整的精确版本。");
        }
        for version in list.iter().take(app.kernel_visible) {
            let is_installed = installed
                .iter()
                .any(|kernel| util::s(kernel, "version") == version);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(version)
                        .size(12.0)
                        .color(pal.text)
                        .monospace(),
                );
                if let Some(object) = tags.as_object() {
                    for (tag, value) in object {
                        if value.as_str() == Some(version) {
                            util::badge(ui, pal, tag, Tone::Neutral);
                        }
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if is_installed {
                        util::badge(ui, pal, "已安装", Tone::Accent);
                    } else if util::ghost_button(ui, pal, "安装此版本").clicked() && app.online() {
                        app.dialog = Some(Dialog::install_kernel(Some(version.clone())));
                    }
                });
            });
        }
        if list.len() > app.kernel_visible {
            if util::ghost_button(ui, pal, "加载更多版本").clicked() {
                app.kernel_visible += 32;
            }
        }
    }
}

fn asset_platform(name: &str) -> &'static str {
    let value = name.to_lowercase();
    if value.contains("darwin")
        || value.contains("macos")
        || value.contains("osx")
        || value.ends_with(".dmg")
        || value.ends_with(".pkg")
    {
        return "macos";
    }
    if value.contains("windows")
        || value.contains("win32")
        || value.contains("win64")
        || value.ends_with(".exe")
        || value.ends_with(".msi")
        || (value.contains("x64") && value.contains("portable") && value.contains("harness"))
    {
        return "windows";
    }
    if value.contains("linux") || value.ends_with(".appimage") || value.ends_with(".deb") {
        return "linux";
    }
    "unknown"
}

fn platform_name(platform: &str) -> &'static str {
    match platform {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "平台未标注",
    }
}

fn detected_platform(raw: &str) -> &'static str {
    match raw {
        "windows" | "win32" => "windows",
        "macos" | "darwin" => "macos",
        "linux" => "linux",
        _ => "unknown",
    }
}

pub fn releases(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let platform = app
        .snap()
        .map(|snapshot| detected_platform(util::s(&snapshot, "platform")))
        .unwrap_or("unknown");

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "DISCOVER / RELEASES",
                "发行版本.",
                "直接获取 EAC 与官方发行。每个文件都来自真实上游。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::ghost_button(ui, pal, "刷新发行版本").clicked() {
                let source = app.release_source.clone();
                app.load_releases(&source);
            }
        });
    });

    ui.horizontal_wrapped(|ui| {
        for (key, label) in [
            ("eac", "EAC 桌面端"),
            ("official", "官方桌面端"),
            ("kernel", "官方内核"),
        ] {
            let active = app.release_source == key;
            if ui
                .add(util::SelectableLabel::new(
                    active,
                    egui::RichText::new(label).size(11.5),
                ))
                .clicked()
            {
                app.load_releases(key);
            }
        }
        let mut platform_value = app.release_platform.clone();
        combo(
            ui,
            "release-platform",
            &mut platform_value,
            &[
                ("all".into(), "所有平台".into()),
                ("windows".into(), "Windows".into()),
                ("macos".into(), "macOS".into()),
                ("linux".into(), "Linux".into()),
                ("unknown".into(), "平台未标注".into()),
            ],
        );
        app.release_platform = platform_value;
        ui.checkbox(
            &mut app.release_prerelease,
            egui::RichText::new("预发行版").size(11.0),
        );
        if app.release_loading {
            ui.spinner();
        }
    });

    if !app.release_error.is_empty() {
        ui.label(
            egui::RichText::new(&app.release_error)
                .size(11.0)
                .color(pal.coral),
        );
    }

    if app.release_loading && app.releases.is_empty() {
        ui.label(
            egui::RichText::new("正在获取上游发行信息…")
                .size(11.5)
                .color(pal.muted),
        );
        return;
    }
    if app.releases.is_empty() {
        util::empty(
            ui,
            pal,
            "上游暂无发行版本",
            "可以刷新来源，或切换其他发行渠道。",
        );
        return;
    }

    let releases = app.releases.clone();
    for release in &releases {
        if !app.release_prerelease && util::b(release, "prerelease") {
            continue;
        }
        ui.push_id(util::s(release, "tag"), |ui| {
        let assets: Vec<Value> = util::arr(release, "assets")
            .iter()
            .filter(|asset| {
                app.release_platform == "all"
                    || asset_platform(util::s(asset, "name")) == app.release_platform
            })
            .cloned()
            .collect();
        util::card(ui, pal, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(util::s(release, "tag"))
                        .size(14.0)
                        .strong()
                        .color(pal.text)
                        .monospace(),
                );
                if util::b(release, "prerelease") {
                    util::badge(ui, pal, "预发行", Tone::Yellow);
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(util::date_time(util::s(release, "publishedAt")))
                            .size(10.0)
                            .color(pal.muted),
                    );
                });
            });
            if !util::s(release, "body").is_empty() {
                ui.collapsing(egui::RichText::new("发行说明").size(10.5), |ui| {
                    ui.label(
                        egui::RichText::new(util::s(release, "body"))
                            .size(10.5)
                            .color(pal.muted)
                            .monospace(),
                    );
                });
            }
            for asset in &assets {
                let name = util::s(asset, "name").to_string();
                let url = util::s(asset, "url").to_string();
                let size = asset.get("size").and_then(Value::as_f64).unwrap_or(-1.0);
                let sha = util::opt(asset, "sha256").map(str::to_string);
                let known = asset_platform(&name);
                let can_install = app.release_source != "kernel"
                    && name.to_lowercase().ends_with(".zip")
                    && known == platform
                    && known != "unknown";
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(&name)
                                .size(11.5)
                                .strong()
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new(format!(
                                "{} · {}{}",
                                platform_name(known),
                                util::bytes(size),
                                if sha.is_some() { " · SHA-256 已提供" } else { "" }
                            ))
                            .size(10.0)
                            .color(pal.muted),
                        );
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if util::ghost_button(ui, pal, "下载").clicked() && app.online() {
                            let mut payload =
                                json!({ "url": url, "filename": name });
                            if let Some(sha) = &sha {
                                payload["sha256"] = json!(sha);
                            }
                            app.run("download_asset", payload, &format!("下载 {}", name));
                        }
                        if can_install && util::primary_button(ui, pal, "安装 ZIP").clicked() {
                            app.dialog = Some(Dialog::desktop(
                                asset.clone(),
                                if app.release_source == "eac" {
                                    "eac-desktop"
                                } else {
                                    "official-desktop"
                                },
                                util::s(release, "tag"),
                            ));
                        }
                    });
                });
                ui.separator();
            }
            if assets.is_empty() {
                ui.label(
                    egui::RichText::new("此版本没有匹配当前平台筛选的文件。")
                        .size(10.5)
                        .color(pal.muted),
                );
            }
        });
        });
        ui.add_space(8.0);
    }

    ui.label(
        egui::RichText::new("仅支持为当前平台安装便携 ZIP。其他格式可下载；未标注平台的文件不自动安装。")
            .size(10.0)
            .color(pal.muted),
    );
}

