use std::fs;
use std::path::{Path, PathBuf};

use ignore::{DirEntry, WalkBuilder};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MATCHES: usize = 500;
const MAX_MATCHED_FILES: usize = 100;
const MAX_PREVIEW_CHARS: usize = 1_200;
const MAX_PREVIEW_LINES: usize = 12;
const BINARY_SAMPLE_BYTES: usize = 8_192;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchInput {
    folder_path: String,
    query: String,
    is_case_sensitive: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchResult {
    files: Vec<ProjectSearchFileMatch>,
    match_count: usize,
    searched_file_count: usize,
    skipped_file_count: usize,
    limit_reached: Option<ProjectSearchLimitReason>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchFileMatch {
    path: String,
    matches: Vec<ProjectSearchMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchMatch {
    start_line_number: usize,
    end_line_number: usize,
    preview: String,
    ranges: Vec<ProjectSearchMatchRange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchMatchRange {
    start_line_number: usize,
    start_column: usize,
    end_line_number: usize,
    end_column: usize,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSearchLimitReason {
    MatchCount,
    MatchedFileCount,
}

#[derive(Debug, Error)]
pub enum ProjectSearchError {
    #[error("project folder path is required")]
    MissingFolderPath,
    #[error("project folder does not exist: {0}")]
    FolderDoesNotExist(String),
    #[error("project folder path is not a directory: {0}")]
    FolderIsNotDirectory(String),
    #[error("invalid regular expression: {0}")]
    InvalidRegex(String),
    #[error("failed to search Project folder {path}: {message}")]
    SearchFolder { path: String, message: String },
}

impl serde::Serialize for ProjectSearchError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
pub async fn project_search(
    input: ProjectSearchInput,
) -> Result<ProjectSearchResult, ProjectSearchError> {
    let folder_path = validate_project_folder(&input.folder_path)?;
    let query = input.query.trim().to_string();
    if query.is_empty() {
        return Ok(ProjectSearchResult {
            files: Vec::new(),
            match_count: 0,
            searched_file_count: 0,
            skipped_file_count: 0,
            limit_reached: None,
        });
    }

    let regex = RegexBuilder::new(&query)
        .case_insensitive(!input.is_case_sensitive)
        .multi_line(true)
        .dot_matches_new_line(true)
        .build()
        .map_err(|error| ProjectSearchError::InvalidRegex(error.to_string()))?;

    tauri::async_runtime::spawn_blocking(move || search_project_folder(&folder_path, &regex))
        .await
        .map_err(|error| ProjectSearchError::SearchFolder {
            path: input.folder_path,
            message: error.to_string(),
        })?
}

fn search_project_folder(
    root_path: &Path,
    regex: &regex::Regex,
) -> Result<ProjectSearchResult, ProjectSearchError> {
    let mut files = Vec::new();
    let mut match_count = 0;
    let mut searched_file_count = 0;
    let mut skipped_file_count = 0;
    let mut limit_reached = None;

    let mut walker = WalkBuilder::new(root_path);
    walker
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(should_visit_entry);

    for entry_result in walker.build() {
        if limit_reached.is_some() {
            break;
        }

        let entry = entry_result.map_err(|error| ProjectSearchError::SearchFolder {
            path: root_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })?;
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| ProjectSearchError::SearchFolder {
                path: entry.path().to_string_lossy().to_string(),
                message: error.to_string(),
            })?;
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            skipped_file_count += 1;
            continue;
        }

        let content = fs::read(entry.path()).map_err(|error| ProjectSearchError::SearchFolder {
            path: entry.path().to_string_lossy().to_string(),
            message: error.to_string(),
        })?;
        if is_binary_content(&content) {
            skipped_file_count += 1;
            continue;
        }

        let Ok(text) = String::from_utf8(content) else {
            skipped_file_count += 1;
            continue;
        };
        searched_file_count += 1;

        let mut matches = Vec::new();
        for regex_match in regex.find_iter(&text) {
            if match_count >= MAX_MATCHES {
                limit_reached = Some(ProjectSearchLimitReason::MatchCount);
                break;
            }

            matches.push(search_match_from_byte_range(
                &text,
                regex_match.start(),
                regex_match.end(),
            ));
            match_count += 1;
        }

        if !matches.is_empty() {
            files.push(ProjectSearchFileMatch {
                path: relative_project_path(root_path, entry.path())?,
                matches,
            });

            if files.len() >= MAX_MATCHED_FILES {
                limit_reached = Some(ProjectSearchLimitReason::MatchedFileCount);
            }
        }
    }

    Ok(ProjectSearchResult {
        files,
        match_count,
        searched_file_count,
        skipped_file_count,
        limit_reached,
    })
}

fn should_visit_entry(entry: &DirEntry) -> bool {
    let file_name = entry.file_name().to_string_lossy();
    !matches!(
        file_name.as_ref(),
        ".git" | "node_modules" | "target" | "dist" | ".next"
    )
}

fn is_binary_content(content: &[u8]) -> bool {
    content
        .iter()
        .take(BINARY_SAMPLE_BYTES)
        .any(|byte| *byte == 0)
}

fn search_match_from_byte_range(text: &str, start: usize, end: usize) -> ProjectSearchMatch {
    let start_location = text_location_at_byte(text, start);
    let end_location = text_location_at_byte(text, end);
    let preview = preview_for_match(text, start_location.line_number, end_location.line_number);

    ProjectSearchMatch {
        start_line_number: start_location.line_number,
        end_line_number: end_location.line_number,
        preview,
        ranges: vec![ProjectSearchMatchRange {
            start_line_number: start_location.line_number,
            start_column: start_location.column,
            end_line_number: end_location.line_number,
            end_column: end_location.column,
        }],
    }
}

#[derive(Debug, Clone, Copy)]
struct TextLocation {
    line_number: usize,
    column: usize,
}

fn text_location_at_byte(text: &str, byte_index: usize) -> TextLocation {
    let mut line_number = 1;
    let mut line_start = 0;

    for (index, character) in text.char_indices() {
        if index >= byte_index {
            break;
        }
        if character == '\n' {
            line_number += 1;
            line_start = index + character.len_utf8();
        }
    }

    TextLocation {
        line_number,
        column: text[line_start..byte_index].chars().count() + 1,
    }
}

fn preview_for_match(text: &str, start_line_number: usize, end_line_number: usize) -> String {
    let first_line = start_line_number.saturating_sub(1);
    let requested_line_count = end_line_number.saturating_sub(start_line_number) + 1;
    let line_count = requested_line_count.min(MAX_PREVIEW_LINES);
    let mut preview = text
        .lines()
        .skip(first_line)
        .take(line_count)
        .collect::<Vec<_>>()
        .join("\n");

    if preview.chars().count() > MAX_PREVIEW_CHARS {
        preview = preview.chars().take(MAX_PREVIEW_CHARS).collect();
        preview.push('…');
    }

    preview
}

fn relative_project_path(
    root_path: &Path,
    entry_path: &Path,
) -> Result<String, ProjectSearchError> {
    entry_path
        .strip_prefix(root_path)
        .map(|relative_path| relative_path.to_string_lossy().replace('\\', "/"))
        .map_err(|error| ProjectSearchError::SearchFolder {
            path: entry_path.to_string_lossy().to_string(),
            message: error.to_string(),
        })
}

fn validate_project_folder(folder_path: &str) -> Result<PathBuf, ProjectSearchError> {
    let trimmed_path = folder_path.trim();
    if trimmed_path.is_empty() {
        return Err(ProjectSearchError::MissingFolderPath);
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err(ProjectSearchError::FolderDoesNotExist(
            trimmed_path.to_string(),
        ));
    }
    if !path.is_dir() {
        return Err(ProjectSearchError::FolderIsNotDirectory(
            trimmed_path.to_string(),
        ));
    }

    path.canonicalize()
        .map_err(|error| ProjectSearchError::SearchFolder {
            path: trimmed_path.to_string(),
            message: error.to_string(),
        })
}
