use crate::{
    engine::Engine,
    model::{now, AchievementState, Result},
};
use chrono::{Duration, Local, Timelike};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Metric {
    Opens,
    NightOpens,
    DawnOpens,
    GithubLogins,
    Instances,
    Launches,
    MaxConcurrent,
    Plugins,
    Backups,
    Kernels,
    Stars,
    Likes,
    PacksPublished,
    PacksImported,
    Searches,
    RankingViews,
    Downloads,
    NightPlugins,
    Streak,
}

pub(crate) struct Definition {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub tier: &'static str,
    pub icon: &'static str,
    pub target: i64,
    pub points: i64,
    pub hidden: bool,
    metric: Metric,
}

const fn def(
    id: &'static str,
    name: &'static str,
    description: &'static str,
    category: &'static str,
    tier: &'static str,
    icon: &'static str,
    target: i64,
    points: i64,
    hidden: bool,
    metric: Metric,
) -> Definition {
    Definition {
        id,
        name,
        description,
        category,
        tier,
        icon,
        target,
        points,
        hidden,
        metric,
    }
}

pub(crate) const DEFINITIONS: &[Definition] = &[
    def("first_light", "初光", "第一次打开 EAC 启动器，深海的灯亮起。", "启航", "common", "spark", 1, 10, false, Metric::Opens),
    def("night_watch", "守夜人", "在 00:00 到 05:00 之间打开启动器。", "启航", "rare", "moon", 1, 20, true, Metric::NightOpens),
    def("dawn_patrol", "晨巡", "在 05:00 到 07:00 之间打开启动器。", "启航", "rare", "sunrise", 1, 20, true, Metric::DawnOpens),
    def("first_workspace", "第一间舱室", "创建第一个独立实例。", "启航", "common", "box", 1, 15, false, Metric::Instances),
    def("ignition", "点火", "第一次真正启动一个实例。", "启航", "common", "rocket", 1, 15, false, Metric::Launches),
    def("twin_engines", "双引擎", "同时运行两个实例，让两套内核并行。", "启航", "epic", "layers", 2, 40, false, Metric::MaxConcurrent),
    def("kernel_archivist", "内核考古", "安装或登记 3 个不同内核版本。", "启航", "rare", "archive", 3, 30, false, Metric::Kernels),
    def("backup_first", "安全网", "完成第一次实例备份。", "启航", "common", "shield", 1, 15, false, Metric::Backups),
    def("backup_keeper", "守档人", "累计完成 10 次实例备份。", "启航", "epic", "shield", 10, 45, false, Metric::Backups),
    def("deep_diver", "深潜者", "用 GitHub 账号登录启动器。", "社交", "common", "github", 1, 20, false, Metric::GithubLogins),
    def("first_star", "第一颗星", "直接在启动器里为项目点亮第一颗 Star。", "社交", "common", "star", 1, 20, false, Metric::Stars),
    def("constellation", "星座", "为 5 个不同项目点亮 Star。", "社交", "epic", "constellation", 5, 50, false, Metric::Stars),
    def("star_sailor", "星海领航", "为 15 个不同项目点亮 Star。", "社交", "legendary", "compass", 15, 80, false, Metric::Stars),
    def("curator", "拾光者", "在插件市场点赞 10 个不同插件。", "社交", "rare", "heart", 10, 35, false, Metric::Likes),
    def("taste_maker", "品味制造者", "在插件市场点赞 30 个不同插件。", "社交", "epic", "heart", 30, 60, false, Metric::Likes),
    def("first_plugin", "第一枚齿轮", "为实例安装第一个插件。", "工坊", "common", "gear", 1, 15, false, Metric::Plugins),
    def("gear_collector", "齿轮收藏家", "累计安装 10 个不同插件。", "工坊", "rare", "gear", 10, 35, false, Metric::Plugins),
    def("module_master", "模块大师", "累计安装 30 个不同插件。", "工坊", "epic", "plug", 30, 60, false, Metric::Plugins),
    def("night_shift", "深夜装配", "在 00:00 到 05:00 之间成功安装插件。", "工坊", "rare", "moon-gear", 1, 25, true, Metric::NightPlugins),
    def("pack_maker", "打包师", "把自己的插件组合发布到大厅。", "工坊", "rare", "package", 1, 30, false, Metric::PacksPublished),
    def("pack_rider", "空投乘客", "导入一个整合包清单。", "工坊", "common", "parachute", 1, 20, false, Metric::PacksImported),
    def("market_scout", "市场侦察", "在插件市场完成 20 次搜索。", "工坊", "common", "search", 20, 20, false, Metric::Searches),
    def("tide_watcher", "潮汐观测", "查看一次插件下载排行榜。", "工坊", "common", "chart", 1, 10, false, Metric::RankingViews),
    def("three_days", "三日航迹", "连续 3 天打开启动器。", "坚持", "common", "calendar", 3, 20, false, Metric::Streak),
    def("seven_days", "七日航迹", "连续 7 天打开启动器。", "坚持", "rare", "calendar-week", 7, 40, false, Metric::Streak),
    def("thirty_days", "三十日航迹", "连续 30 天打开启动器。", "坚持", "legendary", "calendar-month", 30, 100, false, Metric::Streak),
    def("hundred_opens", "百次下潜", "累计打开启动器 100 次。", "坚持", "epic", "waves", 100, 50, false, Metric::Opens),
    def("download_first", "首次下潜", "从插件市场完成一次插件安装。", "工坊", "common", "download", 1, 10, false, Metric::Downloads),
    def("download_ten", "潮汐采集者", "从插件市场完成 10 次插件安装。", "工坊", "rare", "tide", 10, 30, false, Metric::Downloads),
];

fn counter(state: &AchievementState, key: &str) -> i64 {
    state.counters.get(key).copied().unwrap_or(0)
}

fn progress(def: &Definition, state: &AchievementState) -> i64 {
    match def.metric {
        Metric::Opens => counter(state, "opens"),
        Metric::NightOpens => counter(state, "nightOpens"),
        Metric::DawnOpens => counter(state, "dawnOpens"),
        Metric::GithubLogins => counter(state, "githubLogins"),
        Metric::Instances => counter(state, "instances"),
        Metric::Launches => counter(state, "launches"),
        Metric::MaxConcurrent => counter(state, "maxConcurrent"),
        Metric::Plugins => state.plugins.len() as i64,
        Metric::Backups => counter(state, "backups"),
        Metric::Kernels => counter(state, "kernels"),
        Metric::Stars => state.stars.len() as i64,
        Metric::Likes => state.likes.len() as i64,
        Metric::PacksPublished => counter(state, "packsPublished"),
        Metric::PacksImported => counter(state, "packsImported"),
        Metric::Searches => counter(state, "searches"),
        Metric::RankingViews => counter(state, "rankingViews"),
        Metric::Downloads => counter(state, "downloads"),
        Metric::NightPlugins => counter(state, "nightPlugins"),
        Metric::Streak => state.best_streak.max(state.streak),
    }
}

fn bump(state: &mut AchievementState, key: &str, amount: i64) {
    *state.counters.entry(key.to_string()).or_insert(0) += amount;
}

fn touch_day(state: &mut AchievementState) {
    let today = Local::now().date_naive();
    let today_text = today.format("%Y-%m-%d").to_string();
    if state.days.contains(&today_text) {
        return;
    }
    let yesterday = (today - Duration::days(1)).format("%Y-%m-%d").to_string();
    state.streak = if state.last_day == yesterday {
        state.streak + 1
    } else {
        1
    };
    state.best_streak = state.best_streak.max(state.streak);
    state.last_day = today_text.clone();
    state.days.insert(today_text);
    if state.days.len() > 400 {
        let keep: BTreeSet<String> = state.days.iter().skip(state.days.len() - 400).cloned().collect();
        state.days = keep;
    }
}

pub(crate) fn summary(state: &AchievementState) -> Value {
    let unlocked_count = state.unlocked.len();
    let points: i64 = DEFINITIONS
        .iter()
        .filter(|def| state.unlocked.contains_key(def.id))
        .map(|def| def.points)
        .sum();
    let max_points: i64 = DEFINITIONS.iter().map(|def| def.points).sum();
    json!({
        "total": DEFINITIONS.len(),
        "unlockedCount": unlocked_count,
        "points": points,
        "maxPoints": max_points,
        "streak": state.streak,
        "bestStreak": state.best_streak,
        "days": state.days.len(),
        "opens": counter(state, "opens"),
        "unlocked": state.unlocked,
    })
}

impl Engine {
    pub(crate) fn achievement_event(&self, event: &str, value: Option<&str>) -> Result<Vec<String>> {
        self.state(|state| {
            let achievements = &mut state.achievements;
            let hour = Local::now().hour();
            match event {
                "open" => {
                    bump(achievements, "opens", 1);
                    if hour < 5 {
                        bump(achievements, "nightOpens", 1);
                    } else if hour < 7 {
                        bump(achievements, "dawnOpens", 1);
                    }
                    touch_day(achievements);
                }
                "instance_created" => bump(achievements, "instances", 1),
                "instance_launched" => {
                    bump(achievements, "launches", 1);
                    if let Some(count) = value.and_then(|value| value.parse::<i64>().ok()) {
                        let current = counter(achievements, "maxConcurrent");
                        if count > current {
                            achievements.counters.insert("maxConcurrent".into(), count);
                        }
                    }
                }
                "plugin_installed" => {
                    if let Some(plugin) = value.filter(|value| !value.is_empty()) {
                        achievements.plugins.insert(plugin.to_string());
                    }
                    if hour < 5 {
                        bump(achievements, "nightPlugins", 1);
                    }
                }
                "backup_created" => bump(achievements, "backups", 1),
                "kernel_added" => bump(achievements, "kernels", 1),
                "github_login" => bump(achievements, "githubLogins", 1),
                "github_star" => {
                    if let Some(repo) = value.filter(|value| !value.is_empty()) {
                        achievements.stars.insert(repo.to_string());
                    }
                }
                "plugin_liked" => {
                    if let Some(plugin) = value.filter(|value| !value.is_empty()) {
                        achievements.likes.insert(plugin.to_string());
                    }
                }
                "pack_published" => bump(achievements, "packsPublished", 1),
                "pack_imported" => bump(achievements, "packsImported", 1),
                "market_search" => bump(achievements, "searches", 1),
                "ranking_viewed" => bump(achievements, "rankingViews", 1),
                "market_download" => bump(achievements, "downloads", 1),
                other => return Err(format!("Unknown achievement event: {other}")),
            }
            let mut newly = Vec::new();
            for def in DEFINITIONS {
                if achievements.unlocked.contains_key(def.id) {
                    continue;
                }
                if progress(def, achievements) >= def.target {
                    achievements.unlocked.insert(def.id.to_string(), now());
                    newly.push(def.id.to_string());
                }
            }
            Ok(newly)
        })
    }

    pub(crate) fn achievements_view(&self) -> Result<Value> {
        let state = self.state(|state| Ok(state.achievements.clone()))?;
        let mut definitions = Vec::new();
        for def in DEFINITIONS {
            let unlocked_at = state.unlocked.get(def.id);
            let masked = def.hidden && unlocked_at.is_none();
            definitions.push(json!({
                "id": def.id,
                "name": if masked { "???" } else { def.name },
                "description": if masked { "隐藏成就：达成后揭晓。" } else { def.description },
                "category": def.category,
                "tier": def.tier,
                "icon": def.icon,
                "target": def.target,
                "current": progress(def, &state).min(def.target),
                "points": def.points,
                "hidden": def.hidden,
                "unlockedAt": unlocked_at,
            }));
        }
        Ok(json!({
            "definitions": definitions,
            "summary": summary(&state),
            "today": Local::now().format("%Y-%m-%d").to_string(),
        }))
    }

    pub(crate) fn record_achievement_event(&self, payload: &Value) -> Result<Value> {
        let event = crate::engine::required(payload, "event")?;
        if !matches!(
            event,
            "plugin_liked"
                | "pack_published"
                | "pack_imported"
                | "market_search"
                | "ranking_viewed"
                | "market_download"
        ) {
            return Err("Unknown achievement event".into());
        }
        if event == "plugin_liked" {
            crate::social::ensure_login_enabled()?;
        }
        let value = crate::engine::optional(payload, "value")?;
        if let Some(value) = value {
            if value.len() > 300 || value.chars().any(char::is_control) {
                return Err("Achievement event value is invalid".into());
            }
        }
        let newly = self.achievement_event(event, value)?;
        Ok(json!({
            "newlyUnlocked": newly,
            "achievements": summary(&self.state(|state| Ok(state.achievements.clone()))?),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;

    fn temp_engine() -> (Engine, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        let engine = Engine::at(dir.path()).expect("engine");
        (engine, dir)
    }

    #[test]
    fn achievements_unlock_once_and_report_new_ids() {
        let (engine, _dir) = temp_engine();
        let first = engine.achievement_event("instance_created", None).expect("event");
        assert!(first.contains(&"first_workspace".to_string()));
        let second = engine.achievement_event("instance_created", None).expect("event");
        assert!(!second.contains(&"first_workspace".to_string()));
        let view = engine.achievements_view().expect("view");
        let definitions = view["definitions"].as_array().expect("definitions");
        let workspace = definitions.iter().find(|item| item["id"] == "first_workspace").expect("definition");
        assert_eq!(workspace["current"], 1);
        assert!(workspace["unlockedAt"].is_string());
    }

    #[test]
    fn unique_sets_drive_plugin_and_star_progress() {
        let (engine, _dir) = temp_engine();
        for name in ["alpha", "beta", "gamma"] {
            engine.achievement_event("plugin_installed", Some(name)).expect("plugin");
        }
        for repo in ["a/one", "b/two"] {
            engine.achievement_event("github_star", Some(repo)).expect("star");
        }
        let state = engine.state(|state| Ok(state.achievements.clone())).expect("state");
        assert_eq!(state.plugins.len(), 3);
        assert_eq!(state.stars.len(), 2);
        assert!(state.unlocked.contains_key("first_plugin"));
        assert!(!state.unlocked.contains_key("gear_collector"));
    }

    #[test]
    fn consecutive_days_extend_streak() {
        let mut state = AchievementState::default();
        let today = Local::now().date_naive();
        state.last_day = (today - Duration::days(1)).format("%Y-%m-%d").to_string();
        state.streak = 2;
        state.best_streak = 2;
        state.days.insert(state.last_day.clone());
        touch_day(&mut state);
        assert_eq!(state.streak, 3);
        assert_eq!(state.best_streak, 3);
        touch_day(&mut state);
        assert_eq!(state.streak, 3);
    }

    #[test]
    fn summary_counts_points_only_for_unlocked() {
        let mut state = AchievementState::default();
        state.unlocked.insert("first_light".into(), now());
        let value = summary(&state);
        assert_eq!(value["unlockedCount"], 1);
        assert_eq!(value["points"], 10);
        assert!(value["maxPoints"].as_i64().unwrap() >= 900);
    }

}
