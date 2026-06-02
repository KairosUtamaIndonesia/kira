use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    project: Project,
    default_session: Session,
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

async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, ProjectError> {
    sqlx::query_as::<_, Project>(
        "SELECT id, name, folder_path, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| ProjectError::Query(error.to_string()))
}

async fn create_project(
    pool: &SqlitePool,
    input: CreateProjectInput,
) -> Result<CreatedProject, ProjectError> {
    let name = validate_name(&input.name)?;
    let folder_path = validate_folder_path(&input.folder_path)?;

    let existing_project_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM projects WHERE folder_path = ? LIMIT 1",
    )
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
        "INSERT INTO projects (id, name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&project_id)
    .bind(&name)
    .bind(&folder_path)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ProjectError::Create(error.to_string()))?;

    sqlx::query(
        "INSERT INTO sessions (id, project_id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&session_id)
    .bind(&project_id)
    .bind(DEFAULT_SESSION_NAME)
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
            updated_at: now,
            last_opened_at: None,
        },
    })
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
