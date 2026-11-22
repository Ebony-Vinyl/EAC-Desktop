use crate::Engine;
use serde_json::{json, Value};
use std::sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
};
use std::time::Duration;

/// 引擎会话：一个后台线程串行执行所有写操作（与 React 版的 run 队列一致），
/// 另一个线程定时拉取 snapshot。UI 线程只读共享状态，从不阻塞。
pub struct Bridge {
    state: Arc<Mutex<UiState>>,
    tx: Sender<Cmd>,
    rx: Receiver<Event>,
}

pub struct UiState {
    pub snapshot: Option<Arc<Value>>,
    pub online: bool,
    pub connecting: bool,
    pub error: String,
}

pub enum Cmd {
    Call {
        tag: String,
        action: String,
        label: String,
        payload: Value,
    },
}

pub struct Event {
    pub tag: String,
    pub action: String,
    pub label: String,
    pub result: Result<Value, String>,
}

impl Bridge {
    pub fn start() -> Result<Self, String> {
        let engine = Engine::open()?;
        let state = Arc::new(Mutex::new(UiState {
            snapshot: None,
            online: false,
            connecting: true,
            error: String::new(),
        }));
        let (tx, cmd_rx) = mpsc::channel::<Cmd>();
        let (event_tx, rx) = mpsc::channel::<Event>();

        // 写队列：串行执行，保证 create_instance 之后的 install_plugin 看到新实例。
        {
            let engine = engine.clone();
            let events = event_tx.clone();
            std::thread::spawn(move || {
                while let Ok(Cmd::Call {
                    tag,
                    action,
                    label,
                    payload,
                }) = cmd_rx.recv()
                {
                    let result = engine.call(&action, payload);
                    if events
                        .send(Event {
                            tag,
                            action,
                            label,
                            result,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            });
        }

        // 轮询：读取真实状态；写操作进行中也不会挡住界面。
        {
            let engine = engine.clone();
            let shared = state.clone();
            std::thread::spawn(move || loop {
                let result = engine.call("snapshot", json!({}));
                if let Ok(mut guard) = shared.lock() {
                    match result {
                        Ok(value) => {
                            guard.snapshot = Some(Arc::new(value));
                            guard.online = true;
                            guard.connecting = false;
                            guard.error.clear();
                        }
                        Err(error) => {
                            guard.online = false;
                            guard.connecting = false;
                            guard.error = error;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(1500));
            });
        }

        Ok(Self { state, tx, rx })
    }

    pub fn snapshot(&self) -> Option<Arc<Value>> {
        self.state.lock().ok()?.snapshot.clone()
    }

    pub fn online(&self) -> bool {
        self.state.lock().map(|s| s.online).unwrap_or(false)
    }

    pub fn connecting(&self) -> bool {
        self.state.lock().map(|s| s.connecting).unwrap_or(false)
    }

    pub fn error(&self) -> String {
        self.state
            .lock()
            .map(|s| s.error.clone())
            .unwrap_or_default()
    }

    /// 写操作已返回 snapshot 时立即替换，免得等下一次轮询。
    pub fn apply(&self, value: Value) {
        if let Ok(mut guard) = self.state.lock() {
            guard.snapshot = Some(Arc::new(value));
            guard.online = true;
        }
    }

    pub fn call(&self, tag: impl Into<String>, action: &str, label: &str, payload: Value) {
        let _ = self.tx.send(Cmd::Call {
            tag: tag.into(),
            action: action.to_string(),
            label: label.to_string(),
            payload,
        });
    }

    pub fn poll(&self) -> Option<Event> {
        self.rx.try_recv().ok()
    }
}
