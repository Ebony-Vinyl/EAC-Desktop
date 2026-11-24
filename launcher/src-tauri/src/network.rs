use crate::{
    engine::{optional, required, Engine},
    files::{self, text},
    model::{new_id, Result},
    process,
};
use reqwest::{
    blocking::Response,
    header::{CONTENT_RANGE, LOCATION, RANGE},
    Method, StatusCode,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::Path,
    time::Duration,
};
use url::Url;

const REGISTRY: &str = "https://registry.npmjs.org/@deepseek-ai%2fdsh";
const OFFICIAL_INSTALLER: &str = "https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe";
const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;

pub(crate) fn validate_download_url(raw: &str) -> Result<Url> {
    if raw.len() > 16384 || raw.chars().any(char::is_control) {
        return Err("Invalid download URL".into());
    }
    let url = Url::parse(raw).map_err(|e| format!("Invalid URL: {e}"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return Err(
            "Downloads require a public HTTPS URL on port 443 without credentials or fragment"
                .into(),
        );
    }
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))
    {
        return Err("Downloads from local/private hosts are forbidden".into());
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_unspecified()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (18..=19).contains(&b))
                && !ip.is_documentation()
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            let first = ip.segments()[0];
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && first & 0xfe00 != 0xfc00
                && first & 0xffc0 != 0xfe80
                && ip.segments()[..2] != [0x2001, 0x0db8]
        }
    }
}

fn trusted_fake_ip(host: &str, ip: IpAddr) -> bool {
    let trusted = matches!(
        host,
        "registry.npmjs.org"
            | "github.com"
            | "api.github.com"
            | "raw.githubusercontent.com"
            | "release-assets.githubusercontent.com"
            | "objects.githubusercontent.com"
            | "gitee.com"
            | "download.deepseek.com"
            | "nodejs.org"
            | "cdn.jsdelivr.net"
    );
    // TUN DNS modes use the benchmark range as synthetic public-host addresses.
    // Limit this exception to known distribution hosts; private LAN/loopback stays blocked.
    trusted
        && matches!(ip, IpAddr::V4(ip) if ip.octets()[0] == 198 && matches!(ip.octets()[1], 18 | 19))
}

// 出站代理是显式开关：设置 EAC_HTTPS_PROXY（或别名 EAC_GITHUB_PROXY）后，
// 引擎的全部 HTTPS 出站请求（GitHub 授权/Star、发行下载、npm 元数据）都会走它。
// 未设置时保持原有行为：忽略系统代理、DNS 固定 + 私网校验。代理由用户自行选择，
// 因此允许 localhost/LAN 地址；DNS 解析交给代理，跳过 DNS 固定。
pub(crate) fn outbound_proxy() -> Result<Option<String>> {
    for key in ["EAC_HTTPS_PROXY", "EAC_GITHUB_PROXY"] {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if value.len() > 300 || value.chars().any(char::is_control) {
            return Err(format!("{key} contains control characters or is too long"));
        }
        let parsed = Url::parse(value).map_err(|e| format!("Invalid {key}: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err(format!(
                "{key} must be an http(s) proxy URL, e.g. http://127.0.0.1:7890"
            ));
        }
        return Ok(Some(value.to_string()));
    }
    Ok(None)
}

impl Engine {
    // 带 DNS 固定与逐跳重定向校验的 HTTPS 请求。下载走长时间超时，
    // API 请求（GitHub）走短超时；两者共享同一套私网/凭据防护。
    pub(crate) fn secure_request(
        &self,
        method: Method,
        raw: &str,
        headers: &[(String, String)],
        body: Option<Vec<u8>>,
        timeout: Duration,
    ) -> Result<Response> {
        let mut url = validate_download_url(raw)?;
        let proxy = outbound_proxy()?;
        for _ in 0..8 {
            let host = url
                .host_str()
                .ok_or("URL has no hostname")?
                .trim_matches(['[', ']']);
            let mut builder = reqwest::blocking::Client::builder()
                .user_agent("EAC-Launcher/0.1")
                .connect_timeout(Duration::from_secs(20))
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none());
            match &proxy {
                Some(proxy_url) => {
                    let proxy = reqwest::Proxy::all(proxy_url)
                        .map_err(|e| format!("Invalid outbound proxy: {e}"))?;
                    builder = builder.proxy(proxy);
                }
                None => {
                    let addresses: Vec<SocketAddr> = (host, 443)
                        .to_socket_addrs()
                        .map_err(|e| format!("Resolve download hostname: {e}"))?
                        .collect();
                    if addresses.is_empty()
                        || addresses.iter().any(|addr| {
                            !public_ip(addr.ip()) && !trusted_fake_ip(host, addr.ip())
                        })
                    {
                        return Err("Download DNS resolved to a private/reserved address".into());
                    }
                    // Pin the checked DNS answers and recheck every redirect,
                    // preventing rebinding/SSRF. With an explicit proxy the hop
                    // is the user's own proxy, which owns name resolution.
                    builder = builder
                        .no_proxy()
                        .resolve_to_addrs(host, &addresses);
                }
            }
            let client = builder.build().map_err(|e| e.to_string())?;
            let mut request = client.request(method.clone(), url.clone());
            for (name, value) in headers {
                request = request.header(name, value);
            }
            if let Some(body) = &body {
                request = request.body(body.clone());
            }
            let response = request
                .send()
                .map_err(|e| format!("HTTPS request failed: {e}"))?;
            if response.status().is_redirection() {
                if method != Method::GET {
                    return Err("HTTPS API returned an unexpected redirect".into());
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or("Redirect has no valid Location")?;
                url =
                    validate_download_url(url.join(location).map_err(|e| e.to_string())?.as_str())?;
            } else {
                return Ok(response);
            }
        }
        Err("Too many HTTPS redirects".into())
    }

    pub(crate) fn read_body(&self, response: Response, limit: usize) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();
        response
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > limit {
            return Err("Remote response exceeds the size limit".into());
        }
        Ok(bytes)
    }

    fn secure_get(&self, raw: &str) -> Result<Response> {
        self.secure_request(
            Method::GET,
            raw,
            &[],
            None,
            Duration::from_secs(30 * 60),
        )?
        .error_for_status()
        .map_err(|e| e.to_string())
    }

    fn remote_json(&self, url: &str) -> Result<Value> {
        let response = self.secure_get(url)?;
        let mut bytes = Vec::new();
        response
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("Remote metadata exceeds 32 MiB".into());
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid remote JSON: {e}"))
    }

    pub(crate) fn kernel_versions(&self) -> Result<Value> {
        let metadata = self.remote_json(REGISTRY)?;
        let mut versions: Vec<_> = metadata["versions"]
            .as_object()
            .ok_or("npm metadata contains no versions")?
            .keys()
            .filter_map(|version| semver::Version::parse(version).ok())
            .collect();
        versions.sort_by(|a, b| b.cmp(a));
        Ok(json!({
            "versions": versions.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "tags": metadata.get("dist-tags").cloned().unwrap_or_else(|| json!({}))
        }))
    }

    pub(crate) fn releases(&self, source: &str) -> Result<Value> {
        if source == "official" {
            let response = self.secure_get(OFFICIAL_INSTALLER)?;
            let size = response
                .content_length()
                .map(|size| json!(size))
                .unwrap_or(json!(-1));
            let modified = response
                .headers()
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_owned();
            return Ok(json!({"releases":[{
                "tag":"DeepSeek Harness 官方桌面端",
                "prerelease":false,
                "publishedAt":modified,
                "body":"来自 DeepSeek 官方下载站的当前 Windows 安装器。官方仓库没有对应的 GitHub Desktop 附件。下载后运行安装器，再登记已安装的桌面 EXE；启动器不会把安装器当成实例运行。",
                "assets":[{"name":"dsh-latest-windows-x64.exe","url":OFFICIAL_INSTALLER,"size":size}]
            }]}));
        }
        if source == "kernel" {
            let metadata = self.remote_json(REGISTRY)?;
            let versions = metadata["versions"]
                .as_object()
                .ok_or("npm metadata contains no versions")?;
            let mut sorted: Vec<_> = versions
                .keys()
                .filter_map(|s| semver::Version::parse(s).ok())
                .collect();
            sorted.sort_by(|a, b| b.cmp(a));
            let mut releases = Vec::new();
            for version in sorted.into_iter().take(100) {
                let tag = version.to_string();
                let manifest = &versions[&tag];
                let published = metadata["time"][&tag]
                    .as_str()
                    .ok_or("npm version has no publication timestamp")?;
                let tarball = manifest.pointer("/dist/tarball").and_then(Value::as_str);
                // npm does not provide archive byte sizes or SHA-256; do not manufacture assets.
                releases.push(json!({
                    "tag":tag,
                    "prerelease":!version.pre.is_empty(),
                    "publishedAt":published,
                    "body":tarball.map(|u| format!("Official npm package @deepseek-ai/dsh@{tag}\n{u}")).unwrap_or_default(),
                    "assets":[]
                }));
            }
            return Ok(json!({"releases":releases}));
        }
        if source != "eac" {
            return Err("Release source must be eac, official or kernel".into());
        }
        let entries = self.remote_json(
            "https://api.github.com/repos/Ebony-Vinyl/EAC-Desktop/releases?per_page=50",
        )?;
        let entries = entries
            .as_array()
            .ok_or("GitHub returned no releases array")?;
        let mut releases = Vec::new();
        for entry in entries.iter().filter(|entry| entry["draft"] != true) {
            let mut assets = Vec::new();
            for asset in entry["assets"]
                .as_array()
                .ok_or("GitHub release has no assets")?
            {
                let mut item = json!({
                    "name":required(asset,"name")?,
                    "url":required(asset,"browser_download_url")?,
                    "size":asset["size"].as_u64().ok_or("GitHub asset has no byte size")?
                });
                if let Some(hash) = asset["digest"]
                    .as_str()
                    .and_then(|s| s.strip_prefix("sha256:"))
                {
                    files::valid_digest(hash)?;
                    item["sha256"] = json!(hash);
                }
                assets.push(item);
            }
            releases.push(json!({
                "tag":required(entry,"tag_name")?,
                "prerelease":entry["prerelease"].as_bool().ok_or("GitHub release has no prerelease flag")?,
                "publishedAt":required(entry,"published_at")?,
                "body":entry["body"].as_str().unwrap_or(""),
                "assets":assets
            }));
        }
        Ok(json!({"releases":releases}))
    }

    pub(crate) fn download_action(&self, payload: &Value) -> Result<Value> {
        let sources = extract_download_sources(payload)?;
        self.download_sources(
            &sources,
            required(payload, "filename")?,
            optional(payload, "sha256")?,
        )
    }

    pub(crate) fn download_sources(
        &self,
        sources: &[String],
        filename: &str,
        expected: Option<&str>,
    ) -> Result<Value> {
        self.download_with_fetcher(sources, filename, expected, |url, offset| {
            let headers = if offset > 0 {
                vec![(RANGE.as_str().to_string(), format!("bytes={offset}-"))]
            } else {
                Vec::new()
            };
            let response = self.secure_request(
                Method::GET,
                url,
                &headers,
                None,
                Duration::from_secs(30 * 60),
            )?;
            let status = response.status();
            let content_length = response.content_length();
            let content_range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            Ok(TransferResponse {
                status,
                content_length,
                content_range,
                body: Box::new(response),
            })
        })
    }

    pub(crate) fn download_with_fetcher<F>(
        &self,
        raw_sources: &[String],
        filename: &str,
        expected: Option<&str>,
        mut fetcher: F,
    ) -> Result<Value>
    where
        F: FnMut(&str, u64) -> Result<TransferResponse>,
    {
        files::safe_filename(filename)?;
        let sources = normalize_download_sources(raw_sources)?;
        if let Some(hash) = expected {
            files::valid_digest(hash)?;
        }
        let cache = self.path("cache/downloads")?;
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

        // 已落盘且 SHA-256 校验匹配的缓存文件直接复用，跳过重复下载。
        if let Some(expected_hash) = expected {
            let cached_path =
                self.path(format!("cache/downloads/{}-{filename}", expected_hash.to_ascii_lowercase()))?;
            if cached_path.is_file() {
                match verify_file_sha256(&cached_path) {
                    Ok((actual_hash, size)) if actual_hash.eq_ignore_ascii_case(expected_hash) => {
                        let part_name = format!(
                            ".partial-{}.part",
                            partial_download_key(&sources[0], filename, expected)
                        );
                        let _ = fs::remove_file(cache.join(part_name));
                        return Ok(json!({
                            "path": text(&cached_path),
                            "sha256": actual_hash,
                            "size": size,
                            "verified": true,
                            "cached": true
                        }));
                    }
                    _ => {
                        let _ = fs::remove_file(&cached_path);
                    }
                }
            }
        }

        const MAX_ATTEMPTS_PER_SOURCE: usize = 3;
        let mut errors: Vec<String> = Vec::new();

        for source_url in &sources {
            let part_path = cache.join(format!(
                ".partial-{}.part",
                partial_download_key(source_url, filename, expected)
            ));

            for attempt in 0..MAX_ATTEMPTS_PER_SOURCE {
                let mut offset = part_path
                    .metadata()
                    .ok()
                    .filter(|meta| meta.is_file())
                    .map(|meta| meta.len())
                    .unwrap_or(0);
                if offset > MAX_DOWNLOAD {
                    let _ = fs::remove_file(&part_path);
                    offset = 0;
                }

                let mut response = match fetcher(source_url, offset) {
                    Ok(resp) => resp,
                    Err(err) => {
                        errors.push(format!("{source_url} (attempt {}): {err}", attempt + 1));
                        continue;
                    }
                };

                if response.status == StatusCode::RANGE_NOT_SATISFIABLE {
                    if offset > 0 {
                        if let Some(expected_hash) = expected {
                            if let Ok((actual_hash, total_size)) = verify_file_sha256(&part_path) {
                                if actual_hash.eq_ignore_ascii_case(expected_hash) {
                                    let final_path = self.path(format!(
                                        "cache/downloads/{actual_hash}-{filename}"
                                    ))?;
                                    persist_verified_part(&part_path, &final_path)?;
                                    return Ok(json!({
                                        "path": text(&final_path),
                                        "sha256": actual_hash,
                                        "size": total_size,
                                        "verified": true
                                    }));
                                }
                            }
                        }
                        let _ = fs::remove_file(&part_path);
                        continue;
                    }
                    errors.push(format!("{source_url}: HTTP 416 Range Not Satisfiable"));
                    break;
                }

                if !response.status.is_success() {
                    errors.push(format!("{source_url}: HTTP {}", response.status));
                    if response.status.is_client_error()
                        && response.status != StatusCode::TOO_MANY_REQUESTS
                        && response.status != StatusCode::REQUEST_TIMEOUT
                    {
                        break;
                    }
                    continue;
                }

                let (append_mode, base_offset, expected_stream_len, expected_total_len) =
                    if offset > 0 && response.status == StatusCode::PARTIAL_CONTENT {
                        let Some((start, end, total)) = response
                            .content_range
                            .as_deref()
                            .and_then(parse_content_range)
                        else {
                            let _ = fs::remove_file(&part_path);
                            errors.push(format!(
                                "{source_url}: missing or malformed HTTP 206 Content-Range"
                            ));
                            continue;
                        };
                        if start != offset {
                            let _ = fs::remove_file(&part_path);
                            errors.push(format!(
                                "{source_url}: HTTP 206 Content-Range start {start} != requested {offset}"
                            ));
                            continue;
                        }
                        if total.is_some_and(|t| t > MAX_DOWNLOAD) || end >= MAX_DOWNLOAD {
                            let _ = fs::remove_file(&part_path);
                            return Err("Download exceeds 2 GiB limit".into());
                        }
                        let span_len = end - start + 1;
                        if response.content_length.is_some_and(|cl| cl != span_len) {
                            let _ = fs::remove_file(&part_path);
                            errors.push(format!(
                                "{source_url}: HTTP 206 Content-Length disagrees with Content-Range"
                            ));
                            continue;
                        }
                        (true, offset, Some(span_len), total)
                    } else if response.status == StatusCode::OK {
                        if response.content_length.is_some_and(|cl| cl > MAX_DOWNLOAD) {
                            let _ = fs::remove_file(&part_path);
                            return Err("Download exceeds 2 GiB limit".into());
                        }
                        (false, 0, response.content_length, response.content_length)
                    } else {
                        errors.push(format!(
                            "{source_url}: unexpected HTTP status {} for offset {offset}",
                            response.status
                        ));
                        break;
                    };

                let write_outcome: std::result::Result<u64, String> = (|| {
                    let mut file = if append_mode {
                        OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&part_path)
                            .map_err(|e| e.to_string())?
                    } else {
                        OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(true)
                            .open(&part_path)
                            .map_err(|e| e.to_string())?
                    };
                    let mut stream_bytes = 0u64;
                    let mut buf = [0u8; 64 * 1024];
                    loop {
                        let count = match response.body.read(&mut buf) {
                            Ok(n) => n,
                            Err(err) => {
                                let _ = file.flush();
                                return Err(format!("Download interrupted: {err}"));
                            }
                        };
                        if count == 0 {
                            break;
                        }
                        stream_bytes += count as u64;
                        if base_offset + stream_bytes > MAX_DOWNLOAD {
                            return Err("LIMIT_EXCEEDED".into());
                        }
                        file.write_all(&buf[..count]).map_err(|e| e.to_string())?;
                    }
                    if expected_stream_len.is_some_and(|expected_len| stream_bytes != expected_len)
                    {
                        let _ = file.flush();
                        return Err("Download size differs from HTTP Content-Length".into());
                    }
                    file.sync_all().map_err(|e| e.to_string())?;
                    Ok(stream_bytes)
                })();

                let stream_bytes = match write_outcome {
                    Ok(written) => written,
                    Err(msg) if msg == "LIMIT_EXCEEDED" => {
                        let _ = fs::remove_file(&part_path);
                        return Err("Download exceeds 2 GiB limit".into());
                    }
                    Err(err) => {
                        errors.push(format!("{source_url} (attempt {}): {err}", attempt + 1));
                        continue;
                    }
                };

                // 终态体积与 Content-Range total（或 HTTP 200 Content-Length）逐字节核对，
                // 防止服务端返回提前截断的最后一段在无摘要时被误认为完整文件。
                let current_total = base_offset + stream_bytes;
                if let Some(expected_total) = expected_total_len {
                    if current_total > expected_total {
                        let _ = fs::remove_file(&part_path);
                        errors.push(format!(
                            "{source_url}: downloaded {current_total} bytes exceeds expected total {expected_total}"
                        ));
                        continue;
                    }
                    if current_total < expected_total {
                        errors.push(format!(
                            "{source_url} (attempt {}): truncated transfer ({current_total}/{expected_total} bytes)",
                            attempt + 1
                        ));
                        continue;
                    }
                }

                let (actual_hash, total_size) = verify_file_sha256(&part_path)?;
                if let Some(expected_total) = expected_total_len {
                    if total_size != expected_total {
                        let _ = fs::remove_file(&part_path);
                        errors.push(format!(
                            "{source_url}: persisted file size {total_size} disagrees with expected total {expected_total}"
                        ));
                        continue;
                    }
                }

                if let Some(expected_hash) = expected {
                    if !expected_hash.eq_ignore_ascii_case(&actual_hash) {
                        let _ = fs::remove_file(&part_path);
                        errors.push(format!(
                            "SHA-256 mismatch: downloaded {actual_hash}; unverified bytes were discarded"
                        ));
                        break;
                    }
                    let final_path =
                        self.path(format!("cache/downloads/{actual_hash}-{filename}"))?;
                    persist_verified_part(&part_path, &final_path)?;
                    return Ok(json!({
                        "path": text(&final_path),
                        "sha256": actual_hash,
                        "size": total_size,
                        "verified": true
                    }));
                }

                // 无预期 SHA-256 时绝不用 {actual_hash} 命名缓存文件，避免后续代码将其误当成已校验产物；
                // 改用 unverified- 前缀落盘，并在日志与返回值中显式声明本次未做完整性校验。
                let unverified_path =
                    self.path(format!("cache/downloads/unverified-{}-{filename}", new_id()))?;
                persist_verified_part(&part_path, &unverified_path)?;
                eprintln!(
                    "[eac-launcher][download] unverified download (no expected SHA-256, integrity not verified): path={} sha256={} size={}",
                    unverified_path.display(),
                    actual_hash,
                    total_size
                );
                return Ok(json!({
                    "path": text(&unverified_path),
                    "sha256": actual_hash,
                    "size": total_size,
                    "verified": false,
                    "integrityWarning": "本次下载未提供预期 SHA-256，未做完整性校验"
                }));
            }
        }

        Err(errors
            .into_iter()
            .reduce(|acc, item| format!("{acc}; {item}"))
            .unwrap_or_else(|| "Download failed with no available sources".into()))
    }

    // 应用内自更新：强制校验预期 SHA-256 摘要后下载发布版安装器，分离进程启动后返回路径。
    // 真正的安装与替换由 NSIS 安装器完成；前端随后退出当前应用。
    pub(crate) fn install_update(&self, payload: &Value) -> Result<Value> {
        let sources = extract_download_sources(payload)?;
        let filename = required(payload, "filename")?;
        if !filename.to_ascii_lowercase().ends_with(".exe") {
            return Err("Self-update expects the NSIS .exe installer asset".into());
        }
        let expected = required(payload, "sha256").map_err(|_| {
            "Self-update requires a trusted sha256 digest; refusing to execute an unverified installer"
        })?;
        files::valid_digest(expected)?;
        let download = self.download_sources(&sources, filename, Some(expected))?;
        if download["verified"].as_bool() != Some(true) {
            return Err("Self-update download did not complete SHA-256 verification".into());
        }
        let installer = std::path::PathBuf::from(required(&download, "path")?);
        let mut command = process::command(&installer);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // DETACHED_PROCESS：安装器独立于引擎/应用生命周期运行。
            command.creation_flags(0x0000_0008);
        }
        command
            .spawn()
            .map_err(|error| format!("启动更新安装程序失败：{error}"))?;
        Ok(json!({ "path": installer.to_string_lossy() }))
    }

    pub(crate) fn install_desktop(&self, payload: &Value) -> Result<Value> {
        let kind = required(payload, "kind")?;
        if !matches!(kind, "eac-desktop" | "official-desktop") {
            return Err("Desktop kind must be eac-desktop or official-desktop".into());
        }
        let name = required(payload, "name")?;
        files::valid_name(name)?;
        let filename = required(payload, "filename")?;
        if !filename.to_ascii_lowercase().ends_with(".zip") {
            return Err("Desktop installation accepts portable ZIP only. Download EXE installers with download_asset and register the installed application separately".into());
        }
        let download = self.download_action(payload)?;
        let source = Path::new(required(&download, "path")?);
        let staging = self.path(format!("cache/desktop-{}", new_id()))?;
        if let Err(error) = files::extract_zip(source, &staging) {
            let retained = if staging.exists() {
                self.retain_failed(&staging, "desktop")?
            } else {
                staging
            };
            return Err(format!(
                "{error}; rejected extraction retained at {}",
                retained.display()
            ));
        }
        let mut candidates = Vec::new();
        find_executables(&staging, &mut candidates)?;
        candidates.sort_by_key(|path| path.components().count());
        let executable = match candidates.as_slice() {
            [] => {
                return Err(format!(
                "Portable ZIP contains no recognizable main application EXE; files retained at {}",
                staging.display()
            ))
            }
            [one] => one.clone(),
            many => {
                let shallowest = many[0].components().count();
                if many
                    .iter()
                    .filter(|p| p.components().count() == shallowest)
                    .count()
                    == 1
                {
                    many[0].clone()
                } else {
                    return Err(format!(
                        "Portable ZIP contains multiple possible main EXEs; files retained at {}",
                        staging.display()
                    ));
                }
            }
        };
        let relative = executable
            .strip_prefix(&staging)
            .map_err(|e| e.to_string())?
            .to_owned();
        let installed = self.path(format!("cache/desktop-installed-{}", new_id()))?;
        fs::rename(&staging, &installed).map_err(|e| e.to_string())?;
        self.call(
            "create_instance",
            json!({"kind":kind,"name":name,"executable":text(&installed.join(relative))}),
        )
    }
}

fn find_executables(path: &Path, results: &mut Vec<std::path::PathBuf>) -> Result<()> {
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            find_executables(&entry.path(), results)?;
        } else if kind.is_file() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.ends_with(".exe")
                && ["eac", "deepseek", "harness", "dsh"]
                    .iter()
                    .any(|s| name.contains(s))
                && ![
                    "setup",
                    "install",
                    "crash",
                    "helper",
                    "update",
                    "dsh-latest-windows",
                ]
                .iter()
                .any(|s| name.contains(s))
            {
                results.push(entry.path());
            }
        }
    }
    Ok(())
}

pub(crate) struct TransferResponse {
    pub status: StatusCode,
    pub content_length: Option<u64>,
    pub content_range: Option<String>,
    pub body: Box<dyn Read>,
}

pub(crate) fn optional_url_list(payload: &Value, key: &str) -> Result<Vec<String>> {
    let Some(raw_list) = payload.get(key) else {
        return Ok(Vec::new());
    };
    if raw_list.is_null() {
        return Ok(Vec::new());
    }
    let items = raw_list
        .as_array()
        .ok_or_else(|| format!("{key} must be an array of HTTPS URLs"))?;
    let mut urls = Vec::with_capacity(items.len());
    for item in items {
        let raw = item
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Each entry in {key} must be a nonempty HTTPS URL"))?;
        validate_download_url(raw)?;
        urls.push(raw.to_string());
    }
    Ok(urls)
}

pub(crate) fn extract_download_sources(payload: &Value) -> Result<Vec<String>> {
    let primary = optional(payload, "url")?;
    let urls = optional_url_list(payload, "urls")?;
    let mirrors = optional_url_list(payload, "mirrors")?;
    let mut combined = Vec::new();
    if let Some(first) = primary {
        combined.push(first.to_string());
    }
    combined.extend(urls);
    combined.extend(mirrors);
    if combined.is_empty() {
        required(payload, "url")?;
    }
    normalize_download_sources(&combined)
}

fn normalize_download_sources(raw_sources: &[String]) -> Result<Vec<String>> {
    if raw_sources.is_empty() {
        return Err("At least one download URL is required".into());
    }
    if raw_sources.len() > 16 {
        return Err("Too many candidate download URLs (max 16)".into());
    }
    let mut unique = Vec::with_capacity(raw_sources.len());
    for raw in raw_sources {
        let trimmed = raw.trim();
        validate_download_url(trimmed)?;
        if !unique.iter().any(|existing: &String| existing == trimmed) {
            unique.push(trimmed.to_string());
        }
    }
    Ok(unique)
}

pub(crate) fn parse_content_range(raw: &str) -> Option<(u64, u64, Option<u64>)> {
    let trimmed = raw.trim();
    let rest = trimmed
        .strip_prefix("bytes ")
        .or_else(|| trimmed.strip_prefix("BYTES "))?;
    let (span, total_raw) = rest.split_once('/')?;
    let (start_raw, end_raw) = span.trim().split_once('-')?;
    let start: u64 = start_raw.trim().parse().ok()?;
    let end: u64 = end_raw.trim().parse().ok()?;
    if start > end {
        return None;
    }
    let total = if total_raw.trim() == "*" {
        None
    } else {
        let parsed: u64 = total_raw.trim().parse().ok()?;
        if end >= parsed {
            return None;
        }
        Some(parsed)
    };
    Some((start, end, total))
}

fn partial_download_key(url: &str, filename: &str, expected: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    match expected {
        Some(hash) => {
            hasher.update(b"sha256:");
            hasher.update(hash.to_ascii_lowercase().as_bytes());
        }
        None => {
            hasher.update(b"url:");
            hasher.update(url.as_bytes());
        }
    }
    hasher.update(b"\0");
    hasher.update(filename.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    digest[..24].to_string()
}

fn verify_file_sha256(path: &Path) -> Result<(String, u64)> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buf).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_DOWNLOAD {
            return Err("Download exceeds 2 GiB limit".into());
        }
        hasher.update(&buf[..count]);
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn persist_verified_part(part_path: &Path, final_path: &Path) -> Result<()> {
    if final_path.exists() {
        let _ = fs::remove_file(final_path);
    }
    fs::rename(part_path, final_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_urls_reject_local_hosts_and_credentials() {
        for url in [
            "file:///etc/passwd",
            "http://example.com/a",
            "https://localhost/a",
            "https://127.0.0.1/a",
            "https://10.0.0.1/a",
            "https://[::1]/a",
            "https://[::ffff:127.0.0.1]/a",
            "https://user:secret@example.com/a",
            "https://example.com:444/a",
            "https://example.com/a#fragment",
        ] {
            assert!(validate_download_url(url).is_err(), "{url}");
        }
        assert!(validate_download_url(
            "https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe"
        )
        .is_ok());
    }

    #[test]
    fn outbound_proxy_is_opt_in_and_validated() {
        std::env::remove_var("EAC_HTTPS_PROXY");
        std::env::remove_var("EAC_GITHUB_PROXY");
        assert_eq!(outbound_proxy().expect("unset"), None);
        std::env::set_var("EAC_HTTPS_PROXY", "http://127.0.0.1:7890");
        assert_eq!(
            outbound_proxy().expect("valid proxy").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        std::env::set_var("EAC_HTTPS_PROXY", "socks5://127.0.0.1:1080");
        assert!(outbound_proxy().is_err(), "socks5 is not supported");
        std::env::set_var("EAC_HTTPS_PROXY", "");
        assert_eq!(outbound_proxy().expect("empty disables"), None);
        std::env::set_var("EAC_GITHUB_PROXY", "http://192.168.1.10:7890");
        assert_eq!(
            outbound_proxy().expect("alias works").as_deref(),
            Some("http://192.168.1.10:7890")
        );
        std::env::remove_var("EAC_GITHUB_PROXY");
        std::env::remove_var("EAC_HTTPS_PROXY");
    }

    struct FailingPrefixReader {
        data: Vec<u8>,
        pos: usize,
        fail_at: usize,
    }

    impl Read for FailingPrefixReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.pos >= self.fail_at {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionReset,
                    "simulated mid-stream network drop",
                ));
            }
            let remaining = (self.fail_at - self.pos).min(buf.len());
            buf[..remaining].copy_from_slice(&self.data[self.pos..self.pos + remaining]);
            self.pos += remaining;
            Ok(remaining)
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        format!("{:x}", h.finalize())
    }

    #[test]
    fn parse_content_range_validates_bounds() {
        assert_eq!(
            parse_content_range("bytes 0-99/200"),
            Some((0, 99, Some(200)))
        );
        assert_eq!(parse_content_range("bytes 100-199/*"), Some((100, 199, None)));
        assert_eq!(parse_content_range("bytes 200-100/300"), None);
        assert_eq!(parse_content_range("bytes 100-200/200"), None);
        assert_eq!(parse_content_range("items 0-10/20"), None);
    }

    #[test]
    fn download_resumes_interrupted_stream_via_http_206_and_verifies_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();
        let payload: Vec<u8> = (0..150_000).map(|i| (i % 251) as u8).collect();
        let expected_sha = sha256_hex(&payload);
        let url = "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/bundle.dshpack".to_string();

        let mut calls = Vec::new();
        let result = engine
            .download_with_fetcher(
                std::slice::from_ref(&url),
                "bundle.dshpack",
                Some(&expected_sha),
                |_, offset| {
                    calls.push(offset);
                    if calls.len() == 1 {
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(payload.len() as u64),
                            content_range: None,
                            body: Box::new(FailingPrefixReader {
                                data: payload.clone(),
                                pos: 0,
                                fail_at: 80_000,
                            }),
                        })
                    } else {
                        let rest = payload[offset as usize..].to_vec();
                        Ok(TransferResponse {
                            status: StatusCode::PARTIAL_CONTENT,
                            content_length: Some(rest.len() as u64),
                            content_range: Some(format!(
                                "bytes {offset}-{}/{}",
                                payload.len() - 1,
                                payload.len()
                            )),
                            body: Box::new(std::io::Cursor::new(rest)),
                        })
                    }
                },
            )
            .expect("resume should complete download");

        assert_eq!(calls, vec![0, 80_000]);
        assert_eq!(result["sha256"], expected_sha);
        assert_eq!(result["size"], payload.len() as u64);
        let saved = fs::read(result["path"].as_str().unwrap()).unwrap();
        assert_eq!(saved, payload);

        // Repeat call hits verified local cache with zero network requests.
        let cached = engine
            .download_with_fetcher(
                std::slice::from_ref(&url),
                "bundle.dshpack",
                Some(&expected_sha),
                |_, _| panic!("cached file must skip network transfer"),
            )
            .expect("cache hit");
        assert_eq!(cached["cached"], true);
        assert_eq!(cached["sha256"], expected_sha);
    }

    #[test]
    fn download_falls_back_across_mirrors_preserving_verified_partial_progress() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();
        let payload = b"multi-source-resumable-kernel-archive-bytes-0123456789".to_vec();
        let expected_sha = sha256_hex(&payload);
        let sources = vec![
            "https://download.deepseek.com/desktop/broken-primary.tgz".to_string(),
            "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/partial-mirror.tgz"
                .to_string(),
            "https://cdn.jsdelivr.net/gh/Ebony-Vinyl/EAC-Desktop/final-mirror.tgz".to_string(),
        ];

        let mut trace = Vec::new();
        let result = engine
            .download_with_fetcher(&sources, "kernel.tgz", Some(&expected_sha), |url, offset| {
                trace.push((url.to_string(), offset));
                if url.contains("broken-primary") {
                    Ok(TransferResponse {
                        status: StatusCode::NOT_FOUND,
                        content_length: None,
                        content_range: None,
                        body: Box::new(std::io::empty()),
                    })
                } else if url.contains("partial-mirror") {
                    // Fails mid-way on first attempt, then returns 503 on subsequent attempts.
                    if offset == 0 {
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(payload.len() as u64),
                            content_range: None,
                            body: Box::new(FailingPrefixReader {
                                data: payload.clone(),
                                pos: 0,
                                fail_at: 20,
                            }),
                        })
                    } else {
                        Err("mirror upstream timeout".into())
                    }
                } else {
                    // Third mirror seamlessly resumes from byte 20!
                    let rest = payload[offset as usize..].to_vec();
                    Ok(TransferResponse {
                        status: StatusCode::PARTIAL_CONTENT,
                        content_length: Some(rest.len() as u64),
                        content_range: Some(format!(
                            "bytes {offset}-{}/{}",
                            payload.len() - 1,
                            payload.len()
                        )),
                        body: Box::new(std::io::Cursor::new(rest)),
                    })
                }
            })
            .expect("third mirror should finish resumed download");

        assert_eq!(result["sha256"], expected_sha);
        assert_eq!(trace.first().unwrap().1, 0);
        assert_eq!(trace.last().unwrap().1, 20, "third mirror resumed from partial offset 20");
    }

    #[test]
    fn download_truncates_partial_when_server_ignores_range_with_200_and_discards_corrupted_sha() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();
        let good = b"authentic-release-payload-content".to_vec();
        let expected_sha = sha256_hex(&good);
        let sources = vec![
            "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/tampered.tgz"
                .to_string(),
            "https://cdn.jsdelivr.net/gh/Ebony-Vinyl/EAC-Desktop/no-range.tgz".to_string(),
        ];

        // First: verify that if all sources serve tampered bytes, .part is purged and error is reported.
        let bad_only = &sources[..1];
        let err = engine
            .download_with_fetcher(bad_only, "pkg.tgz", Some(&expected_sha), |_, _| {
                Ok(TransferResponse {
                    status: StatusCode::OK,
                    content_length: Some(7),
                    content_range: None,
                    body: Box::new(std::io::Cursor::new(b"corrupt".to_vec())),
                })
            })
            .unwrap_err();
        assert!(err.contains("SHA-256 mismatch"), "got {err}");
        let partials: Vec<_> = fs::read_dir(engine.path("cache/downloads").unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(partials.is_empty(), "corrupted .part must be discarded immediately");

        // Second: tampered mirror fails SHA-256 -> automatically switches to healthy mirror
        // that ignores Range and returns full 200 OK after an initial partial drop.
        let mut second_calls = 0usize;
        let ok = engine
            .download_with_fetcher(&sources, "pkg.tgz", Some(&expected_sha), |url, _offset| {
                if url.contains("tampered") {
                    Ok(TransferResponse {
                        status: StatusCode::OK,
                        content_length: Some(7),
                        content_range: None,
                        body: Box::new(std::io::Cursor::new(b"corrupt".to_vec())),
                    })
                } else {
                    second_calls += 1;
                    if second_calls == 1 {
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(good.len() as u64),
                            content_range: None,
                            body: Box::new(FailingPrefixReader {
                                data: good.clone(),
                                pos: 0,
                                fail_at: 10,
                            }),
                        })
                    } else {
                        // Server ignores Range header and returns full 200 OK instead of 206.
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(good.len() as u64),
                            content_range: None,
                            body: Box::new(std::io::Cursor::new(good.clone())),
                        })
                    }
                }
            })
            .expect("healthy mirror returning 200 OK should truncate and succeed");
        assert_eq!(ok["sha256"], expected_sha);
        assert_eq!(fs::read(ok["path"].as_str().unwrap()).unwrap(), good);
    }

    #[test]
    fn extract_download_sources_deduplicates_and_enforces_https_validation() {
        let valid = extract_download_sources(&json!({
            "url": "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1/a.zip",
            "urls": [
                "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1/a.zip",
                "https://cdn.jsdelivr.net/gh/Ebony-Vinyl/EAC-Desktop/a.zip"
            ]
        }))
        .unwrap();
        assert_eq!(valid.len(), 2);

        assert!(extract_download_sources(&json!({
            "url": "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1/a.zip",
            "mirrors": ["http://insecure-mirror.example.com/a.zip"]
        }))
        .is_err());
    }

    #[test]
    fn install_update_rejects_missing_or_invalid_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();

        let missing = engine
            .install_update(&json!({
                "url": "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/EAC-Setup.exe",
                "filename": "EAC-Setup.exe"
            }))
            .unwrap_err();
        assert!(
            missing.contains("sha256") || missing.contains("unverified"),
            "missing sha256 must be rejected before download: {missing}"
        );

        let invalid = engine
            .install_update(&json!({
                "url": "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/EAC-Setup.exe",
                "filename": "EAC-Setup.exe",
                "sha256": "not-a-valid-hex-digest"
            }))
            .unwrap_err();
        assert!(!invalid.is_empty(), "malformed sha256 must be rejected");
    }

    #[test]
    fn download_without_expected_sha256_uses_unverified_prefix_and_marks_unverified() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();
        let payload = b"unverified-download-payload-bytes".to_vec();
        let actual_sha = sha256_hex(&payload);
        let url =
            "https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe".to_string();

        let result = engine
            .download_with_fetcher(
                std::slice::from_ref(&url),
                "dsh-latest-windows-x64.exe",
                None,
                |_, _| {
                    Ok(TransferResponse {
                        status: StatusCode::OK,
                        content_length: Some(payload.len() as u64),
                        content_range: None,
                        body: Box::new(std::io::Cursor::new(payload.clone())),
                    })
                },
            )
            .expect("unverified download should still succeed for generic download_asset");

        assert_eq!(result["verified"], false);
        assert!(
            result["integrityWarning"]
                .as_str()
                .is_some_and(|w| !w.is_empty()),
            "unverified download must explicitly include integrityWarning"
        );
        let saved_path = std::path::PathBuf::from(result["path"].as_str().unwrap());
        let file_name = saved_path.file_name().unwrap().to_string_lossy();
        assert!(
            file_name.starts_with("unverified-"),
            "unverified artifact must use unverified- prefix, got {file_name}"
        );
        assert!(
            !file_name.contains(&actual_sha),
            "unverified artifact filename must not impersonate verified SHA-256 cache name: {file_name}"
        );
        assert_eq!(fs::read(&saved_path).unwrap(), payload);
    }

    #[test]
    fn download_rejects_truncated_http_206_when_total_exceeds_offset_plus_span() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::at(dir.path()).unwrap();
        let payload: Vec<u8> = (0..60).map(|i| i as u8).collect();
        let url =
            "https://github.com/Ebony-Vinyl/EAC-Desktop/releases/download/v1.0.0/truncated.bin"
                .to_string();

        // 1) 第一次下到 20 字节断开，随后服务端在 HTTP 206 返回 bytes 20-39/60（提前截断，仅 40/60 字节）
        //    无摘要情况下绝不得把 40 字节当成完整文件落盘！
        let mut stage = 0usize;
        let err = engine
            .download_with_fetcher(
                std::slice::from_ref(&url),
                "truncated.bin",
                None,
                |_, offset| {
                    stage += 1;
                    if stage == 1 {
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(payload.len() as u64),
                            content_range: None,
                            body: Box::new(FailingPrefixReader {
                                data: payload.clone(),
                                pos: 0,
                                fail_at: 20,
                            }),
                        })
                    } else {
                        // 始终返回提前截断的 10 字节分片（不触达 total=60）
                        let end = (offset + 9).min(49);
                        let chunk = payload[offset as usize..=end as usize].to_vec();
                        Ok(TransferResponse {
                            status: StatusCode::PARTIAL_CONTENT,
                            content_length: Some(chunk.len() as u64),
                            content_range: Some(format!("bytes {offset}-{end}/{}", payload.len())),
                            body: Box::new(std::io::Cursor::new(chunk)),
                        })
                    }
                },
            )
            .unwrap_err();
        assert!(
            err.contains("truncated transfer"),
            "truncated 206 final segment must be rejected: {err}"
        );

        // 2) 当后续续传真正补齐到 offset + span == total (60/60) 时正常完成。
        let mut stage2 = 0usize;
        let ok = engine
            .download_with_fetcher(
                std::slice::from_ref(&url),
                "truncated-recover.bin",
                None,
                |_, offset| {
                    stage2 += 1;
                    if stage2 == 1 {
                        Ok(TransferResponse {
                            status: StatusCode::OK,
                            content_length: Some(payload.len() as u64),
                            content_range: None,
                            body: Box::new(FailingPrefixReader {
                                data: payload.clone(),
                                pos: 0,
                                fail_at: 20,
                            }),
                        })
                    } else if stage2 == 2 {
                        let chunk = payload[offset as usize..40].to_vec();
                        Ok(TransferResponse {
                            status: StatusCode::PARTIAL_CONTENT,
                            content_length: Some(chunk.len() as u64),
                            content_range: Some(format!("bytes {offset}-39/{}", payload.len())),
                            body: Box::new(std::io::Cursor::new(chunk)),
                        })
                    } else {
                        let chunk = payload[offset as usize..].to_vec();
                        Ok(TransferResponse {
                            status: StatusCode::PARTIAL_CONTENT,
                            content_length: Some(chunk.len() as u64),
                            content_range: Some(format!(
                                "bytes {offset}-{}/{}",
                                payload.len() - 1,
                                payload.len()
                            )),
                            body: Box::new(std::io::Cursor::new(chunk)),
                        })
                    }
                },
            )
            .expect("multi-chunk 206 reaching Content-Range total must succeed");
        assert_eq!(ok["size"], payload.len() as u64);
        assert_eq!(ok["verified"], false);
        assert_eq!(fs::read(ok["path"].as_str().unwrap()).unwrap(), payload);
    }
}
