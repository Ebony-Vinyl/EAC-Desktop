use crate::{
    engine::{required, Engine},
    files,
    model::{now, Result},
};
use chrono::{Duration, Local};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    time::{Duration as StdDuration, Instant},
};
use url::form_urlencoded;

const GITHUB_API: &str = "https://api.github.com";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const OAUTH_SCOPE: &str = "read:user public_repo";
const MAX_RESPONSE: usize = 4 * 1024 * 1024;
const API_TIMEOUT: StdDuration = StdDuration::from_secs(45);

// 发布计划：当前版本关闭 GitHub 登录入口，界面显示「开发中」。
// 恢复开放时改回 true 即可；前端 api.ts 的 GITHUB_LOGIN_ENABLED 保持一致。
pub(crate) const LOGIN_ENABLED: bool = false;

pub(crate) fn ensure_login_enabled() -> Result<()> {
    if LOGIN_ENABLED {
        Ok(())
    } else {
        Err("GitHub 登录功能正在开发中，当前版本未开放。".into())
    }
}

#[derive(Default)]
pub(crate) struct Session {
    pending: Option<DeviceFlow>,
    stars: Option<(Instant, Vec<String>)>,
    liked: Option<(String, Vec<String>)>,
}

#[derive(Clone)]
struct DeviceFlow {
    device_code: String,
    expires: Instant,
    interval: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubProfile {
    pub id: u64,
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub blog: Option<String>,
    #[serde(default)]
    pub twitter_username: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub public_repos: u64,
    #[serde(default)]
    pub public_gists: u64,
    #[serde(default)]
    pub followers: u64,
    #[serde(default)]
    pub following: u64,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    token: String,
    profile: GithubProfile,
    #[serde(default)]
    scopes: Vec<String>,
    // 细粒度令牌不报告作用域；登录后探测一次 GET /user/starred 得知
    // Starring 权限是否可用，None 表示未知（网络失败或经典令牌未探测）。
    #[serde(default)]
    star_ok: Option<bool>,
    saved_at: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocialFile {
    #[serde(default)]
    likes: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    stars: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    downloads: Vec<DownloadEvent>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEvent {
    id: String,
    day: String,
    at: String,
}

struct ApiResponse {
    status: StatusCode,
    body: Value,
    scopes: Vec<String>,
}

// 发布构建时设置 EAC_GITHUB_CLIENT_ID，会通过 option_env! 编译进程序；
// 运行时环境变量优先于内置值，登录窗口里用户手填的设置优先于内置值。
pub(crate) fn bundled_client_id() -> Option<String> {
    option_env!("EAC_GITHUB_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub(crate) fn client_id_preconfigured() -> bool {
    std::env::var("EAC_GITHUB_CLIENT_ID")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        || bundled_client_id().is_some()
}

impl Engine {
    fn credentials_path(&self) -> Result<PathBuf> {
        self.path("github.json")
    }

    fn social_path(&self) -> Result<PathBuf> {
        self.path("social.json")
    }

    fn read_credentials(&self) -> Option<Credentials> {
        let path = self.credentials_path().ok()?;
        if !path.is_file() {
            return None;
        }
        files::read_json::<Credentials>(&path).ok()
    }

    pub(crate) fn github_authenticated(&self) -> bool {
        self.read_credentials().is_some()
    }

    fn write_credentials(&self, credentials: &Credentials) -> Result<()> {
        let path = self.credentials_path()?;
        files::atomic_json(&path, credentials)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Protect GitHub credentials: {e}"))?;
        }
        Ok(())
    }

    fn clear_credentials(&self) -> Result<()> {
        let path = self.credentials_path()?;
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Remove GitHub credentials: {e}"))?;
        }
        let mut session = self
            .session
            .lock()
            .map_err(|_| "GitHub session lock is poisoned")?;
        session.pending = None;
        session.stars = None;
        session.liked = None;
        Ok(())
    }

    fn social_file(&self) -> Result<SocialFile> {
        let path = self.social_path()?;
        if !path.is_file() {
            return Ok(SocialFile::default());
        }
        files::read_json(&path)
    }

    fn write_social(&self, social: &SocialFile) -> Result<()> {
        files::atomic_json(&self.social_path()?, social)
    }

    pub(crate) fn social_summary(&self, client_configured: bool) -> Value {
        let credentials = self.read_credentials();
        let liked = credentials
            .as_ref()
            .map(|credentials| {
                let login = credentials.profile.login.clone();
                if let Ok(session) = self.session.lock() {
                    if let Some((cached_login, items)) = &session.liked {
                        if cached_login == &login {
                            return items.clone();
                        }
                    }
                }
                let items = self
                    .social_file()
                    .ok()
                    .and_then(|social| {
                        social
                            .likes
                            .get(&login)
                            .map(|items| items.keys().cloned().collect::<Vec<_>>())
                    })
                    .unwrap_or_default();
                if let Ok(mut session) = self.session.lock() {
                    session.liked = Some((login, items.clone()));
                }
                items
            })
            .unwrap_or_default();
        json!({
            "authenticated": credentials.is_some(),
            "profile": credentials.as_ref().map(|credentials| &credentials.profile),
            "likedPlugins": liked,
            "starOk": credentials.as_ref().and_then(|credentials| credentials.star_ok),
            "clientConfigured": client_configured,
        })
    }

    pub(crate) fn github_client_id(&self) -> Result<String> {
        if let Ok(value) = std::env::var("EAC_GITHUB_CLIENT_ID") {
            let value = value.trim();
            if !value.is_empty() {
                return validate_client_id(value);
            }
        }
        let settings_value = self.state(|state| Ok(state.settings.github_client_id.clone()))?;
        let settings_value = settings_value.trim();
        if !settings_value.is_empty() {
            return validate_client_id(settings_value);
        }
        if let Some(value) = bundled_client_id() {
            return validate_client_id(&value);
        }
        Err("尚未配置 GitHub OAuth Client ID。请在 GitHub 创建 OAuth App 并启用 Device Flow，然后在登录窗口填入 Client ID，或设置 EAC_GITHUB_CLIENT_ID 环境变量。".into())
    }

    fn client_configured(&self) -> bool {
        client_id_preconfigured()
            || self
                .state(|state| Ok(!state.settings.github_client_id.trim().is_empty()))
                .unwrap_or(false)
    }

    fn probe_starring(&self, token: &str) -> Option<bool> {
        let response = self
            .github_api(
                Method::GET,
                &format!("{GITHUB_API}/user/starred?per_page=1&page=1"),
                Some(token),
                None,
            )
            .ok()?;
        match response.status {
            StatusCode::OK => Some(true),
            // 401 说明令牌本身失效，交给调用方按登录失效处理，不误报为缺权限。
            StatusCode::UNAUTHORIZED => None,
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => Some(false),
            _ => None,
        }
    }

    fn github_api(
        &self,
        method: Method,
        url: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Result<ApiResponse> {
        let mut headers = vec![
            ("Accept".to_string(), "application/vnd.github+json".to_string()),
            (
                "X-GitHub-Api-Version".to_string(),
                "2022-11-28".to_string(),
            ),
        ];
        if let Some(token) = token {
            headers.push(("Authorization".to_string(), format!("Bearer {token}")));
        }
        let body = body
            .map(|value| serde_json::to_vec(&value).map_err(|e| e.to_string()))
            .transpose()?;
        if body.is_some() {
            headers.push(("Content-Type".to_string(), "application/json".to_string()));
        }
        let response = self
            .secure_request(method, url, &headers, body, API_TIMEOUT)
            .map_err(|error| with_proxy_hint(error));
        let response = response?;
        let status = response.status();
        let scopes = response
            .headers()
            .get("x-oauth-scopes")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect();
        let bytes = self.read_body(response, MAX_RESPONSE)?;
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        Ok(ApiResponse {
            status,
            body,
            scopes,
        })
    }

    fn github_form(&self, url: &str, fields: &[(&str, &str)]) -> Result<Value> {
        let body = form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish()
            .into_bytes();
        let headers = vec![
            ("Accept".to_string(), "application/json".to_string()),
            (
                "Content-Type".to_string(),
                "application/x-www-form-urlencoded".to_string(),
            ),
        ];
        let response = self
            .secure_request(Method::POST, url, &headers, Some(body), API_TIMEOUT)
            .map_err(with_proxy_hint)?;
        let status = response.status();
        let bytes = self.read_body(response, MAX_RESPONSE)?;
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if !status.is_success() {
            let raw = std::str::from_utf8(&bytes).unwrap_or("").trim();
            let message = value["error_description"]
                .as_str()
                .or_else(|| value["error"].as_str())
                .or_else(|| value["message"].as_str())
                .filter(|message| !message.is_empty())
                .unwrap_or_else(|| if raw.is_empty() { "GitHub 授权端点返回错误" } else { raw });
            let hint = match status.as_u16() {
                404 => "。请确认 Client ID 正确，并在 GitHub OAuth App 中启用 Enable Device Flow",
                401 => "。请检查 Client ID 是否属于有效的 OAuth App",
                _ => "",
            };
            return Err(format!(
                "GitHub 授权失败（HTTP {}）：{message}{hint}",
                status.as_u16()
            ));
        }
        Ok(value)
    }

    pub(crate) fn github_status(&self) -> Result<Value> {
        let credentials = self.read_credentials();
        let liked = credentials
            .as_ref()
            .map(|credentials| {
                self.social_file()
                    .ok()
                    .and_then(|social| social.likes.get(&credentials.profile.login).cloned())
                    .map(|items| items.into_keys().collect::<Vec<_>>())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        Ok(json!({
            "authenticated": credentials.is_some(),
            "profile": credentials.as_ref().map(|credentials| &credentials.profile),
            "scopes": credentials.as_ref().map(|credentials| &credentials.scopes),
            "starOk": credentials.as_ref().and_then(|credentials| credentials.star_ok),
            "clientConfigured": self.client_configured(),
            "likedPlugins": liked,
        }))
    }

    pub(crate) fn github_refresh(&self) -> Result<Value> {
        ensure_login_enabled()?;
        let Some(credentials) = self.read_credentials() else {
            return self.github_status();
        };
        let response = self.github_api(
            Method::GET,
            &format!("{GITHUB_API}/user"),
            Some(&credentials.token),
            None,
        )?;
        if response.status == StatusCode::UNAUTHORIZED {
            self.clear_credentials()?;
            return self.github_status();
        }
        ensure_ok(&response)?;
        let profile = profile_from(&response.body)?;
        let star_ok = self.probe_starring(&credentials.token);
        self.write_credentials(&Credentials {
            token: credentials.token,
            profile,
            scopes: response.scopes,
            star_ok,
            saved_at: now(),
        })?;
        if let Ok(mut session) = self.session.lock() {
            session.stars = None;
        }
        self.github_status()
    }

    pub(crate) fn github_logout(&self) -> Result<Value> {
        self.clear_credentials()?;
        self.github_status()
    }

    pub(crate) fn github_login_start(&self) -> Result<Value> {
        ensure_login_enabled()?;
        let client_id = self.github_client_id()?;
        let value = self.github_form(
            DEVICE_CODE_URL,
            &[("client_id", client_id.as_str()), ("scope", OAUTH_SCOPE)],
        )?;
        if let Some(error) = value["error"].as_str() {
            let message = value["error_description"]
                .as_str()
                .filter(|message| !message.is_empty())
                .unwrap_or(error);
            return Err(format!("GitHub 授权失败：{message}"));
        }
        let device_code = required(&value, "device_code")?.to_owned();
        let user_code = required(&value, "user_code")?.to_owned();
        let verification_uri = required(&value, "verification_uri")?.to_owned();
        if !verification_uri.starts_with("https://github.com/") {
            return Err("GitHub 返回了意外的设备授权地址。".into());
        }
        let expires_in = value["expires_in"].as_u64().unwrap_or(900).clamp(60, 3600);
        let interval = value["interval"].as_u64().unwrap_or(5).clamp(2, 30);
        let mut session = self
            .session
            .lock()
            .map_err(|_| "GitHub session lock is poisoned")?;
        session.pending = Some(DeviceFlow {
            device_code,
            expires: Instant::now() + StdDuration::from_secs(expires_in),
            interval,
        });
        Ok(json!({
            "userCode": user_code,
            "verificationUri": verification_uri,
            "expiresIn": expires_in,
            "interval": interval,
        }))
    }

    pub(crate) fn github_login_poll(&self) -> Result<Value> {
        ensure_login_enabled()?;
        let pending = {
            let session = self
                .session
                .lock()
                .map_err(|_| "GitHub session lock is poisoned")?;
            session.pending.clone()
        };
        let Some(pending) = pending else {
            return Err("没有进行中的 GitHub 授权，请重新发起登录。".into());
        };
        if Instant::now() >= pending.expires {
            if let Ok(mut session) = self.session.lock() {
                session.pending = None;
            }
            return Ok(json!({"status":"expired"}));
        }
        let client_id = self.github_client_id()?;
        let value = self.github_form(
            ACCESS_TOKEN_URL,
            &[
                ("client_id", client_id.as_str()),
                ("device_code", pending.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )?;
        if let Some(token) = value["access_token"].as_str() {
            let token = validate_token(token)?;
            let response = self.github_api(
                Method::GET,
                &format!("{GITHUB_API}/user"),
                Some(&token),
                None,
            )?;
            ensure_ok(&response)?;
            let profile = profile_from(&response.body)?;
            let star_ok = self.probe_starring(&token);
            self.write_credentials(&Credentials {
                token,
                profile: profile.clone(),
                scopes: response.scopes.clone(),
                star_ok,
                saved_at: now(),
            })?;
            if let Ok(mut session) = self.session.lock() {
                session.pending = None;
                session.stars = None;
                session.liked = None;
            }
            let newly = self
                .achievement_event("github_login", None)
                .unwrap_or_default();
            return Ok(json!({
                "status":"authorized",
                "profile":profile,
                "scopes":response.scopes,
                "newlyUnlocked":newly,
            }));
        }
        let error = value["error"].as_str().unwrap_or("");
        match error {
            "authorization_pending" => Ok(json!({"status":"pending","interval":pending.interval})),
            "slow_down" => {
                let interval = (pending.interval + 5).min(60);
                if let Ok(mut session) = self.session.lock() {
                    if let Some(flow) = session.pending.as_mut() {
                        flow.interval = interval;
                    }
                }
                Ok(json!({"status":"pending","interval":interval}))
            }
            "expired_token" => {
                if let Ok(mut session) = self.session.lock() {
                    session.pending = None;
                }
                Ok(json!({"status":"expired"}))
            }
            "access_denied" => {
                if let Ok(mut session) = self.session.lock() {
                    session.pending = None;
                }
                Ok(json!({"status":"denied"}))
            }
            other => Err(format!(
                "GitHub 授权失败：{}",
                value["error_description"]
                    .as_str()
                    .filter(|message| !message.is_empty())
                    .unwrap_or(other)
            )),
        }
    }

    pub(crate) fn github_login_token(&self, payload: &Value) -> Result<Value> {
        ensure_login_enabled()?;
        let token = validate_token(required(payload, "token")?)?;
        let response = self.github_api(
            Method::GET,
            &format!("{GITHUB_API}/user"),
            Some(&token),
            None,
        )?;
        if response.status == StatusCode::UNAUTHORIZED {
            return Err("GitHub 拒绝了该访问令牌。请确认令牌未过期，并包含 read:user 与 public_repo 权限。".into());
        }
        ensure_ok(&response)?;
        let profile = profile_from(&response.body)?;
        let star_ok = self.probe_starring(&token);
        self.write_credentials(&Credentials {
            token,
            profile: profile.clone(),
            scopes: response.scopes.clone(),
            star_ok,
            saved_at: now(),
        })?;
        if let Ok(mut session) = self.session.lock() {
            session.stars = None;
            session.liked = None;
        }
        let newly = self
            .achievement_event("github_login", None)
            .unwrap_or_default();
        Ok(json!({
            "status":"authorized",
            "profile":profile,
            "scopes":response.scopes,
            "newlyUnlocked":newly,
        }))
    }

    pub(crate) fn github_starred(&self) -> Result<Value> {
        ensure_login_enabled()?;
        let Some(credentials) = self.read_credentials() else {
            return Ok(json!({"repos":[]}));
        };
        {
            let session = self
                .session
                .lock()
                .map_err(|_| "GitHub session lock is poisoned")?;
            if let Some((at, repos)) = &session.stars {
                if at.elapsed() < StdDuration::from_secs(120) {
                    return Ok(json!({"repos":repos}));
                }
            }
        }
        let mut repos = Vec::new();
        for page in 1..=3 {
            let response = self.github_api(
                Method::GET,
                &format!(
                    "{GITHUB_API}/user/starred?per_page=100&page={page}&sort=created&direction=desc"
                ),
                Some(&credentials.token),
                None,
            )?;
            if response.status == StatusCode::UNAUTHORIZED {
                self.clear_credentials()?;
                return Err("GitHub 授权已失效，请重新登录。".into());
            }
            ensure_ok(&response)?;
            let items = response
                .body
                .as_array()
                .ok_or("GitHub 未返回 Star 列表")?;
            for item in items {
                if let Some(name) = item["full_name"].as_str() {
                    repos.push(name.to_string());
                }
            }
            if items.len() < 100 {
                break;
            }
        }
        if let Ok(mut session) = self.session.lock() {
            session.stars = Some((Instant::now(), repos.clone()));
        }
        Ok(json!({"repos":repos}))
    }

    pub(crate) fn github_star(&self, payload: &Value) -> Result<Value> {
        ensure_login_enabled()?;
        let credentials = self
            .read_credentials()
            .ok_or("请先登录 GitHub，才能在启动器里 Star 项目。")?;
        let repo = validate_repo(required(payload, "repo")?)?;
        let starred = payload
            .get("starred")
            .and_then(Value::as_bool)
            .ok_or("starred must be boolean")?;
        let method = if starred { Method::PUT } else { Method::DELETE };
        let response = self.github_api(
            method,
            &format!("{GITHUB_API}/user/starred/{repo}"),
            Some(&credentials.token),
            None,
        )?;
        if response.status == StatusCode::UNAUTHORIZED {
            self.clear_credentials()?;
            return Err("GitHub 授权已失效，请重新登录。".into());
        }
        ensure_ok(&response)?;
        let mut social = self.social_file()?;
        if starred {
            social
                .stars
                .entry(credentials.profile.login.clone())
                .or_default()
                .insert(repo.clone(), now());
        } else if let Some(items) = social.stars.get_mut(&credentials.profile.login) {
            items.remove(&repo);
        }
        self.write_social(&social)?;
        if let Ok(mut session) = self.session.lock() {
            session.stars = None;
        }
        let newly = if starred {
            self.achievement_event("github_star", Some(&repo))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(json!({"starred":starred,"repo":repo,"newlyUnlocked":newly}))
    }

    pub(crate) fn market_like(&self, payload: &Value) -> Result<Value> {
        ensure_login_enabled()?;
        let credentials = self
            .read_credentials()
            .ok_or("登录 GitHub 后才能给插件点赞。")?;
        let plugin_id = validate_plugin_id(required(payload, "pluginId")?)?;
        let liked = payload
            .get("liked")
            .and_then(Value::as_bool)
            .ok_or("liked must be boolean")?;
        let mut social = self.social_file()?;
        let entry = social
            .likes
            .entry(credentials.profile.login.clone())
            .or_default();
        if liked {
            entry.insert(plugin_id.clone(), now());
        } else {
            entry.remove(&plugin_id);
        }
        let likes = social
            .likes
            .values()
            .filter(|items| items.contains_key(&plugin_id))
            .count() as i64;
        self.write_social(&social)?;
        let items = social
            .likes
            .get(&credentials.profile.login)
            .map(|items| items.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        if let Ok(mut session) = self.session.lock() {
            session.liked = Some((credentials.profile.login.clone(), items));
        }
        let newly = if liked {
            self.achievement_event("plugin_liked", Some(&plugin_id))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(json!({
            "liked":liked,
            "pluginId":plugin_id,
            "likes":likes,
            "newlyUnlocked":newly,
        }))
    }

    pub(crate) fn market_download(&self, payload: &Value) -> Result<Value> {
        let plugin_id = validate_plugin_id(required(payload, "pluginId")?)?;
        let mut social = self.social_file()?;
        let today = Local::now().date_naive();
        let day = today.format("%Y-%m-%d").to_string();
        social.downloads.push(DownloadEvent {
            id: plugin_id.clone(),
            day: day.clone(),
            at: now(),
        });
        let cutoff = (today - Duration::days(180))
            .format("%Y-%m-%d")
            .to_string();
        social.downloads.retain(|event| event.day >= cutoff);
        if social.downloads.len() > 20_000 {
            let excess = social.downloads.len() - 20_000;
            social.downloads.drain(0..excess);
        }
        let counts = period_counts(&social, &plugin_id, today);
        self.write_social(&social)?;
        let newly = self
            .achievement_event("market_download", None)
            .unwrap_or_default();
        Ok(json!({
            "pluginId":plugin_id,
            "downloads":counts,
            "newlyUnlocked":newly,
        }))
    }

    pub(crate) fn market_stats(&self) -> Result<Value> {
        let social = self.social_file()?;
        let today = Local::now().date_naive();
        let mut downloads = serde_json::Map::new();
        for (key, days) in [("day", 0), ("week", 6), ("month", 29)] {
            let start = (today - Duration::days(days))
                .format("%Y-%m-%d")
                .to_string();
            let mut counts: BTreeMap<String, i64> = BTreeMap::new();
            for event in social.downloads.iter().filter(|event| event.day >= start) {
                *counts.entry(event.id.clone()).or_insert(0) += 1;
            }
            let mut list: Vec<Value> = counts
                .into_iter()
                .map(|(id, count)| json!({"id":id,"downloads":count}))
                .collect();
            list.sort_by(|a, b| b["downloads"].as_i64().cmp(&a["downloads"].as_i64()));
            downloads.insert(key.to_string(), json!(list));
        }
        let mut likes: BTreeMap<String, i64> = BTreeMap::new();
        for items in social.likes.values() {
            for id in items.keys() {
                *likes.entry(id.clone()).or_insert(0) += 1;
            }
        }
        let mut likes: Vec<Value> = likes
            .into_iter()
            .map(|(id, count)| json!({"id":id,"likes":count}))
            .collect();
        likes.sort_by(|a, b| b["likes"].as_i64().cmp(&a["likes"].as_i64()));
        Ok(json!({
            "source":"local",
            "downloads":downloads,
            "likes":likes,
            "totalDownloads":social.downloads.len(),
        }))
    }
}

fn period_counts(social: &SocialFile, plugin_id: &str, today: chrono::NaiveDate) -> Value {
    let mut result = serde_json::Map::new();
    for (key, days) in [("day", 0), ("week", 6), ("month", 29)] {
        let start = (today - Duration::days(days))
            .format("%Y-%m-%d")
            .to_string();
        let count = social
            .downloads
            .iter()
            .filter(|event| event.id == plugin_id && event.day >= start)
            .count();
        result.insert(key.to_string(), json!(count));
    }
    json!(result)
}

fn ensure_ok(response: &ApiResponse) -> Result<()> {
    if response.status.is_success() {
        return Ok(());
    }
    let message = response.body["message"]
        .as_str()
        .or_else(|| response.body["error_description"].as_str())
        .unwrap_or("");
    Err(github_error(response.status, message))
}

// github.com / api.github.com 在部分网络下无法直连；传输层失败时给出
// 显式代理提示，而不是让用户面对一条裸的网络错误。
fn with_proxy_hint(error: String) -> String {
    if error.starts_with("HTTPS request failed") || error.starts_with("Resolve download hostname") {
        format!(
            "{text}；若 GitHub 无法直连，可设置环境变量 EAC_HTTPS_PROXY=http://127.0.0.1:7890 走本地代理后重试",
            text = error
        )
    } else {
        error
    }
}

fn github_error(status: StatusCode, message: &str) -> String {
    match status.as_u16() {
        401 => "GitHub 授权已失效，请重新登录。".into(),
        403 if message.to_ascii_lowercase().contains("rate limit") => {
            "GitHub API 速率限制，请稍后再试。".into()
        }
        404 => format!("GitHub 上找不到该项目（{message}）。"),
        422 => format!("GitHub 拒绝了这次请求：{message}"),
        _ => format!(
            "GitHub 请求失败（HTTP {}）：{}",
            status.as_u16(),
            if message.is_empty() {
                "未提供错误信息"
            } else {
                message
            }
        ),
    }
}

fn profile_from(value: &Value) -> Result<GithubProfile> {
    let id = value["id"]
        .as_u64()
        .ok_or("GitHub 用户信息缺少 id")?;
    let login = required(value, "login")?.to_owned();
    let avatar_url = value["avatar_url"]
        .as_str()
        .filter(|url| url.starts_with("https://"))
        .ok_or("GitHub 返回了无效的头像地址")?
        .to_owned();
    let html_url = value["html_url"]
        .as_str()
        .filter(|url| url.starts_with("https://"))
        .map(str::to_owned)
        .unwrap_or_else(|| format!("https://github.com/{login}"));
    let text = |key: &str| value[key].as_str().filter(|text| !text.is_empty()).map(str::to_owned);
    Ok(GithubProfile {
        id,
        login,
        name: text("name"),
        avatar_url,
        html_url,
        bio: text("bio"),
        company: text("company"),
        location: text("location"),
        blog: text("blog"),
        twitter_username: text("twitter_username"),
        email: text("email"),
        public_repos: value["public_repos"].as_u64().unwrap_or(0),
        public_gists: value["public_gists"].as_u64().unwrap_or(0),
        followers: value["followers"].as_u64().unwrap_or(0),
        following: value["following"].as_u64().unwrap_or(0),
        created_at: value["created_at"].as_str().unwrap_or("").to_string(),
    })
}

fn validate_client_id(value: &str) -> Result<String> {
    let value = value.trim();
    if value.len() < 6
        || value.len() > 100
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("GitHub Client ID 格式无效。".into());
    }
    Ok(value.to_string())
}

fn validate_token(value: &str) -> Result<String> {
    let value = value.trim();
    if value.len() < 20
        || value.len() > 255
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("GitHub 访问令牌格式无效。请粘贴完整的经典或细粒度令牌。".into());
    }
    Ok(value.to_string())
}

pub(crate) fn validate_repo(value: &str) -> Result<String> {
    let value = value.trim();
    let (owner, repo) = value
        .split_once('/')
        .ok_or("仓库必须使用 owner/repo 格式")?;
    let owner_ok = !owner.is_empty()
        && owner.len() <= 39
        && !owner.starts_with(['-', '.'])
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    let repo_ok = !repo.is_empty()
        && repo.len() <= 100
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if !owner_ok || !repo_ok {
        return Err("仓库名包含不允许的字符。".into());
    }
    Ok(format!("{owner}/{repo}"))
}

fn validate_plugin_id(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 300
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'/' | b'-')
        })
    {
        return Err("插件标识无效。".into());
    }
    Ok(value.to_string())
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
    fn repository_names_are_strictly_validated() {
        assert_eq!(validate_repo("owner/repo").unwrap(), "owner/repo");
        assert_eq!(validate_repo("owner/repo.name").unwrap(), "owner/repo.name");
        for value in [
            "owner",
            "owner/",
            "/repo",
            "../repo",
            "owner/../repo",
            "own er/repo",
            "owner/re po",
            "owner/repo?tab=readme",
        ] {
            assert!(validate_repo(value).is_err(), "{value}");
        }
    }

    #[test]
    fn token_and_client_id_shapes_are_checked() {
        assert!(validate_token("ghp_1234567890abcdefghijklmnop").is_ok());
        assert!(validate_token("short").is_err());
        assert!(validate_token("ghp_1234 567890abcdefghijklmnop").is_err());
        assert!(validate_client_id("Iv1.abc123def456").is_ok());
        assert!(validate_client_id("bad id").is_err());
    }

    #[test]
    fn login_actions_are_disabled_until_release() {
        let (engine, _dir) = temp_engine();
        for action in [
            "github_login_start",
            "github_login_poll",
            "github_starred",
            "github_star",
            "market_like",
        ] {
            let error = engine.call(action, serde_json::json!({})).expect_err("disabled");
            assert!(error.contains("开发中"), "{action}: {error}");
        }
    }

    #[test]
    fn market_like_requires_a_login() {
        let (engine, _dir) = temp_engine();
        let error = engine
            .market_like(&json!({"pluginId":"dev.eac.test","liked":true}))
            .expect_err("must be disabled or require login");
        assert!(error.contains("开发中") || error.contains("登录"));
    }

    #[test]
    fn local_downloads_feed_day_week_month_rankings() {
        let (engine, _dir) = temp_engine();
        engine
            .market_download(&json!({"pluginId":"dev.eac.alpha"}))
            .expect("download");
        engine
            .market_download(&json!({"pluginId":"dev.eac.alpha"}))
            .expect("download");
        engine
            .market_download(&json!({"pluginId":"dev.eac.beta"}))
            .expect("download");
        let stats = engine.market_stats().expect("stats");
        let day = stats["downloads"]["day"].as_array().expect("day");
        assert_eq!(day[0]["id"], "dev.eac.alpha");
        assert_eq!(day[0]["downloads"], 2);
        assert_eq!(stats["totalDownloads"], 3);
    }

    #[test]
    fn unauthenticated_social_summary_has_no_profile() {
        let (engine, _dir) = temp_engine();
        let summary = engine.social_summary(false);
        assert_eq!(summary["authenticated"], false);
        assert!(summary["profile"].is_null());
        assert_eq!(summary["likedPlugins"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn client_id_can_be_configured_in_settings() {
        let (engine, _dir) = temp_engine();
        engine
            .call("save_settings", json!({"githubClientId":"Iv1.abc123def456"}))
            .expect("settings");
        assert_eq!(engine.github_client_id().unwrap(), "Iv1.abc123def456");
    }

    #[test]
    fn plugin_ids_reject_whitespace_and_controls() {
        assert!(validate_plugin_id("dev.eac.plugin").is_ok());
        assert!(validate_plugin_id("@scope/name").is_ok());
        assert!(validate_plugin_id("bad id").is_err());
        assert!(validate_plugin_id("bad\nid").is_err());
    }
}
