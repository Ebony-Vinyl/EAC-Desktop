use eac_launcher_lib::{bridge, Engine};
use serde_json::{json, Value};

fn main() {
    if let Err(error) = run() {
        eprintln!("{}", json!({"ok":false,"error":error}));
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let engine = Engine::open()?;
    match args.first().map(String::as_str) {
        Some("--api") if args.len() == 3 => {
            let payload: Value = serde_json::from_str(&args[2]).map_err(|e| e.to_string())?;
            let data = engine.call(&args[1], payload)?;
            println!("{}", json!({"ok":true,"data":data}));
            Ok(())
        }
        Some("--serve") if args.len() == 2 || (args.len() == 4 && args[2] == "--origin") => {
            let port: u16 = args[1].parse().map_err(|_| "Port must be 0-65535")?;
            let origin = if args.len() == 4 {
                args[3].clone()
            } else {
                std::env::var("EAC_LAUNCHER_UI_ORIGIN").unwrap_or_else(|_| "http://localhost:1420".into())
            };
            bridge::serve(engine, port, &origin)
        }
        _ => Err("Usage: eac-launcher-api --api ACTION JSON | --serve PORT [--origin http://localhost:UI_PORT]. EAC_LAUNCHER_HOME selects isolated launcher storage; EAC_LAUNCHER_UI_ORIGIN sets the exact allowed browser origin.".into()),
    }
}
