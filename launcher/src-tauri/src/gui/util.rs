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

/// 原版鲸鱼 logo（窗口图标同一张图）。
pub fn logo(ui: &mut egui::Ui, texture: &egui::TextureHandle, size: f32) {
    ui.add(egui::Image::from_texture((
        texture.id(),
        egui::vec2(size, size),
    )));
}

// ---- 像素鲸鱼与驾驶舱装饰（数据来自原 pixel-world.tsx）----

type Px = (f32, f32, f32, f32);

const WHALE_BODY_LIGHT: &[Px] = &[
    (92.0, 12.0, 12.0, 4.0), (84.0, 16.0, 40.0, 4.0), (76.0, 20.0, 72.0, 4.0),
    (68.0, 24.0, 104.0, 4.0), (60.0, 28.0, 144.0, 4.0), (52.0, 32.0, 176.0, 4.0),
    (44.0, 36.0, 192.0, 4.0), (36.0, 40.0, 192.0, 4.0), (36.0, 44.0, 184.0, 4.0),
    (32.0, 48.0, 184.0, 4.0), (24.0, 52.0, 184.0, 4.0), (20.0, 56.0, 180.0, 4.0),
    (16.0, 60.0, 176.0, 4.0), (12.0, 64.0, 176.0, 4.0), (8.0, 68.0, 172.0, 4.0),
    (8.0, 72.0, 164.0, 4.0), (4.0, 76.0, 160.0, 4.0), (4.0, 80.0, 152.0, 4.0),
    (8.0, 84.0, 144.0, 4.0), (12.0, 88.0, 132.0, 4.0), (16.0, 92.0, 116.0, 4.0),
    (24.0, 96.0, 100.0, 4.0), (32.0, 100.0, 84.0, 4.0), (44.0, 104.0, 60.0, 4.0),
];
const WHALE_BODY_MID: &[Px] = &[
    (92.0, 44.0, 124.0, 4.0), (80.0, 48.0, 144.0, 4.0), (68.0, 52.0, 156.0, 4.0),
    (56.0, 56.0, 164.0, 4.0), (44.0, 60.0, 168.0, 4.0), (36.0, 64.0, 164.0, 4.0),
    (32.0, 68.0, 160.0, 4.0), (28.0, 72.0, 152.0, 4.0), (28.0, 76.0, 144.0, 4.0),
    (32.0, 80.0, 132.0, 4.0), (40.0, 84.0, 120.0, 4.0), (52.0, 88.0, 104.0, 4.0),
    (68.0, 92.0, 84.0, 4.0),
];
const WHALE_BODY_DARK: &[Px] = &[
    (48.0, 88.0, 108.0, 4.0), (60.0, 92.0, 96.0, 4.0), (76.0, 96.0, 80.0, 4.0),
    (96.0, 100.0, 64.0, 4.0), (120.0, 104.0, 40.0, 4.0), (128.0, 108.0, 24.0, 4.0),
];
const WHALE_BODY_WHITE: &[Px] = &[
    (36.0, 64.0, 12.0, 8.0), (52.0, 72.0, 12.0, 4.0), (68.0, 80.0, 16.0, 4.0),
    (88.0, 84.0, 20.0, 4.0), (112.0, 88.0, 16.0, 4.0), (136.0, 88.0, 16.0, 4.0),
];
const WHALE_BODY_NAVY: &[Px] = &[
    (64.0, 72.0, 8.0, 8.0), (104.0, 84.0, 20.0, 4.0), (112.0, 92.0, 16.0, 4.0),
    (124.0, 100.0, 12.0, 4.0), (144.0, 104.0, 8.0, 4.0),
];
const WHALE_BODY_PALE: &[Px] = &[
    (56.0, 28.0, 8.0, 4.0), (72.0, 32.0, 12.0, 4.0), (88.0, 40.0, 12.0, 4.0),
    (112.0, 48.0, 20.0, 4.0), (132.0, 56.0, 16.0, 4.0), (156.0, 64.0, 12.0, 4.0),
];
const WHALE_TAIL_LIGHT: &[Px] = &[
    (208.0, 48.0, 16.0, 4.0), (216.0, 44.0, 12.0, 4.0), (224.0, 40.0, 12.0, 4.0),
    (228.0, 32.0, 16.0, 4.0), (232.0, 24.0, 16.0, 4.0), (240.0, 16.0, 16.0, 4.0),
    (244.0, 8.0, 16.0, 4.0), (252.0, 4.0, 20.0, 4.0), (264.0, 8.0, 12.0, 4.0),
    (260.0, 16.0, 16.0, 4.0), (256.0, 20.0, 12.0, 4.0), (248.0, 28.0, 12.0, 4.0),
    (244.0, 36.0, 12.0, 4.0), (236.0, 44.0, 16.0, 4.0), (228.0, 52.0, 16.0, 4.0),
    (224.0, 60.0, 12.0, 4.0), (216.0, 64.0, 16.0, 4.0), (212.0, 72.0, 12.0, 4.0),
    (204.0, 76.0, 16.0, 4.0), (196.0, 80.0, 16.0, 4.0),
];
const WHALE_TAIL_WHITE: &[Px] = &[
    (252.0, 4.0, 20.0, 4.0), (260.0, 8.0, 12.0, 4.0), (244.0, 16.0, 8.0, 4.0),
];
const WHALE_TAIL_MID: &[Px] = &[
    (216.0, 52.0, 12.0, 4.0), (224.0, 60.0, 12.0, 4.0), (212.0, 68.0, 12.0, 4.0),
    (204.0, 76.0, 12.0, 4.0),
];
const WHALE_BELLY: &[(f32, f32, f32, f32, egui::Color32)] = &[
    (36.0, 92.0, 12.0, 4.0, egui::Color32::from_rgb(0xbd, 0xe7, 0xff)),
    (52.0, 96.0, 16.0, 4.0, egui::Color32::from_rgb(0xbd, 0xe7, 0xff)),
    (72.0, 100.0, 20.0, 4.0, egui::Color32::from_rgb(0x8f, 0xd0, 0xff)),
    (96.0, 104.0, 24.0, 4.0, egui::Color32::from_rgb(0x6f, 0xb8, 0xff)),
];

/// 按原版 viewBox (280×124) 绘制像素鲸鱼；scale=1 时逐像素清晰。
pub fn paint_whale(painter: &egui::Painter, origin: egui::Pos2, scale: f32) {
    let light = egui::Color32::from_rgb(0x72, 0xb9, 0xff);
    let mid = egui::Color32::from_rgb(0x2f, 0x7c, 0xff);
    let dark = egui::Color32::from_rgb(0x15, 0x50, 0xb8);
    let white = egui::Color32::from_rgb(0xea, 0xf7, 0xff);
    let navy = egui::Color32::from_rgb(0x0a, 0x23, 0x4f);
    let pale = egui::Color32::from_rgb(0x9e, 0xd8, 0xff);
    let draw = |rects: &[Px], color: egui::Color32| {
        for (x, y, w, h) in rects {
            painter.rect_filled(
                egui::Rect::from_min_size(
                    egui::pos2(origin.x + x * scale, origin.y + y * scale),
                    egui::vec2(w * scale, h * scale),
                ),
                egui::CornerRadius::same(0),
                color,
            );
        }
    };
    draw(WHALE_TAIL_LIGHT, light);
    draw(WHALE_TAIL_WHITE, white);
    draw(WHALE_TAIL_MID, mid);
    draw(WHALE_BODY_LIGHT, light);
    draw(WHALE_BODY_MID, mid);
    draw(WHALE_BODY_DARK, dark);
    draw(WHALE_BODY_WHITE, white);
    draw(WHALE_BODY_NAVY, navy);
    draw(WHALE_BODY_PALE, pale);
    for (x, y, w, h, color) in WHALE_BELLY {
        painter.rect_filled(
            egui::Rect::from_min_size(
                egui::pos2(origin.x + x * scale, origin.y + y * scale),
                egui::vec2(w * scale, h * scale),
            ),
            egui::CornerRadius::same(0),
            *color,
        );
    }
}

/// 驾驶舱四角的 ⌐ 括号。
pub fn cockpit_corners(painter: &egui::Painter, rect: egui::Rect, pal: &Palette) {
    let stroke = egui::Stroke::new(1.5, pal.text.gamma_multiply(0.45));
    let inset = 6.0;
    let length = 16.0;
    let tl = egui::pos2(rect.left() + inset, rect.top() + inset);
    painter.line_segment([tl, egui::pos2(tl.x + length, tl.y)], stroke);
    painter.line_segment([tl, egui::pos2(tl.x, tl.y + length)], stroke);
    let tr = egui::pos2(rect.right() - inset, rect.top() + inset);
    painter.line_segment([egui::pos2(tr.x - length, tr.y), tr], stroke);
    painter.line_segment([tr, egui::pos2(tr.x, tr.y + length)], stroke);
    let bl = egui::pos2(rect.left() + inset, rect.bottom() - inset);
    painter.line_segment([bl, egui::pos2(bl.x + length, bl.y)], stroke);
    painter.line_segment([egui::pos2(bl.x, bl.y - length), bl], stroke);
    let br = egui::pos2(rect.right() - inset, rect.bottom() - inset);
    painter.line_segment([egui::pos2(br.x - length, br.y), br], stroke);
    painter.line_segment([egui::pos2(br.x, br.y - length), br], stroke);
}

/// 顶部遥测条里的 8 根小柱。
pub fn telemetry_bars(ui: &mut egui::Ui, pal: &Palette) {
    let heights = [5.0f32, 9.0, 6.0, 12.0, 7.0, 10.0, 4.0, 8.0];
    let (area, _) = ui.allocate_exact_size(egui::vec2(38.0, 12.0), egui::Sense::hover());
    for (index, height) in heights.iter().enumerate() {
        let color = match index % 3 {
            0 => pal.accent,
            1 => pal.muted,
            _ => pal.text.gamma_multiply(0.55),
        };
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                egui::pos2(area.left() + index as f32 * 4.6, area.bottom() - height),
                egui::vec2(3.0, *height),
            ),
            egui::CornerRadius::same(1),
            color,
        );
    }
}

/// 舞台右下角的均衡器小柱。
pub fn stage_pixels(ui: &mut egui::Ui, pal: &Palette) {
    let heights = [8.0f32, 14.0, 6.0, 11.0];
    let colors = [pal.accent, pal.text, pal.coral, pal.muted];
    let (area, _) = ui.allocate_exact_size(egui::vec2(46.0, 14.0), egui::Sense::hover());
    for (index, height) in heights.iter().enumerate() {
        ui.painter().rect_filled(
            egui::Rect::from_min_size(
                egui::pos2(area.right() - 5.0 - index as f32 * 11.0, area.bottom() - height),
                egui::vec2(5.0, *height),
            ),
            egui::CornerRadius::same(1),
            colors[index],
        );
    }
}

/// 像素小鱼（32×16，variant 翻转配色）。
pub fn paint_fish(painter: &egui::Painter, origin: egui::Pos2, scale: f32, variant: usize) {
    let (body, fin) = if variant % 2 == 1 {
        (
            egui::Color32::from_rgb(0xea, 0xf7, 0xff),
            egui::Color32::from_rgb(0x6f, 0xb8, 0xff),
        )
    } else {
        (
            egui::Color32::from_rgb(0x6f, 0xb8, 0xff),
            egui::Color32::from_rgb(0xea, 0xf7, 0xff),
        )
    };
    let eye = egui::Color32::from_rgb(0x08, 0x1a, 0x3a);
    let rect = |x: f32, y: f32, w: f32, h: f32, color: egui::Color32| {
        painter.rect_filled(
            egui::Rect::from_min_size(
                origin + egui::vec2(x * scale, y * scale),
                egui::vec2(w * scale, h * scale),
            ),
            egui::CornerRadius::same(0),
            color,
        );
    };
    rect(0.0, 8.0, 8.0, 4.0, fin);
    rect(8.0, 4.0, 24.0, 4.0, body);
    rect(4.0, 8.0, 20.0, 4.0, body);
    rect(8.0, 12.0, 12.0, 4.0, body);
    rect(20.0, 8.0, 4.0, 4.0, eye);
    rect(12.0, 12.0, 8.0, 4.0, fin);
}

/// 像素云。
pub fn paint_cloud(painter: &egui::Painter, origin: egui::Pos2, scale: f32, color: egui::Color32) {
    for (x, y, w, h) in [(0.0f32, 6.0, 8.0, 4.0), (5.0, 2.0, 9.0, 8.0), (13.0, 6.0, 8.0, 4.0)] {
        painter.rect_filled(
            egui::Rect::from_min_size(
                origin + egui::vec2(x * scale, y * scale),
                egui::vec2(w * scale, h * scale),
            ),
            egui::CornerRadius::same(0),
            color,
        );
    }
}

/// 全窗环境粒子（原 AmbientWorld 画布的移植）。
pub fn ambient_particles(ui: &mut egui::Ui, _pal: &Palette, t: f32) {
    let area = ui.max_rect();
    let w = area.width();
    let h = area.height();
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let count = ((w * h / 18000.0) as usize).min(90);
    for i in 0..count {
        let base_x = ((i as f32 * 137.51) % 997.0) / 997.0 * w;
        let base_y = ((i as f32 * 283.73) % 991.0) / 991.0 * h;
        let depth = 0.2 + (i % 7) as f32 / 9.0;
        let size = if i % 10 == 0 {
            4.0
        } else if i % 3 == 0 {
            3.0
        } else {
            2.0
        };
        let phase = i as f32 * 1.618;
        let cross = i % 12 == 0;
        let x = (((base_x + t * 6.0 * depth + w) % w) / 2.0).floor() * 2.0;
        let y = ((base_y + (t * 0.4 + phase).sin() * 9.0) / 2.0).floor() * 2.0;
        let alpha = (0.1 + depth * 0.32 + (t + phase).sin() * 0.09).clamp(0.06, 0.6);
        let alpha = (alpha * 255.0) as u8;
        let color = if cross {
            egui::Color32::from_rgba_unmultiplied(226, 245, 255, alpha)
        } else {
            egui::Color32::from_rgba_unmultiplied(71, 151, 255, alpha)
        };
        let painter = ui.painter();
        let origin = area.min + egui::vec2(x, y);
        painter.rect_filled(
            egui::Rect::from_min_size(origin, egui::vec2(size, size)),
            egui::CornerRadius::same(0),
            color,
        );
        if cross {
            painter.rect_filled(
                egui::Rect::from_min_size(origin + egui::vec2(-5.0, 1.0), egui::vec2(15.0, 2.0)),
                egui::CornerRadius::same(0),
                color,
            );
            painter.rect_filled(
                egui::Rect::from_min_size(origin + egui::vec2(1.0, -5.0), egui::vec2(2.0, 15.0)),
                egui::CornerRadius::same(0),
                color,
            );
        }
    }
}

/// 图标 + 文字整体居中的主按钮。
pub fn primary_icon_button(ui: &mut egui::Ui, pal: &Palette, icon: Icon, text: &str) -> egui::Response {
    let font = egui::FontId::proportional(13.0);
    let galley = ui.painter().layout_no_wrap(text.to_owned(), font.clone(), egui::Color32::WHITE);
    let gap = 6.0;
    let content = 13.0 + gap + galley.size().x;
    let response = ui.add(
        egui::Button::new(egui::RichText::new(" "))
            .fill(pal.accent)
            .stroke(egui::Stroke::new(1.0, pal.accent))
            .corner_radius(egui::CornerRadius::same(9))
            .min_size(egui::vec2(content + 30.0, 30.0)),
    );
    let start = response.rect.center().x - content * 0.5;
    let cy = response.rect.center().y;
    paint_icon(
        ui.painter(),
        egui::pos2(start + 6.5, cy),
        13.0,
        icon,
        egui::Color32::WHITE,
    );
    ui.painter().text(
        egui::pos2(start + 13.0 + gap, cy),
        egui::Align2::LEFT_CENTER,
        text,
        font,
        egui::Color32::WHITE,
    );
    response
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

fn styled_button(
    ui: &mut egui::Ui,
    text: &str,
    fill: egui::Color32,
    stroke: egui::Stroke,
    text_color: egui::Color32,
) -> egui::Response {
    // egui 0.37 的 Button 不保证文字水平居中，用 galley 显式居中绘制。
    let font = egui::FontId::proportional(13.0);
    let galley = ui
        .painter()
        .layout_no_wrap(text.to_owned(), font.clone(), text_color);
    let response = ui.add(
        egui::Button::new(egui::RichText::new(" "))
            .fill(fill)
            .stroke(stroke)
            .corner_radius(egui::CornerRadius::same(9))
            .min_size(egui::vec2(galley.size().x + 30.0, 30.0)),
    );
    let pos = response.rect.center() - galley.size() * 0.5;
    ui.painter().galley(pos, galley, egui::Color32::WHITE);
    response
}

pub fn primary_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    styled_button(
        ui,
        text,
        pal.accent,
        egui::Stroke::new(1.0, pal.accent),
        egui::Color32::WHITE,
    )
}

pub fn ghost_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    styled_button(
        ui,
        text,
        egui::Color32::TRANSPARENT,
        egui::Stroke::new(1.0, pal.line),
        pal.text,
    )
}

pub fn danger_button(ui: &mut egui::Ui, pal: &Palette, text: &str) -> egui::Response {
    styled_button(
        ui,
        text,
        pal.coral,
        egui::Stroke::new(1.0, pal.coral),
        egui::Color32::WHITE,
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

pub fn card(ui: &mut egui::Ui, pal: &Palette, add: impl FnOnce(&mut egui::Ui)) -> egui::InnerResponse<()> {
    egui::Frame::new()
        .fill(pal.card)
        .stroke(egui::Stroke::new(1.0, pal.line))
        .corner_radius(egui::CornerRadius::same(12))
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui);
        })
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


