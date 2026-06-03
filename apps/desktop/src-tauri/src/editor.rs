use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_TEXT_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileInput {
    folder_path: String,
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EditorFileReadResult {
    Text(EditorTextFile),
    Binary(EditorBinaryFile),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTextFile {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorBinaryFile {
    path: String,
}

#[derive(Debug, Error)]
pub enum EditorError {
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("file path is required")]
    MissingFilePath,
    #[error("path resolves outside the project folder: {0}")]
    PathOutsideProject(String),
    #[error("file does not exist: {0}")]
    FileDoesNotExist(String),
    #[error("path is not a file: {0}")]
    PathIsNotFile(String),
    #[error("file is too large for read-only preview: {path} ({size} bytes)")]
    FileTooLarge { path: String, size: u64 },
    #[error("failed to read file {path}: {message}")]
    ReadFile { path: String, message: String },
}

impl serde::Serialize for EditorError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
pub async fn editor_file_read(input: EditorFileInput) -> Result<EditorFileReadResult, EditorError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_path = validate_relative_file_path(&folder_path, &input.file_path)?;
    let absolute_path = folder_path.join(&file_path);
    if !absolute_path.exists() {
        return Err(EditorError::FileDoesNotExist(input.file_path));
    }
    if !absolute_path.is_file() {
        return Err(EditorError::PathIsNotFile(input.file_path));
    }

    let metadata = fs::metadata(&absolute_path).map_err(|error| EditorError::ReadFile {
        path: input.file_path.clone(),
        message: error.to_string(),
    })?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(EditorError::FileTooLarge {
            path: input.file_path,
            size: metadata.len(),
        });
    }

    match fs::read_to_string(&absolute_path) {
        Ok(content) => Ok(EditorFileReadResult::Text(EditorTextFile {
            path: file_path.to_string_lossy().replace('\\', "/"),
            content,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
            Ok(EditorFileReadResult::Binary(EditorBinaryFile {
                path: file_path.to_string_lossy().replace('\\', "/"),
            }))
        }
        Err(error) => Err(EditorError::ReadFile {
            path: input.file_path,
            message: error.to_string(),
        }),
    }
}

fn validate_project_folder(folder_path: &str) -> Result<PathBuf, EditorError> {
    let trimmed_path = folder_path.trim();
    if trimmed_path.is_empty() {
        return Err(EditorError::MissingFolderPath);
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err(EditorError::FolderDoesNotExist(trimmed_path.to_string()));
    }
    if !path.is_dir() {
        return Err(EditorError::FolderIsNotDirectory(trimmed_path.to_string()));
    }

    path.canonicalize().map_err(|error| EditorError::ReadFile {
        path: trimmed_path.to_string(),
        message: error.to_string(),
    })
}

fn validate_relative_file_path(
    folder_path: &Path,
    file_path: &str,
) -> Result<PathBuf, EditorError> {
    let trimmed_file_path = file_path.trim();
    if trimmed_file_path.is_empty() {
        return Err(EditorError::MissingFilePath);
    }

    let relative_path = PathBuf::from(trimmed_file_path);
    if relative_path.is_absolute() {
        return Err(EditorError::PathOutsideProject(
            trimmed_file_path.to_string(),
        ));
    }

    let absolute_path = folder_path.join(&relative_path);
    let canonical_parent = absolute_path
        .parent()
        .ok_or_else(|| EditorError::PathOutsideProject(trimmed_file_path.to_string()))?
        .canonicalize()
        .map_err(|error| EditorError::ReadFile {
            path: trimmed_file_path.to_string(),
            message: error.to_string(),
        })?;
    if !canonical_parent.starts_with(folder_path) {
        return Err(EditorError::PathOutsideProject(
            trimmed_file_path.to_string(),
        ));
    }

    Ok(relative_path)
}
