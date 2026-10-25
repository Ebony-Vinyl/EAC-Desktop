use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub type Result<T> = std::result::Result<T, String>;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub kernel_id: Option<String>,
    pub port: u16,
    pub home: String,
    pub workspace: String,
    #[serde(default)]
    pub plugins: Vec<Plugin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inventory_error: Option<String>,
    pub created_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub core_range: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kernel {
    pub id: String,
    pub version: String,
    pub path: String,
    pub node_path: String,
    pub cli_path: String,
    pub installed_at: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Task {
    pub id: String,
    pub label: String,
    pub status: String,
    pub progress: Option<f64>,
    pub message: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub reduced_motion: bool,
    #[serde(default)]
    pub github_client_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            reduced_motion: false,
            github_client_id: String::new(),
        }
    }
}

// 成就状态与真实操作事件绑定：计数器只在引擎完成对应动作后递增，
// 集合按去重对象累计，日期集合用于连续使用天数。
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementState {
    #[serde(default)]
    pub unlocked: BTreeMap<String, String>,
    #[serde(default)]
    pub counters: BTreeMap<String, i64>,
    #[serde(default)]
    pub plugins: BTreeSet<String>,
    #[serde(default)]
    pub likes: BTreeSet<String>,
    #[serde(default)]
    pub stars: BTreeSet<String>,
    #[serde(default)]
    pub days: BTreeSet<String>,
    #[serde(default)]
    pub streak: i64,
    #[serde(default)]
    pub best_streak: i64,
    #[serde(default)]
    pub last_day: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OwnedProcess {
    pub pid: u32,
    pub start_time: u64,
    pub executable: String,
    pub job: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default)]
    pub instances: Vec<Instance>,
    #[serde(default)]
    pub kernels: Vec<Kernel>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub achievements: AchievementState,
    #[serde(default)]
    pub processes: BTreeMap<String, OwnedProcess>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupKind {
    // 用户主动创建的备份；保留得更久。
    #[default]
    Manual,
    // 插件安装/启停、切换内核前的安全点；数量少，自动轮换。
    Automatic,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Backup {
    pub id: String,
    pub created_at: String,
    pub path: String,
    pub kind: BackupKind,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupManifest {
    pub schema_version: u32,
    pub instance_id: String,
    pub kernel_id: Option<String>,
    pub created_at: String,
    // 旧版 manifest 没有该字段：按用户备份处理，行为保持不变。
    #[serde(default)]
    pub kind: BackupKind,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Descriptor {
    pub schema_version: u32,
    pub name: String,
    pub kind: String,
    pub kernel_version: Option<String>,
    pub plugins: Vec<PortablePlugin>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortablePlugin {
    pub r#ref: String,
}
