use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const EXPLORER_FILE_LIMIT: usize = 5_000;
const IGNORED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    ".next",
    ".turbo",
    "dist",
    "node_modules",
    "target",
    "vendor",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeInput {
    folder_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeResult {
    paths: BTreeMap<String, ExplorerPathMetadata>,
    truncated: bool,
    limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPathMetadata {
    size: Option<u64>,
    last_modified: Option<u128>,
}

#[derive(Debug, Error)]
pub enum ExplorerError {
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("failed to inspect Explorer folder {path}: {message}")]
    InspectFolder { path: String, message: String },
}

impl serde::Serialize for ExplorerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
pub async fn explorer_tree(input: ExplorerTreeInput) -> Result<ExplorerTreeResult, ExplorerError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    tauri::async_runtime::spawn_blocking(move || collect_file_paths(&folder_path))
        .await
        .map_err(|error| ExplorerError::InspectFolder {
            path: input.folder_path,
            message: error.to_string(),
        })?
}

fn collect_file_paths(root_path: &Path) -> Result<ExplorerTreeResult, ExplorerError> {
    let mut paths = BTreeMap::new();
    let mut pending_folders = vec![root_path.to_path_buf()];
    let mut truncated = false;

    while let Some(folder_path) = pending_folders.pop() {
        let entries = fs::read_dir(&folder_path).map_err(|error| ExplorerError::InspectFolder {
            path: folder_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?;

        for entry_result in entries {
            if paths.len() >= EXPLORER_FILE_LIMIT {
                truncated = true;
                pending_folders.clear();
                break;
            }

            let entry = entry_result.map_err(|error| ExplorerError::InspectFolder {
                path: folder_path.to_string_lossy().to_string(),
                message: error.to_string(),
            })?;
            let entry_path = entry.path();
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if should_ignore_entry(&file_name) {
                continue;
            }

            let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
                ExplorerError::InspectFolder {
                    path: entry_path.to_string_lossy().to_string(),
                    message: error.to_string(),
                }
            })?;

            if metadata.file_type().is_symlink() {
                continue;
            }

            if metadata.is_dir() {
                pending_folders.push(entry_path);
                continue;
            }

            if !metadata.is_file() {
                continue;
            }

            let relative_path = entry_path
                .strip_prefix(root_path)
                .map_err(|error| ExplorerError::InspectFolder {
                    path: entry_path.to_string_lossy().to_string(),
                    message: error.to_string(),
                })?
                .to_string_lossy()
                .replace('\\', "/");
            paths.insert(
                relative_path,
                ExplorerPathMetadata {
                    size: Some(metadata.len()),
                    last_modified: metadata
                        .modified()
                        .ok()
                        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_millis()),
                },
            );
        }
    }

    Ok(ExplorerTreeResult {
        paths,
        truncated,
        limit: EXPLORER_FILE_LIMIT,
    })
}

fn should_ignore_entry(file_name: &str) -> bool {
    (file_name.starts_with('.') && file_name != ".env")
        || IGNORED_DIRECTORY_NAMES.contains(&file_name)
}

fn validate_project_folder(folder_path: &str) -> Result<PathBuf, ExplorerError> {
    let trimmed_path = folder_path.trim();
    if trimmed_path.is_empty() {
        return Err(ExplorerError::MissingFolderPath);
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err(ExplorerError::FolderDoesNotExist(trimmed_path.to_string()));
    }
    if !path.is_dir() {
        return Err(ExplorerError::FolderIsNotDirectory(
            trimmed_path.to_string(),
        ));
    }

    path.canonicalize()
        .map_err(|error| ExplorerError::InspectFolder {
            path: trimmed_path.to_string(),
            message: error.to_string(),
        })
}
