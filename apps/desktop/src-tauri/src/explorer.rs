use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use ignore::Walk;
use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};
use tauri::State;
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

#[derive(Debug, Default)]
pub struct FileReferenceCache(pub(crate) Mutex<HashMap<PathBuf, Vec<CachedEntry>>>);

#[derive(Debug, Clone)]
pub(crate) struct CachedEntry {
    relative_path: String,
    name: String,
    kind: ExplorerEntryKind,
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
    cache: State<'_, FileReferenceCache>,
) -> Result<ExplorerFileReferenceSuggestionsResult, ExplorerError> {
    let root_path = validate_project_folder(&input.folder_path)?;
    let raw_query = input
        .query
        .trim_start_matches('@')
        .trim_matches('"')
        .to_string();
    let limit = input.limit.clamp(1, 50);
    let scoped_query = resolve_file_reference_query(&root_path, &raw_query)?;
    let scope_prefix = compute_scope_prefix(&root_path, &scoped_query.folder_path);

    // Cache lookup (sync, fast)
    let cached = {
        let guard = cache
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard.get(&root_path).cloned()
    };

    let entries = if let Some(entries) = cached {
        entries
    } else {
        let walked = walk_project_tree(&root_path)?;
        let mut guard = cache
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let walked_clone = walked.clone();
        guard.insert(root_path.clone(), walked_clone);
        walked
    };

    let filter = scoped_query.filter;

    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, ExplorerError>(score_cached_entries(
            &entries,
            &filter,
            &scope_prefix,
            limit,
        ))
    })
    .await
    .map_err(|join_error| ExplorerError::InspectFolder {
        path: input.folder_path,
        message: join_error.to_string(),
    })?
}

fn score_cached_entries(
    entries: &[CachedEntry],
    filter: &str,
    scope_prefix: &str,
    limit: usize,
) -> ExplorerFileReferenceSuggestionsResult {
    let empty_filter = filter.is_empty();
    let atoms = if empty_filter {
        None
    } else {
        Some((
            Atom::new(
                filter,
                CaseMatching::Ignore,
                Normalization::Smart,
                AtomKind::Fuzzy,
                false,
            ),
            Atom::new(
                filter,
                CaseMatching::Ignore,
                Normalization::Smart,
                AtomKind::Substring,
                false,
            ),
        ))
    };
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut scored: Vec<(&CachedEntry, u32)> = Vec::new();
    let mut char_buf = Vec::new();

    for entry in entries {
        if !scope_prefix.is_empty() && !entry.relative_path.starts_with(scope_prefix) {
            continue;
        }

        let score = match &atoms {
            Some((name_atom, path_atom)) => {
                // Name: fuzzy match (tolerant, short string, few false positives)
                char_buf.clear();
                let name_haystack = Utf32Str::new(&entry.name, &mut char_buf);
                if let Some(s) = name_atom.score(name_haystack, &mut matcher) {
                    u32::from(s) + 10000
                } else {
                    // Path: substring match (exact contiguous, prevents scattered noise)
                    char_buf.clear();
                    let path_haystack = Utf32Str::new(&entry.relative_path, &mut char_buf);
                    path_atom
                        .score(path_haystack, &mut matcher)
                        .map_or(0, u32::from)
                }
            }
            None => 1,
        };

        if score > 0 {
            scored.push((entry, score));
        }
    }

    scored.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then(a.0.relative_path.cmp(&b.0.relative_path))
    });
    scored.truncate(limit);

    ExplorerFileReferenceSuggestionsResult {
        suggestions: scored
            .into_iter()
            .map(|(entry, _)| ExplorerFileReferenceSuggestion {
                path: entry.relative_path.clone(),
                kind: entry.kind,
                label: if entry.kind == ExplorerEntryKind::Directory {
                    format!("{}/", entry.name)
                } else {
                    entry.name.clone()
                },
                description: entry.relative_path.trim_end_matches('/').to_string(),
            })
            .collect(),
    }
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

fn walk_project_tree(root_path: &Path) -> Result<Vec<CachedEntry>, ExplorerError> {
    let mut entries = Vec::new();
    for result in Walk::new(root_path) {
        let dir_entry = result.map_err(|err| ExplorerError::InspectFolder {
            path: root_path.to_string_lossy().to_string(),
            message: err.to_string(),
        })?;

        if dir_entry.depth() == 0 {
            continue;
        }

        let Some(file_type) = dir_entry.file_type() else {
            continue;
        };

        let kind = if file_type.is_dir() {
            ExplorerEntryKind::Directory
        } else if file_type.is_file() {
            ExplorerEntryKind::File
        } else {
            continue;
        };

        let relative_path =
            dir_entry
                .path()
                .strip_prefix(root_path)
                .map_err(|_| ExplorerError::InspectFolder {
                    path: dir_entry.path().to_string_lossy().to_string(),
                    message: "path outside root".to_string(),
                })?;

        let relative_path_str = relative_path.to_string_lossy().replace('\\', "/");
        let name = dir_entry.file_name().to_string_lossy().to_string();

        entries.push(CachedEntry {
            relative_path: if kind == ExplorerEntryKind::Directory {
                format!("{relative_path_str}/")
            } else {
                relative_path_str
            },
            name,
            kind,
        });
    }

    Ok(entries)
}

fn compute_scope_prefix(root_path: &Path, scope_abs: &Path) -> String {
    if scope_abs == root_path {
        return String::new();
    }
    let Ok(prefix) = scope_abs.strip_prefix(root_path) else {
        return String::new();
    };
    let prefix_str = prefix.to_string_lossy().replace('\\', "/");
    let trimmed = prefix_str.trim_end_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}/")
    }
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
