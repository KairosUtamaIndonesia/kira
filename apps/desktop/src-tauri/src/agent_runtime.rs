use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use thiserror::Error;
use tokio::process::{Child, Command};

use crate::persistence::PersistenceStore;

const AGENT_RUNTIME_HOST: &str = "127.0.0.1";
const AGENT_RUNTIME_PORT: u16 = 19876;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(200);

// ── Error ────────────────────────────────────────────────────────────

#[derive(Debug, Error, Serialize)]
pub enum AgentRuntimeError {
    #[error("{0} is not configured")]
    ConfigMissing(String),
    #[error("Agent runtime project id is required")]
    MissingProjectId,
    #[error("Agent runtime session id is required")]
    MissingSessionId,
    #[error("Agent Thread id is required")]
    MissingThreadId,
    #[error("Agent runtime startup failed: {reason}")]
    RuntimeStartFailed { reason: String },
    #[error(
        "Bun runtime not found. Install Bun from https://bun.sh or configure a custom path in Settings."
    )]
    BunNotFound,
    #[error("bundled agent runtime is missing: {path}")]
    RuntimeBundleMissing { path: String },
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
    /// A launch is in flight; concurrent `start_agent_runtime` calls return
    /// immediately instead of racing to spawn a duplicate process.
    Starting,
    /// The runtime is reachable. `process` is `Some` when this app instance
    /// spawned and owns the sidecar (production); `None` when it is managed
    /// externally (dev via `tauri.ts`, or an already-listening process).
    Running {
        process: Option<Box<Child>>,
    },
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

/// Start the agent runtime.
///
/// In dev builds the sidecar is spawned by `scripts/tauri.ts`, so this only
/// records the `Running` state. In production builds this resolves the Bun
/// binary, spawns `bun run <resources>/agent-runtime/server.mjs`, and waits
/// until the sidecar accepts connections on port 19876.
#[tauri::command]
pub async fn start_agent_runtime(
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), AgentRuntimeError> {
    {
        let mut guard = registry.lock_runtime();
        match &*guard {
            AgentRuntimeState::Running { .. } | AgentRuntimeState::Starting => return Ok(()),
            AgentRuntimeState::NotStarted | AgentRuntimeState::Failed { .. } => {
                *guard = AgentRuntimeState::Starting;
            }
        }
    }

    match launch_runtime(&app, &store).await {
        Ok(process) => {
            *registry.lock_runtime() = AgentRuntimeState::Running {
                process: process.map(Box::new),
            };
            Ok(())
        }
        Err(error) => {
            *registry.lock_runtime() = AgentRuntimeState::Failed {
                reason: error.to_string(),
            };
            Err(error)
        }
    }
}

/// Launches the sidecar process for production builds.
///
/// Returns `Ok(None)` when no process needs to be owned by this app instance:
/// dev builds (spawned by `tauri.ts`) or a sidecar already listening on the
/// fixed port (e.g. another app window started it).
async fn launch_runtime(
    app: &tauri::AppHandle,
    store: &PersistenceStore,
) -> Result<Option<Child>, AgentRuntimeError> {
    // Read the primary shell path so the production sidecar receives it, not the
    // Terminal Panel override.  Only the per-child `cmd.env` bridge applies here;
    // dev mode (tauri.ts) must rely on the developer setting KIRA_AGENT_SHELL_PATH
    // manually because tauri.ts spawns the sidecar before Rust code runs.
    let shell_path = crate::settings::primary_shell_path(store.pool()).await;

    if cfg!(debug_assertions) {
        return Ok(None);
    }

    if port_is_open().await {
        return Ok(None);
    }

    let resource_dir =
        app.path()
            .resource_dir()
            .map_err(|error| AgentRuntimeError::RuntimeBundleMissing {
                path: format!("failed to resolve resource dir: {error}"),
            })?;
    let script_path = resource_dir.join("agent-runtime").join("server.mjs");
    if !script_path.is_file() {
        return Err(AgentRuntimeError::RuntimeBundleMissing {
            path: script_path.display().to_string(),
        });
    }

    let bun_path = resolve_bun_path(store).await?;

    let mut cmd = Command::new(&bun_path);
    cmd.arg("run").arg(&script_path);
    // The resource dir can be read-only (Program Files, signed .app bundle);
    // run from the writable app data dir instead.
    cmd.current_dir(store.app_data_dir());
    cmd.env(
        "KIRA_AGENT_PI_DATA_DIR",
        store.app_data_dir().to_string_lossy().as_ref(),
    );
    if let Some(ref path) = shell_path {
        cmd.env("KIRA_AGENT_SHELL_PATH", path);
    }
    cmd.kill_on_drop(true);
    crate::process_ext::hide_console_window(cmd.as_std_mut());

    let mut child = cmd
        .spawn()
        .map_err(|error| AgentRuntimeError::RuntimeStartFailed {
            reason: format!("failed to spawn agent runtime via `{bun_path}`: {error}"),
        })?;

    wait_for_port(&mut child).await?;
    Ok(Some(child))
}

/// Returns true when something already accepts connections on the sidecar port.
async fn port_is_open() -> bool {
    tokio::net::TcpStream::connect((AGENT_RUNTIME_HOST, AGENT_RUNTIME_PORT))
        .await
        .is_ok()
}

/// Polls the sidecar port until it accepts a connection, the child exits
/// early, or the startup timeout elapses.
async fn wait_for_port(child: &mut Child) -> Result<(), AgentRuntimeError> {
    let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
    loop {
        if let Some(status) =
            child
                .try_wait()
                .map_err(|error| AgentRuntimeError::RuntimeStartFailed {
                    reason: format!("failed to poll agent runtime process: {error}"),
                })?
        {
            return Err(AgentRuntimeError::RuntimeStartFailed {
                reason: format!("agent runtime exited during startup ({status})"),
            });
        }
        if port_is_open().await {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            let _ = child.start_kill();
            return Err(AgentRuntimeError::RuntimeStartFailed {
                reason: format!(
                    "timed out waiting for agent runtime to listen on port {AGENT_RUNTIME_PORT}"
                ),
            });
        }
        tokio::time::sleep(STARTUP_POLL_INTERVAL).await;
    }
}

// ── Bun resolution ───────────────────────────────────────────────────

/// Resolves the Bun binary by probing known locations, then verifies it runs.
///
/// Preference order:
/// 1. `KIRA_AGENT_BUN_PATH` env var override (testing/debugging)
/// 2. `SQLite` setting `agentRuntime.bunPath` (user-configured)
/// 3. Official installer location (`~/.bun/bin`)
/// 4. Homebrew paths (macOS) / `%LOCALAPPDATA%\bun\bin` (Windows)
/// 5. `PATH` fallback
async fn resolve_bun_path(store: &PersistenceStore) -> Result<String, AgentRuntimeError> {
    let candidate = resolve_bun_candidate(store).await?;
    validate_bun_executable(&candidate).await?;
    Ok(candidate)
}

async fn resolve_bun_candidate(store: &PersistenceStore) -> Result<String, AgentRuntimeError> {
    if let Ok(path) = env::var("KIRA_AGENT_BUN_PATH") {
        if Path::new(&path).is_file() {
            return Ok(path);
        }
    }

    if let Some(path) = crate::settings::bun_path_get(store.pool()).await {
        if Path::new(&path).is_file() {
            return Ok(path);
        }
    }

    // Official Bun installer: ~/.bun/bin/bun (macOS/Linux) / bun.exe (Windows)
    if let Some(home) = env::var("HOME")
        .ok()
        .or_else(|| env::var("USERPROFILE").ok())
    {
        let bin_dir = Path::new(&home).join(".bun").join("bin");
        for name in ["bun", "bun.exe"] {
            let path = bin_dir.join(name);
            if path.is_file() {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }

    // macOS Homebrew paths
    for path in [
        PathBuf::from("/opt/homebrew/bin/bun"),
        PathBuf::from("/usr/local/bin/bun"),
    ] {
        if path.is_file() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // Windows Local AppData (scoop/manual installs)
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let path = PathBuf::from(local_app_data)
            .join("bun")
            .join("bin")
            .join("bun.exe");
        if path.is_file() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // PATH fallback (terminal-launched / CI)
    if let Some(path) = probe_path_for_bun() {
        return Ok(path.to_string_lossy().to_string());
    }

    Err(AgentRuntimeError::BunNotFound)
}

/// Verifies the candidate actually executes (`bun --version` succeeds).
async fn validate_bun_executable(path: &str) -> Result<(), AgentRuntimeError> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    crate::process_ext::hide_console_window(cmd.as_std_mut());
    let output = cmd
        .output()
        .await
        .map_err(|_| AgentRuntimeError::BunNotFound)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AgentRuntimeError::BunNotFound)
    }
}

/// Searches `PATH` for a `bun` or `bun.exe` executable.
fn probe_path_for_bun() -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths).find_map(|dir| {
            let bun = dir.join("bun");
            if bun.is_file() {
                return Some(bun);
            }
            let bun_exe = dir.join("bun.exe");
            if bun_exe.is_file() {
                return Some(bun_exe);
            }
            None
        })
    })
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
        AgentRuntimeState::Failed { reason } => {
            return Err(AgentRuntimeError::RuntimeStartFailed {
                reason: format!("Agent runtime previously failed: {reason}"),
            });
        }
        AgentRuntimeState::Running { .. } | AgentRuntimeState::Starting => {} // OK
    }
    drop(guard);

    validate_required_field(&input.project_id, "project_id")?;
    validate_required_field(&input.session_id, "session_id")?;
    validate_required_field(&input.thread_id, "thread_id")?;

    // Fixed port — no negotiation, no token
    Ok(AgentRuntimeConnection {
        base_url: format!("http://{AGENT_RUNTIME_HOST}:{AGENT_RUNTIME_PORT}"),
        token: String::new(),
    })
}

// ── Cloud config ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CloudConfig {
    pub(crate) url: String,
    pub(crate) api_key: String,
}

/// Returns the cloud API URL and the stored API key from the OS keychain.
/// Also validates that the cloud API is reachable by fetching the model catalog.
///
/// The cloud URL is resolved in this order:
/// 1. `KIRA_CLOUD_URL` env var (dev override, set by `tauri.ts`)
/// 2. `KIRA_CLOUD_API_URL` env var (legacy alias)
/// 3. Compile-time baked value from `env!("KIRA_CLOUD_URL")` (production builds)
#[tauri::command]
pub async fn get_cloud_config() -> Result<CloudConfig, AgentRuntimeError> {
    let url = std::env::var("KIRA_CLOUD_URL")
        .or_else(|_| std::env::var("KIRA_CLOUD_API_URL"))
        .unwrap_or_else(|_| crate::cloud_api::cloud_base_url().to_string());
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

// ── Shutdown ─────────────────────────────────────────────────────────

pub(crate) fn shutdown(registry: &AgentRuntimeRegistry) {
    let mut guard = registry.lock_runtime();
    if let AgentRuntimeState::Running {
        process: Some(child),
    } = &mut *guard
    {
        let _ = child.start_kill();
    }
    *guard = AgentRuntimeState::NotStarted;
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
            _ => AgentRuntimeError::RuntimeStartFailed {
                reason: format!("missing required field: {name}"),
            },
        });
    }
    Ok(())
}
