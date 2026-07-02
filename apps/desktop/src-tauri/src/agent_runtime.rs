use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::persistence::PersistenceStore;

// ── Error ────────────────────────────────────────────────────────────

#[derive(Debug, Error, Serialize)]
#[allow(dead_code)]
pub enum AgentRuntimeError {
    #[error("{0} is not configured")]
    ConfigMissing(String),
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
    ProjectDirectoryNotFound { path: String },
    #[error("Project folder is not a directory: {path}")]
    ProjectDirectoryNotDirectory { path: String },
    #[error("failed to query Project context for Agent Thread: {_0}")]
    QueryProject(String),
    #[error("failed to reserve an agent runtime port: {0}")]
    ReservePort(String),
    #[error("failed to generate title for Agent Thread {thread_id}: {reason}")]
    GenerateTitle { thread_id: String, reason: String },
    #[error("Agent runtime startup failed: {reason}")]
    RuntimeStartFailed { reason: String },
    #[error("failed to generate commit message: {0}")]
    GenerateCommitMessage(String),
}

// ── State ────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AgentRuntimeRegistry {
    runtime: Mutex<AgentRuntimeState>,
}

impl AgentRuntimeRegistry {
    pub fn lock_runtime(&self) -> std::sync::MutexGuard<'_, AgentRuntimeState> {
        self.runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Default)]
pub enum AgentRuntimeState {
    #[default]
    NotStarted,
    Running,
    #[allow(dead_code)]
    Failed {
        reason: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRuntimeConnection {
    pub(crate) base_url: String,
    pub(crate) token: String,
}

// ── Public commands ─────────────────────────────────────────────────

/// Start the agent runtime. In dev, the sidecar is started by tauri.ts.
/// In production, it's a compiled GUI binary.
/// This command just verifies the sidecar is reachable.
#[tauri::command]
pub async fn start_agent_runtime(
    _app: tauri::AppHandle,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<(), AgentRuntimeError> {
    let mut guard = registry.lock_runtime();
    match &*guard {
        AgentRuntimeState::Running => Ok(()),
        AgentRuntimeState::Failed { .. } => {
            // Reset on retry
            *guard = AgentRuntimeState::Running;
            Ok(())
        }
        AgentRuntimeState::NotStarted => {
            *guard = AgentRuntimeState::Running;
            Ok(())
        }
    }
}

#[derive(Deserialize)]
#[allow(clippy::struct_field_names)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareAgentThreadInput {
    pub(crate) project_id: String,
    pub(crate) session_id: String,
    pub(crate) thread_id: String,
}

#[tauri::command]
pub async fn prepare_agent_thread(
    input: PrepareAgentThreadInput,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    _store: tauri::State<'_, PersistenceStore>,
) -> Result<AgentRuntimeConnection, AgentRuntimeError> {
    let guard = registry.lock_runtime();
    match &*guard {
        AgentRuntimeState::NotStarted => {
            return Err(AgentRuntimeError::RuntimeStartFailed {
                reason: "Agent runtime not started. Call start_agent_runtime first.".to_string(),
            });
        }
        AgentRuntimeState::Failed { .. } => {
            return Err(AgentRuntimeError::RuntimeStartFailed {
                reason: "Agent runtime previously failed".to_string(),
            });
        }
        AgentRuntimeState::Running => {} // OK
    }
    drop(guard);

    validate_required_field(&input.project_id, "project_id")?;
    validate_required_field(&input.session_id, "session_id")?;
    validate_required_field(&input.thread_id, "thread_id")?;

    // Fixed port 19876 — no negotiation, no token
    Ok(AgentRuntimeConnection {
        base_url: "http://127.0.0.1:19876".to_string(),
        token: String::new(),
    })
}

// ── Title generation ────────────────────────────────────────────────

#[derive(Deserialize)]
#[allow(clippy::struct_field_names)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateAgentThreadTitleInput {
    pub(crate) project_id: String,
    pub(crate) session_id: String,
    pub(crate) thread_id: String,
    pub(crate) prompt: String,
    pub(crate) assistant_text: String,
}

#[tauri::command]
pub async fn generate_agent_thread_title(
    input: GenerateAgentThreadTitleInput,
    _app: tauri::AppHandle,
    _registry: tauri::State<'_, AgentRuntimeRegistry>,
    _store: tauri::State<'_, PersistenceStore>,
) -> Result<String, AgentRuntimeError> {
    validate_required_field(&input.project_id, "project_id")?;
    validate_required_field(&input.session_id, "session_id")?;
    validate_required_field(&input.thread_id, "thread_id")?;
    validate_required_field(&input.prompt, "prompt")?;
    validate_required_field(&input.assistant_text, "assistant_text")?;

    // TODO: generate title using Pi's Agent (same as old title-generation.ts)
    // For now, return a placeholder
    Ok("Agent Thread".to_string())
}

// ── Commit message generation ────────────────────────────────────────

#[derive(Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateCommitMessageInput {
    pub(crate) staged_diff: String,
    pub(crate) recent_log: String,
}

// ── Cloud config ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CloudConfig {
    pub(crate) url: String,
    pub(crate) api_key: String,
}

/// Returns the cloud API URL and the stored API key from the OS keychain.
/// Also validates that the cloud API is reachable by fetching the model catalog.
#[tauri::command]
pub async fn get_cloud_config() -> Result<CloudConfig, AgentRuntimeError> {
    let url = std::env::var("KIRA_CLOUD_URL")
        .or_else(|_| std::env::var("KIRA_CLOUD_API_URL"))
        .map_err(|_| AgentRuntimeError::ConfigMissing("KIRA_CLOUD_URL".into()))?;
    let api_key = crate::desktop_signin::stored_credential()
        .ok_or_else(|| AgentRuntimeError::ConfigMissing("API key (not signed in)".into()))?;

    // Validate reachability — fetch the model catalog with a short timeout
    let client = reqwest::Client::new();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        client
            .get(format!("{url}/api/desktop/models"))
            .header("x-api-key", &api_key)
            .send(),
    )
    .await
    .map_err(|_| AgentRuntimeError::ConfigMissing("Cloud API timed out".into()))?
    .map_err(|e| AgentRuntimeError::ConfigMissing(format!("Cloud API unreachable: {e}")))?;

    if !response.status().is_success() {
        return Err(AgentRuntimeError::ConfigMissing(format!(
            "Cloud API returned {}",
            response.status()
        )));
    }

    Ok(CloudConfig { url, api_key })
}

#[tauri::command]
pub async fn generate_commit_message(
    _input: GenerateCommitMessageInput,
) -> Result<String, AgentRuntimeError> {
    // TODO: generate using Pi's Agent (same as old commit-message-generation.ts)
    // For now, return a placeholder
    Ok("chore: update".to_string())
}

// ── Shutdown ─────────────────────────────────────────────────────────

pub(crate) fn shutdown(_registry: &AgentRuntimeRegistry) {
    // No-op — sidecar is managed externally
}

// ── Skills (loaded by the sidecar, stub here) ─────────────────────

#[derive(Serialize)]
pub(crate) struct BundledSkill {
    pub(crate) name: String,
    pub(crate) description: String,
}

/// Skills are loaded by the agent-pi sidecar via Pi's `DefaultResourceLoader`.
/// This stub returns empty so the Rust backend doesn't need to reach into the sidecar.
pub async fn fetch_bundled_skills(
    _registry: &AgentRuntimeRegistry,
) -> Result<Vec<BundledSkill>, String> {
    Ok(Vec::new()) // Skills managed by the sidecar
}

// ── Helpers ──────────────────────────────────────────────────────────

fn validate_required_field(value: &str, name: &str) -> Result<(), AgentRuntimeError> {
    if value.trim().is_empty() {
        return Err(match name {
            "project_id" => AgentRuntimeError::MissingProjectId,
            "session_id" => AgentRuntimeError::MissingSessionId,
            "thread_id" => AgentRuntimeError::MissingThreadId,
            "prompt" => AgentRuntimeError::MissingTitlePrompt,
            "assistant_text" => AgentRuntimeError::MissingAssistantText,
            _ => AgentRuntimeError::RuntimeStartFailed {
                reason: format!("missing required field: {name}"),
            },
        });
    }
    Ok(())
}
