use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, FromRow, Row, SqlitePool};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::persistence::PersistenceStore;

const DEFAULT_SESSION_NAME: &str = "Default";

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
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
    layout_json: Option<String>,
}

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
pub struct DeleteWorkspacePanelInput {
    panel_id: String,
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
    #[error("workspace panel title is required")]
    MissingPanelTitle,
    #[error("source control diff file path is required")]
    MissingSourceControlDiffFilePath,
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
pub async fn workspace_panel_delete(
    input: DeleteWorkspacePanelInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<(), ProjectError> {
    sqlx::query("DELETE FROM workspace_panels WHERE id = ?")
        .bind(input.panel_id)
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

async fn open_project(
    pool: &SqlitePool,
    input: OpenProjectInput,
) -> Result<OpenProject, ProjectError> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, folder_path, created_at, updated_at FROM projects WHERE id = ?",
    )
    .bind(&input.project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?
    .ok_or_else(|| ProjectError::MissingProject(input.project_id.clone()))?;

    let session = sqlx::query_as::<_, Session>(
        "SELECT id, project_id, name, created_at, updated_at, last_opened_at, layout_json FROM sessions WHERE project_id = ? ORDER BY COALESCE(last_opened_at, created_at) DESC LIMIT 1",
    )
    .bind(&input.project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?
    .ok_or(ProjectError::MissingSession(input.project_id))?;

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

async fn list_workspace_panels(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<WorkspacePanel>, ProjectError> {
    let rows = sqlx::query(
        "SELECT workspace_panels.id, workspace_panels.session_id, workspace_panels.kind, workspace_panels.title, workspace_panels.position_index, workspace_panels.created_at, workspace_panels.updated_at, terminal_panel_state.working_directory, terminal_panel_state.shell, source_control_diff_panel_state.folder_path AS diff_folder_path, source_control_diff_panel_state.file_path AS diff_file_path, source_control_diff_panel_state.old_path AS diff_old_path, source_control_diff_panel_state.source AS diff_source FROM workspace_panels LEFT JOIN terminal_panel_state ON terminal_panel_state.panel_id = workspace_panels.id LEFT JOIN source_control_diff_panel_state ON source_control_diff_panel_state.panel_id = workspace_panels.id WHERE workspace_panels.session_id = ? ORDER BY workspace_panels.position_index ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))?;

    rows.iter().map(workspace_panel_from_row).collect()
}

fn workspace_panel_from_row(row: &SqliteRow) -> Result<WorkspacePanel, ProjectError> {
    let id: String = row
        .try_get("id")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let kind: String = row
        .try_get("kind")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let working_directory: Option<String> = row
        .try_get("working_directory")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let shell: Option<String> = row
        .try_get("shell")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let diff_folder_path: Option<String> = row
        .try_get("diff_folder_path")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let diff_file_path: Option<String> = row
        .try_get("diff_file_path")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let diff_old_path: Option<String> = row
        .try_get("diff_old_path")
        .map_err(|error| ProjectError::Query(error.to_string()))?;
    let diff_source: Option<String> = row
        .try_get("diff_source")
        .map_err(|error| ProjectError::Query(error.to_string()))?;

    let terminal_state = match (kind.as_str(), working_directory) {
        ("terminal", Some(working_directory)) => Some(TerminalPanelState {
            working_directory,
            shell,
        }),
        ("terminal", None) => {
            return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id });
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
                return Err(ProjectError::MissingWorkspacePanelState { kind, panel_id: id });
            }
            _ => None,
        };

    Ok(WorkspacePanel {
        id,
        session_id: row
            .try_get("session_id")
            .map_err(|error| ProjectError::Query(error.to_string()))?,
        kind,
        title: row
            .try_get("title")
            .map_err(|error| ProjectError::Query(error.to_string()))?,
        position_index: row
            .try_get("position_index")
            .map_err(|error| ProjectError::Query(error.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|error| ProjectError::Query(error.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|error| ProjectError::Query(error.to_string()))?,
        terminal_state,
        source_control_diff_state,
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
    })
}

async fn get_workspace_panel(
    pool: &SqlitePool,
    panel_id: &str,
) -> Result<Option<WorkspacePanel>, ProjectError> {
    let row = sqlx::query(
        "SELECT workspace_panels.id, workspace_panels.session_id, workspace_panels.kind, workspace_panels.title, workspace_panels.position_index, workspace_panels.created_at, workspace_panels.updated_at, terminal_panel_state.working_directory, terminal_panel_state.shell, source_control_diff_panel_state.folder_path AS diff_folder_path, source_control_diff_panel_state.file_path AS diff_file_path, source_control_diff_panel_state.old_path AS diff_old_path, source_control_diff_panel_state.source AS diff_source FROM workspace_panels LEFT JOIN terminal_panel_state ON terminal_panel_state.panel_id = workspace_panels.id LEFT JOIN source_control_diff_panel_state ON source_control_diff_panel_state.panel_id = workspace_panels.id WHERE workspace_panels.id = ?",
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
        "source-control-diff:{session_id}:{}:{file_path}",
        source.as_str()
    )
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
        "INSERT INTO sessions (id, project_id, name, created_at, updated_at, last_opened_at, layout_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
