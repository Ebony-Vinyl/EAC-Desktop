use crate::gui::util::{self, Palette, Tone};
use crate::gui::App;
use eframe::egui;
use serde_json::Value;

pub fn profile(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let snapshot = app.snap();
    let social = app
        .social
        .clone()
        .or_else(|| snapshot.as_ref().and_then(|value| value.get("social").cloned()));
    let profile = social
        .as_ref()
        .and_then(|value| value.get("profile"))
        .filter(|value| !value.is_null())
        .cloned();
    let authenticated = social
        .as_ref()
        .map(|value| util::b(value, "authenticated"))
        .unwrap_or(false);
    let usage = app.usage.clone();
    let totals = usage
        .as_ref()
        .and_then(|value| value.get("totals").cloned());

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "IDENTITY / PROFILE",
                "个人中心.",
                "账号、头像、成就，以及 DSH 真实用量与估价。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if util::ghost_button(ui, pal, "刷新用量").clicked() && app.online() {
                app.load_usage(true);
            }
            if usage.is_none() && app.usage_error.is_empty() {
                ui.spinner();
            }
        });
    });
    if !app.usage_error.is_empty() {
        ui.label(
            egui::RichText::new(&app.usage_error)
                .size(11.0)
                .color(pal.coral),
        );
    }

    // 身份卡
    ui.columns(2, |cols| {
        util::card(&mut cols[0], pal, |ui| {
            ui.horizontal(|ui| {
                let initial = profile
                    .as_ref()
                    .map(|value| {
                        format!(
                            "{}{}",
                            util::s(value, "name"),
                            util::s(value, "login")
                        )
                    })
                    .unwrap_or_default()
                    .trim()
                    .chars()
                    .next()
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_else(|| "E".into());
                egui::Frame::new()
                    .fill(pal.accent_soft)
                    .stroke(egui::Stroke::new(1.0, pal.accent))
                    .corner_radius(egui::CornerRadius::same(40))
                    .inner_margin(egui::Margin::symmetric(18, 10))
                    .show(ui, |ui| {
                        ui.label(
                            egui::RichText::new(initial)
                                .size(28.0)
                                .strong()
                                .color(pal.accent),
                        );
                    });
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new(if authenticated {
                            "GITHUB / CONNECTED"
                        } else {
                            "LOCAL / EXPLORER"
                        })
                        .size(9.5)
                        .color(pal.muted),
                    );
                    ui.label(
                        egui::RichText::new(
                            profile
                                .as_ref()
                                .and_then(|value| {
                                    util::opt(value, "name")
                                        .or_else(|| util::opt(value, "login"))
                                })
                                .unwrap_or("本机探索者"),
                        )
                        .size(19.0)
                        .strong()
                        .color(pal.text),
                    );
                    if let Some(profile) = &profile {
                        ui.label(
                            egui::RichText::new(format!("@{}", util::s(profile, "login")))
                                .size(11.0)
                                .color(pal.muted),
                        );
                        if let Some(bio) = util::opt(profile, "bio") {
                            ui.label(
                                egui::RichText::new(bio).size(10.5).color(pal.muted),
                            );
                        }
                        if let Some(url) = util::opt(profile, "htmlUrl") {
                            ui.hyperlink_to(
                                egui::RichText::new("GitHub 主页").size(10.5),
                                url,
                            );
                        }
                    } else {
                        ui.label(
                            egui::RichText::new("登录 GitHub 后显示公开资料；用量统计仍然只来自本机。")
                                .size(10.5)
                                .color(pal.muted),
                        );
                        util::badge(ui, pal, "GitHub 登录 · 开发中", Tone::Yellow);
                    }
                });
            });
        });
        util::card(&mut cols[1], pal, |ui| {
            let summary = app
                .achievements
                .as_ref()
                .and_then(|value| value.get("summary"))
                .or_else(|| snapshot.as_ref().and_then(|value| value.get("achievements")));
            let points = summary.map(|value| util::i(value, "points")).unwrap_or(0);
            let unlocked = summary
                .map(|value| util::i(value, "unlockedCount"))
                .unwrap_or(0);
            let total = summary.map(|value| util::i(value, "total")).unwrap_or(0);
            let streak = summary.map(|value| util::i(value, "streak")).unwrap_or(0);
            ui.label(
                egui::RichText::new("ACHIEVEMENTS")
                    .size(9.5)
                    .color(pal.muted),
            );
            ui.label(
                egui::RichText::new(format!("{} PT", points))
                    .size(22.0)
                    .strong()
                    .color(pal.accent),
            );
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} 已点亮 · 连续 {} 天",
                    unlocked, total, streak
                ))
                .size(10.5)
                .color(pal.muted),
            );
            if util::ghost_button(ui, pal, "查看全部成就 →").clicked() {
                app.view = crate::gui::View::Achievements;
            }
        });
    });

    ui.add_space(10.0);

    // 指标
    let metrics = [
        (
            "总 Token",
            util::tokens(totals.as_ref().map(|value| util::f(value, "tokens")).unwrap_or(0.0)),
            format!(
                "输入 {} · 输出 {}",
                util::tokens(totals.as_ref().map(|value| util::f(value, "input")).unwrap_or(0.0)),
                util::tokens(totals.as_ref().map(|value| util::f(value, "output")).unwrap_or(0.0))
            ),
        ),
        (
            "热力值",
            util::tokens(totals.as_ref().map(|value| util::f(value, "heat")).unwrap_or(0.0)),
            "输出×1 + 输入×0.2 + 缓存×0.05".into(),
        ),
        (
            "平均速度",
            util::speed(usage.as_ref().map(|value| util::f(value, "avgSpeed")).unwrap_or(0.0)),
            "模型回复的实测均值".into(),
        ),
        (
            "会话 / 轮次",
            format!(
                "{} / {}",
                usage.as_ref().map(|value| util::i(value, "sessions")).unwrap_or(0),
                usage.as_ref().map(|value| util::i(value, "turns")).unwrap_or(0)
            ),
            "本机真实会话统计".into(),
        ),
        (
            "估算费用",
            {
                let input = totals.as_ref().map(|value| util::f(value, "input")).unwrap_or(0.0);
                let cache = totals.as_ref().map(|value| util::f(value, "cacheRead")).unwrap_or(0.0);
                let output = totals.as_ref().map(|value| util::f(value, "output")).unwrap_or(0.0);
                if input + cache + output > 0.0 {
                    util::cost(Some((input * 2.0 + cache * 0.2 + output * 3.0) / 1_000_000.0))
                } else {
                    "—".into()
                }
            },
            "按 DeepSeek 参考价估算".into(),
        ),
        (
            "缓存读取",
            util::tokens(totals.as_ref().map(|value| util::f(value, "cacheRead")).unwrap_or(0.0)),
            format!(
                "推理 Token {}",
                util::tokens(totals.as_ref().map(|value| util::f(value, "reasoning")).unwrap_or(0.0))
            ),
        ),
    ];
    for row in metrics.chunks(3) {
        ui.columns(3, |cols| {
            for (index, (label, value, note)) in row.iter().enumerate() {
                util::card(&mut cols[index], pal, |ui| {
                    ui.label(
                        egui::RichText::new(*label)
                            .size(10.0)
                            .color(pal.muted),
                    );
                    ui.label(
                        egui::RichText::new(value)
                            .size(20.0)
                            .strong()
                            .color(pal.text),
                    );
                    ui.label(
                        egui::RichText::new(note)
                            .size(9.5)
                            .color(pal.muted),
                    );
                });
            }
        });
        ui.add_space(6.0);
    }

    ui.add_space(6.0);
    util::section(ui, pal, "Token 热力图", Some("最近 365 天"));
    if let Some(usage) = &usage {
        let days = util::arr(usage, "heatmap");
        if days.is_empty() {
            util::empty(
                ui,
                pal,
                "还没有发现 DSH 用量",
                "启动器会读取实例与本机的会话日志；只解析 usage 与模型字段。",
            );
        } else {
            heatmap(ui, pal, days);
            ui.label(
                egui::RichText::new(format!(
                    "{} tokens / 365 天",
                    util::tokens(totals.as_ref().map(|value| util::f(value, "tokens")).unwrap_or(0.0))
                ))
                .size(10.0)
                .color(pal.muted),
            );
            ui.add_space(6.0);
            ui.label(
                egui::RichText::new("最近 30 天")
                    .size(11.0)
                    .strong()
                    .color(pal.text),
            );
            recent_bars(ui, pal, util::arr(usage, "recent"));
        }
    } else {
        util::empty(
            ui,
            pal,
            if app.online() {
                "正在读取本机用量"
            } else {
                "连接引擎后读取本机用量"
            },
            "用量统计由本地 Rust 引擎读取，不上传。",
        );
    }

    ui.add_space(10.0);
    ui.columns(2, |cols| {
        util::card(&mut cols[0], pal, |ui| {
            ui.label(
                egui::RichText::new("数据源")
                    .size(13.0)
                    .strong()
                    .color(pal.text),
            );
            if let Some(usage) = &usage {
                let roots = util::arr(usage, "roots");
                if roots.is_empty() {
                    ui.label(
                        egui::RichText::new("还没有找到会话目录。运行一次实例后这里会出现真实数据。")
                            .size(10.5)
                            .color(pal.muted),
                    );
                }
                for root in roots {
                    ui.label(
                        egui::RichText::new(util::s(root, "label"))
                            .size(11.5)
                            .strong()
                            .color(pal.text),
                    );
                    util::code(ui, pal, util::s(root, "path"));
                    ui.label(
                        egui::RichText::new(format!(
                            "{} 个会话文件 · {} 条用量{}",
                            util::i(root, "files"),
                            util::i(root, "records"),
                            if util::i(root, "errors") > 0 {
                                format!(" · {} 个读取错误", util::i(root, "errors"))
                            } else {
                                String::new()
                            }
                        ))
                        .size(9.5)
                        .color(pal.muted),
                    );
                }
            }
            ui.label(
                egui::RichText::new("只解析 assistant/message.usage 与模型字段，不上传任何消息内容。")
                    .size(9.5)
                    .color(pal.muted),
            );
        });
        util::card(&mut cols[1], pal, |ui| {
            let summary = app
                .achievements
                .as_ref()
                .and_then(|value| value.get("summary"))
                .or_else(|| snapshot.as_ref().and_then(|value| value.get("achievements")));
            ui.label(
                egui::RichText::new("旅程概览")
                    .size(13.0)
                    .strong()
                    .color(pal.text),
            );
            egui::Grid::new("journey")
                .num_columns(2)
                .spacing([12.0, 6.0])
                .show(ui, |ui| {
                    for (label, value) in [
                        ("当前连续", format!("{} 天", summary.map(|s| util::i(s, "streak")).unwrap_or(0))),
                        ("最佳连续", format!("{} 天", summary.map(|s| util::i(s, "bestStreak")).unwrap_or(0))),
                        ("累计活跃", format!("{} 天", summary.map(|s| util::i(s, "days")).unwrap_or(0))),
                        ("打开启动器", format!("{} 次", summary.map(|s| util::i(s, "opens")).unwrap_or(0))),
                    ] {
                        ui.label(egui::RichText::new(label).size(10.5).color(pal.muted));
                        ui.label(egui::RichText::new(value).size(11.5).strong().color(pal.text));
                        ui.end_row();
                    }
                });
            if util::ghost_button(ui, pal, "查看全部成就 →").clicked() {
                app.view = crate::gui::View::Achievements;
            }
        });
    });

    ui.add_space(10.0);
    util::section(ui, pal, "模型用量", Some("速度来自真实耗时"));
    if let Some(usage) = &usage {
        let models = util::arr(usage, "models");
        if models.is_empty() {
            util::empty(
                ui,
                pal,
                "还没有模型用量",
                "成功完成一次 DSH 对话后，模型、Token 与速度会出现在这里。",
            );
        } else {
            egui::Grid::new("models")
                .num_columns(5)
                .spacing([14.0, 6.0])
                .show(ui, |ui| {
                    for header in ["模型", "用量", "Tokens", "速度", "累计耗时"] {
                        ui.label(
                            egui::RichText::new(header)
                                .size(10.0)
                                .color(pal.muted),
                        );
                    }
                    ui.end_row();
                    for model in models.iter().take(30) {
                        ui.label(
                            egui::RichText::new(util::s(model, "model"))
                                .size(11.5)
                                .strong()
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new(format!(
                                "{} · {} 次",
                                util::s(model, "provider"),
                                util::i(model, "messages")
                            ))
                            .size(10.0)
                            .color(pal.muted),
                        );
                        ui.label(
                            egui::RichText::new(util::tokens(util::f(model, "tokens")))
                                .size(11.0)
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new(util::speed(util::f(model, "avgSpeed")))
                                .size(11.0)
                                .color(pal.text),
                        );
                        ui.label(
                            egui::RichText::new(format!(
                                "{}s",
                                (util::f(model, "durationMs") / 1000.0).round() as i64
                            ))
                            .size(10.5)
                            .color(pal.muted),
                        );
                        ui.end_row();
                    }
                });
        }
    }
}

fn heatmap(ui: &mut egui::Ui, pal: &Palette, days: &[Value]) {
    let max = days
        .iter()
        .map(|day| util::f(day, "tokens"))
        .fold(1.0f64, f64::max);
    let first = util::s(&days[0], "date");
    let offset = chrono::NaiveDate::parse_from_str(first, "%Y-%m-%d")
        .map(|date| {
            use chrono::Datelike;
            date.weekday().num_days_from_sunday() as usize
        })
        .unwrap_or(0);
    let cell = 11.0f32;
    let gap = 2.0f32;
    let weeks = ((offset + days.len() + 6) / 7).max(1);
    let width = weeks as f32 * (cell + gap);
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(width, 7.0 * (cell + gap)),
        egui::Sense::hover(),
    );
    let painter = ui.painter();
    for (index, day) in days.iter().enumerate() {
        let position = offset + index;
        let week = position / 7;
        let row = position % 7;
        let tokens = util::f(day, "tokens");
        let level = if tokens <= 0.0 {
            0
        } else {
            (((tokens + 1.0).log10() / (max + 1.0).log10()) * 4.0)
                .ceil()
                .clamp(1.0, 4.0) as i32
        };
        let color = match level {
            0 => pal.line.gamma_multiply(0.6),
            1 => pal.accent.gamma_multiply(0.28),
            2 => pal.accent.gamma_multiply(0.5),
            3 => pal.accent.gamma_multiply(0.75),
            _ => pal.accent,
        };
        let min = rect.min
            + egui::vec2(week as f32 * (cell + gap), row as f32 * (cell + gap));
        painter.rect_filled(
            egui::Rect::from_min_size(min, egui::vec2(cell, cell)),
            egui::CornerRadius::same(2),
            color,
        );
    }
}

fn recent_bars(ui: &mut egui::Ui, pal: &Palette, days: &[Value]) {
    if days.is_empty() {
        return;
    }
    let max = days
        .iter()
        .map(|day| util::f(day, "tokens"))
        .fold(1.0f64, f64::max);
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), 64.0),
        egui::Sense::hover(),
    );
    let painter = ui.painter();
    let width = rect.width() / days.len() as f32;
    for (index, day) in days.iter().enumerate() {
        let tokens = util::f(day, "tokens");
        let height = if tokens <= 0.0 {
            2.0
        } else {
            ((tokens / max).sqrt() * (rect.height() - 4.0) as f64) as f32
        };
        let x = rect.min.x + index as f32 * width;
        let bar = egui::Rect::from_min_size(
            egui::pos2(x + 1.0, rect.max.y - height),
            egui::vec2((width - 2.0).max(1.0), height),
        );
        painter.rect_filled(
            bar,
            egui::CornerRadius::same(1),
            if tokens > 0.0 {
                pal.accent
            } else {
                pal.line
            },
        );
    }
}

pub fn achievements(app: &mut App, ui: &mut egui::Ui, pal: &Palette) {
    let view = app.achievements.clone();
    let definitions: Vec<Value> = view
        .as_ref()
        .map(|value| util::arr(value, "definitions").to_vec())
        .unwrap_or_default();
    let snapshot = app.snap();
    let summary = view
        .as_ref()
        .and_then(|value| value.get("summary"))
        .or_else(|| {
            snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.get("achievements"))
        });
    let total = summary.map(|value| util::i(value, "total")).unwrap_or(definitions.len() as i64);
    let unlocked = summary
        .map(|value| util::i(value, "unlockedCount"))
        .unwrap_or_else(|| {
            definitions
                .iter()
                .filter(|item| util::opt(item, "unlockedAt").is_some())
                .count() as i64
        });
    let percent = if total > 0 {
        (unlocked * 100 / total) as i32
    } else {
        0
    };
    let points = summary.map(|value| util::i(value, "points")).unwrap_or(0);
    let max_points = summary
        .map(|value| util::i(value, "maxPoints"))
        .unwrap_or_else(|| {
            definitions
                .iter()
                .map(|item| util::i(item, "points"))
                .sum()
        });
    let streak = summary.map(|value| util::i(value, "streak")).unwrap_or(0);
    let days_active = summary.map(|value| util::i(value, "days")).unwrap_or(0);

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            util::heading(
                ui,
                pal,
                "JOURNEY / ACHIEVEMENTS",
                "成就.",
                "每一次真实操作，都会在这片深海里留下光点。",
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if !app
                .social
                .as_ref()
                .map(|value| util::b(value, "authenticated"))
                .unwrap_or(false)
            {
                util::badge(ui, pal, "GitHub 登录 · 开发中", Tone::Yellow);
            }
        });
    });

    util::card(ui, pal, |ui| {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(
                    egui::RichText::new(format!("{}%", percent))
                        .size(34.0)
                        .strong()
                        .color(pal.accent),
                );
                ui.label(
                    egui::RichText::new("完成度")
                        .size(10.0)
                        .color(pal.muted),
                );
            });
            ui.add_space(18.0);
            ui.vertical(|ui| {
                ui.label(
                    egui::RichText::new(format!("DEEP SEA LOG / {}", chrono::Local::now().format("%Y")))
                        .size(9.5)
                        .color(pal.muted),
                );
                let title = if percent >= 100 {
                    "深海全图鉴"
                } else if percent >= 60 {
                    "资深下潜者"
                } else if percent >= 25 {
                    "稳定航行中"
                } else {
                    "旅程刚刚开始"
                };
                ui.label(
                    egui::RichText::new(title)
                        .size(20.0)
                        .strong()
                        .color(pal.text),
                );
                ui.label(
                    egui::RichText::new(format!(
                        "{} 个成就已点亮，共 {} 个。隐藏成就不会剧透，达成后才会显形。",
                        unlocked, total
                    ))
                    .size(11.0)
                    .color(pal.muted),
                );
                ui.horizontal_wrapped(|ui| {
                    for text in [
                        format!("{} / {} PT", points, max_points),
                        format!("连续 {} 天", streak),
                        format!("累计 {} 天", days_active),
                        format!("{}/{}", unlocked, total),
                    ] {
                        util::badge(ui, pal, &text, Tone::Neutral);
                    }
                });
                let fraction = if max_points > 0 {
                    points as f32 / max_points as f32
                } else {
                    0.0
                };
                util::progress(ui, pal, fraction, ui.available_width().min(360.0));
            });
        });
    });

    let recent: Vec<Value> = {
        let mut items: Vec<Value> = definitions
            .iter()
            .filter(|item| util::opt(item, "unlockedAt").is_some())
            .cloned()
            .collect();
        items.sort_by(|a, b| util::s(b, "unlockedAt").cmp(util::s(a, "unlockedAt")));
        items.truncate(4);
        items
    };
    if !recent.is_empty() {
        ui.add_space(8.0);
        util::section(ui, pal, "最近点亮", Some(format!("{} 条", recent.len()).as_str()));
        for item in &recent {
            ui.horizontal(|ui| {
                util::badge(
                    ui,
                    pal,
                    util::tier_label(util::s(item, "tier")),
                    Tone::Accent,
                );
                ui.label(
                    egui::RichText::new(util::s(item, "name"))
                        .size(12.0)
                        .strong()
                        .color(pal.text),
                );
                ui.label(
                    egui::RichText::new(util::date_time(util::s(item, "unlockedAt")))
                        .size(10.0)
                        .color(pal.muted),
                );
                ui.label(
                    egui::RichText::new(format!("+{}", util::i(item, "points")))
                        .size(10.5)
                        .color(pal.green),
                );
            });
        }
    }

    ui.add_space(8.0);
    let categories: Vec<String> = {
        let mut list = vec!["全部".to_string()];
        for item in &definitions {
            let category = util::s(item, "category").to_string();
            if !category.is_empty() && !list.contains(&category) {
                list.push(category);
            }
        }
        list
    };
    ui.horizontal_wrapped(|ui| {
        for category in &categories {
            let active = app.ach_category == *category;
            let count = definitions
                .iter()
                .filter(|item| category == "全部" || util::s(item, "category") == category)
                .count();
            if ui
                .add(util::SelectableLabel::new(
                    active,
                    egui::RichText::new(format!("{} {}", category, count)).size(11.0),
                ))
                .clicked()
            {
                app.ach_category = category.clone();
            }
        }
        for (key, label) in [("all", "全部"), ("unlocked", "已点亮"), ("locked", "未点亮")] {
            let active = app.ach_status == key;
            if ui
                .add(util::SelectableLabel::new(
                    active,
                    egui::RichText::new(label).size(11.0),
                ))
                .clicked()
            {
                app.ach_status = key.into();
            }
        }
    });
    ui.add_space(4.0);

    let filtered: Vec<Value> = definitions
        .iter()
        .filter(|item| {
            (app.ach_category == "全部" || util::s(item, "category") == app.ach_category)
                && match app.ach_status.as_str() {
                    "unlocked" => util::opt(item, "unlockedAt").is_some(),
                    "locked" => util::opt(item, "unlockedAt").is_none(),
                    _ => true,
                }
        })
        .cloned()
        .collect();

    if filtered.is_empty() {
        util::empty(
            ui,
            pal,
            if definitions.is_empty() {
                "成就目录尚未加载"
            } else {
                "这个筛选下没有成就"
            },
            "连接本地引擎后，成就目录会从真实状态加载。",
        );
        return;
    }
    let cols = ((ui.available_width() / 260.0).floor() as usize).clamp(1, 3);
    for chunk in filtered.chunks(cols) {
        ui.columns(cols, |columns| {
            for (index, item) in chunk.iter().enumerate() {
                achievement_card(&mut columns[index], pal, item);
            }
        });
    }
}

fn achievement_card(ui: &mut egui::Ui, pal: &Palette, item: &Value) {
    let hidden = util::b(item, "hidden") && util::opt(item, "unlockedAt").is_none();
    let unlocked = util::opt(item, "unlockedAt").is_some();
    let target = util::i(item, "target").max(0);
    let current = util::i(item, "current");
    let fraction = if target > 0 {
        (current as f32 / target as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let tier = util::s(item, "tier");
    util::card(ui, pal, |ui| {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(if unlocked {
                    "已点亮"
                } else if hidden {
                    "隐藏"
                } else {
                    "未点亮"
                })
                .size(10.0)
                .color(if unlocked { pal.yellow } else { pal.muted }),
            );
            util::badge(
                ui,
                pal,
                if hidden {
                    "隐藏"
                } else {
                    util::tier_label(tier)
                },
                if unlocked {
                    Tone::Accent
                } else {
                    Tone::Neutral
                },
            );
            if unlocked {
                ui.label(egui::RichText::new("已点亮").size(10.0).color(pal.green));
            }
        });
        ui.label(
            egui::RichText::new(util::s(item, "name"))
                .size(13.0)
                .strong()
                .color(if unlocked { pal.text } else { pal.muted }),
        );
        ui.label(
            egui::RichText::new(util::s(item, "description"))
                .size(10.5)
                .color(pal.muted),
        );
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(if hidden {
                    "???".to_string()
                } else {
                    format!("{} / {}", current, target)
                })
                .size(10.0)
                .color(pal.muted),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{} PT", util::i(item, "points")))
                        .size(10.0)
                        .color(pal.yellow),
                );
            });
        });
        util::progress(ui, pal, fraction, ui.available_width());
    });
}
