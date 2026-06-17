use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use time::OffsetDateTime;

use crate::persistence::PersistenceStore;

const ENTRY_DELIMITER: &str = "\n§\n";
const MEMORY_CHAR_LIMIT: usize = 5_000;

// ─── API types ───

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    id: usize,
    content: String,
    created: String,
    last_referenced: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryInfo {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateInput {
    store_type: String,
    action: String,
    content: String,
    old_content: Option<String>,
    project_id: Option<String>,
}

// ─── Error ───

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("invalid store type: {0}")]
    InvalidStore(String),
    #[error("missing project_id for project store")]
    MissingProjectId,
    #[error("invalid action: {0}")]
    InvalidAction(String),
    #[error("content exceeds {limit} character limit ({actual} chars)")]
    ContentTooLong { limit: usize, actual: usize },
    #[error("entry not found: no entry matching the given content")]
    EntryNotFound,
    #[error("content contains the entry delimiter which is not allowed")]
    ContentContainsDelimiter,
    #[error("failed to read directory `{path}`: {message}")]
    ReadDirectory { path: String, message: String },
    #[error("failed to read memory file `{path}`: {message}")]
    ReadFile { path: String, message: String },
    #[error("failed to write memory file `{path}`: {message}")]
    WriteFile { path: String, message: String },
    #[error("failed to parse entry metadata")]
    ParseMetadata,
    #[error("missing required field: {0}")]
    MissingField(String),
}

impl serde::Serialize for MemoryError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// Resolves the file path for a given store type.
fn memory_file_path(
    app_data_dir: &Path,
    store_type: &str,
    project_id: Option<&str>,
) -> Result<PathBuf, MemoryError> {
    let agent_dir = app_data_dir.join(".agent");
    match store_type {
        "user" => Ok(agent_dir.join("data").join("USER.md")),
        "memory" | "notes" => Ok(agent_dir.join("data").join("MEMORY.md")),
        "failure" | "failures" => Ok(agent_dir.join("data").join("failures.md")),
        "project" => {
            let pid = project_id.ok_or(MemoryError::MissingProjectId)?;
            Ok(agent_dir.join("projects").join(pid).join("MEMORY.md"))
        }
        _ => Err(MemoryError::InvalidStore(store_type.to_string())),
    }
}

/// Reads raw entry strings from a file, splitting by the entry delimiter.
fn read_entries_from_disk(path: &PathBuf) -> Result<Vec<String>, MemoryError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|e| MemoryError::ReadFile {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    Ok(content
        .split(ENTRY_DELIMITER)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// Writes entries atomically to a file (temp + rename).
fn write_entries_to_disk(path: &PathBuf, entries: &[String]) -> Result<(), MemoryError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| MemoryError::WriteFile {
            path: path.display().to_string(),
            message: e.to_string(),
        })?;
    }

    let content = entries.join(ENTRY_DELIMITER);

    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, &content).map_err(|e| MemoryError::WriteFile {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    fs::rename(&temp_path, path).map_err(|e| MemoryError::WriteFile {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;

    Ok(())
}

/// Parses a raw entry string into (content, created, `last_referenced`).
fn parse_entry(raw: &str, re: &Regex) -> MemoryEntry {
    let (text, created, last) = if let Some(caps) = re.captures(raw) {
        let text = caps.get(1).map_or("", |m| m.as_str().trim()).to_string();
        let created = caps
            .get(2)
            .map_or_else(today_date, |m| m.as_str().to_string());
        let last = caps
            .get(3)
            .map_or_else(today_date, |m| m.as_str().to_string());
        (text, created, last)
    } else {
        // Legacy entry without metadata
        let today = today_date();
        (raw.trim().to_string(), today.clone(), today)
    };
    // id is filled by the caller
    MemoryEntry {
        id: 0,
        content: text,
        created,
        last_referenced: last,
    }
}

/// Formats a single entry for storage.
fn encode_entry(text: &str, created: &str, last: &str) -> String {
    format!("{text} <!-- created={created}, last={last} -->")
}

/// Today's date in YYYY-MM-DD format.
fn today_date() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
}

/// Looks up a project's display name from the projects table.
async fn lookup_project_name(pool: &SqlitePool, project_id: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT name FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

// ─── Tauri Commands ───

/// Lists all projects that have memory files on disk.
#[tauri::command]
pub async fn memory_list_projects(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<Vec<ProjectMemoryInfo>, MemoryError> {
    let projects_dir = store.app_data_dir().join(".agent/projects");

    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut result: Vec<ProjectMemoryInfo> = Vec::new();

    let dir_reader = fs::read_dir(&projects_dir).map_err(|e| MemoryError::ReadDirectory {
        path: projects_dir.display().to_string(),
        message: e.to_string(),
    })?;
    for entry in dir_reader {
        let entry = entry.map_err(|e| MemoryError::ReadDirectory {
            path: projects_dir.display().to_string(),
            message: e.to_string(),
        })?;

        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            let mem_file = entry.path().join("MEMORY.md");
            if mem_file.exists() {
                let project_id = entry.file_name().to_string_lossy().to_string();
                let name = lookup_project_name(store.pool(), &project_id)
                    .await
                    .unwrap_or_else(|| project_id.clone());
                result.push(ProjectMemoryInfo {
                    id: project_id,
                    name,
                });
            }
        }
    }

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

/// Reads entries from a memory store file.
#[tauri::command]
pub async fn memory_get_entries(
    store: tauri::State<'_, PersistenceStore>,
    store_type: String,
    project_id: Option<String>,
) -> Result<Vec<MemoryEntry>, MemoryError> {
    let file_path = memory_file_path(store.app_data_dir(), &store_type, project_id.as_deref())?;
    let raw_entries = read_entries_from_disk(&file_path)?;

    let re = Regex::new(r"^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$")
        .map_err(|_| MemoryError::ParseMetadata)?;

    let entries: Vec<MemoryEntry> = raw_entries
        .into_iter()
        .enumerate()
        .map(|(i, raw)| {
            let mut entry = parse_entry(&raw, &re);
            entry.id = i;
            entry
        })
        .collect();

    Ok(entries)
}

/// Adds, edits, or deletes an entry in a memory store.
#[tauri::command]
pub async fn memory_update_entry(
    store: tauri::State<'_, PersistenceStore>,
    input: MemoryUpdateInput,
) -> Result<(), MemoryError> {
    let file_path = memory_file_path(
        store.app_data_dir(),
        &input.store_type,
        input.project_id.as_deref(),
    )?;

    // Validate content for add/edit (delete doesn't need content validation beyond finding the entry)
    match input.action.as_str() {
        "add" | "edit" => {
            if input.content.len() > MEMORY_CHAR_LIMIT {
                return Err(MemoryError::ContentTooLong {
                    limit: MEMORY_CHAR_LIMIT,
                    actual: input.content.len(),
                });
            }
            if input.content.contains(ENTRY_DELIMITER) {
                return Err(MemoryError::ContentContainsDelimiter);
            }
        }
        "delete" => {} // No content validation needed
        _ => return Err(MemoryError::InvalidAction(input.action)),
    }

    let mut entries = read_entries_from_disk(&file_path)?;

    let re = Regex::new(r"^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$")
        .map_err(|_| MemoryError::ParseMetadata)?;

    match input.action.as_str() {
        "add" => {
            let today = today_date();
            let encoded = encode_entry(&input.content, &today, &today);
            entries.push(encoded);
        }
        "edit" => {
            let old_content = input
                .old_content
                .as_ref()
                .ok_or_else(|| MemoryError::MissingField("old_content".to_string()))?;

            let idx = entries.iter().position(|raw| {
                let entry = parse_entry(raw, &re);
                entry.content.as_str() == old_content.as_str()
            });

            match idx {
                Some(idx) => {
                    // Preserve original created date
                    let existing = parse_entry(&entries[idx], &re);
                    let today = today_date();
                    entries[idx] = encode_entry(&input.content, &existing.created, &today);
                }
                None => return Err(MemoryError::EntryNotFound),
            }
        }
        "delete" => {
            let old_content = input
                .old_content
                .as_ref()
                .ok_or_else(|| MemoryError::MissingField("old_content".to_string()))?;

            let before = entries.len();
            entries.retain(|raw| {
                let entry = parse_entry(raw, &re);
                entry.content.as_str() != old_content.as_str()
            });

            if entries.len() == before {
                return Err(MemoryError::EntryNotFound);
            }
        }
        _ => unreachable!(), // validated above
    }

    write_entries_to_disk(&file_path, &entries)?;
    Ok(())
}
