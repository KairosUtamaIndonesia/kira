use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::persistence::PersistenceStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlProjectInput {
    folder_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlPathInput {
    folder_path: String,
    file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlPathsInput {
    folder_path: String,
    file_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlCommitInput {
    folder_path: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlDiffInput {
    folder_path: String,
    file_path: String,
    old_path: Option<String>,
    source: SourceControlDiffSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceControlDiffSource {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SourceControlDiffResult {
    Text(SourceControlTextDiff),
    Binary(SourceControlBinaryDiff),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlTextDiff {
    original_content: String,
    modified_content: String,
    original_path: String,
    modified_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlBinaryDiff {
    original_path: String,
    modified_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SourceControlStatusResult {
    NotGitRepository,
    GitRepository(GitRepositoryStatus),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryStatus {
    branch: Option<String>,
    head: Option<String>,
    upstream_status: Option<GitUpstreamStatus>,
    conflict_operation: GitConflictOperation,
    entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpstreamStatus {
    has_upstream: bool,
    upstream_name: Option<String>,
    ahead: i64,
    behind: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    path: String,
    status: GitFileStatus,
    area: GitStagingArea,
    old_path: Option<String>,
    added: Option<u64>,
    removed: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitStagingArea {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitConflictOperation {
    Merge,
    Rebase,
    CherryPick,
    Unknown,
}

#[derive(Debug, Error)]
pub enum SourceControlError {
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("git operation requires a file path")]
    MissingFilePath,
    #[error("git operation requires at least one file path")]
    MissingFilePaths,
    #[error("source control diff is unavailable for binary file: {0}")]
    BinaryDiff(String),
    #[error("commit message is required")]
    MissingCommitMessage,
    #[error("path resolves outside the project folder: {0}")]
    PathOutsideProject(String),
    #[error("failed to run git {operation}: {message}")]
    GitCommand { operation: String, message: String },
    #[error("failed to inspect Git repository: {0}")]
    GitRepository(String),
}

impl serde::Serialize for SourceControlError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
pub async fn source_control_status(
    input: SourceControlProjectInput,
) -> Result<SourceControlStatusResult, SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    if gix::discover(&folder_path).is_err() {
        return Ok(SourceControlStatusResult::NotGitRepository);
    }

    let repository = gix::discover(&folder_path)
        .map_err(|error| SourceControlError::GitRepository(error.to_string()))?;
    let branch = repository
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_string());
    let head = repository.head_id().ok().map(|id| id.to_string());
    let conflict_operation = detect_conflict_operation(&folder_path);
    let status_output = run_git(
        &folder_path,
        "status",
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    let mut entries = parse_status_output(&status_output);
    attach_line_stats(&folder_path, &mut entries);

    Ok(SourceControlStatusResult::GitRepository(
        GitRepositoryStatus {
            branch,
            head,
            upstream_status: parse_upstream_status(&status_output),
            conflict_operation,
            entries,
        },
    ))
}

#[tauri::command]
pub async fn source_control_stage_path(
    input: SourceControlPathInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_path = validate_relative_file_path(&folder_path, &input.file_path)?;
    run_git(
        &folder_path,
        "stage path",
        &["add", "--", &literal_pathspec(&file_path)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn source_control_unstage_path(
    input: SourceControlPathInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_path = validate_relative_file_path(&folder_path, &input.file_path)?;
    run_git(
        &folder_path,
        "unstage path",
        &["restore", "--staged", "--", &literal_pathspec(&file_path)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn source_control_discard_path(
    input: SourceControlPathInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_path = validate_relative_file_path(&folder_path, &input.file_path)?;
    discard_path(&folder_path, &file_path)
}

#[tauri::command]
pub async fn source_control_stage_paths(
    input: SourceControlPathsInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_paths = validate_relative_file_paths(&folder_path, &input.file_paths)?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(
        file_paths
            .iter()
            .map(|file_path| literal_pathspec(file_path)),
    );
    run_git_owned(&folder_path, "stage paths", &args)?;
    Ok(())
}

#[tauri::command]
pub async fn source_control_unstage_paths(
    input: SourceControlPathsInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_paths = validate_relative_file_paths(&folder_path, &input.file_paths)?;
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(
        file_paths
            .iter()
            .map(|file_path| literal_pathspec(file_path)),
    );
    run_git_owned(&folder_path, "unstage paths", &args)?;
    Ok(())
}

#[tauri::command]
pub async fn source_control_discard_paths(
    input: SourceControlPathsInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_paths = validate_relative_file_paths(&folder_path, &input.file_paths)?;
    for file_path in file_paths {
        discard_path(&folder_path, &file_path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn source_control_commit(
    input: SourceControlCommitInput,
) -> Result<(), SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let message = input.message.trim();
    if message.is_empty() {
        return Err(SourceControlError::MissingCommitMessage);
    }
    run_git(&folder_path, "commit", &["commit", "-m", message])?;
    Ok(())
}

#[tauri::command]
pub async fn source_control_diff(
    input: SourceControlDiffInput,
) -> Result<SourceControlDiffResult, SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let file_path = validate_relative_file_path(&folder_path, &input.file_path)?;
    let old_path = match input.old_path {
        Some(value) => Some(validate_relative_file_path(&folder_path, &value)?),
        None => None,
    };
    load_diff(&folder_path, &file_path, old_path.as_deref(), &input.source)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedDiffLogResult {
    pub staged_diff: String,
    pub recent_log: String,
}

#[tauri::command]
pub async fn source_control_staged_diff_log(
    input: SourceControlProjectInput,
    _store: tauri::State<'_, PersistenceStore>,
) -> Result<StagedDiffLogResult, SourceControlError> {
    let folder_path = validate_project_folder(&input.folder_path)?;

    let staged_diff = run_git(
        &folder_path,
        "staged diff",
        &["diff", "--cached", "--no-color"],
    )?;

    let recent_log = run_git(
        &folder_path,
        "recent log",
        &["log", "--oneline", "-10", "--no-decorate"],
    )?;

    Ok(StagedDiffLogResult {
        staged_diff,
        recent_log,
    })
}

pub(crate) fn validate_project_folder(folder_path: &str) -> Result<PathBuf, SourceControlError> {
    if folder_path.trim().is_empty() {
        return Err(SourceControlError::MissingFolderPath);
    }
    let path = PathBuf::from(folder_path);
    if !path.exists() {
        return Err(SourceControlError::FolderDoesNotExist(
            folder_path.to_string(),
        ));
    }
    if !path.is_dir() {
        return Err(SourceControlError::FolderIsNotDirectory(
            folder_path.to_string(),
        ));
    }
    path.canonicalize()
        .map_err(|error| SourceControlError::GitRepository(error.to_string()))
}

fn validate_relative_file_path(
    folder_path: &Path,
    file_path: &str,
) -> Result<String, SourceControlError> {
    if file_path.trim().is_empty() {
        return Err(SourceControlError::MissingFilePath);
    }
    let normalized = file_path.replace('\\', "/");
    let target = folder_path.join(&normalized);
    let parent = target.parent().unwrap_or(folder_path);
    let canonical_parent = if parent.exists() {
        parent
            .canonicalize()
            .map_err(|error| SourceControlError::GitRepository(error.to_string()))?
    } else {
        folder_path.to_path_buf()
    };
    if !canonical_parent.starts_with(folder_path) {
        return Err(SourceControlError::PathOutsideProject(
            file_path.to_string(),
        ));
    }
    Ok(normalized)
}

fn validate_relative_file_paths(
    folder_path: &Path,
    file_paths: &[String],
) -> Result<Vec<String>, SourceControlError> {
    if file_paths.is_empty() {
        return Err(SourceControlError::MissingFilePaths);
    }
    file_paths
        .iter()
        .map(|file_path| validate_relative_file_path(folder_path, file_path))
        .collect()
}

pub(crate) fn run_git(
    cwd: &Path,
    operation: &str,
    args: &[&str],
) -> Result<String, SourceControlError> {
    let mut command = Command::new("git");
    command.args(args).current_dir(cwd);
    crate::process_ext::hide_console_window(&mut command);
    let output = command
        .output()
        .map_err(|error| SourceControlError::GitCommand {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(SourceControlError::GitCommand {
        operation: operation.to_string(),
        message: if stderr.is_empty() { stdout } else { stderr },
    })
}

fn run_git_owned(
    cwd: &Path,
    operation: &str,
    args: &[String],
) -> Result<String, SourceControlError> {
    let borrowed_args: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(cwd, operation, &borrowed_args)
}

fn run_git_bytes(
    cwd: &Path,
    operation: &str,
    args: &[&str],
) -> Result<Vec<u8>, SourceControlError> {
    let mut command = Command::new("git");
    command.args(args).current_dir(cwd);
    crate::process_ext::hide_console_window(&mut command);
    let output = command
        .output()
        .map_err(|error| SourceControlError::GitCommand {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(SourceControlError::GitCommand {
        operation: operation.to_string(),
        message: if stderr.is_empty() { stdout } else { stderr },
    })
}

fn load_diff(
    folder_path: &Path,
    file_path: &str,
    old_path: Option<&str>,
    source: &SourceControlDiffSource,
) -> Result<SourceControlDiffResult, SourceControlError> {
    let original_path = old_path.unwrap_or(file_path).to_string();
    let modified_path = file_path.to_string();
    let original_bytes = match source {
        SourceControlDiffSource::Staged => git_blob_or_empty(folder_path, "HEAD", &original_path)?,
        SourceControlDiffSource::Unstaged => git_index_blob_or_empty(folder_path, &original_path)?,
        SourceControlDiffSource::Untracked => Vec::new(),
    };
    let modified_bytes = match source {
        SourceControlDiffSource::Staged => git_index_blob_or_empty(folder_path, file_path)?,
        SourceControlDiffSource::Unstaged | SourceControlDiffSource::Untracked => {
            read_worktree_file_or_empty(folder_path, file_path)?
        }
    };

    if is_binary(&original_bytes) || is_binary(&modified_bytes) {
        return Ok(SourceControlDiffResult::Binary(SourceControlBinaryDiff {
            original_path,
            modified_path,
        }));
    }

    let original_content = String::from_utf8(original_bytes)
        .map_err(|_| SourceControlError::BinaryDiff(file_path.to_string()))?;
    let modified_content = String::from_utf8(modified_bytes)
        .map_err(|_| SourceControlError::BinaryDiff(file_path.to_string()))?;

    Ok(SourceControlDiffResult::Text(SourceControlTextDiff {
        original_content,
        modified_content,
        original_path,
        modified_path,
    }))
}

fn git_blob_or_empty(
    folder_path: &Path,
    revision: &str,
    file_path: &str,
) -> Result<Vec<u8>, SourceControlError> {
    let spec = format!("{revision}:{file_path}");
    match run_git_bytes(folder_path, "read git blob", &["show", &spec]) {
        Ok(bytes) => Ok(bytes),
        Err(SourceControlError::GitCommand { .. }) => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn git_index_blob_or_empty(
    folder_path: &Path,
    file_path: &str,
) -> Result<Vec<u8>, SourceControlError> {
    let spec = format!(":{file_path}");
    match run_git_bytes(folder_path, "read index blob", &["show", &spec]) {
        Ok(bytes) => Ok(bytes),
        Err(SourceControlError::GitCommand { .. }) => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn read_worktree_file_or_empty(
    folder_path: &Path,
    file_path: &str,
) -> Result<Vec<u8>, SourceControlError> {
    let target = folder_path.join(file_path);
    if !target.exists() {
        return Ok(Vec::new());
    }
    std::fs::read(target).map_err(|error| SourceControlError::GitRepository(error.to_string()))
}

fn is_binary(content: &[u8]) -> bool {
    content.contains(&0)
}

fn parse_status_output(output: &str) -> Vec<GitStatusEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        if line.starts_with("# ") || line.is_empty() {
            continue;
        }
        if let Some(path) = line.strip_prefix("? ") {
            entries.push(status_entry(
                path,
                GitFileStatus::Untracked,
                GitStagingArea::Untracked,
                None,
            ));
            continue;
        }
        if line.starts_with("1 ") || line.starts_with("2 ") {
            parse_changed_entry(line, &mut entries);
        }
    }
    entries
}

fn parse_changed_entry(line: &str, entries: &mut Vec<GitStatusEntry>) {
    let parts: Vec<&str> = line.split(' ').collect();
    if parts.len() < 9 {
        return;
    }
    let Some(xy) = parts.get(1) else {
        return;
    };
    let mut chars = xy.chars();
    let index_status = chars.next().unwrap_or('.');
    let worktree_status = chars.next().unwrap_or('.');
    if line.starts_with("2 ") {
        let tab_parts: Vec<&str> = line.split('\t').collect();
        let path = tab_parts
            .first()
            .map(|header| header.split(' ').skip(9).collect::<Vec<&str>>().join(" "))
            .unwrap_or_default();
        let old_path = tab_parts.get(1).map(|value| (*value).to_string());
        push_status_entries(entries, &path, index_status, worktree_status, old_path);
        return;
    }
    let path = parts
        .iter()
        .skip(8)
        .copied()
        .collect::<Vec<&str>>()
        .join(" ");
    push_status_entries(entries, &path, index_status, worktree_status, None);
}

fn push_status_entries(
    entries: &mut Vec<GitStatusEntry>,
    path: &str,
    index_status: char,
    worktree_status: char,
    old_path: Option<String>,
) {
    if index_status != '.' {
        entries.push(status_entry(
            path,
            status_from_char(index_status),
            GitStagingArea::Staged,
            old_path.clone(),
        ));
    }
    if worktree_status != '.' {
        entries.push(status_entry(
            path,
            status_from_char(worktree_status),
            GitStagingArea::Unstaged,
            old_path,
        ));
    }
}

fn status_entry(
    path: &str,
    status: GitFileStatus,
    area: GitStagingArea,
    old_path: Option<String>,
) -> GitStatusEntry {
    GitStatusEntry {
        path: path.to_string(),
        status,
        area,
        old_path,
        added: None,
        removed: None,
    }
}

fn status_from_char(status: char) -> GitFileStatus {
    match status {
        'A' => GitFileStatus::Added,
        'D' => GitFileStatus::Deleted,
        'R' => GitFileStatus::Renamed,
        'C' => GitFileStatus::Copied,
        _ => GitFileStatus::Modified,
    }
}

fn parse_upstream_status(output: &str) -> Option<GitUpstreamStatus> {
    let mut upstream_name = None;
    let mut ahead = 0;
    let mut behind = 0;
    for line in output.lines() {
        if let Some(value) = line.strip_prefix("# branch.upstream ") {
            upstream_name = Some(value.trim().to_string());
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split(' ') {
                if let Some(raw) = part.strip_prefix('+') {
                    ahead = raw.parse::<i64>().unwrap_or(0);
                }
                if let Some(raw) = part.strip_prefix('-') {
                    behind = raw.parse::<i64>().unwrap_or(0);
                }
            }
        }
    }
    upstream_name.as_ref().map(|name| GitUpstreamStatus {
        has_upstream: true,
        upstream_name: Some(name.clone()),
        ahead,
        behind,
    })
}

fn attach_line_stats(folder_path: &Path, entries: &mut [GitStatusEntry]) {
    let staged = run_git(
        folder_path,
        "staged line stats",
        &["diff", "--cached", "--numstat"],
    )
    .unwrap_or_default();
    let unstaged =
        run_git(folder_path, "unstaged line stats", &["diff", "--numstat"]).unwrap_or_default();
    apply_numstat(entries, &GitStagingArea::Staged, &staged);
    apply_numstat(entries, &GitStagingArea::Unstaged, &unstaged);
    for entry in entries
        .iter_mut()
        .filter(|entry| matches!(entry.area, GitStagingArea::Untracked))
    {
        entry.added = count_file_lines(folder_path, &entry.path);
        entry.removed = Some(0);
    }
}

fn apply_numstat(entries: &mut [GitStatusEntry], area: &GitStagingArea, output: &str) {
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let added = parts[0].parse::<u64>().ok();
        let removed = parts[1].parse::<u64>().ok();
        let path = parts[2];
        for entry in entries
            .iter_mut()
            .filter(|entry| same_area(&entry.area, area) && entry.path == path)
        {
            entry.added = added;
            entry.removed = removed;
        }
    }
}

fn same_area(left: &GitStagingArea, right: &GitStagingArea) -> bool {
    matches!(
        (left, right),
        (GitStagingArea::Staged, GitStagingArea::Staged)
            | (GitStagingArea::Unstaged, GitStagingArea::Unstaged)
            | (GitStagingArea::Untracked, GitStagingArea::Untracked)
    )
}

fn count_file_lines(folder_path: &Path, file_path: &str) -> Option<u64> {
    let content = std::fs::read_to_string(folder_path.join(file_path)).ok()?;
    Some(content.lines().count() as u64)
}

fn detect_conflict_operation(folder_path: &Path) -> GitConflictOperation {
    let git_dir = match run_git(folder_path, "git dir", &["rev-parse", "--git-dir"]) {
        Ok(output) => output.trim().to_string(),
        Err(_) => return GitConflictOperation::Unknown,
    };
    let git_path = if Path::new(&git_dir).is_absolute() {
        PathBuf::from(git_dir)
    } else {
        folder_path.join(git_dir)
    };
    if git_path.join("rebase-merge").exists() || git_path.join("rebase-apply").exists() {
        return GitConflictOperation::Rebase;
    }
    if git_path.join("MERGE_HEAD").exists() {
        return GitConflictOperation::Merge;
    }
    if git_path.join("CHERRY_PICK_HEAD").exists() {
        return GitConflictOperation::CherryPick;
    }
    GitConflictOperation::Unknown
}

fn discard_path(folder_path: &Path, file_path: &str) -> Result<(), SourceControlError> {
    let tracked = run_git(
        folder_path,
        "check tracked path",
        &[
            "ls-files",
            "--error-unmatch",
            "--",
            &literal_pathspec(file_path),
        ],
    )
    .is_ok();
    if tracked {
        run_git(
            folder_path,
            "discard path",
            &[
                "restore",
                "--worktree",
                "--source=HEAD",
                "--",
                &literal_pathspec(file_path),
            ],
        )?;
    } else {
        run_git(
            folder_path,
            "delete untracked path",
            &["clean", "-ffdx", "--", &literal_pathspec(file_path)],
        )?;
    }
    Ok(())
}

fn literal_pathspec(file_path: &str) -> String {
    format!(":(literal){file_path}")
}
