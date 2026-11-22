mod library;
mod profile;
mod system;
mod workspace;

pub use library::{kernels, market, packs, releases};
pub use profile::{achievements, profile};
pub use system::{settings, tasks};
pub use workspace::{instances, overview};

use crate::gui::dialogs::{Dialog, PathKind};
use crate::gui::util::{self, Palette};
use crate::gui::App;
use eframe::egui;
use serde_json::{json, Value};

/// 实例的启动/停止与更多操作。总览和实例详情共用。
pub fn instance_actions(
    app: &mut App,
    ui: &mut egui::Ui,
    pal: &Palette,
    instance: &Value,
    compact: bool,
) {
    let id = util::s(instance, "id").to_string();
    let status = util::s(instance, "status");
    let running = status == "running" || status == "starting";
    let busy = app
        .pending
        .iter()
        .any(|item| item.instance_id.as_deref() == Some(id.as_str()));
    let online = app.online();

    ui.horizontal_wrapped(|ui| {
        if busy {
            ui.spinner();
        }
        let start = if running { "停止" } else { "启动" };
        let clicked = if !running {
            util::primary_button(ui, pal, start).clicked()
        } else {
            util::ghost_button(ui, pal, start).clicked()
        };
        if clicked && online && !busy {
            if running {
                app.run("stop_instance", json!({ "id": id }), "停止实例");
            } else {
                app.run("launch_instance", json!({ "id": id }), "启动实例");
            }
        }
        if !compact {
            if util::ghost_button(ui, pal, "配置").clicked() && online && !running {
                app.dialog = Some(Dialog::configure(instance));
            }
            if util::ghost_button(ui, pal, "克隆").clicked() && online && !running {
                app.dialog = Some(Dialog::clone_instance(instance));
            }
            if util::ghost_button(ui, pal, "导出").clicked() {
                app.dialog = Some(Dialog::path(PathKind::Export, instance));
            }
            if util::ghost_button(ui, pal, "目录").clicked() {
                app.run(
                    "open_path",
                    json!({ "path": util::s(instance, "home") }),
                    "打开实例目录",
                );
            }
            if util::ghost_button(ui, pal, "删除").clicked() && online && !running {
                app.dialog = Some(Dialog::confirm(
                    "删除此实例？",
                    format!(
                        "从启动器中移除「{}」。引擎会保留可恢复的数据，删除前必须停止实例。",
                        util::s(instance, "name")
                    ),
                    "删除实例",
                    "delete_instance",
                    json!({ "id": id }),
                    true,
                ));
            }
        }
    });
}
