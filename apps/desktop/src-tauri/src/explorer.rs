use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeInput {
    folder_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerDirectoryChildrenInput {
    folder_path: String,
    directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerFileReferenceSuggestionsInput {
    folder_path: String,
    query: String,
    limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerFileReferenceSuggestionsResult {
    suggestions: Vec<ExplorerFileReferenceSuggestion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerFileReferenceSuggestion {
    path: String,
    kind: ExplorerEntryKind,
    label: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTreeResult {
    entries: Vec<ExplorerEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerDirectoryChildrenResult {
    directory_path: String,
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
struct ScoredExplorerEntry {
    entry: ScannedExplorerEntry,
    score: u8,
}

#[derive(Debug)]
struct ScannedExplorerEntry {
    path: PathBuf,
    name: String,
    kind: ExplorerEntryKind,
}

#[derive(Debug, Error)]
pub enum ExplorerError {
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("Explorer directory path is invalid: {0}")]
    InvalidDirectoryPath(String),
    #[error("Explorer directory is outside the project folder: {0}")]
    DirectoryOutsideProject(String),
    #[error("Explorer path is not a directory: {0}")]
    ExplorerPathIsNotDirectory(String),
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
    tauri::async_runtime::spawn_blocking(move || {
        collect_directory_entries(&folder_path, &folder_path)
            .map(|entries| ExplorerTreeResult { entries })
    })
    .await
    .map_err(|error| ExplorerError::InspectFolder {
        path: input.folder_path,
        message: error.to_string(),
    })?
}

#[tauri::command]
pub async fn explorer_directory_children(
    input: ExplorerDirectoryChildrenInput,
) -> Result<ExplorerDirectoryChildrenResult, ExplorerError> {
    let root_path = validate_project_folder(&input.folder_path)?;
    let directory_path = resolve_project_directory(&root_path, &input.directory_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        collect_directory_entries(&root_path, &directory_path).map(|entries| {
            ExplorerDirectoryChildrenResult {
                directory_path: input.directory_path,
                entries,
            }
        })
    })
    .await
    .map_err(|error| ExplorerError::InspectFolder {
        path: input.folder_path,
        message: error.to_string(),
    })?
}

#[tauri::command]
pub async fn explorer_file_reference_suggestions(
    input: ExplorerFileReferenceSuggestionsInput,
) -> Result<ExplorerFileReferenceSuggestionsResult, ExplorerError> {
    let root_path = validate_project_folder(&input.folder_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        collect_file_reference_suggestions(&root_path, &input.query, input.limit)
            .map(|suggestions| ExplorerFileReferenceSuggestionsResult { suggestions })
    })
    .await
    .map_err(|error| ExplorerError::InspectFolder {
        path: input.folder_path,
        message: error.to_string(),
    })?
}

fn collect_directory_entries(
    root_path: &Path,
    folder_path: &Path,
) -> Result<Vec<ExplorerEntry>, ExplorerError> {
    let mut scanned_entries = scan_folder(folder_path)?;
    scanned_entries.sort_by(compare_scanned_entries);

    scanned_entries
        .iter()
        .map(|scanned_entry| to_explorer_entry(root_path, scanned_entry))
        .collect()
}

fn collect_file_reference_suggestions(
    root_path: &Path,
    raw_query: &str,
    limit: usize,
) -> Result<Vec<ExplorerFileReferenceSuggestion>, ExplorerError> {
    let query = raw_query.trim_start_matches('@').trim_matches('"');
    let limit = limit.clamp(1, 50);
    let scoped_query = resolve_file_reference_query(root_path, query)?;
    let mut entries = scan_folder(&scoped_query.folder_path)?;
    let normalized_filter = scoped_query.filter.to_lowercase();

    let mut scored_entries = Vec::new();
    for entry in entries.drain(..) {
        let relative_path = relative_explorer_path(root_path, &entry.path, entry.kind)?;
        let score = score_file_reference(&relative_path, &entry.name, &normalized_filter);
        if score == 0 {
            continue;
        }

        scored_entries.push(ScoredExplorerEntry { entry, score });
    }

    scored_entries.sort_by(compare_scored_entries);
    scored_entries
        .into_iter()
        .take(limit)
        .map(|scored| to_file_reference_suggestion(root_path, &scored.entry))
        .collect()
}

struct FileReferenceQuery {
    folder_path: PathBuf,
    filter: String,
}

fn resolve_file_reference_query(
    root_path: &Path,
    query: &str,
) -> Result<FileReferenceQuery, ExplorerError> {
    let normalized_query = query.replace('\\', "/");
    let slash_index = normalized_query.rfind('/');
    let Some(index) = slash_index else {
        return Ok(FileReferenceQuery {
            folder_path: root_path.to_path_buf(),
            filter: normalized_query,
        });
    };

    let directory_path = &normalized_query[..=index];
    let filter = normalized_query[index + 1..].to_string();
    let folder_path = resolve_project_directory(root_path, directory_path)?;
    Ok(FileReferenceQuery {
        folder_path,
        filter,
    })
}

fn scan_folder(folder_path: &Path) -> Result<Vec<ScannedExplorerEntry>, ExplorerError> {
    let mut entries = Vec::new();
    let directory_entries =
        fs::read_dir(folder_path).map_err(|error| ExplorerError::InspectFolder {
            path: folder_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?;

    for entry_result in directory_entries {
        let entry = entry_result.map_err(|error| ExplorerError::InspectFolder {
            path: folder_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?;
        let entry_path = entry.path();
        let metadata =
            fs::symlink_metadata(&entry_path).map_err(|error| ExplorerError::InspectFolder {
                path: entry_path.to_string_lossy().to_string(),
                message: error.to_string(),
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
        });
    }

    Ok(entries)
}

fn compare_scanned_entries(left: &ScannedExplorerEntry, right: &ScannedExplorerEntry) -> Ordering {
    match (left.kind, right.kind) {
        (ExplorerEntryKind::Directory, ExplorerEntryKind::File) => Ordering::Less,
        (ExplorerEntryKind::File, ExplorerEntryKind::Directory) => Ordering::Greater,
        (ExplorerEntryKind::Directory, ExplorerEntryKind::Directory)
        | (ExplorerEntryKind::File, ExplorerEntryKind::File) => {
            compare_names(&left.name, &right.name)
        }
    }
}

fn compare_scored_entries(left: &ScoredExplorerEntry, right: &ScoredExplorerEntry) -> Ordering {
    match right.score.cmp(&left.score) {
        Ordering::Equal => compare_scanned_entries(&left.entry, &right.entry),
        ordering => ordering,
    }
}

fn score_file_reference(relative_path: &str, name: &str, normalized_filter: &str) -> u8 {
    if normalized_filter.is_empty() {
        return 1;
    }

    let normalized_name = name.to_lowercase();
    let normalized_path = relative_path.to_lowercase();
    if normalized_name == normalized_filter {
        100
    } else if normalized_name.starts_with(normalized_filter) {
        80
    } else if normalized_name.contains(normalized_filter) {
        50
    } else if normalized_path.contains(normalized_filter) {
        30
    } else {
        0
    }
}

fn to_file_reference_suggestion(
    root_path: &Path,
    scanned_entry: &ScannedExplorerEntry,
) -> Result<ExplorerFileReferenceSuggestion, ExplorerError> {
    let path = relative_explorer_path(root_path, &scanned_entry.path, scanned_entry.kind)?;
    let label = match scanned_entry.kind {
        ExplorerEntryKind::Directory => format!("{}/", scanned_entry.name),
        ExplorerEntryKind::File => scanned_entry.name.clone(),
    };
    Ok(ExplorerFileReferenceSuggestion {
        description: path.trim_end_matches('/').to_string(),
        path,
        kind: scanned_entry.kind,
        label,
    })
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
        size: None,
        last_modified: None,
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

fn resolve_project_directory(
    root_path: &Path,
    directory_path: &str,
) -> Result<PathBuf, ExplorerError> {
    let trimmed_path = directory_path.trim();
    if trimmed_path.is_empty() {
        return Ok(root_path.to_path_buf());
    }

    let relative_path = trimmed_path.trim_end_matches('/');
    if relative_path.is_empty() {
        return Ok(root_path.to_path_buf());
    }

    let requested_path = Path::new(relative_path);
    if !is_safe_relative_directory_path(requested_path) {
        return Err(ExplorerError::InvalidDirectoryPath(
            trimmed_path.to_string(),
        ));
    }

    let canonical_path = root_path
        .join(requested_path)
        .canonicalize()
        .map_err(|error| ExplorerError::InspectFolder {
            path: trimmed_path.to_string(),
            message: error.to_string(),
        })?;

    if !canonical_path.starts_with(root_path) {
        return Err(ExplorerError::DirectoryOutsideProject(
            trimmed_path.to_string(),
        ));
    }

    if !canonical_path.is_dir() {
        return Err(ExplorerError::ExplorerPathIsNotDirectory(
            trimmed_path.to_string(),
        ));
    }

    Ok(canonical_path)
}

fn is_safe_relative_directory_path(path: &Path) -> bool {
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}
