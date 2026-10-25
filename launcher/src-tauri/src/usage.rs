use crate::{
    engine::Engine,
    files,
    model::{now, Result},
};
use chrono::{Duration, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const CACHE_VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 800;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageRecord {
    at: i64,
    provider: String,
    model: String,
    input: i64,
    output: i64,
    cache_read: i64,
    reasoning: i64,
    duration_ms: Option<i64>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileUsage {
    modified: u64,
    size: u64,
    session_id: String,
    created_at: Option<i64>,
    last_at: Option<i64>,
    turns: i64,
    steps: i64,
    records: Vec<UsageRecord>,
    truncated: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageCache {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    generated_at: String,
    #[serde(default)]
    files: BTreeMap<String, FileUsage>,
}

#[derive(Default)]
struct Totals {
    tokens: i64,
    input: i64,
    output: i64,
    cache_read: i64,
    reasoning: i64,
    messages: i64,
    duration_ms: i64,
}

impl Totals {
    fn add(&mut self, record: &UsageRecord) {
        self.input += record.input;
        self.output += record.output;
        self.cache_read += record.cache_read;
        self.reasoning += record.reasoning;
        self.tokens += record.input + record.output + record.cache_read;
        self.messages += 1;
        self.duration_ms += record.duration_ms.unwrap_or(0);
    }
    fn value(&self) -> Value {
        json!({
            "tokens": self.tokens,
            "input": self.input,
            "output": self.output,
            "cacheRead": self.cache_read,
            "reasoning": self.reasoning,
            "messages": self.messages,
            "durationMs": self.duration_ms,
            "heat": self.output + self.input / 5 + self.cache_read / 20,
            "avgSpeed": speed(self.output, self.duration_ms),
        })
    }
}

#[derive(Default)]
struct ModelTotals {
    totals: Totals,
    last_at: i64,
}

struct RootScan {
    label: String,
    path: PathBuf,
    files: Vec<PathBuf>,
    records: i64,
    errors: usize,
    last_error: Option<String>,
}

impl Engine {
    pub(crate) fn usage_profile(&self, refresh: bool) -> Result<Value> {
        let roots = self.usage_roots();
        let mut cache = if refresh {
            UsageCache {
                version: CACHE_VERSION,
                ..UsageCache::default()
            }
        } else {
            self.read_usage_cache().unwrap_or_else(|| UsageCache {
                version: CACHE_VERSION,
                ..UsageCache::default()
            })
        };
        if cache.version != CACHE_VERSION {
            cache = UsageCache {
                version: CACHE_VERSION,
                ..UsageCache::default()
            };
        }
        let mut scans = Vec::new();
        let mut seen_files = BTreeSet::new();
        for (label, root) in roots {
            let mut scan = RootScan {
                label,
                path: root.clone(),
                files: Vec::new(),
                records: 0,
                errors: 0,
                last_error: None,
            };
            for file in session_files(&root) {
                let key = files::text(&file);
                if !seen_files.insert(key.clone()) {
                    continue;
                }
                let metadata = match fs::metadata(&file) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        scan.errors += 1;
                        scan.last_error = Some(error.to_string());
                        continue;
                    }
                };
                if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                    continue;
                }
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0);
                let cached = cache.files.get(&key);
                let usable = cached.is_some_and(|cached| {
                    cached.modified == modified && cached.size == metadata.len()
                });
                if !usable {
                    match parse_session(&file) {
                        Ok(mut parsed) => {
                            parsed.modified = modified;
                            parsed.size = metadata.len();
                            cache.files.insert(key.clone(), parsed);
                        }
                        Err(error) => {
                            scan.errors += 1;
                            scan.last_error = Some(error);
                            continue;
                        }
                    }
                }
                if let Some(parsed) = cache.files.get(&key) {
                    scan.files.push(file);
                    scan.records += parsed.records.len() as i64;
                }
            }
            scans.push(scan);
        }
        // 删除已不存在的会话缓存，避免缓存文件随历史目录无限增长。
        cache.files.retain(|key, _| seen_files.contains(key));
        cache.generated_at = now();
        let _ = self.write_usage_cache(&cache);
        Ok(aggregate(&cache, &scans))
    }

    fn usage_cache_path(&self) -> Result<PathBuf> {
        self.path("usage-cache.json")
    }

    fn read_usage_cache(&self) -> Option<UsageCache> {
        let path = self.usage_cache_path().ok()?;
        if !path.is_file() {
            return None;
        }
        files::read_json(&path).ok()
    }

    fn write_usage_cache(&self, cache: &UsageCache) -> Result<()> {
        files::atomic_json(&self.usage_cache_path()?, cache)
    }

    // 只扫描启动器实例与本机 DSH 的真实 sessions 目录。测试使用临时根目录时
    // 不会碰用户日常 ~/.dsh；需要时可用 EAC_USAGE_INCLUDE_HOME=1 显式开启。
    fn usage_roots(&self) -> Vec<(String, PathBuf)> {
        let mut roots: Vec<(String, PathBuf)> = Vec::new();
        let mut seen = BTreeSet::new();
        let mut push = |label: String, path: PathBuf| {
            let key = files::text(&path);
            if seen.insert(key) && path.is_dir() {
                roots.push((label, path));
            }
        };
        let instances = self
            .state(|state| {
                Ok(state
                    .instances
                    .iter()
                    .map(|instance| (instance.name.clone(), instance.home.clone()))
                    .collect::<Vec<_>>())
            })
            .unwrap_or_default();
        for (name, home) in instances {
            push(
                format!("实例 · {name}"),
                Path::new(&home).join("sessions"),
            );
        }
        let default_root = dirs::data_local_dir().map(|directory| directory.join("EACLauncher"));
        let default_root = default_root
            .as_deref()
            .and_then(|path| fs::canonicalize(path).ok());
        let include_home = std::env::var("EAC_USAGE_INCLUDE_HOME")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
            || default_root.as_deref() == Some(self.root.as_path());
        if include_home {
            if let Some(home) = dirs::home_dir() {
                for name in [".dsh", ".deepseek", ".deepseek-ai"] {
                    push(format!("本机 {name}"), home.join(name).join("sessions"));
                }
            }
            if let Some(home) = std::env::var_os("DSH_HOME") {
                push("DSH_HOME".into(), PathBuf::from(home).join("sessions"));
            }
        }
        if let Some(raw) = std::env::var_os("EAC_USAGE_ROOTS") {
            for path in std::env::split_paths(&raw) {
                let sessions = if path.join("sessions").is_dir() {
                    path.join("sessions")
                } else {
                    path
                };
                push("自定义数据源".into(), sessions);
            }
        }
        roots
    }
}

fn session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut queue = vec![(root.to_path_buf(), 0usize)];
    while let Some((directory, depth)) = queue.pop() {
        if files.len() >= MAX_FILES || depth > 4 {
            break;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                queue.push((path, depth + 1));
            } else if metadata.is_file()
                && path.file_name().and_then(|name| name.to_str()) == Some("session.v4.jsonl.zstd")
            {
                files.push(path);
                if files.len() >= MAX_FILES {
                    break;
                }
            }
        }
    }
    files
}

fn parse_session(path: &Path) -> Result<FileUsage> {
    let file = fs::File::open(path).map_err(|error| format!("打开会话日志失败：{error}"))?;
    let decoder = zstd::stream::read::Decoder::new(BufReader::new(file))
        .map_err(|error| format!("解压会话日志失败：{error}"))?;
    let mut reader = BufReader::new(decoder).take(MAX_DECOMPRESSED_BYTES);
    let mut steps: HashMap<(i64, i64), i64> = HashMap::new();
    let mut usage = FileUsage {
        session_id: path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string(),
        ..FileUsage::default()
    };
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => {
                // 会话可能正在写入，最后一段 frame 尚未完整；已读出的真实记录仍然有效。
                usage.truncated = true;
                break;
            }
        }
        if line.len() > 16 * 1024 * 1024 {
            usage.truncated = true;
            continue;
        }
        if !line.contains("\"type\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match value["type"].as_str() {
            Some("session") => {
                if let Some(id) = value["id"].as_str() {
                    usage.session_id = id.to_string();
                }
                usage.created_at = value["createdAt"].as_i64();
            }
            Some("turn/start") => usage.turns += 1,
            Some("step/start") => {
                let turn = value["data"]["turn"].as_i64().unwrap_or(0);
                let step = value["data"]["step"].as_i64().unwrap_or(0);
                let time = value["time"].as_i64().unwrap_or(0);
                if time > 0 {
                    steps.insert((turn, step), time);
                }
            }
            Some("assistant/message") => {
                let metrics = &value["data"]["usage"];
                if !metrics.is_object() {
                    continue;
                }
                let input = metrics["inputTokens"].as_i64().unwrap_or(0).max(0);
                let output = metrics["outputTokens"].as_i64().unwrap_or(0).max(0);
                let cache_read = metrics["cacheReadTokens"].as_i64().unwrap_or(0).max(0);
                let reasoning = metrics["reasoningTokens"].as_i64().unwrap_or(0).max(0);
                let total = metrics["totalTokens"]
                    .as_i64()
                    .unwrap_or(input + output + cache_read);
                if total <= 0 {
                    continue;
                }
                let at = value["time"].as_i64().unwrap_or(0);
                if at <= 0 {
                    continue;
                }
                let source = &value["data"]["message"]["source"];
                let provider = source["provider"].as_str().unwrap_or("unknown").to_string();
                let model = source["model"].as_str().unwrap_or("unknown").to_string();
                let turn = value["data"]["turn"].as_i64().unwrap_or(0);
                let step = value["data"]["step"].as_i64().unwrap_or(0);
                let duration_ms = steps
                    .get(&(turn, step))
                    .map(|start| (at - start).clamp(1, 3_600_000))
                    .filter(|duration| *duration > 0);
                if usage.records.len() >= 50_000 {
                    usage.truncated = true;
                    break;
                }
                usage.records.push(UsageRecord {
                    at,
                    provider,
                    model,
                    input,
                    output,
                    cache_read,
                    reasoning,
                    duration_ms,
                });
                usage.steps += 1;
                usage.last_at = Some(usage.last_at.unwrap_or(at).max(at));
            }
            _ => {}
        }
    }
    Ok(usage)
}

fn aggregate(cache: &UsageCache, scans: &[RootScan]) -> Value {
    let mut totals = Totals::default();
    let mut models: BTreeMap<(String, String), ModelTotals> = BTreeMap::new();
    let mut providers: BTreeMap<String, Totals> = BTreeMap::new();
    let mut daily: BTreeMap<NaiveDate, Totals> = BTreeMap::new();
    let mut first_at = i64::MAX;
    let mut last_at = 0;
    let mut turns = 0;
    let mut steps = 0;
    let mut sessions = 0;
    let mut speed_output = 0;
    let mut speed_duration = 0;
    for scan in scans {
        for file in &scan.files {
            let Some(parsed) = cache.files.get(&files::text(file)) else {
                continue;
            };
            turns += parsed.turns;
            steps += parsed.steps;
            if !parsed.records.is_empty() {
                sessions += 1;
            }
            for record in &parsed.records {
                totals.add(record);
                let key = (record.provider.clone(), record.model.clone());
                let entry = models.entry(key).or_default();
                entry.totals.add(record);
                entry.last_at = entry.last_at.max(record.at);
                providers
                    .entry(record.provider.clone())
                    .or_default()
                    .add(record);
                let day = date_of(record.at);
                daily.entry(day).or_default().add(record);
                first_at = first_at.min(record.at);
                last_at = last_at.max(record.at);
                if let Some(duration) = record.duration_ms {
                    if duration > 0 {
                        speed_output += record.output;
                        speed_duration += duration;
                    }
                }
            }
        }
    }
    let today = Local::now().date_naive();
    let active_days: BTreeSet<NaiveDate> = daily.keys().copied().collect();
    let (current_streak, longest_streak) = streaks(&active_days, today);
    let mut model_values = Vec::new();
    for ((provider, model), entry) in models {
        let mut value = entry.totals.value();
        value["provider"] = json!(provider);
        value["model"] = json!(model);
        value["lastAt"] = json!(iso(entry.last_at));
        model_values.push(value);
    }
    model_values.sort_by(|a, b| b["tokens"].as_i64().cmp(&a["tokens"].as_i64()));
    let mut provider_values = Vec::new();
    for (provider, entry) in providers {
        let mut value = entry.value();
        value["provider"] = json!(provider);
        provider_values.push(value);
    }
    provider_values.sort_by(|a, b| b["tokens"].as_i64().cmp(&a["tokens"].as_i64()));
    let mut days = Vec::new();
    let start = today - Duration::days(364);
    for offset in 0..365 {
        let day = start + Duration::days(offset);
        let entry = daily.get(&day);
        days.push(json!({
            "date": day.format("%Y-%m-%d").to_string(),
            "tokens": entry.map(|entry| entry.tokens).unwrap_or(0),
            "input": entry.map(|entry| entry.input).unwrap_or(0),
            "output": entry.map(|entry| entry.output).unwrap_or(0),
            "cacheRead": entry.map(|entry| entry.cache_read).unwrap_or(0),
            "messages": entry.map(|entry| entry.messages).unwrap_or(0),
            "heat": entry.map(|entry| entry.output + entry.input / 5 + entry.cache_read / 20).unwrap_or(0),
        }));
    }
    let recent: Vec<Value> = (0..30)
        .map(|offset| {
            let day = today - Duration::days(29 - offset);
            let entry = daily.get(&day);
            json!({
                "date": day.format("%Y-%m-%d").to_string(),
                "tokens": entry.map(|entry| entry.tokens).unwrap_or(0),
                "output": entry.map(|entry| entry.output).unwrap_or(0),
                "heat": entry.map(|entry| entry.output + entry.input / 5 + entry.cache_read / 20).unwrap_or(0),
            })
        })
        .collect();
    let mut root_values = Vec::new();
    for scan in scans {
        root_values.push(json!({
            "label": scan.label,
            "path": files::text(&scan.path),
            "files": scan.files.len(),
            "records": scan.records,
            "errors": scan.errors,
            "lastError": scan.last_error,
        }));
    }
    json!({
        "generatedAt": now(),
        "totals": totals.value(),
        "today": daily.get(&today).map(Totals::value).unwrap_or_else(|| Totals::default().value()),
        "week": window(&daily, today, 7),
        "month": window(&daily, today, 30),
        "heatmap": days,
        "recent": recent,
        "models": model_values,
        "providers": provider_values,
        "roots": root_values,
        "sessions": sessions,
        "turns": turns,
        "steps": steps,
        "activeDays": active_days.len(),
        "currentStreak": current_streak,
        "longestStreak": longest_streak,
        "avgSpeed": speed(speed_output, speed_duration),
        "firstAt": if first_at == i64::MAX { Value::Null } else { json!(iso(first_at)) },
        "lastAt": if last_at == 0 { Value::Null } else { json!(iso(last_at)) },
        "cachedFiles": cache.files.len(),
    })
}

fn window(daily: &BTreeMap<NaiveDate, Totals>, today: NaiveDate, days: i64) -> Value {
    let mut totals = Totals::default();
    for offset in 0..days {
        if let Some(entry) = daily.get(&(today - Duration::days(offset))) {
            totals.input += entry.input;
            totals.output += entry.output;
            totals.cache_read += entry.cache_read;
            totals.reasoning += entry.reasoning;
            totals.tokens += entry.tokens;
            totals.messages += entry.messages;
            totals.duration_ms += entry.duration_ms;
        }
    }
    totals.value()
}

fn speed(output: i64, duration_ms: i64) -> Value {
    if output <= 0 || duration_ms <= 0 {
        return Value::Null;
    }
    json!((output as f64 / (duration_ms as f64 / 1000.0) * 10.0).round() / 10.0)
}

fn date_of(ms: i64) -> NaiveDate {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|time| time.date_naive())
        .unwrap_or_else(|| Local::now().date_naive())
}

fn iso(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn streaks(days: &BTreeSet<NaiveDate>, today: NaiveDate) -> (i64, i64) {
    let mut longest = 0;
    let mut run = 0;
    let mut previous: Option<NaiveDate> = None;
    for day in days {
        run = if previous.is_some_and(|previous| *day == previous + Duration::days(1)) {
            run + 1
        } else {
            1
        };
        longest = longest.max(run);
        previous = Some(*day);
    }
    let mut cursor = if days.contains(&today) {
        today
    } else {
        today - Duration::days(1)
    };
    let mut current = 0;
    while days.contains(&cursor) {
        current += 1;
        cursor -= Duration::days(1);
    }
    (current, longest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;
    use std::io::Write;

    fn temp_engine() -> (Engine, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        let engine = Engine::at(dir.path()).expect("engine");
        (engine, dir)
    }

    fn write_session(path: &Path, lines: &[Value]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        // DSH 会话日志是多个 zstd frame 顺序拼接的；测试也按这种方式写入。
        let split = lines.len().max(1) / 2;
        let mut compressed = Vec::new();
        for chunk in [&lines[..split], &lines[split..]] {
            if chunk.is_empty() {
                continue;
            }
            let mut text = String::new();
            for line in chunk {
                text.push_str(&serde_json::to_string(line).expect("json"));
                text.push('\n');
            }
            compressed.extend(zstd::stream::encode_all(text.as_bytes(), 3).expect("zstd"));
        }
        let mut file = fs::File::create(path).expect("file");
        file.write_all(&compressed).expect("write");
    }

    #[test]
    fn parses_real_session_shape_and_computes_speed() {
        let lines = vec![
            json!({"type":"session","id":"session-test","createdAt":1_700_000_000_000i64}),
            json!({"type":"turn/start","time":1_700_000_001_000i64,"data":{"turn":1}}),
            json!({"type":"step/start","time":1_700_000_002_000i64,"data":{"turn":1,"step":1}}),
            json!({"type":"assistant/message","time":1_700_000_006_000i64,"data":{
                "turn":1,"step":1,
                "usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":200,"reasoningTokens":50,"totalTokens":1700},
                "message":{"source":{"provider":"deepseek","model":"deepseek-chat"}}
            }}),
        ];
        let dir = tempfile::tempdir().expect("dir");
        let file = dir.path().join("workspace/session-test/session.v4.jsonl.zstd");
        write_session(&file, &lines);
        let parsed = parse_session(&file).expect("parse");
        assert_eq!(parsed.records.len(), 1);
        assert_eq!(parsed.records[0].input, 1000);
        assert_eq!(parsed.records[0].output, 500);
        assert_eq!(parsed.records[0].duration_ms, Some(4000));
        assert_eq!(parsed.session_id, "session-test");
        assert_eq!(parsed.turns, 1);
    }

    #[test]
    fn aggregate_builds_heatmap_and_streaks() {
        let mut cache = UsageCache {
            version: CACHE_VERSION,
            ..UsageCache::default()
        };
        let file = PathBuf::from("session.v4.jsonl.zstd");
        let today = Local::now().date_naive();
        let at = Local
            .from_local_datetime(&today.and_hms_opt(12, 0, 0).unwrap())
            .single()
            .unwrap()
            .timestamp_millis();
        cache.files.insert(
            files::text(&file),
            FileUsage {
                records: vec![UsageRecord {
                    at,
                    provider: "deepseek".into(),
                    model: "deepseek-chat".into(),
                    input: 100,
                    output: 50,
                    cache_read: 20,
                    reasoning: 5,
                    duration_ms: Some(2000),
                }],
                steps: 1,
                ..FileUsage::default()
            },
        );
        let scans = vec![RootScan {
            label: "test".into(),
            path: PathBuf::from("."),
            files: vec![file],
            records: 1,
            errors: 0,
            last_error: None,
        }];
        let value = aggregate(&cache, &scans);
        assert_eq!(value["totals"]["tokens"], 170);
        assert_eq!(value["models"][0]["model"], "deepseek-chat");
        assert_eq!(value["avgSpeed"], 25.0);
        assert_eq!(value["heatmap"].as_array().unwrap().len(), 365);
        assert_eq!(value["activeDays"], 1);
    }

    #[test]
    fn temp_engine_does_not_scan_the_daily_dsh_home() {
        let (engine, _dir) = temp_engine();
        let value = engine.usage_profile(false).expect("usage");
        assert_eq!(value["totals"]["tokens"], 0);
        assert_eq!(value["roots"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn streaks_count_today_or_yesterday() {
        let today = Local::now().date_naive();
        let mut days = BTreeSet::new();
        days.insert(today);
        days.insert(today - Duration::days(1));
        days.insert(today - Duration::days(2));
        assert_eq!(streaks(&days, today), (3, 3));
        days.remove(&today);
        assert_eq!(streaks(&days, today), (2, 2));
    }
}
