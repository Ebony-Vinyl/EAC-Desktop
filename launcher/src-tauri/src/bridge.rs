use crate::{engine::Engine, model::Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};
use tiny_http::{Header, Method, Request, Response, Server};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    action: String,
    #[serde(default = "empty_payload")]
    payload: Value,
}

fn empty_payload() -> Value {
    json!({})
}

pub fn validate_origin(raw: &str) -> Result<String> {
    let url = url::Url::parse(raw).map_err(|e| e.to_string())?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_none()
    {
        return Err(
            "UI origin must be an exact HTTP localhost origin with an explicit UI port".into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}

pub fn serve(engine: Engine, port: u16, origin: &str) -> Result<()> {
    let origin = validate_origin(origin)?;
    let server = Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let address = server
        .server_addr()
        .to_ip()
        .ok_or("Bridge did not bind TCP")?;
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    // Exactly one discovery line. stdout is reserved for machine-readable transport information.
    println!(
        "{}",
        json!({
            "event":"eac-launcher-bridge",
            "url":format!("http://127.0.0.1:{}",address.port()),
            "token":token,
            "origin":origin
        })
    );
    let active = Arc::new(AtomicUsize::new(0));
    for request in server.incoming_requests() {
        if active.fetch_add(1, Ordering::SeqCst) >= 32 {
            active.fetch_sub(1, Ordering::SeqCst);
            respond(
                request,
                503,
                json!({"ok":false,"error":"Bridge is busy"}),
                None,
            );
            continue;
        }
        let engine = engine.clone();
        let token = token.clone();
        let origin = origin.clone();
        let active = active.clone();
        thread::spawn(move || {
            handle(request, &engine, &token, &origin);
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
    Ok(())
}

fn header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

fn handle(mut request: Request, engine: &Engine, token: &str, allowed_origin: &str) {
    let origin = header(&request, "Origin").map(str::to_owned);
    if origin
        .as_deref()
        .is_some_and(|origin| origin != allowed_origin)
    {
        respond(
            request,
            403,
            json!({"ok":false,"error":"Origin is not allowed"}),
            None,
        );
        return;
    }
    let cors = origin.as_deref();
    if request.url() != "/api" {
        respond(request, 404, json!({"ok":false,"error":"Not found"}), cors);
        return;
    }
    if request.method() == &Method::Options {
        // Browsers do not attach Authorization to CORS preflight.
        if cors != Some(allowed_origin)
            || header(&request, "Access-Control-Request-Method") != Some("POST")
            || header(&request, "Access-Control-Request-Headers").is_some_and(|headers| {
                headers.split(',').any(|h| {
                    !matches!(
                        h.trim().to_ascii_lowercase().as_str(),
                        "authorization" | "content-type"
                    )
                })
            })
        {
            respond(
                request,
                403,
                json!({"ok":false,"error":"Invalid preflight"}),
                None,
            );
        } else {
            respond(request, 204, Value::Null, cors);
        }
        return;
    }
    if request.method() != &Method::Post {
        respond(
            request,
            405,
            json!({"ok":false,"error":"Use POST /api"}),
            cors,
        );
        return;
    }
    if !constant_time_equal(
        header(&request, "Authorization").unwrap_or(""),
        &format!("Bearer {token}"),
    ) {
        respond(
            request,
            401,
            json!({"ok":false,"error":"Invalid bearer token"}),
            cors,
        );
        return;
    }
    if !header(&request, "Content-Type").is_some_and(|v| {
        v.split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
    }) {
        respond(
            request,
            415,
            json!({"ok":false,"error":"Content-Type must be application/json"}),
            cors,
        );
        return;
    }
    let mut body = Vec::new();
    let read = request
        .as_reader()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut body);
    if read.is_err() || body.len() > 1024 * 1024 {
        respond(
            request,
            413,
            json!({"ok":false,"error":"Request body exceeds 1 MiB or could not be read"}),
            cors,
        );
        return;
    }
    let call: Call = match serde_json::from_slice(&body) {
        Ok(call) => call,
        Err(error) => {
            respond(
                request,
                400,
                json!({"ok":false,"error":format!("Invalid request: {error}")}),
                cors,
            );
            return;
        }
    };
    match engine.call(&call.action, call.payload) {
        Ok(data) => respond(request, 200, json!({"ok":true,"data":data}), cors),
        Err(error) => respond(request, 400, json!({"ok":false,"error":error}), cors),
    }
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    let mut diff = left.len() ^ right.len();
    for (index, byte) in right.bytes().enumerate() {
        diff |= (left.as_bytes().get(index).copied().unwrap_or(0) ^ byte) as usize;
    }
    diff == 0
}

fn respond(request: Request, status: u16, value: Value, origin: Option<&str>) {
    let body = if status == 204 {
        String::new()
    } else {
        value.to_string()
    };
    let mut response = Response::from_string(body).with_status_code(status);
    for (key, value) in [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ] {
        if let Ok(header) = Header::from_bytes(key, value) {
            response.add_header(header);
        }
    }
    if let Some(origin) = origin {
        for (key, value) in [
            ("Access-Control-Allow-Origin", origin),
            ("Access-Control-Allow-Methods", "POST, OPTIONS"),
            (
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type",
            ),
            ("Vary", "Origin"),
        ] {
            if let Ok(header) = Header::from_bytes(key, value) {
                response.add_header(header);
            }
        }
    }
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_local_origins() {
        assert_eq!(
            validate_origin("http://localhost:1420").unwrap(),
            "http://localhost:1420"
        );
        for origin in [
            "https://example.com",
            "http://localhost.evil:1420",
            "http://localhost:1420/path",
            "null",
            "http://user@localhost:1420",
        ] {
            assert!(validate_origin(origin).is_err());
        }
    }
}
