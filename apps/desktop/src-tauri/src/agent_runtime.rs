use std::{env, io::Write, net::TcpListener, path::PathBuf, time::Duration};

use axum::{routing::get, Json, Router};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::net::TcpListener as TokioTcpListener;
use tokio::{
    process::{Child as TokioChild, Command},
    sync::Mutex,
    time::{sleep, timeout},
};

use tauri::Manager;

use crate::persistence::PersistenceStore;
use crate::source_control;

const AGENT_RUNTIME_HEALTH_TIMEOUT_MS: u64 = 30_000;
const AGENT_RUNTIME_HEALTH_TIMEOUT: Duration =
    Duration::from_millis(AGENT_RUNTIME_HEALTH_TIMEOUT_MS);
const AGENT_RUNTIME_HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(150);
const AGENT_RUNTIME_PACKAGE_NAME: &str = "@kira/agent-pi";
const AGENT_RUNTIME_KIND: &str = "pi";
const AGENT_RUNTIME_HOST: &str = "127.0.0.1";

#[derive(Default)]
pub struct AgentRuntimeRegistry {
    pub(crate) runtime: Mutex<AgentRuntimeState>,
}

#[derive(Default)]
pub(crate) enum AgentRuntimeState {
    #[default]
    NotStarted,
    Running(Box<AppAgentRuntime>),
    Failed {
        reason: String,
    },
}

/// Holds the child process handle for the agent runtime.
/// Killed explicitly during shutdown.
enum ProcessHandle {
    Dev(Box<TokioChild>),
    Resource(Box<TokioChild>),
}

pub(crate) struct AppAgentRuntime {
    pub(crate) connection: RuntimeConnection,
    process: Option<ProcessHandle>,
}
#[derive(Clone)]
pub(crate) struct RuntimeConnection {
    pub(crate) base_url: String,
    pub(crate) token: String,
}

/// Terminates the agent runtime child process during application shutdown.
///
/// Tauri does not run `Drop` for managed state when the process exits, so the
/// dev-mode child's `kill_on_drop` guard never fires, and the sidecar process
/// also needs explicit cleanup. Without this, the agent runtime keeps running
/// after the desktop app window closes.
pub(crate) fn shutdown(registry: &AgentRuntimeRegistry) {
    let mut state = tauri::async_runtime::block_on(registry.runtime.lock());
    if let AgentRuntimeState::Running(runtime) = &mut *state {
        if let Some(handle) = runtime.process.take() {
            match handle {
                ProcessHandle::Dev(mut child) | ProcessHandle::Resource(mut child) => {
                    let _ = child.start_kill();
                }
            }
        }
    }
    *state = AgentRuntimeState::NotStarted;
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    clippy::struct_field_names,
    reason = "Token usage fields intentionally mirror the frontend and Flue token vocabulary"
)]
struct AgentThreadContextTokenUsage {
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cached_input_tokens: i64,
    cache_write_tokens: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentThreadContextUsageCost {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
    total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadContextUsage {
    used_tokens: i64,
    context_window: i64,
    max_output_tokens: i64,
    model_id: String,
    usage: AgentThreadContextTokenUsage,
    cost: AgentThreadContextUsageCost,
    updated_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct AgentThreadContextUsageRow {
    used_tokens: i64,
    context_window: i64,
    max_output_tokens: i64,
    model_id: String,
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cached_input_tokens: i64,
    cache_write_tokens: i64,
    input_cost: f64,
    output_cost: f64,
    cache_read_cost: f64,
    cache_write_cost: f64,
    total_cost: f64,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentThreadContextUsageInput {
    thread_id: String,
}

impl From<AgentThreadContextUsageRow> for AgentThreadContextUsage {
    fn from(row: AgentThreadContextUsageRow) -> Self {
        Self {
            used_tokens: row.used_tokens,
            context_window: row.context_window,
            max_output_tokens: row.max_output_tokens,
            model_id: row.model_id,
            usage: AgentThreadContextTokenUsage {
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                reasoning_tokens: row.reasoning_tokens,
                cached_input_tokens: row.cached_input_tokens,
                cache_write_tokens: row.cache_write_tokens,
            },
            cost: AgentThreadContextUsageCost {
                input: row.input_cost,
                output: row.output_cost,
                cache_read: row.cache_read_cost,
                cache_write: row.cache_write_cost,
                total: row.total_cost,
            },
            updated_at: row.updated_at,
        }
    }
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
pub struct GenerateAgentThreadTitleInput {
    project_id: String,
    session_id: String,
    thread_id: String,
    prompt: String,
    assistant_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAgentThreadTitleOutput {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCommitMessageInput {
    pub folder_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateCommitMessageOutput {
    commit_message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateCommitMessageError {
    error: String,
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
    #[error("Agent Thread title prompt is required")]
    MissingTitlePrompt,
    #[error("Agent Thread assistant text is required")]
    MissingAssistantText,
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
    #[error("failed to query Agent Thread context usage: {0}")]
    QueryContextUsage(String),
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
    #[error("Failed to register Agent Thread {thread_id} with agent runtime: {reason}")]
    RegisterAgentThread { thread_id: String, reason: String },
    #[error("Failed to generate title for Agent Thread {thread_id}: {reason}")]
    GenerateTitle { thread_id: String, reason: String },
    #[error("Agent runtime is not running. Start the app-scoped agent runtime before preparing an Agent Thread.")]
    NotRunning,
    #[error("Agent runtime startup failed: {reason}")]
    RuntimeStartFailed { reason: String },
    #[error("failed to generate commit message: {reason}")]
    GenerateCommitMessage { reason: String },
    #[error("failed to resolve bundled agent runtime resources: {reason}")]
    ResourceDirMissing { reason: String },
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
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), AgentRuntimeError> {
    let mut runtime_guard = registry.runtime.lock().await;
    match &*runtime_guard {
        AgentRuntimeState::Running(_) => Ok(()),
        AgentRuntimeState::Failed { reason: _ } | AgentRuntimeState::NotStarted => {
            match start_app_runtime(store.inner().clone(), app).await {
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

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn generate_agent_thread_title(
    input: GenerateAgentThreadTitleInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<String, AgentRuntimeError> {
    validate_required_project_id(&input.project_id)?;
    validate_required_session_id(&input.session_id)?;
    validate_required_thread_id(&input.thread_id)?;
    validate_required_prompt(&input.prompt)?;
    validate_required_assistant_text(&input.assistant_text)?;

    let context = load_agent_thread_project_context(
        &store,
        &input.project_id,
        &input.session_id,
        &input.thread_id,
    )
    .await?;
    validate_project_path(&context.project_path)?;

    let connection = runtime_connection(&registry).await?;
    request_agent_thread_title(&connection, &input, &context.project_path).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn generate_commit_message(
    input: GenerateCommitMessageInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<String, AgentRuntimeError> {
    let folder_path = source_control::validate_project_folder(&input.folder_path).map_err(|e| {
        AgentRuntimeError::GenerateCommitMessage {
            reason: e.to_string(),
        }
    })?;

    let staged_diff = source_control::run_git(
        &folder_path,
        "staged diff",
        &["diff", "--cached", "--no-color"],
    )
    .map_err(|e| AgentRuntimeError::GenerateCommitMessage {
        reason: e.to_string(),
    })?;

    let recent_log = source_control::run_git(
        &folder_path,
        "recent log",
        &["log", "--oneline", "-10", "--no-decorate"],
    )
    .map_err(|e| AgentRuntimeError::GenerateCommitMessage {
        reason: e.to_string(),
    })?;

    let connection = runtime_connection(&registry).await?;

    let http_response = reqwest::Client::new()
        .post(format!(
            "{}/app/generate-commit-message",
            connection.base_url
        ))
        .bearer_auth(&connection.token)
        .json(&serde_json::json!({
            "stagedDiff": staged_diff,
            "recentLog": recent_log,
        }))
        .send()
        .await
        .map_err(|error| AgentRuntimeError::GenerateCommitMessage {
            reason: error.to_string(),
        })?;

    let status = http_response.status();

    if !status.is_success() {
        let error_body = http_response
            .json::<GenerateCommitMessageError>()
            .await
            .unwrap_or(GenerateCommitMessageError {
                error: format!("HTTP {status}"),
            });
        return Err(AgentRuntimeError::GenerateCommitMessage {
            reason: error_body.error,
        });
    }

    let output = http_response
        .json::<GenerateCommitMessageOutput>()
        .await
        .map_err(|error| AgentRuntimeError::GenerateCommitMessage {
            reason: format!("failed to parse runtime response: {error}"),
        })?;

    Ok(output.commit_message)
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn agent_thread_context_usage_get(
    input: GetAgentThreadContextUsageInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Option<AgentThreadContextUsage>, AgentRuntimeError> {
    validate_required_thread_id(&input.thread_id)?;

    let row = sqlx::query_as::<_, AgentThreadContextUsageRow>(
        r"
        SELECT used_tokens, context_window, max_output_tokens, model_id,
               input_tokens, output_tokens, reasoning_tokens, cached_input_tokens, cache_write_tokens,
               input_cost, output_cost, cache_read_cost, cache_write_cost, total_cost, updated_at
        FROM agent_thread_context_usage
        WHERE agent_thread_id = ?
        ",
    )
    .bind(input.thread_id)
    .fetch_optional(store.pool())
    .await
    .map_err(|error| AgentRuntimeError::QueryContextUsage(error.to_string()))?;

    Ok(row.map(AgentThreadContextUsage::from))
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

async fn request_agent_thread_title(
    connection: &RuntimeConnection,
    input: &GenerateAgentThreadTitleInput,
    project_path: &str,
) -> Result<String, AgentRuntimeError> {
    let http_response = reqwest::Client::new()
        .post(format!("{}/app/agent-thread-title", connection.base_url))
        .bearer_auth(&connection.token)
        .json(&serde_json::json!({
            "projectPath": project_path,
            "prompt": input.prompt,
            "assistantText": input.assistant_text,
        }))
        .send()
        .await
        .map_err(|error| AgentRuntimeError::GenerateTitle {
            thread_id: input.thread_id.clone(),
            reason: error.to_string(),
        })?;

    if !http_response.status().is_success() {
        return Err(AgentRuntimeError::GenerateTitle {
            thread_id: input.thread_id.clone(),
            reason: format!("runtime returned HTTP {}", http_response.status()),
        });
    }

    let output = http_response
        .json::<GenerateAgentThreadTitleOutput>()
        .await
        .map_err(|error| AgentRuntimeError::GenerateTitle {
            thread_id: input.thread_id.clone(),
            reason: error.to_string(),
        })?;
    Ok(output.title)
}

/// Bundled Skill metadata reported by the agent runtime's `GET /app/skills` route.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledSkill {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
struct BundledSkillsResponse {
    skills: Vec<BundledSkill>,
}

/// Fetches the Bundled Skills compiled into the agent runtime.
///
/// # Errors
///
/// Returns the failure reason when the runtime is not running, is in a failed
/// state, or the `GET /app/skills` request fails. Callers surface this as a
/// degraded Bundled section without failing the whole Skills listing.
pub async fn fetch_bundled_skills(
    registry: &tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<Vec<BundledSkill>, String> {
    let connection = {
        let runtime_guard = registry.runtime.lock().await;
        match &*runtime_guard {
            AgentRuntimeState::Running(runtime) => runtime.connection.clone(),
            AgentRuntimeState::Failed { reason } => return Err(reason.clone()),
            AgentRuntimeState::NotStarted => {
                return Err("Agent runtime is not running.".to_string())
            }
        }
    };

    let response = reqwest::Client::new()
        .get(format!("{}/app/skills", connection.base_url))
        .bearer_auth(&connection.token)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("runtime returned HTTP {}", response.status()));
    }

    let parsed = response
        .json::<BundledSkillsResponse>()
        .await
        .map_err(|error| error.to_string())?;

    Ok(parsed.skills)
}

async fn backend_models_handler(
) -> Result<Json<crate::org_config::ModelCatalog>, crate::org_config::OrgConfigError> {
    crate::org_config::fetch_model_catalog().await.map(Json)
}

fn runtime_base_url(port: u16) -> String {
    format!("http://{AGENT_RUNTIME_HOST}:{port}")
}

#[allow(
    clippy::too_many_lines,
    reason = "Function covers the full launch orchestration: validate, bind backend, spawn agent, await health"
)]
async fn start_app_runtime(
    store: PersistenceStore,
    app_handle: tauri::AppHandle,
) -> Result<AppAgentRuntime, AgentRuntimeError> {
    let mode = resolve_launch_mode();
    let port = reserve_port()?;
    let token = generate_runtime_token();

    // Validate cloud connectivity at startup — fail fast if unreachable
    crate::org_config::fetch_model_catalog()
        .await
        .map_err(|error| AgentRuntimeError::StartFailed {
            reason: format!("failed to fetch organization model catalog: {error}"),
        })?;

    // Start a lightweight Axum server so agent-pi can fetch the model
    // catalog on demand (enables model switching without restarts).
    let backend_port = reserve_port()?;
    let backend_router = Router::new().route("/api/org/models", get(backend_models_handler));
    let backend_listener = TokioTcpListener::bind((AGENT_RUNTIME_HOST, backend_port))
        .await
        .map_err(|error| AgentRuntimeError::StartFailed {
            reason: format!("failed to bind backend server: {error}"),
        })?;
    let backend_actual_port = backend_listener
        .local_addr()
        .map_err(|error| AgentRuntimeError::StartFailed {
            reason: format!("failed to get backend server port: {error}"),
        })?
        .port();
    tokio::spawn(async move {
        axum::serve(backend_listener, backend_router).await.ok();
    });
    let backend_url = format!("http://{AGENT_RUNTIME_HOST}:{backend_actual_port}");

    let process = match mode {
        AgentRuntimeLaunchMode::Dev => {
            let runtime_dir = resolve_runtime_dir()?;
            let mut cmd = Command::new("bun");
            cmd.current_dir(&runtime_dir);
            cmd.arg("run")
                .arg("dev")
                .arg("--")
                .arg("--port")
                .arg(port.to_string());
            cmd.env("HOST", AGENT_RUNTIME_HOST)
                .env("HOSTNAME", AGENT_RUNTIME_HOST)
                .env("PORT", port.to_string())
                .env("KIRA_AGENT_RUNTIME_TOKEN", &token)
                .env("KIRA_AGENT_PI_DATA_DIR", store.app_data_dir())
                .env("KIRA_AGENT_BACKEND_URL", &backend_url)
                .kill_on_drop(true);
            if let Some(shell_path) = crate::settings::agent_shell_path(store.pool()).await {
                cmd.env("KIRA_AGENT_SHELL_PATH", shell_path);
            }
            crate::process_ext::hide_console_window(cmd.as_std_mut());
            ProcessHandle::Dev(Box::new(cmd.spawn().map_err(|error| {
                AgentRuntimeError::StartFailed {
                    reason: format!(
                        "failed to spawn agent runtime from agent-pi directory: {error}",
                    ),
                }
            })?))
        }
        AgentRuntimeLaunchMode::Built => {
            let resource_dir = app_handle.path().resource_dir().map_err(|e| {
                AgentRuntimeError::ResourceDirMissing {
                    reason: format!("failed to resolve resource dir: {e}"),
                }
            })?;
            let pi_package_dir = resource_dir.join("agent-runtime");
            let agent_binary = resource_dir.join("agent-runtime").join("kira-agent-pi");
            let mut cmd = Command::new(&agent_binary);
            cmd.arg("--port")
                .arg(port.to_string())
                .env("HOST", AGENT_RUNTIME_HOST)
                .env("HOSTNAME", AGENT_RUNTIME_HOST)
                .env("PORT", port.to_string())
                .env("KIRA_AGENT_RUNTIME_TOKEN", &token)
                .env("KIRA_AGENT_PI_DATA_DIR", store.app_data_dir())
                .env("KIRA_AGENT_BACKEND_URL", &backend_url)
                .env("PI_PACKAGE_DIR", &pi_package_dir)
                .kill_on_drop(true);
            if let Some(shell_path) = crate::settings::agent_shell_path(store.pool()).await {
                cmd.env("KIRA_AGENT_SHELL_PATH", shell_path);
            }
            crate::process_ext::hide_console_window(cmd.as_std_mut());

            // Capture stderr so we can see startup errors
            cmd.stderr(std::process::Stdio::piped());
            let mut child = cmd.spawn().map_err(|error| {
                AgentRuntimeError::StartFailed {
                    reason: format!("failed to spawn agent runtime binary: {error}"),
                }
            })?;

            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    use tokio::io::AsyncReadExt;
                    let log_path = "/tmp/kira-agent-pi.stderr.log";
                    let mut stderr = stderr;
                    let mut buf = vec![0u8; 4096];
                    loop {
                        match stderr.read(&mut buf).await {
                            Ok(0) => break,
                            Ok(n) => {
                                if let Ok(mut f) = std::fs::OpenOptions::new()
                                    .create(true)
                                    .append(true)
                                    .open(log_path)
                                {
                                    let _ = writeln!(f, "[kira-agent-pi] {}",
                                        String::from_utf8_lossy(&buf[..n]).trim_end());
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }

            ProcessHandle::Resource(Box::new(child))
        }
    };
    if let Err(error) = wait_for_health(port).await {
        match process {
            ProcessHandle::Dev(mut child) | ProcessHandle::Resource(mut child) => {
                let _ = child.start_kill();
            }
        }
        return Err(error);
    }
    Ok(AppAgentRuntime {
        connection: RuntimeConnection {
            base_url: runtime_base_url(port),
            token,
        },
        process: Some(process),
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
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent-pi")
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

fn validate_required_prompt(prompt: &str) -> Result<(), AgentRuntimeError> {
    if prompt.trim().is_empty() {
        return Err(AgentRuntimeError::MissingTitlePrompt);
    }
    Ok(())
}

fn validate_required_assistant_text(assistant_text: &str) -> Result<(), AgentRuntimeError> {
    if assistant_text.trim().is_empty() {
        return Err(AgentRuntimeError::MissingAssistantText);
    }
    Ok(())
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
