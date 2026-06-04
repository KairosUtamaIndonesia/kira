use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeInput {
    folder_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeResult {
    entries: Vec<ExplorerEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntry {
    path: String,
    kind: ExplorerEntryKind,
    size: Option<u64>,
    last_modified: Option<u128>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExplorerEntryKind {
    Directory,
    File,
}

#[derive(Debug)]
struct ScannedExplorerEntry {
    path: PathBuf,
    name: String,
    kind: ExplorerEntryKind,
    metadata: fs::Metadata,
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
    tauri::async_runtime::spawn_blocking(move || collect_explorer_entries(&folder_path))
        .await
        .map_err(|error| ExplorerError::InspectFolder {
            path: input.folder_path,
            message: error.to_string(),
        })?
}

fn collect_explorer_entries(root_path: &Path) -> Result<ExplorerTreeResult, ExplorerError> {
    let mut entries = Vec::new();
    collect_folder_entries(root_path, root_path, &mut entries)?;
    Ok(ExplorerTreeResult { entries })
}

fn collect_folder_entries(
    root_path: &Path,
    folder_path: &Path,
    entries: &mut Vec<ExplorerEntry>,
) -> Result<(), ExplorerError> {
    let mut scanned_entries = scan_folder(folder_path)?;
    scanned_entries.sort_by(compare_scanned_entries);

    for scanned_entry in scanned_entries {
        entries.push(to_explorer_entry(root_path, &scanned_entry)?);

        if scanned_entry.kind == ExplorerEntryKind::Directory {
            collect_folder_entries(root_path, &scanned_entry.path, entries)?;
        }
    }

    Ok(())
}

fn scan_folder(folder_path: &Path) -> Result<Vec<ScannedExplorerEntry>, ExplorerError> {
    let mut entries = Vec::new();
    let directory_entries = fs::read_dir(folder_path).map_err(|error| ExplorerError::InspectFolder {
        path: folder_path.to_string_lossy().to_string(),
        message: error.to_string(),
    })?;

    for entry_result in directory_entries {
        let entry = entry_result.map_err(|error| ExplorerError::InspectFolder {
            path: folder_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?;
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            ExplorerError::InspectFolder {
                path: entry_path.to_string_lossy().to_string(),
                message: error.to_string(),
            }
        })?;
        let file_type = metadata.file_type();
        let kind = if metadata.is_dir() {
            ExplorerEntryKind::Directory
        } else if metadata.is_file() || file_type.is_symlink() {
            ExplorerEntryKind::File
        } else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();

        entries.push(ScannedExplorerEntry {
            path: entry_path,
            name,
            kind,
            metadata,
        });
    }

    Ok(entries)
}

fn compare_scanned_entries(left: &ScannedExplorerEntry, right: &ScannedExplorerEntry) -> Ordering {
    match (left.kind, right.kind) {
        (ExplorerEntryKind::Directory, ExplorerEntryKind::File) => Ordering::Less,
        (ExplorerEntryKind::File, ExplorerEntryKind::Directory) => Ordering::Greater,
        (ExplorerEntryKind::Directory, ExplorerEntryKind::Directory)
        | (ExplorerEntryKind::File, ExplorerEntryKind::File) => compare_names(&left.name, &right.name),
    }
}

fn compare_names(left: &str, right: &str) -> Ordering {
    let left_lowercase = left.to_lowercase();
    let right_lowercase = right.to_lowercase();
    match left_lowercase.cmp(&right_lowercase) {
        Ordering::Equal => left.cmp(right),
        ordering => ordering,
    }
}

fn to_explorer_entry(
    root_path: &Path,
    scanned_entry: &ScannedExplorerEntry,
) -> Result<ExplorerEntry, ExplorerError> {
    Ok(ExplorerEntry {
        path: relative_explorer_path(root_path, &scanned_entry.path, scanned_entry.kind)?,
        kind: scanned_entry.kind,
        size: (scanned_entry.kind == ExplorerEntryKind::File).then_some(scanned_entry.metadata.len()),
        last_modified: scanned_entry
            .metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis()),
    })
}

fn relative_explorer_path(
    root_path: &Path,
    entry_path: &Path,
    kind: ExplorerEntryKind,
) -> Result<String, ExplorerError> {
    let mut relative_path = entry_path
        .strip_prefix(root_path)
        .map_err(|error| ExplorerError::InspectFolder {
            path: entry_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?
        .to_string_lossy()
        .replace('\\', "/");

    if kind == ExplorerEntryKind::Directory {
        relative_path.push('/');
    }

    Ok(relative_path)
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
