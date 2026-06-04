use std::{
    collections::HashMap,
    env,
    net::TcpListener,
    path::{Path, PathBuf},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    process::{Child, Command},
    sync::{mpsc, Mutex},
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

const AGENT_RUNTIME_EVENT: &str = "agent_thread_event";
const AGENT_RUNTIME_HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const AGENT_RUNTIME_HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(150);
const AGENT_RUNTIME_SESSION: &str = "default";
const AGENT_RUNTIME_PACKAGE_NAME: &str = "@kira/agent-runtime";
const AGENT_RUNTIME_KIND: &str = "flue";

#[derive(Default)]
pub struct AgentRuntimeRegistry {
    inner: Mutex<AgentRuntimeRegistryInner>,
}

#[derive(Default)]
struct AgentRuntimeRegistryInner {
    projects: HashMap<String, ProjectAgentRuntime>,
    thread_index: HashMap<String, String>,
}

struct ProjectAgentRuntime {
    port: u16,
    token: String,
    process: Child,
    threads: HashMap<String, AgentThreadSocket>,
}

struct AgentThreadSocket {
    session_id: String,
    sender: mpsc::UnboundedSender<String>,
    read_task: JoinHandle<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentThreadInput {
    project_id: String,
    session_id: String,
    project_path: String,
    thread_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    clippy::struct_field_names,
    reason = "Agent Thread commands intentionally carry project, session, and thread ids"
)]
pub struct AgentThreadInput {
    project_id: String,
    session_id: String,
    thread_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentPromptInput {
    project_id: String,
    session_id: String,
    thread_id: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadStarted {
    project_id: String,
    session_id: String,
    thread_id: String,
    port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    clippy::struct_field_names,
    reason = "Prompt acknowledgment intentionally returns project, session, thread, and request ids"
)]
pub struct AgentPromptSent {
    project_id: String,
    session_id: String,
    thread_id: String,
    request_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentThreadEvent {
    project_id: String,
    session_id: String,
    thread_id: String,
    message: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    package_name: String,
    runtime: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentRuntimeLaunchMode {
    Dev,
    Built,
}

#[derive(Debug, Error)]
pub enum AgentRuntimeError {
    #[error("Agent runtime is already running for Agent Thread {thread_id}")]
    AlreadyRunning { thread_id: String },
    #[error("Agent runtime is not running for Agent Thread {thread_id}")]
    NotRunning { thread_id: String },
    #[error("Agent runtime project id is required")]
    MissingProjectId,
    #[error("Agent runtime session id is required")]
    MissingSessionId,
    #[error("Agent Thread id is required")]
    MissingThreadId,
    #[error("Agent prompt message is required")]
    MissingPromptMessage,
    #[error("Agent runtime project path is required")]
    MissingProjectPath,
    #[error("Agent runtime project path does not exist: {path}")]
    ProjectPathMissing { path: String },
    #[error("Agent runtime project path is not a directory: {path}")]
    ProjectPathNotDirectory { path: String },
    #[error("Agent runtime directory was not found: {path}")]
    RuntimeDirectoryMissing { path: String },
    #[error("failed to reserve an agent runtime port: {0}")]
    ReservePort(String),
    #[error("failed to start agent runtime: {reason}")]
    StartFailed { reason: String },
    #[error("Agent runtime did not become healthy on port {port} within {timeout_ms}ms")]
    HealthTimeout { port: u16, timeout_ms: u64 },
    #[error("Agent runtime returned invalid health response on port {port}: {reason}")]
    InvalidHealthResponse { port: u16, reason: String },
    #[error("Failed to connect to Flue coding agent for Agent Thread {thread_id}: {reason}")]
    WebSocketConnectFailed { thread_id: String, reason: String },
    #[error("Failed to send prompt to Agent Thread {thread_id}: {reason}")]
    PromptSendFailed { thread_id: String, reason: String },
    #[error("Failed to stop agent runtime for Agent Thread {thread_id}: {reason}")]
    StopFailed { thread_id: String, reason: String },
    #[error("agent runtime registry is unavailable because its lock is poisoned")]
    RegistryUnavailable,
}

impl serde::Serialize for AgentRuntimeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn start_agent_thread(
    app: AppHandle,
    input: StartAgentThreadInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<AgentThreadStarted, AgentRuntimeError> {
    validate_required("project_id", &input.project_id)?;
    validate_required("session_id", &input.session_id)?;
    validate_required("thread_id", &input.thread_id)?;
    let project_path = validate_project_path(&input.project_path)?;

    {
        let inner = registry.inner.lock().await;
        if inner.thread_index.contains_key(&input.thread_id) {
            return Err(AgentRuntimeError::AlreadyRunning {
                thread_id: input.thread_id,
            });
        }
    }

    let project_id = input.project_id;
    let session_id = input.session_id;
    let thread_id = input.thread_id;

    let mut new_runtime = None;
    let runtime_connection = {
        let inner = registry.inner.lock().await;
        if let Some(runtime) = inner.projects.get(&project_id) {
            RuntimeConnection {
                port: runtime.port,
                token: runtime.token.clone(),
            }
        } else {
            drop(inner);
            let runtime = start_project_runtime(&project_id, &project_path).await?;
            let connection = RuntimeConnection {
                port: runtime.port,
                token: runtime.token.clone(),
            };
            new_runtime = Some(runtime);
            connection
        }
    };

    let socket = connect_agent_thread_socket(AgentThreadSocketConnection {
        app: &app,
        project_id: &project_id,
        session_id: &session_id,
        thread_id: &thread_id,
        port: runtime_connection.port,
        token: &runtime_connection.token,
    })
    .await?;

    let mut inner = registry.inner.lock().await;
    if inner.thread_index.contains_key(&thread_id) {
        socket.read_task.abort();
        return Err(AgentRuntimeError::AlreadyRunning { thread_id });
    }

    if let Some(runtime) = new_runtime {
        inner.projects.insert(project_id.clone(), runtime);
    }

    let runtime = inner
        .projects
        .get_mut(&project_id)
        .ok_or(AgentRuntimeError::RegistryUnavailable)?;

    runtime.threads.insert(thread_id.clone(), socket);
    inner
        .thread_index
        .insert(thread_id.clone(), project_id.clone());

    Ok(AgentThreadStarted {
        project_id,
        session_id,
        thread_id,
        port: runtime_connection.port,
    })
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn send_agent_prompt(
    input: SendAgentPromptInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<AgentPromptSent, AgentRuntimeError> {
    validate_required("project_id", &input.project_id)?;
    validate_required("session_id", &input.session_id)?;
    validate_required("thread_id", &input.thread_id)?;
    if input.message.trim().is_empty() {
        return Err(AgentRuntimeError::MissingPromptMessage);
    }

    let request_id = Uuid::new_v4().to_string();
    let frame = json!({
        "version": 1,
        "type": "prompt",
        "requestId": request_id,
        "message": input.message,
        "session": AGENT_RUNTIME_SESSION,
    })
    .to_string();

    let inner = registry.inner.lock().await;
    let runtime =
        inner
            .projects
            .get(&input.project_id)
            .ok_or_else(|| AgentRuntimeError::NotRunning {
                thread_id: input.thread_id.clone(),
            })?;
    let socket =
        runtime
            .threads
            .get(&input.thread_id)
            .ok_or_else(|| AgentRuntimeError::NotRunning {
                thread_id: input.thread_id.clone(),
            })?;

    if socket.session_id != input.session_id {
        return Err(AgentRuntimeError::NotRunning {
            thread_id: input.thread_id,
        });
    }

    socket
        .sender
        .send(frame)
        .map_err(|error| AgentRuntimeError::PromptSendFailed {
            thread_id: input.thread_id.clone(),
            reason: error.to_string(),
        })?;

    Ok(AgentPromptSent {
        project_id: input.project_id,
        session_id: input.session_id,
        thread_id: input.thread_id,
        request_id,
    })
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn stop_agent_thread(
    input: AgentThreadInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<(), AgentRuntimeError> {
    validate_required("project_id", &input.project_id)?;
    validate_required("session_id", &input.session_id)?;
    validate_required("thread_id", &input.thread_id)?;

    let mut runtime_to_stop = None;
    let socket = {
        let mut inner = registry.inner.lock().await;
        let runtime = inner.projects.get_mut(&input.project_id).ok_or_else(|| {
            AgentRuntimeError::NotRunning {
                thread_id: input.thread_id.clone(),
            }
        })?;
        let socket = runtime.threads.remove(&input.thread_id).ok_or_else(|| {
            AgentRuntimeError::NotRunning {
                thread_id: input.thread_id.clone(),
            }
        })?;
        let should_stop_runtime = runtime.threads.is_empty();
        inner.thread_index.remove(&input.thread_id);
        if should_stop_runtime {
            runtime_to_stop = inner.projects.remove(&input.project_id);
        }
        socket
    };

    socket.read_task.abort();
    drop(socket.sender);

    if let Some(runtime) = runtime_to_stop.as_mut() {
        stop_process(&mut runtime.process).await.map_err(|reason| {
            AgentRuntimeError::StopFailed {
                thread_id: input.thread_id,
                reason,
            }
        })?;
    }

    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn stop_agent_runtime(
    project_id: String,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<(), AgentRuntimeError> {
    validate_required("project_id", &project_id)?;

    let mut runtime =
        {
            let mut inner = registry.inner.lock().await;
            let runtime = inner.projects.remove(&project_id).ok_or_else(|| {
                AgentRuntimeError::NotRunning {
                    thread_id: project_id.clone(),
                }
            })?;
            for thread_id in runtime.threads.keys() {
                inner.thread_index.remove(thread_id);
            }
            runtime
        };

    for socket in runtime.threads.into_values() {
        socket.read_task.abort();
        drop(socket.sender);
    }

    stop_process(&mut runtime.process)
        .await
        .map_err(|reason| AgentRuntimeError::StopFailed {
            thread_id: project_id,
            reason,
        })
}

struct RuntimeConnection {
    port: u16,
    token: String,
}

async fn start_project_runtime(
    _project_id: &str,
    project_path: &Path,
) -> Result<ProjectAgentRuntime, AgentRuntimeError> {
    let runtime_dir = resolve_runtime_dir()?;
    let mode = resolve_launch_mode();
    let port = reserve_port()?;
    let token = generate_runtime_token();

    let mut command = Command::new("bun");
    match mode {
        AgentRuntimeLaunchMode::Dev => {
            command.arg("run").arg("dev");
        }
        AgentRuntimeLaunchMode::Built => {
            command.arg("dist/server.mjs");
        }
    }

    command
        .current_dir(&runtime_dir)
        .env("PORT", port.to_string())
        .env("KIRA_AGENT_RUNTIME_TOKEN", &token)
        .env("KIRA_AGENT_PROJECT_PATH", project_path)
        .kill_on_drop(true);

    if let Ok(provider_api_key) = env::var("KIRA_AGENT_PROVIDER_API_KEY") {
        command.env("KIRA_AGENT_PROVIDER_API_KEY", provider_api_key);
    }

    let mut process = command
        .spawn()
        .map_err(|error| AgentRuntimeError::StartFailed {
            reason: format!(
                "failed to spawn Bun in `{}`: {error}",
                runtime_dir.display()
            ),
        })?;

    if let Err(error) = wait_for_health(port).await {
        let _kill_result = process.kill().await;
        return Err(error);
    }

    Ok(ProjectAgentRuntime {
        port,
        token,
        process,
        threads: HashMap::new(),
    })
}

struct AgentThreadSocketConnection<'a> {
    app: &'a AppHandle,
    project_id: &'a str,
    session_id: &'a str,
    thread_id: &'a str,
    port: u16,
    token: &'a str,
}

async fn connect_agent_thread_socket(
    connection: AgentThreadSocketConnection<'_>,
) -> Result<AgentThreadSocket, AgentRuntimeError> {
    let encoded_thread_id = urlencoding::encode(connection.thread_id);
    let encoded_token = urlencoding::encode(connection.token);
    let url = format!(
        "ws://localhost:{}/agents/coding/{encoded_thread_id}?token={encoded_token}",
        connection.port
    );
    let (stream, _response) =
        connect_async(&url)
            .await
            .map_err(|error| AgentRuntimeError::WebSocketConnectFailed {
                thread_id: connection.thread_id.to_string(),
                reason: error.to_string(),
            })?;

    let (mut writer, mut reader) = stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(frame) = receiver.recv().await {
            if writer.send(Message::Text(frame.into())).await.is_err() {
                break;
            }
        }
        let _close_result = writer.close().await;
    });

    let event_app = connection.app.clone();
    let event_project_id = connection.project_id.to_string();
    let event_session_id = connection.session_id.to_string();
    let event_thread_id = connection.thread_id.to_string();
    let read_task = tokio::spawn(async move {
        while let Some(message_result) = reader.next().await {
            match message_result {
                Ok(Message::Text(text)) => {
                    let parsed = serde_json::from_str::<serde_json::Value>(&text)
                        .unwrap_or_else(|_| json!({ "type": "raw", "data": text.to_string() }));
                    let event = AgentThreadEvent {
                        project_id: event_project_id.clone(),
                        session_id: event_session_id.clone(),
                        thread_id: event_thread_id.clone(),
                        message: parsed,
                    };
                    let _emit_result = event_app.emit(AGENT_RUNTIME_EVENT, event);
                }
                Ok(Message::Binary(bytes)) => {
                    let event = AgentThreadEvent {
                        project_id: event_project_id.clone(),
                        session_id: event_session_id.clone(),
                        thread_id: event_thread_id.clone(),
                        message: json!({ "type": "binary", "byteLength": bytes.len() }),
                    };
                    let _emit_result = event_app.emit(AGENT_RUNTIME_EVENT, event);
                }
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_)) => {}
                Err(error) => {
                    let event = AgentThreadEvent {
                        project_id: event_project_id.clone(),
                        session_id: event_session_id.clone(),
                        thread_id: event_thread_id.clone(),
                        message: json!({ "type": "error", "message": error.to_string() }),
                    };
                    let _emit_result = event_app.emit(AGENT_RUNTIME_EVENT, event);
                    break;
                }
            }
        }
    });

    Ok(AgentThreadSocket {
        session_id: connection.session_id.to_string(),
        sender,
        read_task,
    })
}

async fn wait_for_health(port: u16) -> Result<(), AgentRuntimeError> {
    let health_url = format!("http://localhost:{port}/healthz");
    let client = reqwest::Client::new();

    let check = async {
        loop {
            match client.get(&health_url).send().await {
                Ok(response) if response.status().is_success() => {
                    let health = response.json::<HealthResponse>().await.map_err(|error| {
                        AgentRuntimeError::InvalidHealthResponse {
                            port,
                            reason: error.to_string(),
                        }
                    })?;
                    validate_health_response(port, &health)?;
                    return Ok(());
                }
                Ok(response) => {
                    let _status = response.status();
                }
                Err(_error) => {}
            }
            sleep(AGENT_RUNTIME_HEALTH_POLL_INTERVAL).await;
        }
    };

    timeout(AGENT_RUNTIME_HEALTH_TIMEOUT, check)
        .await
        .map_err(|_| AgentRuntimeError::HealthTimeout {
            port,
            timeout_ms: 10_000,
        })?
}

fn validate_health_response(port: u16, health: &HealthResponse) -> Result<(), AgentRuntimeError> {
    if health.status != "ready" {
        return Err(AgentRuntimeError::InvalidHealthResponse {
            port,
            reason: format!("expected status `ready`, got `{}`", health.status),
        });
    }
    if health.package_name != AGENT_RUNTIME_PACKAGE_NAME {
        return Err(AgentRuntimeError::InvalidHealthResponse {
            port,
            reason: format!(
                "expected packageName `{AGENT_RUNTIME_PACKAGE_NAME}`, got `{}`",
                health.package_name
            ),
        });
    }
    if health.runtime != AGENT_RUNTIME_KIND {
        return Err(AgentRuntimeError::InvalidHealthResponse {
            port,
            reason: format!(
                "expected runtime `{AGENT_RUNTIME_KIND}`, got `{}`",
                health.runtime
            ),
        });
    }
    Ok(())
}

fn resolve_runtime_dir() -> Result<PathBuf, AgentRuntimeError> {
    let runtime_dir = if let Ok(path) = env::var("KIRA_AGENT_RUNTIME_DIR") {
        PathBuf::from(path)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent-runtime")
    };

    if !runtime_dir.exists() {
        return Err(AgentRuntimeError::RuntimeDirectoryMissing {
            path: runtime_dir.display().to_string(),
        });
    }
    if !runtime_dir.is_dir() {
        return Err(AgentRuntimeError::RuntimeDirectoryMissing {
            path: runtime_dir.display().to_string(),
        });
    }
    Ok(runtime_dir)
}

fn resolve_launch_mode() -> AgentRuntimeLaunchMode {
    match env::var("KIRA_AGENT_RUNTIME_MODE") {
        Ok(value) if value == "built" => AgentRuntimeLaunchMode::Built,
        Ok(value) if value == "dev" => AgentRuntimeLaunchMode::Dev,
        _ if cfg!(debug_assertions) => AgentRuntimeLaunchMode::Dev,
        _ => AgentRuntimeLaunchMode::Built,
    }
}

fn validate_project_path(project_path: &str) -> Result<PathBuf, AgentRuntimeError> {
    if project_path.trim().is_empty() {
        return Err(AgentRuntimeError::MissingProjectPath);
    }
    let path = PathBuf::from(project_path);
    if !path.exists() {
        return Err(AgentRuntimeError::ProjectPathMissing {
            path: path.display().to_string(),
        });
    }
    if !path.is_dir() {
        return Err(AgentRuntimeError::ProjectPathNotDirectory {
            path: path.display().to_string(),
        });
    }
    Ok(path)
}

fn validate_required(field: &str, value: &str) -> Result<(), AgentRuntimeError> {
    if !value.trim().is_empty() {
        return Ok(());
    }
    match field {
        "project_id" => Err(AgentRuntimeError::MissingProjectId),
        "session_id" => Err(AgentRuntimeError::MissingSessionId),
        "thread_id" => Err(AgentRuntimeError::MissingThreadId),
        _ => Err(AgentRuntimeError::RegistryUnavailable),
    }
}

fn reserve_port() -> Result<u16, AgentRuntimeError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| AgentRuntimeError::ReservePort(error.to_string()))?;
    let address = listener
        .local_addr()
        .map_err(|error| AgentRuntimeError::ReservePort(error.to_string()))?;
    Ok(address.port())
}

fn generate_runtime_token() -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    token
}

async fn stop_process(process: &mut Child) -> Result<(), String> {
    match process.try_wait() {
        Ok(Some(_status)) => Ok(()),
        Ok(None) => process.kill().await.map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    }
}
