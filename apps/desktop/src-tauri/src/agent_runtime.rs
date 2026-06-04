use std::{env, net::TcpListener, path::PathBuf, time::Duration};

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, put},
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::{
    net::TcpListener as TokioTcpListener,
    process::{Child, Command},
    sync::Mutex,
    task::JoinHandle,
    time::{sleep, timeout},
};

use crate::persistence::PersistenceStore;

const AGENT_RUNTIME_HEALTH_TIMEOUT_MS: u64 = 30_000;
const AGENT_RUNTIME_HEALTH_TIMEOUT: Duration =
    Duration::from_millis(AGENT_RUNTIME_HEALTH_TIMEOUT_MS);
const AGENT_RUNTIME_HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(150);
const AGENT_RUNTIME_PACKAGE_NAME: &str = "@kira/agent-runtime";
const AGENT_RUNTIME_KIND: &str = "flue";
const AGENT_RUNTIME_HOST: &str = "127.0.0.1";

#[derive(Default)]
pub struct AgentRuntimeRegistry {
    runtime: Mutex<AgentRuntimeState>,
}

#[derive(Default)]
enum AgentRuntimeState {
    #[default]
    NotStarted,
    Running(Box<AppAgentRuntime>),
    Failed {
        reason: String,
    },
}

struct AppAgentRuntime {
    connection: RuntimeConnection,
    _process: Child,
    _persistence_bridge: JoinHandle<()>,
}

#[derive(Clone)]
struct RuntimeConnection {
    base_url: String,
    token: String,
}

#[derive(Clone)]
struct AgentRuntimePersistenceBridgeState {
    store: PersistenceStore,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFlueSessionStateInput {
    agent_thread_id: String,
    session_data: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadFlueSessionStateOutput {
    session_data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    clippy::struct_field_names,
    reason = "Agent Thread preparation intentionally carries project, session, and thread ids"
)]
pub struct PrepareAgentThreadInput {
    project_id: String,
    session_id: String,
    thread_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeConnection {
    project_id: String,
    session_id: String,
    base_url: String,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    package_name: String,
    runtime: String,
}

#[derive(Debug, sqlx::FromRow)]
struct AgentThreadProjectContext {
    project_id: String,
    session_id: String,
    project_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentRuntimeLaunchMode {
    Dev,
    Built,
}

#[derive(Debug, Error)]
pub enum AgentRuntimeError {
    #[error("Agent runtime project id is required")]
    MissingProjectId,
    #[error("Agent runtime session id is required")]
    MissingSessionId,
    #[error("Agent Thread id is required")]
    MissingThreadId,
    #[error("Project {project_id} with Session {session_id} was not found")]
    ProjectSessionNotFound {
        project_id: String,
        session_id: String,
    },
    #[error("Project folder does not exist: {path}")]
    ProjectPathMissing { path: String },
    #[error("Project folder is not a directory: {path}")]
    ProjectPathNotDirectory { path: String },
    #[error("failed to query Project context for Agent Thread: {0}")]
    QueryProjectContext(String),
    #[error("Agent runtime directory was not found: {path}")]
    RuntimeDirectoryMissing { path: String },
    #[error("failed to reserve an agent runtime port: {0}")]
    ReservePort(String),
    #[error("failed to start agent runtime: {reason}")]
    StartFailed { reason: String },
    #[error("failed to start Agent Thread persistence bridge: {reason}")]
    PersistenceBridgeStart { reason: String },
    #[error("Agent runtime did not become healthy on port {port} within {timeout_ms}ms")]
    HealthTimeout { port: u16, timeout_ms: u64 },
    #[error("Agent runtime returned invalid health response on port {port}: {reason}")]
    InvalidHealthResponse { port: u16, reason: String },
    #[error("Failed to register Agent Thread {thread_id} with agent runtime: {reason}")]
    RegisterAgentThread { thread_id: String, reason: String },
    #[error("Agent runtime is not running. Start the app-scoped agent runtime before preparing an Agent Thread.")]
    NotRunning,
    #[error("Agent runtime startup failed: {reason}")]
    RuntimeStartFailed { reason: String },
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
pub async fn start_agent_runtime(
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), AgentRuntimeError> {
    let mut runtime_guard = registry.runtime.lock().await;
    match &*runtime_guard {
        AgentRuntimeState::Running(_) => Ok(()),
        AgentRuntimeState::Failed { reason: _ } | AgentRuntimeState::NotStarted => {
            match start_app_runtime(store.inner().clone()).await {
                Ok(runtime) => {
                    *runtime_guard = AgentRuntimeState::Running(Box::new(runtime));
                    Ok(())
                }
                Err(error) => {
                    let reason = error.to_string();
                    *runtime_guard = AgentRuntimeState::Failed {
                        reason: reason.clone(),
                    };
                    Err(AgentRuntimeError::RuntimeStartFailed { reason })
                }
            }
        }
    }
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn prepare_agent_thread(
    input: PrepareAgentThreadInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<AgentRuntimeConnection, AgentRuntimeError> {
    validate_required_project_id(&input.project_id)?;
    validate_required_session_id(&input.session_id)?;
    validate_required_thread_id(&input.thread_id)?;

    let context = load_agent_thread_project_context(
        &store,
        &input.project_id,
        &input.session_id,
        &input.thread_id,
    )
    .await?;
    validate_project_path(&context.project_path)?;

    let connection = runtime_connection(&registry).await?;
    register_agent_thread(&connection, &input.thread_id, &context).await?;

    Ok(AgentRuntimeConnection {
        project_id: context.project_id,
        session_id: context.session_id,
        base_url: connection.base_url,
        token: connection.token,
    })
}

async fn load_agent_thread_project_context(
    store: &PersistenceStore,
    project_id: &str,
    session_id: &str,
    thread_id: &str,
) -> Result<AgentThreadProjectContext, AgentRuntimeError> {
    sqlx::query_as::<_, AgentThreadProjectContext>(
        r"
        SELECT projects.id AS project_id, sessions.id AS session_id, projects.folder_path AS project_path
        FROM projects
        INNER JOIN sessions ON sessions.project_id = projects.id
        INNER JOIN agent_threads ON agent_threads.session_id = sessions.id
        WHERE projects.id = ? AND sessions.id = ? AND agent_threads.id = ?
        ",
    )
    .bind(project_id)
    .bind(session_id)
    .bind(thread_id)
    .fetch_optional(store.pool())
    .await
    .map_err(|error| AgentRuntimeError::QueryProjectContext(error.to_string()))?
    .ok_or_else(|| AgentRuntimeError::ProjectSessionNotFound {
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
    })
}

async fn runtime_connection(
    registry: &tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<RuntimeConnection, AgentRuntimeError> {
    let runtime_guard = registry.runtime.lock().await;
    match &*runtime_guard {
        AgentRuntimeState::Running(runtime) => Ok(runtime.connection.clone()),
        AgentRuntimeState::Failed { reason } => Err(AgentRuntimeError::RuntimeStartFailed {
            reason: reason.clone(),
        }),
        AgentRuntimeState::NotStarted => Err(AgentRuntimeError::NotRunning),
    }
}

async fn register_agent_thread(
    connection: &RuntimeConnection,
    thread_id: &str,
    context: &AgentThreadProjectContext,
) -> Result<(), AgentRuntimeError> {
    let response = reqwest::Client::new()
        .post(format!("{}/app/agent-threads", connection.base_url))
        .bearer_auth(&connection.token)
        .json(&serde_json::json!({
            "projectId": context.project_id,
            "sessionId": context.session_id,
            "threadId": thread_id,
            "projectPath": context.project_path,
        }))
        .send()
        .await
        .map_err(|error| AgentRuntimeError::RegisterAgentThread {
            thread_id: thread_id.to_string(),
            reason: error.to_string(),
        })?;

    if !response.status().is_success() {
        return Err(AgentRuntimeError::RegisterAgentThread {
            thread_id: thread_id.to_string(),
            reason: format!("runtime returned HTTP {}", response.status()),
        });
    }

    Ok(())
}

async fn start_persistence_bridge(
    store: PersistenceStore,
    port: u16,
    token: String,
) -> Result<JoinHandle<()>, AgentRuntimeError> {
    let listener = TokioTcpListener::bind((AGENT_RUNTIME_HOST, port))
        .await
        .map_err(|error| AgentRuntimeError::PersistenceBridgeStart {
            reason: error.to_string(),
        })?;
    let state = AgentRuntimePersistenceBridgeState { store, token };
    let router = Router::new()
        .route("/flue-sessions/{storage_key}", get(load_flue_session_state))
        .route("/flue-sessions/{storage_key}", put(save_flue_session_state))
        .route(
            "/flue-sessions/{storage_key}",
            delete(delete_flue_session_state),
        )
        .with_state(state);

    Ok(tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("Agent Thread persistence bridge stopped: {error}");
        }
    }))
}

async fn save_flue_session_state(
    State(state): State<AgentRuntimePersistenceBridgeState>,
    headers: HeaderMap,
    Path(storage_key): Path<String>,
    Json(input): Json<SaveFlueSessionStateInput>,
) -> Result<StatusCode, (StatusCode, String)> {
    authorize_bridge_request(&headers, &state.token)?;
    let now = current_bridge_timestamp()?;
    let session_data_json = serde_json::to_string(&input.session_data)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    sqlx::query("INSERT INTO flue_agent_session_state (storage_key, agent_thread_id, session_data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(storage_key) DO UPDATE SET agent_thread_id = excluded.agent_thread_id, session_data_json = excluded.session_data_json, updated_at = excluded.updated_at")
        .bind(storage_key)
        .bind(input.agent_thread_id)
        .bind(session_data_json)
        .bind(&now)
        .bind(&now)
        .execute(state.store.pool())
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn load_flue_session_state(
    State(state): State<AgentRuntimePersistenceBridgeState>,
    headers: HeaderMap,
    Path(storage_key): Path<String>,
) -> Result<Json<Option<LoadFlueSessionStateOutput>>, (StatusCode, String)> {
    authorize_bridge_request(&headers, &state.token)?;
    let session_data_json = sqlx::query_scalar::<_, String>(
        "SELECT session_data_json FROM flue_agent_session_state WHERE storage_key = ?",
    )
    .bind(storage_key)
    .fetch_optional(state.store.pool())
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    match session_data_json {
        Some(value) => {
            let session_data = serde_json::from_str(&value)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            Ok(Json(Some(LoadFlueSessionStateOutput { session_data })))
        }
        None => Ok(Json(None)),
    }
}

async fn delete_flue_session_state(
    State(state): State<AgentRuntimePersistenceBridgeState>,
    headers: HeaderMap,
    Path(storage_key): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    authorize_bridge_request(&headers, &state.token)?;
    sqlx::query("DELETE FROM flue_agent_session_state WHERE storage_key = ?")
        .bind(storage_key)
        .execute(state.store.pool())
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

fn authorize_bridge_request(headers: &HeaderMap, token: &str) -> Result<(), (StatusCode, String)> {
    let Some(value) = headers.get("authorization") else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "authorization header is required".to_string(),
        ));
    };
    let Ok(value) = value.to_str() else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "authorization header is invalid".to_string(),
        ));
    };
    if value != format!("Bearer {token}") {
        return Err((
            StatusCode::UNAUTHORIZED,
            "authorization token is invalid".to_string(),
        ));
    }
    Ok(())
}

fn current_bridge_timestamp() -> Result<String, (StatusCode, String)> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn runtime_base_url(port: u16) -> String {
    format!("http://{AGENT_RUNTIME_HOST}:{port}")
}

async fn start_app_runtime(store: PersistenceStore) -> Result<AppAgentRuntime, AgentRuntimeError> {
    let runtime_dir = resolve_runtime_dir()?;
    let mode = resolve_launch_mode();
    let port = reserve_port()?;
    let token = generate_runtime_token();
    let bridge_token = generate_runtime_token();
    let bridge_port = reserve_port()?;
    let persistence_bridge =
        start_persistence_bridge(store, bridge_port, bridge_token.clone()).await?;

    let mut command = Command::new("bun");
    match mode {
        AgentRuntimeLaunchMode::Dev => {
            command
                .arg("run")
                .arg("dev")
                .arg("--")
                .arg("--port")
                .arg(port.to_string());
        }
        AgentRuntimeLaunchMode::Built => {
            command.arg("dist/server.mjs");
        }
    }

    command
        .current_dir(&runtime_dir)
        .env("HOST", AGENT_RUNTIME_HOST)
        .env("HOSTNAME", AGENT_RUNTIME_HOST)
        .env("PORT", port.to_string())
        .env("KIRA_AGENT_RUNTIME_TOKEN", &token)
        .env(
            "KIRA_AGENT_PERSISTENCE_BRIDGE_URL",
            runtime_base_url(bridge_port),
        )
        .env("KIRA_AGENT_PERSISTENCE_BRIDGE_TOKEN", bridge_token)
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
        persistence_bridge.abort();
        return Err(error);
    }

    Ok(AppAgentRuntime {
        connection: RuntimeConnection {
            base_url: runtime_base_url(port),
            token,
        },
        _process: process,
        _persistence_bridge: persistence_bridge,
    })
}

async fn wait_for_health(port: u16) -> Result<(), AgentRuntimeError> {
    let health_url = format!("http://{AGENT_RUNTIME_HOST}:{port}/healthz");
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
                Ok(_response) => {}
                Err(_error) => {}
            }
            sleep(AGENT_RUNTIME_HEALTH_POLL_INTERVAL).await;
        }
    };

    timeout(AGENT_RUNTIME_HEALTH_TIMEOUT, check)
        .await
        .map_err(|_| AgentRuntimeError::HealthTimeout {
            port,
            timeout_ms: AGENT_RUNTIME_HEALTH_TIMEOUT_MS,
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

fn validate_project_path(project_path: &str) -> Result<(), AgentRuntimeError> {
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
    Ok(())
}

fn validate_required_project_id(project_id: &str) -> Result<(), AgentRuntimeError> {
    if project_id.trim().is_empty() {
        return Err(AgentRuntimeError::MissingProjectId);
    }
    Ok(())
}

fn validate_required_session_id(session_id: &str) -> Result<(), AgentRuntimeError> {
    if session_id.trim().is_empty() {
        return Err(AgentRuntimeError::MissingSessionId);
    }
    Ok(())
}

fn validate_required_thread_id(thread_id: &str) -> Result<(), AgentRuntimeError> {
    if thread_id.trim().is_empty() {
        return Err(AgentRuntimeError::MissingThreadId);
    }
    Ok(())
}

fn reserve_port() -> Result<u16, AgentRuntimeError> {
    let listener = TcpListener::bind((AGENT_RUNTIME_HOST, 0))
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
