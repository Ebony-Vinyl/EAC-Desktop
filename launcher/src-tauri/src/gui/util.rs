use eframe::egui;
use serde_json::Value;

// ---- 内置矢量图标：原界面 lucide 图标的最小手绘集，随主题着色 ----

#[derive(Clone, Copy)]
pub enum Icon {
    Overview,
    Instances,
    Kernels,
    Market,
    Packs,
    Releases,
    Profile,
    Achievements,
    Tasks,
    Settings,
    Plus,
    Radio,
}

pub fn paint_icon(painter: &egui::Painter, center: egui::Pos2, size: f32, icon: Icon, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.5, color);
    let s = size * 0.5;
    let c = center;
    let pt = |dx: f32, dy: f32| egui::pos2(c.x + dx * s, c.y + dy * s);
    let line = |points: Vec<egui::Pos2>| painter.add(egui::Shape::line(points, stroke));
    let seg = |a: egui::Pos2, b: egui::Pos2| painter.line_segment([a, b], stroke);
    let kind = egui::StrokeKind::Middle;
    match icon {
        Icon::Overview => {
            for (dx, dy) in [(-0.42f32, -0.42f32), (0.42, -0.42), (-0.42, 0.42), (0.42, 0.42)] {
                let rect = egui::Rect::from_center_size(pt(dx, dy), egui::vec2(0.48 * s, 0.48 * s));
                painter.rect_stroke(rect, egui::CornerRadius::same(2), stroke, kind);
            }
        }
        Icon::Instances => {
            // 立方体
            painter.add(egui::Shape::closed_line(
                vec![
                    pt(0.0, -0.68),
                    pt(-0.6, -0.34),
                    pt(-0.6, 0.34),
                    pt(0.0, 0.68),
                    pt(0.6, 0.34),
                    pt(0.6, -0.34),
                ],
                stroke,
            ));
            line(vec![pt(-0.6, -0.34), pt(0.0, 0.0), pt(0.6, -0.34)]);
            line(vec![pt(0.0, 0.0), pt(0.0, 0.68)]);
        }
        Icon::Kernels => {
            for dy in [-0.45f32, 0.0, 0.45] {
                line(vec![pt(-0.62, dy), pt(0.0, dy + 0.22), pt(0.62, dy)]);
            }
        }
        Icon::Market => {
            let rect = egui::Rect::from_center_size(c, egui::vec2(1.0 * s, 1.3 * s));
            painter.rect_stroke(rect, egui::CornerRadius::same(2), stroke, kind);
            seg(
                egui::pos2(rect.right() - 0.35 * s, rect.top()),
                egui::pos2(rect.right(), rect.top() + 0.35 * s),
            );
            let inner = egui::Rect::from_center_size(pt(0.0, 0.2), egui::vec2(0.5 * s, 0.5 * s));
            painter.rect_stroke(inner, egui::CornerRadius::same(1), stroke, kind);
        }
        Icon::Packs => {
            let rect = egui::Rect::from_center_size(c, egui::vec2(1.25 * s, 1.25 * s));
            painter.rect_stroke(rect, egui::CornerRadius::same(2), stroke, kind);
            let y = rect.top() + 0.38 * s;
            seg(egui::pos2(rect.left(), y), egui::pos2(rect.right(), y));
            seg(pt(0.0, y), pt(0.0, y + 0.32 * s));
        }
        Icon::Releases => {
            seg(pt(0.0, -0.62), pt(0.0, 0.25));
            line(vec![pt(-0.35, -0.12), pt(0.0, 0.25), pt(0.35, -0.12)]);
            seg(pt(-0.55, 0.6), pt(0.55, 0.6));
        }
        Icon::Profile => {
            painter.circle(pt(0.0, -0.28), 0.3 * s, egui::Color32::TRANSPARENT, stroke);
            let mut pts = Vec::new();
            for i in 0..=12 {
                let a = std::f32::consts::PI * (1.0 - i as f32 / 12.0);
                pts.push(egui::pos2(
                    c.x + (0.55 * s) * a.cos(),
                    c.y + 0.62 * s - (0.42 * s) * a.sin(),
                ));
            }
            line(pts);
        }
        Icon::Achievements => {
            seg(pt(-0.42, -0.5), pt(0.42, -0.5));
            line(vec![pt(-0.42, -0.5), pt(-0.3, 0.1), pt(0.3, 0.1), pt(0.42, -0.5)]);
            seg(pt(0.0, 0.1), pt(0.0, 0.42));
            seg(pt(-0.25, 0.42), pt(-0.25, 0.55));
            seg(pt(0.25, 0.42), pt(0.25, 0.55));
            seg(pt(-0.35, 0.55), pt(0.35, 0.55));
        }
        Icon::Tasks => {
            line(vec![
                pt(-0.68, 0.0),
                pt(-0.32, 0.0),
                pt(-0.1, -0.55),
                pt(0.14, 0.55),
                pt(0.34, 0.0),
                pt(0.68, 0.0),
            ]);
        }
        Icon::Settings => {
            seg(pt(-0.6, -0.28), pt(0.6, -0.28));
            painter.circle(pt(0.18, -0.28), 0.16 * s, egui::Color32::TRANSPARENT, stroke);
            seg(pt(-0.6, 0.3), pt(0.6, 0.3));
            painter.circle(pt(-0.2, 0.3), 0.16 * s, egui::Color32::TRANSPARENT, stroke);
        }
        Icon::Plus => {
            seg(pt(-0.5, 0.0), pt(0.5, 0.0));
            seg(pt(0.0, -0.5), pt(0.0, 0.5));
        }
        Icon::Radio => {
            painter.circle(c, 0.14 * s, color, egui::Stroke::NONE);
            for r in [0.32f32, 0.58] {
                let mut pts = Vec::new();
                for i in 0..=8 {
                    let a = -std::f32::consts::FRAC_PI_4
                        + std::f32::consts::FRAC_PI_2 * (i as f32 / 8.0);
                    pts.push(egui::pos2(c.x + r * s * a.cos(), c.y - r * s * a.sin()));
                }
                line(pts);
            }
        }
    }
}

/// 在当前布局里画一个图标占位。
pub fn icon(ui: &mut egui::Ui, icon: Icon, color: egui::Color32, size: f32) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(size, size), egui::Sense::hover());
    paint_icon(ui.painter(), rect.center(), size, icon, color);
}

// ---- 轻量 JSON 读取：引擎返回的都是 serde_json::Value，直接按字段取，
// 缺字段一律回落为空值，避免为了展示再造一套镜像类型。 ----

pub fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn opt<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

pub fn b(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub fn f(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

pub fn i(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

pub fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

// ---- 格式化 ----

pub fn date_time(raw: &str) -> String {
    if raw.trim().is_empty() {
        return "未知".into();
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%m月%d日 %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| raw.to_string())
}

pub fn bytes(value: f64) -> String {
    if !value.is_finite() || value < 0.0 {
        return "大小未知".into();
    }
    if value == 0.0 {
        return "0 B".into();
    }
    let units = ["B", "KB", "MB", "GB"];
    let idx = ((value.ln() / 1024f64.ln()).floor() as usize).min(units.len() - 1);
    if idx == 0 {
        format!("{} {}", value as u64, units[0])
    } else {
        format!("{:.1} {}", value / 1024f64.powi(idx as i32), units[idx])
    }
}

pub fn tokens(value: f64) -> String {
    if !value.is_finite() || value <= 0.0 {
        return "0".into();
    }
    if value >= 1_000_000_000.0 {
        format!("{:.1}B", value / 1_000_000_000.0)
    } else if value >= 1_000_000.0 {
        format!("{:.1}M", value / 1_000_000.0)
    } else if value >= 1_000.0 {
        format!("{:.1}K", value / 1_000.0)
    } else {
        format!("{}", value as u64)
    }
}

pub fn speed(value: f64) -> String {
    if value > 0.0 {
        format!("{:.1} tok/s", value)
    } else {
        "—".into()
    }
}

pub fn cost(value: Option<f64>) -> String {
    match value {
        None => "未配置".into(),
        Some(v) if v > 0.0 && v < 0.01 => "< ¥0.01".into(),
        Some(v) => format!("¥{:.2}", v),
    }
}

pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        "harness" => "Harness",
        "eac-desktop" => "EAC Desktop",
        "official-desktop" => "Official Desktop",
        _ => "未知类型",
    }
}

pub fn status_label(status: &str) -> &str {
    match status {
        "stopped" => "已停止",
        "starting" => "启动中",
        "running" => "运行中",
        "error" => "异常",
        "offline" => "离线",
        "online" => "已连接",
        "completed" => "已完成",
        "failed" => "失败",
        "cancelled" => "已取消",
        _ => status,
    }
}

pub fn status_color(pal: &Palette, status: &str) -> egui::Color32 {
    match status {
        "running" | "online" | "completed" => pal.green,
        "starting" => pal.yellow,
        "error" | "failed" => pal.coral,
        _ => pal.muted,
    }
}

pub fn tier_label(tier: &str) -> &'static str {
    match tier {
        "common" => "普通",
        "rare" => "稀有",
        "epic" => "史诗",
        "legendary" => "传说",
        _ => "普通",
    }
}

// ---- 主题配色：像素深海（深蓝）与简洁工作台（浅色）两套。 ----

#[derive(Clone, Copy)]
pub struct Palette {
    pub dark: bool,
    pub bg: egui::Color32,
    pub panel: egui::Color32,
    pub card: egui::Color32,
    pub text: egui::Color32,
    pub muted: egui::Color32,
    pub accent: egui::Color32,
    pub accent_soft: egui::Color32,
    pub coral: egui::Color32,
    pub yellow: egui::Color32,
    pub green: egui::Color32,
    pub line: egui::Color32,
}

pub fn palette(dark: bool, pixel: bool) -> Palette {
    match (dark, pixel) {
        (true, true) => Palette {
            dark,
            bg: egui::Color32::from_rgb(6, 23, 43),
            panel: egui::Color32::from_rgb(8, 30, 56),
            card: egui::Color32::from_rgb(11, 38, 69),
            text: egui::Color32::from_rgb(226, 240, 255),
            muted: egui::Color32::from_rgb(137, 166, 198),
            accent: egui::Color32::from_rgb(61, 135, 247),
            accent_soft: egui::Color32::from_rgb(21, 60, 110),
            coral: egui::Color32::from_rgb(255, 122, 108),
            yellow: egui::Color32::from_rgb(240, 196, 84),
            green: egui::Color32::from_rgb(82, 214, 170),
            line: egui::Color32::from_rgb(28, 62, 102),
        },
        (true, false) => Palette {
            dark,
            bg: egui::Color32::from_rgb(16, 24, 35),
            panel: egui::Color32::from_rgb(21, 30, 43),
            card: egui::Color32::from_rgb(26, 37, 52),
            text: egui::Color32::from_rgb(232, 238, 246),
            muted: egui::Color32::from_rgb(140, 153, 170),
            accent: egui::Color32::from_rgb(86, 143, 255),
            accent_soft: egui::Color32::from_rgb(35, 55, 86),
            coral: egui::Color32::from_rgb(235, 118, 106),
            yellow: egui::Color32::from_rgb(222, 184, 96),
            green: egui::Color32::from_rgb(96, 200, 164),
            line: egui::Color32::from_rgb(41, 53, 70),
        },
        (false, true) => Palette {
            dark,
            bg: egui::Color32::from_rgb(233, 242, 252),
            panel: egui::Color32::from_rgb(255, 255, 255),
            card: egui::Color32::from_rgb(255, 255, 255),
            text: egui::Color32::from_rgb(18, 43, 74),
            muted: egui::Color32::from_rgb(96, 122, 152),
            accent: egui::Color32::from_rgb(29, 105, 214),
            accent_soft: egui::Color32::from_rgb(219, 234, 253),
            coral: egui::Color32::from_rgb(206, 82, 68),
            yellow: egui::Color32::from_rgb(176, 128, 24),
            green: egui::Color32::from_rgb(26, 148, 108),
            line: egui::Color32::from_rgb(199, 219, 241),
        },
        (false, false) => Palette {
            dark,
            bg: egui::Color32::from_rgb(244, 247, 251),
            panel: egui::Color32::from_rgb(255, 255, 255),
            card: egui::Color32::from_rgb(255, 255, 255),
            text: egui::Color32::from_rgb(23, 34, 53),
            muted: egui::Color32::from_rgb(108, 122, 145),
            accent: egui::Color32::from_rgb(37, 99, 235),
            accent_soft: egui::Color32::from_rgb(226, 237, 252),
            coral: egui::Color32::from_rgb(206, 82, 68),
            yellow: egui::Color32::from_rgb(176, 128, 24),
            green: egui::Color32::from_rgb(26, 148, 108),
            line: egui::Color32::from_rgb(219, 228, 241),
        },
    }
}

pub fn apply_visuals(ctx: &egui::Context, pal: &Palette) {
    let mut visuals = if pal.dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    visuals.panel_fill = pal.bg;
    visuals.window_fill = pal.panel;
    visuals.extreme_bg_color = if pal.dark {
        egui::Color32::from_rgb(4, 16, 30)
    } else {
        egui::Color32::from_rgb(238, 243, 250)
    };
    visuals.faint_bg_color = pal.card;
    visuals.override_text_color = Some(pal.text);
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, pal.line);
    visuals.widgets.inactive.bg_fill = pal.card;
    visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, pal.line);
    visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, pal.text);
    visuals.widgets.hovered.bg_fill = pal.accent_soft;
    visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, pal.accent);
    visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, pal.text);
    visuals.widgets.active.bg_fill = pal.accent_soft;
    visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0, pal.accent);
    visuals.selection.bg_fill = pal.accent_soft;
    visuals.selection.stroke = egui::Stroke::new(1.0, pal.accent);
    visuals.window_stroke = egui::Stroke::new(1.0, pal.line);
    visuals.window_corner_radius = egui::CornerRadius::same(14);
    visuals.menu_corner_radius = egui::CornerRadius::same(10);
    for widget in [
        &mut visuals.widgets.noninteractive,
        &mut visuals.widgets.inactive,
        &mut visuals.widgets.hovered,
        &mut visuals.widgets.active,
        &mut visuals.widgets.open,
    ] {
        widget.corner_radius = egui::CornerRadius::same(8);
    }
    ctx.set_visuals(visuals);
}

// ---- 通用小部件 ----

pub fn heading(ui: &mut egui::Ui, pal: &Palette, eyebrow: &str, title: &str, subtitle: &str) {
    ui.label(egui::RichText::new(eyebrow).size(11.0).color(pal.muted));
    ui.label(egui::RichText::new(title).size(27.0).strong().color(pal.text));
    if !subtitle.is_empty() {
        ui.label(egui::RichText::new(subtitle).size(13.0).color(pal.muted));
    }
    ui.add_space(6.0);
}

pub fn section(ui: &mut egui::Ui, pal: &Palette, title: &str, badge_text: Option<&str>) {
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(title)
                .size(16.0)
                .strong()
                .color(pal.text),
        );
        if let Some(text) = badge_text {
            badge(ui, pal, text, Tone::Neutral);
        }
    });
    ui.add_space(4.0);
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Neutral,
    Accent,
    Coral,
    Yellow,
    Green,
    Info,
    Success,
    Error,
}

pub fn tone_color(pal: &Palette, tone: Tone) -> egui::Color32 {
    match tone {
        Tone::Neutral => pal.muted,
        Tone::Accent => pal.accent,
        Tone::Coral => pal.coral,
        Tone::Yellow => pal.yellow,
        Tone::Green | Tone::Success => pal.green,
        Tone::Info => pal.accent,
        Tone::Error => pal.coral,
    }
}

pub fn badge(ui: &mut egui::Ui, pal: &Palette, text: &str, tone: Tone) {
    let color = tone_color(pal, tone);
    let bg = color.gamma_multiply(0.16);
    egui::Frame::new()
        .fill(bg)
        .stroke(egui::Stroke::new(1.0, color.gamma_multiply(0.55)))
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::symmetric(6, 1))
        .show(ui, |ui| {
            ui.label(egui::RichText::new(text).size(10.5).color(color));
        });
}

pub fn status_chip(ui: &mut egui::Ui, pal: &Palette, status: &str) {
    let color = status_color(pal, status);
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), egui::Sense::hover());
        ui.painter().circle_filled(rect.center(), 3.5, color);
        ui.label(
            egui::RichText::new(status_label(status))
                .size(11.5)
                .color(color),
        );
    });
}

pub fn primary_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    ui.add(
        egui::Button::new(egui::RichText::new(text).size(13.0).color(egui::Color32::WHITE))
            .fill(pal.accent)
            .stroke(egui::Stroke::new(1.0, pal.accent))
            .corner_radius(egui::CornerRadius::same(9))
            .min_size(egui::vec2(0.0, 30.0)),
    )
}

pub fn ghost_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    ui.add(
        egui::Button::new(egui::RichText::new(text).size(13.0).color(pal.text))
            .fill(egui::Color32::TRANSPARENT)
            .stroke(egui::Stroke::new(1.0, pal.line))
            .corner_radius(egui::CornerRadius::same(9))
            .min_size(egui::vec2(0.0, 30.0)),
    )
}

pub fn danger_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    ui.add(
        egui::Button::new(egui::RichText::new(text).size(13.0).color(egui::Color32::WHITE))
            .fill(pal.coral)
            .stroke(egui::Stroke::new(1.0, pal.coral))
            .corner_radius(egui::CornerRadius::same(9))
            .min_size(egui::vec2(0.0, 30.0)),
    )
}

/// egui 0.37 移除了 SelectableLabel，用无边框的 selectable Button 保持原样。
pub struct SelectableLabel {
    selected: bool,
    text: egui::RichText,
}

impl SelectableLabel {
    pub fn new(selected: bool, text: egui::RichText) -> Self {
        Self { selected, text }
    }
}

impl egui::Widget for SelectableLabel {
    fn ui(self, ui: &mut egui::Ui) -> egui::Response {
        ui.add(
            egui::Button::selectable(self.selected, self.text)
                .frame(false)
                .corner_radius(egui::CornerRadius::same(8)),
        )
    }
}

pub fn card(ui: &mut egui::Ui, pal: &Palette, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(12))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui);
        });
}

pub fn empty(ui: &mut egui::Ui, pal: &Palette, title: &str, desc: &str) {
    ui.vertical_centered(|ui| {
        ui.add_space(18.0);
        ui.label(egui::RichText::new(title).size(14.0).strong().color(pal.text));
        if !desc.is_empty() {
            ui.label(egui::RichText::new(desc).size(12.0).color(pal.muted));
        }
        ui.add_space(18.0);
    });
}

pub fn kv(ui: &mut egui::Ui, pal: &Palette, key: &str, value: &str) {
    ui.label(egui::RichText::new(key).size(11.5).color(pal.muted));
    ui.label(
        egui::RichText::new(value)
            .size(12.5)
            .color(pal.text)
            .monospace(),
    );
}

pub fn code(ui: &mut egui::Ui, pal: &Palette, value: &str) {
    ui.label(
        egui::RichText::new(value)
            .size(11.5)
            .color(pal.muted)
            .monospace(),
    );
}

pub fn progress(ui: &mut egui::Ui, pal: &Palette, fraction: f32, width: f32) {
    ui.add(
        egui::ProgressBar::new(fraction.clamp(0.0, 1.0))
            .desired_width(width)
            .fill(pal.accent)
            .text(egui::RichText::new(format!("{:.0}%", fraction * 100.0)).size(10.0)),
    );
}

pub fn task_row(ui: &mut egui::Ui, pal: &Palette, task: &Value) {
    let status = s(task, "status");
    let color = status_color(pal, status);
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(10))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(format!("● {}", status_label(status)))
                        .size(11.0)
                        .color(color),
                );
                ui.label(
                    egui::RichText::new(s(task, "label"))
                        .size(13.0)
                        .strong()
                        .color(pal.text),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(date_time(s(task, "timestamp")))
                            .size(10.5)
                            .color(pal.muted),
                    );
                });
            });
            let message = s(task, "message");
            if !message.is_empty() {
                // 失败任务可能带回整段进程日志，卡片里只留开头，完整内容在控制台。
                let mut clipped: String = message.chars().take(320).collect();
                if message.chars().count() > 320 {
                    clipped.push('…');
                }
                ui.label(egui::RichText::new(clipped).size(11.5).color(pal.muted));
            }
            if status == "running" {
                if let Some(p) = task.get("progress").and_then(Value::as_f64) {
                    let frac = if p <= 1.0 { p } else { p / 100.0 };
                    progress(ui, pal, frac as f32, ui.available_width());
                } else {
                    ui.spinner();
                }
            }
        });
}


