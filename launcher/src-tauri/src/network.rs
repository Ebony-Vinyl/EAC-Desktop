use crate::{
    engine::{optional, required, Engine},
    files::{self, text},
    model::{new_id, Result},
    process,
};
use reqwest::{blocking::Response, header::LOCATION, Method};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
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
        self.download(
            required(payload, "url")?,
            required(payload, "filename")?,
            optional(payload, "sha256")?,
        )
    }

    pub(crate) fn download(
        &self,
        url: &str,
        filename: &str,
        expected: Option<&str>,
    ) -> Result<Value> {
        files::safe_filename(filename)?;
        validate_download_url(url)?;
        if let Some(hash) = expected {
            files::valid_digest(hash)?;
        }
        let response = self.secure_get(url)?;
        let expected_size = response.content_length();
        if expected_size.is_some_and(|size| size > MAX_DOWNLOAD) {
            return Err("Download exceeds 2 GiB limit".into());
        }
        let cache = self.path("cache/downloads")?;
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let mut output = tempfile::NamedTempFile::new_in(&cache).map_err(|e| e.to_string())?;
        let mut source = response;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut bytes = [0; 64 * 1024];
        loop {
            let count = source
                .read(&mut bytes)
                .map_err(|e| format!("Download interrupted: {e}"))?;
            if count == 0 {
                break;
            }
            size += count as u64;
            if size > MAX_DOWNLOAD {
                return Err("Download exceeds 2 GiB limit".into());
            }
            output
                .write_all(&bytes[..count])
                .map_err(|e| e.to_string())?;
            hash.update(&bytes[..count]);
        }
        if expected_size.is_some_and(|expected| size != expected) {
            return Err("Download size differs from HTTP Content-Length".into());
        }
        let hash = format!("{:x}", hash.finalize());
        if expected.is_some_and(|expected| !expected.eq_ignore_ascii_case(&hash)) {
            return Err(format!(
                "SHA-256 mismatch: downloaded {hash}; unverified bytes were discarded"
            ));
        }
        output.as_file().sync_all().map_err(|e| e.to_string())?;
        let path = self.path(format!("cache/downloads/{hash}-{filename}"))?;
        output.persist(&path).map_err(|e| e.to_string())?;
        Ok(json!({"path":text(&path),"sha256":hash,"size":size}))
    }

    // 应用内自更新：下载发布版安装器（可选 sha256 校验），分离进程启动后返回路径。
    // 真正的安装与替换由 NSIS 安装器完成；前端随后退出当前应用。
    pub(crate) fn install_update(&self, payload: &Value) -> Result<Value> {
        let url = required(payload, "url")?;
        let filename = required(payload, "filename")?;
        if !filename.to_ascii_lowercase().ends_with(".exe") {
            return Err("Self-update expects the NSIS .exe installer asset".into());
        }
        let expected = optional(payload, "sha256")?;
        let download = self.download(url, filename, expected)?;
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
}
