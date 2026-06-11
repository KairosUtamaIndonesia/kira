use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, FromRow, Row, SqlitePool};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::persistence::PersistenceStore;

const DEFAULT_SESSION_NAME: &str = "Default";
const HEX_DIGITS: [char; 16] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    name: String,
    folder_path: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    folder_path: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    project_id: String,
    name: String,
    root_kind: SessionRootKind,
    worktree_path: Option<String>,
    branch_name: Option<String>,
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
    layout_json: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum SessionRootKind {
    ProjectFolder,
    Worktree,
}

const SESSION_SELECT_PROJECT: &str =
    "SELECT id, project_id, name, root_kind, worktree_path, branch_name, created_at, updated_at, last_opened_at, layout_json FROM sessions WHERE project_id = ? ORDER BY COALESCE(last_opened_at, created_at) DESC";
const SESSION_SELECT_LAST_PROJECT: &str =
    "SELECT id, project_id, name, root_kind, worktree_path, branch_name, created_at, updated_at, last_opened_at, layout_json FROM sessions WHERE project_id = ? ORDER BY COALESCE(last_opened_at, created_at) DESC LIMIT 1";
const SESSION_SELECT_BY_PROJECT_AND_ID: &str =
    "SELECT id, project_id, name, root_kind, worktree_path, branch_name, created_at, updated_at, last_opened_at, layout_json FROM sessions WHERE project_id = ? AND id = ?";
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    project: Project,
    default_session: Session,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInput {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectSessionsInput {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectSessionInput {
    project_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectSessionInput {
    project_id: String,
    name: String,
    root: CreateSessionRootInput,
}

#[derive(Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum CreateSessionRootInput {
    ProjectFolder,
    Worktree {
        project_slug: String,
        worktree_slug: String,
        branch: CreateWorktreeBranchInput,
    },
}

#[derive(Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum CreateWorktreeBranchInput {
    New { name: String },
    Existing { name: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectSessionInput {
    project_id: String,
    session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProject {
    project: Project,
    session: Session,
    panels: Vec<WorkspacePanel>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePanel {
    id: String,
    session_id: String,
    kind: String,
    title: String,
    position_index: i64,
    created_at: String,
    updated_at: String,
    terminal_state: Option<TerminalPanelState>,
    source_control_diff_state: Option<SourceControlDiffPanelState>,
    file_editor_state: Option<FileEditorPanelState>,
    agent_thread_state: Option<AgentThreadPanelState>,
    browser_state: Option<BrowserPanelState>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadPanelState {
    thread_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPanelState {
    working_directory: String,
    shell: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlDiffPanelState {
    folder_path: String,
    file_path: String,
    old_path: Option<String>,
    source: SourceControlDiffSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEditorPanelState {
    folder_path: String,
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPanelState {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBrowserPanelInput {
    session_id: String,
    title: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBrowserPanelUrlInput {
    panel_id: String,
    url: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceControlDiffSource {
    Staged,
    Unstaged,
    Untracked,
}

impl SourceControlDiffSource {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Staged => "staged",
            Self::Unstaged => "unstaged",
            Self::Untracked => "untracked",
        }
    }

    fn from_database(value: &str) -> Result<Self, ProjectError> {
        match value {
            "staged" => Ok(Self::Staged),
            "unstaged" => Ok(Self::Unstaged),
            "untracked" => Ok(Self::Untracked),
            _ => Err(ProjectError::InvalidSourceControlDiffSource(
                value.to_string(),
            )),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalPanelInput {
    session_id: String,
    title: String,
    working_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentThreadPanelInput {
    session_id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSourceControlDiffPanelInput {
    session_id: String,
    title: String,
    folder_path: String,
    file_path: String,
    old_path: Option<String>,
    source: SourceControlDiffSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileEditorPanelInput {
    session_id: String,
    title: String,
    folder_path: String,
    file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkspacePanelInput {
    panel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspacePanelInput {
    panel_id: String,
    title: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    terminal_id: String,
    sequence: i64,
    serialized: String,
    cols: i64,
    rows: i64,
    captured_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTerminalSnapshotInput {
    terminal_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTerminalSnapshotInput {
    terminal_id: String,
    sequence: i64,
    serialized: String,
    cols: i64,
    rows: i64,
    captured_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTerminalSnapshotInput {
    terminal_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProjectInput {
    project_id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectInput {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionLayoutInput {
    session_id: String,
    layout_json: String,
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("project name is required")]
    MissingName,
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("project folder is already added to Kira: {0}")]
    DuplicateFolder(String),
    #[error("project was not found: {0}")]
    MissingProject(String),
    #[error("project has no sessions: {0}")]
    MissingSession(String),
    #[error("session name is required")]
    MissingSessionName,
    #[error("session was not found: {0}")]
    MissingProjectSession(String),
    #[error("default session cannot be deleted")]
    CannotDeleteDefaultSession,
    #[error("session worktree slug is required")]
    MissingWorktreeSlug,
    #[error("session branch name is required")]
    MissingBranchName,
    #[error(
        "session worktree slug `{0}` must contain only lowercase letters, numbers, and hyphens"
    )]
    InvalidWorktreeSlug(String),
    #[error("session worktree already exists: {0}")]
    WorktreeAlreadyExists(String),
    #[error("session worktree path is missing for session: {0}")]
    MissingWorktreePath(String),
    #[error("session worktree has uncommitted changes: {0}")]
    DirtyWorktree(String),
    #[error("failed to create session worktree directory `{path}`: {message}")]
    CreateWorktreeDirectory { path: String, message: String },
    #[error("failed to remove session worktree `{path}`: {message}")]
    RemoveWorktree { path: String, message: String },
    #[error("failed to run git {operation}: {message}")]
    GitCommand { operation: String, message: String },
    #[error("workspace panel title is required")]
    MissingPanelTitle,
    #[error("workspace panel was not found: {0}")]
    MissingWorkspacePanel(String),
    #[error("source control diff file path is required")]
    MissingSourceControlDiffFilePath,
    #[error("file editor file path is required")]
    MissingFileEditorFilePath,
    #[error("browser panel url is required")]
    MissingBrowserUrl,
    #[error("source control diff source is invalid: {0}")]
    InvalidSourceControlDiffSource(String),
    #[error("workspace panel kind `{kind}` is missing required state for panel {panel_id}")]
    MissingWorkspacePanelState { kind: String, panel_id: String },
    #[error("terminal snapshot id is required")]
    MissingTerminalSnapshotId,
    #[error("terminal snapshot payload is required")]
    MissingTerminalSnapshotPayload,
    #[error("terminal snapshot sequence must be at least 0, got {0}")]
    InvalidTerminalSnapshotSequence(i64),
    #[error("terminal snapshot size must be at least 1 row and 1 column, got {rows} rows and {cols} columns")]
    InvalidTerminalSnapshotSize { rows: i64, cols: i64 },
    #[error("failed to generate project timestamp: {0}")]
    Timestamp(String),
    #[error("failed to query projects: {0}")]
    Query(String),
    #[error("failed to create project: {0}")]
    Create(String),
    #[error("failed to update project: {0}")]
    Update(String),
}

impl serde::Serialize for ProjectError {
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
pub async fn project_list(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Vec<Project>, ProjectError> {
    list_projects(store.pool()).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_create(
    input: CreateProjectInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<CreatedProject, ProjectError> {
    create_project(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_open(
    input: OpenProjectInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<OpenProject, ProjectError> {
    open_project(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_open_last(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Option<OpenProject>, ProjectError> {
    open_last_project(store.pool()).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_sessions_list(
    input: ListProjectSessionsInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Vec<Session>, ProjectError> {
    list_project_sessions(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_session_open(
    input: OpenProjectSessionInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<OpenProject, ProjectError> {
    open_project_session(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_session_create(
    input: CreateProjectSessionInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Session, ProjectError> {
    create_project_session(store.pool(), store.app_data_dir(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_session_delete(
    input: DeleteProjectSessionInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    delete_project_session(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_rename(
    input: RenameProjectInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Project, ProjectError> {
    let name = validate_name(&input.name)?;
    let now = current_timestamp()?;
    sqlx::query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&now)
        .bind(&input.project_id)
        .execute(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    sqlx::query_as::<_, Project>(
        "SELECT id, name, folder_path, created_at, updated_at FROM projects WHERE id = ?",
    )
    .bind(&input.project_id)
    .fetch_optional(store.pool())
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?
    .ok_or(ProjectError::MissingProject(input.project_id))
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn project_remove(
    input: RemoveProjectInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    let project = ensure_project_exists(store.pool(), &input.project_id).await?;
    let sessions = sqlx::query_as::<_, Session>(SESSION_SELECT_PROJECT)
        .bind(&input.project_id)
        .fetch_all(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;

    for session in sessions {
        if session.root_kind == SessionRootKind::Worktree {
            let worktree_path = session
                .worktree_path
                .as_deref()
                .ok_or_else(|| ProjectError::MissingWorktreePath(session.id.clone()))?;
            remove_clean_session_worktree(&project.folder_path, worktree_path)?;
        }
    }

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(input.project_id)
        .execute(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_terminal_panel_create(
    input: CreateTerminalPanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    create_terminal_panel(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_agent_thread_panel_create(
    input: CreateAgentThreadPanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    create_agent_thread_panel(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_source_control_diff_panel_open(
    input: OpenSourceControlDiffPanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    open_source_control_diff_panel(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_file_editor_panel_open(
    input: OpenFileEditorPanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    open_file_editor_panel(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_browser_panel_create(
    input: CreateBrowserPanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    create_browser_panel(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_browser_panel_url_update(
    input: UpdateBrowserPanelUrlInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    update_browser_panel_url(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn session_layout_update(
    input: UpdateSessionLayoutInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    sqlx::query("UPDATE sessions SET layout_json = ?, updated_at = ? WHERE id = ?")
        .bind(input.layout_json)
        .bind(current_timestamp()?)
        .bind(input.session_id)
        .execute(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_panel_rename(
    input: RenameWorkspacePanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let now = current_timestamp()?;

    let mut transaction = store
        .pool()
        .begin()
        .await
        .map_err(|error| ProjectError::Update(error.to_string()))?;

    sqlx::query("UPDATE workspace_panels SET title = ?, updated_at = ? WHERE id = ?")
        .bind(&title)
        .bind(&now)
        .bind(&input.panel_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;

    sqlx::query(
        "UPDATE agent_threads SET title = ?, updated_at = ? WHERE id = (
            SELECT thread_id FROM agent_thread_panel_state WHERE panel_id = ?
        )",
    )
    .bind(&title)
    .bind(&now)
    .bind(&input.panel_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Update(error.to_string()))?;

    get_workspace_panel(store.pool(), &input.panel_id)
        .await?
        .ok_or(ProjectError::MissingWorkspacePanel(input.panel_id))
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_panel_delete(
    input: DeleteWorkspacePanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    let thread_id = sqlx::query_scalar::<_, String>(
        "SELECT thread_id FROM agent_thread_panel_state WHERE panel_id = ?",
    )
    .bind(&input.panel_id)
    .fetch_optional(store.pool())
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = store
        .pool()
        .begin()
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    sqlx::query("DELETE FROM workspace_panels WHERE id = ?")
        .bind(&input.panel_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    if let Some(thread_id) = thread_id {
        sqlx::query("DELETE FROM agent_threads WHERE id = ?")
            .bind(thread_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ProjectError::Query(error.to_string()))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_terminal_snapshot_get(
    input: GetTerminalSnapshotInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Option<TerminalSnapshot>, ProjectError> {
    let terminal_id = validate_terminal_snapshot_id(&input.terminal_id)?;
    sqlx::query_as::<_, TerminalSnapshot>(
        "SELECT terminal_id, sequence, serialized, cols, rows, captured_at, updated_at FROM terminal_snapshots WHERE terminal_id = ?",
    )
    .bind(terminal_id)

    .fetch_optional(store.pool())
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))
}

async fn create_project_session(
    pool: &SqlitePool,
    app_data_dir: &Path,
    input: CreateProjectSessionInput,
) -> Result<Session, ProjectError> {
    let project = ensure_project_exists(pool, &input.project_id).await?;
    let name = validate_session_name(&input.name)?;
    let session_id = Uuid::new_v4().to_string();
    let now = current_timestamp()?;

    let root = match input.root {
        CreateSessionRootInput::ProjectFolder => CreatedSessionRoot {
            kind: SessionRootKind::ProjectFolder,
            worktree_path: None,
            branch_name: None,
        },
        CreateSessionRootInput::Worktree {
            project_slug,
            worktree_slug,
            branch,
        } => create_session_worktree(
            app_data_dir,
            &project,
            &project_slug,
            &worktree_slug,
            &branch,
        )?,
    };

    sqlx::query(
        "INSERT INTO sessions (id, project_id, name, root_kind, worktree_path, branch_name, created_at, updated_at, last_opened_at, layout_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
    )
    .bind(&session_id)
    .bind(&input.project_id)
    .bind(&name)
    .bind(root.kind)
    .bind(&root.worktree_path)
    .bind(&root.branch_name)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(Session {
        id: session_id,
        project_id: input.project_id,
        name,
        root_kind: root.kind,
        worktree_path: root.worktree_path,
        branch_name: root.branch_name,
        created_at: now.clone(),
        updated_at: now,
        last_opened_at: None,
        layout_json: None,
    })
}

async fn delete_project_session(
    pool: &SqlitePool,
    input: DeleteProjectSessionInput,
) -> Result<(), ProjectError> {
    let project = ensure_project_exists(pool, &input.project_id).await?;
    let session = sqlx::query_as::<_, Session>(SESSION_SELECT_BY_PROJECT_AND_ID)
        .bind(&input.project_id)
        .bind(&input.session_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?
        .ok_or_else(|| ProjectError::MissingProjectSession(input.session_id.clone()))?;

    if session.name == DEFAULT_SESSION_NAME {
        return Err(ProjectError::CannotDeleteDefaultSession);
    }

    if session.root_kind == SessionRootKind::Worktree {
        let worktree_path = session
            .worktree_path
            .as_deref()
            .ok_or_else(|| ProjectError::MissingWorktreePath(session.id.clone()))?;
        remove_clean_session_worktree(&project.folder_path, worktree_path)?;
    }

    sqlx::query("DELETE FROM sessions WHERE project_id = ? AND id = ?")
        .bind(input.project_id)
        .bind(input.session_id)
        .execute(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_terminal_snapshot_save(
    input: SaveTerminalSnapshotInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<TerminalSnapshot, ProjectError> {
    let terminal_id = validate_terminal_snapshot_id(&input.terminal_id)?;
    let serialized = validate_terminal_snapshot_payload(&input.serialized)?;
    validate_terminal_snapshot_sequence(input.sequence)?;
    validate_terminal_snapshot_size(input.rows, input.cols)?;
    let now = current_timestamp()?;

    sqlx::query("INSERT INTO terminal_snapshots (terminal_id, sequence, serialized, cols, rows, captured_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET sequence = excluded.sequence, serialized = excluded.serialized, cols = excluded.cols, rows = excluded.rows, captured_at = excluded.captured_at, updated_at = excluded.updated_at")
        .bind(&terminal_id)
        .bind(input.sequence)
        .bind(&serialized)
        .bind(input.cols)
        .bind(input.rows)
        .bind(&input.captured_at)
        .bind(&now)
        .execute(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;

    Ok(TerminalSnapshot {
        terminal_id,
        sequence: input.sequence,
        serialized,
        cols: input.cols,
        rows: input.rows,
        captured_at: input.captured_at,
        updated_at: now,
    })
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn workspace_terminal_snapshot_delete(
    input: DeleteTerminalSnapshotInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    let terminal_id = validate_terminal_snapshot_id(&input.terminal_id)?;
    sqlx::query("DELETE FROM terminal_snapshots WHERE terminal_id = ?")
        .bind(terminal_id)
        .execute(store.pool())
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    Ok(())
}

async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, ProjectError> {
    sqlx::query_as::<_, Project>(
        "SELECT id, name, folder_path, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))
}

async fn open_last_project(pool: &SqlitePool) -> Result<Option<OpenProject>, ProjectError> {
    let project_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM projects WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    match project_id {
        Some(project_id) => open_project(pool, OpenProjectInput { project_id })
            .await
            .map(Some),
        None => Ok(None),
    }
}

async fn list_project_sessions(
    pool: &SqlitePool,
    input: ListProjectSessionsInput,
) -> Result<Vec<Session>, ProjectError> {
    ensure_project_exists(pool, &input.project_id).await?;
    sqlx::query_as::<_, Session>(SESSION_SELECT_PROJECT)
        .bind(input.project_id)
        .fetch_all(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))
}

async fn open_project(
    pool: &SqlitePool,
    input: OpenProjectInput,
) -> Result<OpenProject, ProjectError> {
    let session = sqlx::query_as::<_, Session>(SESSION_SELECT_LAST_PROJECT)
        .bind(&input.project_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?
        .ok_or_else(|| ProjectError::MissingSession(input.project_id.clone()))?;

    open_project_with_session(pool, &input.project_id, session).await
}

async fn open_project_session(
    pool: &SqlitePool,
    input: OpenProjectSessionInput,
) -> Result<OpenProject, ProjectError> {
    let session = sqlx::query_as::<_, Session>(SESSION_SELECT_BY_PROJECT_AND_ID)
        .bind(&input.project_id)
        .bind(&input.session_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?
        .ok_or(ProjectError::MissingSession(input.project_id.clone()))?;

    open_project_with_session(pool, &input.project_id, session).await
}

async fn open_project_with_session(
    pool: &SqlitePool,
    project_id: &str,
    session: Session,
) -> Result<OpenProject, ProjectError> {
    let project = ensure_project_exists(pool, project_id).await?;
    let panels = list_workspace_panels(pool, &session.id).await?;
    let now = current_timestamp()?;

    sqlx::query("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&project.id)
        .execute(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    sqlx::query("UPDATE sessions SET last_opened_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&session.id)
        .execute(pool)
        .await
        .map_err(|error| ProjectError::Query(error.to_string()))?;

    Ok(OpenProject {
        project,
        session,
        panels,
    })
}

async fn ensure_project_exists(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Project, ProjectError> {
    sqlx::query_as::<_, Project>(
        "SELECT id, name, folder_path, created_at, updated_at FROM projects WHERE id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?
    .ok_or_else(|| ProjectError::MissingProject(project_id.to_string()))
}

async fn list_workspace_panels(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<WorkspacePanel>, ProjectError> {
    let rows = sqlx::query(
        "SELECT workspace_panels.id, workspace_panels.session_id, workspace_panels.kind, workspace_panels.title, workspace_panels.position_index, workspace_panels.created_at, workspace_panels.updated_at, terminal_panel_state.working_directory, terminal_panel_state.shell, source_control_diff_panel_state.folder_path AS diff_folder_path, source_control_diff_panel_state.file_path AS diff_file_path, source_control_diff_panel_state.old_path AS diff_old_path, source_control_diff_panel_state.source AS diff_source, file_editor_panel_state.folder_path AS editor_folder_path, file_editor_panel_state.file_path AS editor_file_path, agent_thread_panel_state.thread_id AS agent_thread_id, browser_panel_state.url AS browser_url FROM workspace_panels LEFT JOIN terminal_panel_state ON terminal_panel_state.panel_id = workspace_panels.id LEFT JOIN source_control_diff_panel_state ON source_control_diff_panel_state.panel_id = workspace_panels.id LEFT JOIN file_editor_panel_state ON file_editor_panel_state.panel_id = workspace_panels.id LEFT JOIN agent_thread_panel_state ON agent_thread_panel_state.panel_id = workspace_panels.id LEFT JOIN browser_panel_state ON browser_panel_state.panel_id = workspace_panels.id WHERE workspace_panels.session_id = ? ORDER BY workspace_panels.position_index ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    rows.iter().map(workspace_panel_from_row).collect()
}

fn panel_column<'r, T>(row: &'r SqliteRow, column: &str) -> Result<T, ProjectError>
where
    T: sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    row.try_get(column)
        .map_err(|error| ProjectError::Query(error.to_string()))
}

fn workspace_panel_from_row(row: &SqliteRow) -> Result<WorkspacePanel, ProjectError> {
    let id: String = panel_column(row, "id")?;
    let kind: String = panel_column(row, "kind")?;
    let working_directory: Option<String> = panel_column(row, "working_directory")?;
    let shell: Option<String> = panel_column(row, "shell")?;
    let diff_folder_path: Option<String> = panel_column(row, "diff_folder_path")?;
    let diff_file_path: Option<String> = panel_column(row, "diff_file_path")?;
    let diff_old_path: Option<String> = panel_column(row, "diff_old_path")?;
    let diff_source: Option<String> = panel_column(row, "diff_source")?;
    let editor_folder_path: Option<String> = panel_column(row, "editor_folder_path")?;
    let editor_file_path: Option<String> = panel_column(row, "editor_file_path")?;
    let agent_thread_id: Option<String> = panel_column(row, "agent_thread_id")?;
    let browser_url: Option<String> = panel_column(row, "browser_url")?;

    let terminal_state = match (kind.as_str(), working_directory) {
        ("terminal", Some(working_directory)) => Some(TerminalPanelState {
            working_directory,
            shell,
        }),
        ("terminal", None) => {
            return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id })
        }
        _ => None,
    };

    let source_control_diff_state =
        match (kind.as_str(), diff_folder_path, diff_file_path, diff_source) {
            ("source_control_diff", Some(folder_path), Some(file_path), Some(source)) => {
                Some(SourceControlDiffPanelState {
                    folder_path,
                    file_path,
                    old_path: diff_old_path,
                    source: SourceControlDiffSource::from_database(&source)?,
                })
            }
            ("source_control_diff", _, _, _) => {
                return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id })
            }
            _ => None,
        };

    let file_editor_state = match (kind.as_str(), editor_folder_path, editor_file_path) {
        ("file_editor", Some(folder_path), Some(file_path)) => Some(FileEditorPanelState {
            folder_path,
            file_path,
        }),
        ("file_editor", _, _) => {
            return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id })
        }
        _ => None,
    };

    let agent_thread_state = match (kind.as_str(), agent_thread_id) {
        ("agent_thread", Some(thread_id)) => Some(AgentThreadPanelState { thread_id }),
        ("agent_thread", None) => {
            return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id })
        }
        _ => None,
    };

    let browser_state = match (kind.as_str(), browser_url) {
        ("browser", Some(url)) => Some(BrowserPanelState { url }),
        ("browser", None) => {
            return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id })
        }
        _ => None,
    };

    Ok(WorkspacePanel {
        id,
        session_id: panel_column(row, "session_id")?,
        kind,
        title: panel_column(row, "title")?,
        position_index: panel_column(row, "position_index")?,
        created_at: panel_column(row, "created_at")?,
        updated_at: panel_column(row, "updated_at")?,
        terminal_state,
        source_control_diff_state,
        file_editor_state,
        agent_thread_state,
        browser_state,
    })
}

async fn create_terminal_panel(
    pool: &SqlitePool,
    input: CreateTerminalPanelInput,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let working_directory = validate_folder_path(&input.working_directory)?;
    let panel_id = Uuid::new_v4().to_string();
    let now = current_timestamp()?;
    let position_index = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position_index), -1) + 1 FROM workspace_panels WHERE session_id = ?",
    )
    .bind(&input.session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO workspace_panels (id, session_id, kind, title, position_index, created_at, updated_at) VALUES (?, ?, 'terminal', ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(position_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query(
        "INSERT INTO terminal_panel_state (panel_id, working_directory, shell) VALUES (?, ?, ?)",
    )
    .bind(&panel_id)
    .bind(&working_directory)
    .bind(Option::<String>::None)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(WorkspacePanel {
        id: panel_id,
        session_id: input.session_id,
        kind: "terminal".to_string(),
        title,
        position_index,
        created_at: now.clone(),
        updated_at: now,
        terminal_state: Some(TerminalPanelState {
            working_directory,
            shell: None,
        }),
        source_control_diff_state: None,
        file_editor_state: None,
        agent_thread_state: None,
        browser_state: None,
    })
}

async fn create_agent_thread_panel(
    pool: &SqlitePool,
    input: CreateAgentThreadPanelInput,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let panel_id = Uuid::new_v4().to_string();
    let thread_id = Uuid::new_v4().to_string();
    let now = current_timestamp()?;
    let position_index = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position_index), -1) + 1 FROM workspace_panels WHERE session_id = ?",
    )
    .bind(&input.session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO agent_threads (id, session_id, title, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&thread_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO workspace_panels (id, session_id, kind, title, position_index, created_at, updated_at) VALUES (?, ?, 'agent_thread', ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(position_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO agent_thread_panel_state (panel_id, thread_id) VALUES (?, ?)")
        .bind(&panel_id)
        .bind(&thread_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(WorkspacePanel {
        id: panel_id,
        session_id: input.session_id,
        kind: "agent_thread".to_string(),
        title,
        position_index,
        created_at: now.clone(),
        updated_at: now,
        terminal_state: None,
        source_control_diff_state: None,
        file_editor_state: None,
        agent_thread_state: Some(AgentThreadPanelState { thread_id }),
        browser_state: None,
    })
}

async fn open_source_control_diff_panel(
    pool: &SqlitePool,
    input: OpenSourceControlDiffPanelInput,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let folder_path = validate_folder_path(&input.folder_path)?;
    let file_path = validate_source_control_diff_file_path(&input.file_path)?;
    let old_path = validate_optional_source_control_diff_file_path(input.old_path)?;
    let panel_id = source_control_diff_panel_id(&input.session_id, input.source, &file_path);

    if let Some(panel) = get_workspace_panel(pool, &panel_id).await? {
        return Ok(panel);
    }

    let now = current_timestamp()?;
    let position_index = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position_index), -1) + 1 FROM workspace_panels WHERE session_id = ?",
    )
    .bind(&input.session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO workspace_panels (id, session_id, kind, title, position_index, created_at, updated_at) VALUES (?, ?, 'source_control_diff', ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(position_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO source_control_diff_panel_state (panel_id, folder_path, file_path, old_path, source) VALUES (?, ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&folder_path)
        .bind(&file_path)
        .bind(&old_path)
        .bind(input.source.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(WorkspacePanel {
        id: panel_id,
        session_id: input.session_id,
        kind: "source_control_diff".to_string(),
        title,
        position_index,
        created_at: now.clone(),
        updated_at: now,
        terminal_state: None,
        source_control_diff_state: Some(SourceControlDiffPanelState {
            folder_path,
            file_path,
            old_path,
            source: input.source,
        }),
        file_editor_state: None,
        agent_thread_state: None,
        browser_state: None,
    })
}

async fn open_file_editor_panel(
    pool: &SqlitePool,
    input: OpenFileEditorPanelInput,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let folder_path = validate_folder_path(&input.folder_path)?;
    let file_path = validate_file_editor_file_path(&input.file_path)?;
    let panel_id = file_editor_panel_id(&input.session_id, &file_path);

    if let Some(panel) = get_workspace_panel(pool, &panel_id).await? {
        return Ok(panel);
    }

    let now = current_timestamp()?;
    let position_index = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position_index), -1) + 1 FROM workspace_panels WHERE session_id = ?",
    )
    .bind(&input.session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO workspace_panels (id, session_id, kind, title, position_index, created_at, updated_at) VALUES (?, ?, 'file_editor', ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(position_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query(
        "INSERT INTO file_editor_panel_state (panel_id, folder_path, file_path) VALUES (?, ?, ?)",
    )
    .bind(&panel_id)
    .bind(&folder_path)
    .bind(&file_path)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(WorkspacePanel {
        id: panel_id,
        session_id: input.session_id,
        kind: "file_editor".to_string(),
        title,
        position_index,
        created_at: now.clone(),
        updated_at: now,
        terminal_state: None,
        source_control_diff_state: None,
        file_editor_state: Some(FileEditorPanelState {
            folder_path,
            file_path,
        }),
        agent_thread_state: None,
        browser_state: None,
    })
}

async fn create_browser_panel(
    pool: &SqlitePool,
    input: CreateBrowserPanelInput,
) -> Result<WorkspacePanel, ProjectError> {
    let title = validate_panel_title(&input.title)?;
    let url = validate_browser_url(&input.url)?;
    let panel_id = Uuid::new_v4().to_string();
    let now = current_timestamp()?;
    let position_index = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(position_index), -1) + 1 FROM workspace_panels WHERE session_id = ?",
    )
    .bind(&input.session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO workspace_panels (id, session_id, kind, title, position_index, created_at, updated_at) VALUES (?, ?, 'browser', ?, ?, ?, ?)")
        .bind(&panel_id)
        .bind(&input.session_id)
        .bind(&title)
        .bind(position_index)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    sqlx::query("INSERT INTO browser_panel_state (panel_id, url) VALUES (?, ?)")
        .bind(&panel_id)
        .bind(&url)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(WorkspacePanel {
        id: panel_id,
        session_id: input.session_id,
        kind: "browser".to_string(),
        title,
        position_index,
        created_at: now.clone(),
        updated_at: now,
        terminal_state: None,
        source_control_diff_state: None,
        file_editor_state: None,
        agent_thread_state: None,
        browser_state: Some(BrowserPanelState { url }),
    })
}

async fn update_browser_panel_url(
    pool: &SqlitePool,
    input: UpdateBrowserPanelUrlInput,
) -> Result<(), ProjectError> {
    let url = validate_browser_url(&input.url)?;
    sqlx::query("UPDATE browser_panel_state SET url = ? WHERE panel_id = ?")
        .bind(&url)
        .bind(&input.panel_id)
        .execute(pool)
        .await
        .map_err(|error| ProjectError::Update(error.to_string()))?;
    Ok(())
}

struct CreatedSessionRoot {
    kind: SessionRootKind,
    worktree_path: Option<String>,
    branch_name: Option<String>,
}

fn create_session_worktree(
    app_data_dir: &Path,
    project: &Project,
    project_slug: &str,
    worktree_slug: &str,
    branch: &CreateWorktreeBranchInput,
) -> Result<CreatedSessionRoot, ProjectError> {
    let project_slug = validate_worktree_slug(project_slug)?;
    let worktree_slug = validate_worktree_slug(worktree_slug)?;
    let branch_name = validate_branch_name(branch)?;
    let worktree_path = session_worktree_path(app_data_dir, &project_slug, &worktree_slug);
    if worktree_path.exists() {
        return Err(ProjectError::WorktreeAlreadyExists(
            worktree_path.display().to_string(),
        ));
    }
    let parent = worktree_path
        .parent()
        .ok_or_else(|| ProjectError::CreateWorktreeDirectory {
            path: worktree_path.display().to_string(),
            message: "worktree path has no parent directory".to_string(),
        })?;
    fs::create_dir_all(parent).map_err(|error| ProjectError::CreateWorktreeDirectory {
        path: parent.display().to_string(),
        message: error.to_string(),
    })?;

    let project_folder = Path::new(&project.folder_path);
    match branch {
        CreateWorktreeBranchInput::New { .. } => run_git(
            project_folder,
            "create worktree branch",
            &[
                "worktree",
                "add",
                "-b",
                &branch_name,
                &worktree_path.display().to_string(),
            ],
        )?,
        CreateWorktreeBranchInput::Existing { .. } => run_git(
            project_folder,
            "create worktree",
            &[
                "worktree",
                "add",
                &worktree_path.display().to_string(),
                &branch_name,
            ],
        )?,
    };

    Ok(CreatedSessionRoot {
        kind: SessionRootKind::Worktree,
        worktree_path: Some(worktree_path.display().to_string()),
        branch_name: Some(branch_name),
    })
}

fn session_worktree_path(app_data_dir: &Path, project_slug: &str, worktree_slug: &str) -> PathBuf {
    app_data_dir
        .join("worktrees")
        .join(project_slug)
        .join(worktree_slug)
}

fn remove_clean_session_worktree(
    project_folder: &str,
    worktree_path: &str,
) -> Result<(), ProjectError> {
    let worktree_path = PathBuf::from(worktree_path);
    match run_git(
        &worktree_path,
        "inspect worktree status",
        &["status", "--porcelain"],
    ) {
        Ok(status) if !status.trim().is_empty() => {
            return Err(ProjectError::DirtyWorktree(
                worktree_path.display().to_string(),
            ));
        }
        Err(error) if is_missing_git_repository_error(&error) => {
            prune_stale_project_worktrees(project_folder)?;
            remove_worktree_directory_with_retry(&worktree_path)?;
            return Ok(());
        }
        Err(error) => return Err(error),
        Ok(_) => {}
    }

    run_git(
        Path::new(project_folder),
        "remove worktree",
        &["worktree", "remove", &worktree_path.display().to_string()],
    )?;
    prune_stale_project_worktrees(project_folder)?;
    remove_worktree_directory_with_retry(&worktree_path)?;
    Ok(())
}

fn remove_worktree_directory_with_retry(worktree_path: &Path) -> Result<(), ProjectError> {
    if !worktree_path.exists() {
        return Ok(());
    }

    let mut last_error = None;
    for attempt in 0..10 {
        match fs::remove_dir_all(worktree_path) {
            Ok(()) => return Ok(()),
            Err(error) if attempt < 9 && is_transient_remove_dir_error(&error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return Err(ProjectError::RemoveWorktree {
                    path: worktree_path.display().to_string(),
                    message: error.to_string(),
                });
            }
        }
    }

    if let Some(error) = last_error {
        return Err(ProjectError::RemoveWorktree {
            path: worktree_path.display().to_string(),
            message: error.to_string(),
        });
    }

    Err(ProjectError::RemoveWorktree {
        path: worktree_path.display().to_string(),
        message: "failed to remove worktree directory after retries".to_string(),
    })
}

fn is_transient_remove_dir_error(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(32 | 5))
        || matches!(error.kind(), std::io::ErrorKind::PermissionDenied)
}

fn prune_stale_project_worktrees(project_folder: &str) -> Result<(), ProjectError> {
    run_git(
        Path::new(project_folder),
        "prune stale worktree metadata",
        &["worktree", "prune"],
    )?;
    Ok(())
}

fn is_missing_git_repository_error(error: &ProjectError) -> bool {
    matches!(
        error,
        ProjectError::GitCommand { message, .. }
            if message.contains("not a git repository")
                || message.contains("directory name is invalid")
                || message.contains("system cannot find the file specified")
                || message.contains("No such file or directory")
                || message.contains("os error 267")
                || message.contains("os error 2")
    )
}

fn run_git(cwd: &Path, operation: &str, args: &[&str]) -> Result<String, ProjectError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| ProjectError::GitCommand {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(ProjectError::GitCommand {
        operation: operation.to_string(),
        message: if stderr.is_empty() { stdout } else { stderr },
    })
}

fn validate_session_name(name: &str) -> Result<String, ProjectError> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(ProjectError::MissingSessionName);
    }

    Ok(trimmed_name.to_string())
}

fn validate_worktree_slug(slug: &str) -> Result<String, ProjectError> {
    let trimmed_slug = slug.trim();
    if trimmed_slug.is_empty() {
        return Err(ProjectError::MissingWorktreeSlug);
    }
    let is_valid = trimmed_slug
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !is_valid {
        return Err(ProjectError::InvalidWorktreeSlug(trimmed_slug.to_string()));
    }

    Ok(trimmed_slug.to_string())
}

fn validate_branch_name(branch: &CreateWorktreeBranchInput) -> Result<String, ProjectError> {
    let name = match branch {
        CreateWorktreeBranchInput::New { name } | CreateWorktreeBranchInput::Existing { name } => {
            name.as_str()
        }
    };
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(ProjectError::MissingBranchName);
    }

    Ok(trimmed_name.to_string())
}

fn validate_browser_url(url: &str) -> Result<String, ProjectError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::MissingBrowserUrl);
    }
    Ok(trimmed.to_string())
}

async fn get_workspace_panel(
    pool: &SqlitePool,
    panel_id: &str,
) -> Result<Option<WorkspacePanel>, ProjectError> {
    let row = sqlx::query(
        "SELECT workspace_panels.id, workspace_panels.session_id, workspace_panels.kind, workspace_panels.title, workspace_panels.position_index, workspace_panels.created_at, workspace_panels.updated_at, terminal_panel_state.working_directory, terminal_panel_state.shell, source_control_diff_panel_state.folder_path AS diff_folder_path, source_control_diff_panel_state.file_path AS diff_file_path, source_control_diff_panel_state.old_path AS diff_old_path, source_control_diff_panel_state.source AS diff_source, file_editor_panel_state.folder_path AS editor_folder_path, file_editor_panel_state.file_path AS editor_file_path, agent_thread_panel_state.thread_id AS agent_thread_id, browser_panel_state.url AS browser_url FROM workspace_panels LEFT JOIN terminal_panel_state ON terminal_panel_state.panel_id = workspace_panels.id LEFT JOIN source_control_diff_panel_state ON source_control_diff_panel_state.panel_id = workspace_panels.id LEFT JOIN file_editor_panel_state ON file_editor_panel_state.panel_id = workspace_panels.id LEFT JOIN agent_thread_panel_state ON agent_thread_panel_state.panel_id = workspace_panels.id LEFT JOIN browser_panel_state ON browser_panel_state.panel_id = workspace_panels.id WHERE workspace_panels.id = ?",
    )
    .bind(panel_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    row.as_ref().map(workspace_panel_from_row).transpose()
}

fn source_control_diff_panel_id(
    session_id: &str,
    source: SourceControlDiffSource,
    file_path: &str,
) -> String {
    format!(
        "source-control-diff:{session_id}:{}:{}",
        source.as_str(),
        panel_id_path_segment(file_path)
    )
}

fn file_editor_panel_id(session_id: &str, file_path: &str) -> String {
    format!(
        "file-editor:{session_id}:{}",
        panel_id_path_segment(file_path)
    )
}

fn panel_id_path_segment(file_path: &str) -> String {
    let mut segment = String::with_capacity(file_path.len());
    for byte in file_path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-') {
            segment.push(char::from(byte));
            continue;
        }

        segment.push('~');
        segment.push(HEX_DIGITS[usize::from(byte >> 4)]);
        segment.push(HEX_DIGITS[usize::from(byte & 0x0F)]);
    }

    segment
}

async fn create_project(
    pool: &SqlitePool,
    input: CreateProjectInput,
) -> Result<CreatedProject, ProjectError> {
    let name = validate_name(&input.name)?;
    let folder_path = validate_folder_path(&input.folder_path)?;

    let existing_project_id =
        sqlx::query_scalar::<_, String>("SELECT id FROM projects WHERE folder_path = ? LIMIT 1")
            .bind(&folder_path)
            .fetch_optional(pool)
            .await
            .map_err(|error| ProjectError::Query(error.to_string()))?;

    if existing_project_id.is_some() {
        return Err(ProjectError::DuplicateFolder(folder_path));
    }

    let project_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    let now = current_timestamp()?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    sqlx::query(
        "INSERT INTO projects (id, name, folder_path, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&project_id)
    .bind(&name)
    .bind(&folder_path)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;

    sqlx::query(
        "INSERT INTO sessions (id, project_id, name, root_kind, worktree_path, branch_name, created_at, updated_at, last_opened_at, layout_json) VALUES (?, ?, ?, 'project_folder', NULL, NULL, ?, ?, ?, ?)",
    )
    .bind(&session_id)
    .bind(&project_id)
    .bind(DEFAULT_SESSION_NAME)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .bind(Option::<String>::None)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;

    transaction
        .commit()
        .await
        .map_err(|error| ProjectError::Create(error.to_string()))?;

    Ok(CreatedProject {
        project: Project {
            id: project_id.clone(),
            name,
            folder_path,
            created_at: now.clone(),
            updated_at: now.clone(),
        },
        default_session: Session {
            id: session_id,
            project_id,
            name: DEFAULT_SESSION_NAME.to_string(),
            root_kind: SessionRootKind::ProjectFolder,
            worktree_path: None,
            branch_name: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: Some(now),
            layout_json: None,
        },
    })
}

fn validate_panel_title(title: &str) -> Result<String, ProjectError> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(ProjectError::MissingPanelTitle);
    }

    Ok(trimmed_title.to_string())
}

fn validate_source_control_diff_file_path(file_path: &str) -> Result<String, ProjectError> {
    let trimmed_file_path = file_path.trim();
    if trimmed_file_path.is_empty() {
        return Err(ProjectError::MissingSourceControlDiffFilePath);
    }

    Ok(trimmed_file_path.to_string())
}

fn validate_optional_source_control_diff_file_path(
    file_path: Option<String>,
) -> Result<Option<String>, ProjectError> {
    file_path
        .map(|file_path| validate_source_control_diff_file_path(&file_path))
        .transpose()
}

fn validate_file_editor_file_path(file_path: &str) -> Result<String, ProjectError> {
    let trimmed_file_path = file_path.trim();
    if trimmed_file_path.is_empty() {
        return Err(ProjectError::MissingFileEditorFilePath);
    }

    Ok(trimmed_file_path.to_string())
}

fn validate_terminal_snapshot_id(terminal_id: &str) -> Result<String, ProjectError> {
    let trimmed_terminal_id = terminal_id.trim();
    if trimmed_terminal_id.is_empty() {
        return Err(ProjectError::MissingTerminalSnapshotId);
    }

    Ok(trimmed_terminal_id.to_string())
}

fn validate_terminal_snapshot_payload(serialized: &str) -> Result<String, ProjectError> {
    if serialized.is_empty() {
        return Err(ProjectError::MissingTerminalSnapshotPayload);
    }

    Ok(serialized.to_string())
}

fn validate_terminal_snapshot_sequence(sequence: i64) -> Result<(), ProjectError> {
    if sequence < 0 {
        return Err(ProjectError::InvalidTerminalSnapshotSequence(sequence));
    }

    Ok(())
}

fn validate_terminal_snapshot_size(rows: i64, cols: i64) -> Result<(), ProjectError> {
    if rows <= 0 || cols <= 0 {
        return Err(ProjectError::InvalidTerminalSnapshotSize { rows, cols });
    }

    Ok(())
}

fn validate_name(name: &str) -> Result<String, ProjectError> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(ProjectError::MissingName);
    }

    Ok(trimmed_name.to_string())
}

fn validate_folder_path(folder_path: &str) -> Result<String, ProjectError> {
    let trimmed_folder_path = folder_path.trim();
    if trimmed_folder_path.is_empty() {
        return Err(ProjectError::MissingFolderPath);
    }

    let path = Path::new(trimmed_folder_path);
    if !path.exists() {
        return Err(ProjectError::FolderDoesNotExist(
            trimmed_folder_path.to_string(),
        ));
    }

    if !path.is_dir() {
        return Err(ProjectError::FolderIsNotDirectory(
            trimmed_folder_path.to_string(),
        ));
    }

    Ok(trimmed_folder_path.to_string())
}

fn current_timestamp() -> Result<String, ProjectError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ProjectError::Timestamp(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        session_worktree_path, validate_branch_name, validate_worktree_slug,
        CreateWorktreeBranchInput, ProjectError,
    };
    use std::path::Path;

    #[test]
    fn validate_worktree_slug_accepts_safe_slug() {
        assert!(matches!(
            validate_worktree_slug("project-123").as_deref(),
            Ok("project-123")
        ));
    }

    #[test]
    fn validate_worktree_slug_rejects_empty_slug() {
        let error = validate_worktree_slug("  ");

        assert!(matches!(error, Err(ProjectError::MissingWorktreeSlug)));
    }

    #[test]
    fn validate_worktree_slug_rejects_unsafe_slug() {
        let error = validate_worktree_slug("Project Name");

        assert!(
            matches!(error, Err(ProjectError::InvalidWorktreeSlug(value)) if value == "Project Name")
        );
    }

    #[test]
    fn validate_branch_name_rejects_empty_branch() {
        let error = validate_branch_name(&CreateWorktreeBranchInput::New {
            name: " ".to_string(),
        });

        assert!(matches!(error, Err(ProjectError::MissingBranchName)));
    }

    #[test]
    fn session_worktree_path_uses_app_data_worktrees_directory() {
        let path = session_worktree_path(Path::new("app-data"), "project-name", "worktree-name");
        assert_eq!(
            path,
            Path::new("app-data")
                .join("worktrees")
                .join("project-name")
                .join("worktree-name")
        );
    }
}
