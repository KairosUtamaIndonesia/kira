use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::agent_runtime::{fetch_bundled_skills, AgentRuntimeRegistry};

/// Provenance of an installed Skill.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillScope {
    /// Compiled into Kira's agent runtime; always loaded by Kira's agent.
    Bundled,
    /// Discovered from the active Project's `.agents/skills/`; loaded for that Project.
    Project,
    /// Installed at the machine-level `.agents/skills/` root; not loaded by Kira's agent.
    Global,
}

/// A single installed Skill surfaced to the desktop Skills inspector.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    /// Declared name from `SKILL.md` frontmatter. Identity for conflict detection.
    name: String,
    description: String,
    scope: SkillScope,
    /// Source repository or provider from `skills-lock.json`. `None` for Bundled or unlocked Skills.
    source: Option<String>,
    /// `"github"` or `"well-known"` from `skills-lock.json`.
    source_type: Option<String>,
    /// Absolute path to the on-disk `SKILL.md`. `None` for Bundled Skills.
    skill_path: Option<String>,
    /// `computedHash` from `skills-lock.json` when present.
    hash: Option<String>,
    /// Whether Kira's agent loads this Skill (Bundled and Project, never Global).
    loaded_by_agent: bool,
    /// Whether this Skill participates in a Skill Conflict (Bundled name == Project name).
    conflict: bool,
}

/// State of the Bundled section, which depends on the agent runtime being reachable.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BundledSource {
    /// Bundled Skills were listed successfully.
    Ready,
    /// The agent runtime could not be reached; Bundled Skills are unavailable.
    RuntimeUnavailable { reason: String },
}

/// Composed Skills listing across all scopes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsListResult {
    bundled: Vec<InstalledSkill>,
    project: Vec<InstalledSkill>,
    global: Vec<InstalledSkill>,
    /// Declared names that collide between Bundled and Project scopes.
    conflicts: Vec<String>,
    bundled_source: BundledSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsListInput {
    project_path: Option<String>,
}

#[derive(Debug, Error)]
pub enum SkillsError {
    #[error("failed to read skills directory {path}: {reason}")]
    ReadDirectory { path: String, reason: String },
    #[error("failed to read {path}: {reason}")]
    ReadFile { path: String, reason: String },
    #[error("invalid SKILL.md frontmatter in {path}: {reason}")]
    FrontmatterParse { path: String, reason: String },
    #[error("invalid skills-lock.json at {path}: {reason}")]
    LockParse { path: String, reason: String },
    #[error("could not resolve the home directory for global skills: {reason}")]
    GlobalRootUnavailable { reason: String },
}

impl serde::Serialize for SkillsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// Lists installed Skills across Bundled, Project, and Global scopes.
///
/// # Errors
///
/// Returns a [`SkillsError`] when a present skills directory, `SKILL.md`, or
/// `skills-lock.json` cannot be read or parsed. A missing directory is not an
/// error; that scope returns an empty list. Bundled-runtime failures degrade the
/// Bundled section rather than failing the command.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State and AppHandle by value"
)]
pub async fn skills_list(
    input: SkillsListInput,
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentRuntimeRegistry>,
) -> Result<SkillsListResult, SkillsError> {
    let (mut bundled, bundled_source) = match fetch_bundled_skills(&registry).await {
        Ok(skills) => (
            skills
                .into_iter()
                .map(|skill| bundled_skill(skill.name, skill.description))
                .collect::<Vec<_>>(),
            BundledSource::Ready,
        ),
        Err(reason) => (Vec::new(), BundledSource::RuntimeUnavailable { reason }),
    };

    let mut project = match input.project_path.as_deref() {
        Some(path) => scan_skills_root(Path::new(path), SkillScope::Project)?,
        None => Vec::new(),
    };

    let global = scan_global_skills(&app)?;

    let conflicts = mark_conflicts(&mut bundled, &mut project);

    Ok(SkillsListResult {
        bundled,
        project,
        global,
        conflicts,
        bundled_source,
    })
}

fn bundled_skill(name: String, description: String) -> InstalledSkill {
    InstalledSkill {
        name,
        description,
        scope: SkillScope::Bundled,
        source: None,
        source_type: None,
        skill_path: None,
        hash: None,
        loaded_by_agent: true,
        conflict: false,
    }
}

/// Resolves the machine-level global skills root: `<home>/.agents/skills`.
///
/// Mirrors Kira's per-Project `.agents/skills/` convention. A missing directory
/// yields an empty Global section; only an unresolvable home directory errors.
fn scan_global_skills(app: &tauri::AppHandle) -> Result<Vec<InstalledSkill>, SkillsError> {
    use tauri::Manager;

    let home = app
        .path()
        .home_dir()
        .map_err(|error| SkillsError::GlobalRootUnavailable {
            reason: error.to_string(),
        })?;

    scan_skills_root(&home, SkillScope::Global)
}

/// Scans `<root>/.agents/skills/<name>/SKILL.md`, enriching each entry from the
/// scope's `skills-lock.json`. A missing skills directory returns an empty list.
fn scan_skills_root(root: &Path, scope: SkillScope) -> Result<Vec<InstalledSkill>, SkillsError> {
    let skills_dir = root.join(".agents").join("skills");
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }

    let lock = read_lock(root)?;

    let read_dir = fs::read_dir(&skills_dir).map_err(|error| SkillsError::ReadDirectory {
        path: skills_dir.display().to_string(),
        reason: error.to_string(),
    })?;

    // Collect into a BTreeMap keyed by directory name for stable, sorted output.
    let mut entries: BTreeMap<String, InstalledSkill> = BTreeMap::new();
    for dir_entry in read_dir {
        let dir_entry = dir_entry.map_err(|error| SkillsError::ReadDirectory {
            path: skills_dir.display().to_string(),
            reason: error.to_string(),
        })?;

        let path = dir_entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        let dir_name = dir_entry.file_name().to_string_lossy().into_owned();
        let content = fs::read_to_string(&skill_md).map_err(|error| SkillsError::ReadFile {
            path: skill_md.display().to_string(),
            reason: error.to_string(),
        })?;
        let frontmatter = parse_frontmatter(&content, &skill_md)?;
        let lock_entry = lock.get(&dir_name);

        entries.insert(
            dir_name,
            InstalledSkill {
                name: frontmatter.name,
                description: frontmatter.description,
                scope,
                source: lock_entry.map(|entry| entry.source.clone()),
                source_type: lock_entry.map(|entry| entry.source_type.clone()),
                skill_path: Some(skill_md.display().to_string()),
                hash: lock_entry.and_then(|entry| entry.computed_hash.clone()),
                loaded_by_agent: matches!(scope, SkillScope::Project),
                conflict: false,
            },
        );
    }

    Ok(entries.into_values().collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockEntry {
    source: String,
    source_type: String,
    #[serde(default)]
    computed_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SkillsLock {
    #[serde(default)]
    skills: BTreeMap<String, LockEntry>,
}

/// Reads `<root>/skills-lock.json`. A missing lock is valid and returns empty.
fn read_lock(root: &Path) -> Result<BTreeMap<String, LockEntry>, SkillsError> {
    let lock_path = root.join("skills-lock.json");
    if !lock_path.is_file() {
        return Ok(BTreeMap::new());
    }

    let content = fs::read_to_string(&lock_path).map_err(|error| SkillsError::ReadFile {
        path: lock_path.display().to_string(),
        reason: error.to_string(),
    })?;
    let lock: SkillsLock =
        serde_json::from_str(&content).map_err(|error| SkillsError::LockParse {
            path: lock_path.display().to_string(),
            reason: error.to_string(),
        })?;

    Ok(lock.skills)
}

struct SkillFrontmatter {
    name: String,
    description: String,
}

/// Extracts the required `name` and `description` scalars from `SKILL.md`
/// frontmatter. Fails fast when the YAML block or either field is missing.
fn parse_frontmatter(content: &str, path: &Path) -> Result<SkillFrontmatter, SkillsError> {
    let block = frontmatter_block(content).ok_or_else(|| SkillsError::FrontmatterParse {
        path: path.display().to_string(),
        reason: "missing YAML frontmatter block".to_string(),
    })?;

    let name = scalar_field(block, "name").ok_or_else(|| SkillsError::FrontmatterParse {
        path: path.display().to_string(),
        reason: "frontmatter is missing a non-empty `name`".to_string(),
    })?;
    let description =
        scalar_field(block, "description").ok_or_else(|| SkillsError::FrontmatterParse {
            path: path.display().to_string(),
            reason: "frontmatter is missing a non-empty `description`".to_string(),
        })?;

    Ok(SkillFrontmatter { name, description })
}

/// Returns the inner text of a leading `---` … `---` YAML frontmatter block.
fn frontmatter_block(content: &str) -> Option<&str> {
    let rest = content.strip_prefix("---")?;
    // The opening fence must be alone on its line.
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;

    let mut search_from = 0;
    while let Some(relative) = rest[search_from..].find("\n---") {
        let fence_start = search_from + relative + 1;
        let after_fence = &rest[fence_start + 3..];
        if after_fence.is_empty()
            || after_fence.starts_with('\n')
            || after_fence.starts_with("\r\n")
            || after_fence.chars().all(char::is_whitespace)
        {
            return Some(&rest[..fence_start]);
        }
        search_from = fence_start + 3;
    }

    None
}

/// Reads a top-level scalar field from a frontmatter block. Supports bare,
/// double-quoted, and single-quoted YAML scalars on a single line.
fn scalar_field(block: &str, key: &str) -> Option<String> {
    for line in block.lines() {
        let Some(rest) = line.strip_prefix(key) else {
            continue;
        };
        let Some(rest) = rest.strip_prefix(':') else {
            continue;
        };
        let value = parse_scalar(rest.trim());
        if value.is_empty() {
            return None;
        }
        return Some(value);
    }
    None
}

fn parse_scalar(raw: &str) -> String {
    if let Some(inner) = raw.strip_prefix('"') {
        if let Some(inner) = inner.strip_suffix('"') {
            return inner.replace("\\\"", "\"").replace("\\\\", "\\");
        }
    }
    if let Some(inner) = raw.strip_prefix('\'') {
        if let Some(inner) = inner.strip_suffix('\'') {
            return inner.replace("''", "'");
        }
    }
    raw.to_string()
}

/// Flags Skills whose declared name collides between Bundled and Project scopes
/// (a Skill Conflict that fails Flue session initialization), returning the
/// colliding names sorted and de-duplicated.
fn mark_conflicts(bundled: &mut [InstalledSkill], project: &mut [InstalledSkill]) -> Vec<String> {
    let bundled_names: BTreeSet<&str> = bundled.iter().map(|skill| skill.name.as_str()).collect();
    let project_names: BTreeSet<&str> = project.iter().map(|skill| skill.name.as_str()).collect();
    let colliding: BTreeSet<String> = bundled_names
        .intersection(&project_names)
        .map(|name| (*name).to_string())
        .collect();

    for skill in bundled.iter_mut().chain(project.iter_mut()) {
        if colliding.contains(&skill.name) {
            skill.conflict = true;
        }
    }

    colliding.into_iter().collect()
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        reason = "Test helpers assert on Result values via expect"
    )]

    use std::path::PathBuf;

    use super::*;

    fn write_skill(dir: &Path, slug: &str, frontmatter: &str) {
        let skill_dir = dir.join(".agents").join("skills").join(slug);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        fs::write(skill_dir.join("SKILL.md"), frontmatter).expect("write SKILL.md");
    }

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "kira-skills-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn scans_skills_and_enriches_from_lock() {
        let root = temp_root("enrich");
        write_skill(
            &root,
            "tauri-v2",
            "---\nname: tauri-v2\ndescription: \"Tauri dev\"\n---\nbody",
        );
        write_skill(
            &root,
            "gitbutler",
            "---\nname: but\ndescription: \"GitButler CLI\"\n---\nbody",
        );
        fs::write(
            root.join("skills-lock.json"),
            r#"{"version":1,"skills":{"tauri-v2":{"source":"a/b","sourceType":"github","skillPath":".agents/skills/tauri-v2/SKILL.md","computedHash":"abc"}}}"#,
        )
        .expect("write lock");

        let skills = scan_skills_root(&root, SkillScope::Project).expect("scan");

        assert_eq!(skills.len(), 2);
        // BTreeMap keyed by directory name: "gitbutler" sorts before "tauri-v2".
        let gitbutler = &skills[0];
        assert_eq!(gitbutler.name, "but");
        assert_eq!(gitbutler.description, "GitButler CLI");
        assert_eq!(gitbutler.source, None);
        assert!(gitbutler.loaded_by_agent);

        let tauri = &skills[1];
        assert_eq!(tauri.name, "tauri-v2");
        assert_eq!(tauri.source.as_deref(), Some("a/b"));
        assert_eq!(tauri.source_type.as_deref(), Some("github"));
        assert_eq!(tauri.hash.as_deref(), Some("abc"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_skills_directory_is_empty() {
        let root = temp_root("empty");
        let skills = scan_skills_root(&root, SkillScope::Global).expect("scan");
        assert!(skills.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn malformed_frontmatter_fails_fast() {
        let root = temp_root("malformed");
        write_skill(&root, "broken", "no frontmatter here\n");

        let error = scan_skills_root(&root, SkillScope::Project).expect_err("should fail");
        assert!(matches!(error, SkillsError::FrontmatterParse { .. }));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn global_scope_is_not_loaded_by_agent() {
        let root = temp_root("global");
        write_skill(&root, "shared", "---\nname: shared\ndescription: x\n---\n");

        let skills = scan_skills_root(&root, SkillScope::Global).expect("scan");
        assert_eq!(skills.len(), 1);
        assert!(!skills[0].loaded_by_agent);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn marks_bundled_project_conflicts() {
        let mut bundled = vec![bundled_skill(
            "review".to_string(),
            "bundled review".to_string(),
        )];
        let mut project = vec![
            InstalledSkill {
                name: "review".to_string(),
                description: "project review".to_string(),
                scope: SkillScope::Project,
                source: None,
                source_type: None,
                skill_path: None,
                hash: None,
                loaded_by_agent: true,
                conflict: false,
            },
            InstalledSkill {
                name: "tauri-v2".to_string(),
                description: "unrelated".to_string(),
                scope: SkillScope::Project,
                source: None,
                source_type: None,
                skill_path: None,
                hash: None,
                loaded_by_agent: true,
                conflict: false,
            },
        ];

        let conflicts = mark_conflicts(&mut bundled, &mut project);

        assert_eq!(conflicts, vec!["review".to_string()]);
        assert!(bundled[0].conflict);
        assert!(project[0].conflict);
        assert!(!project[1].conflict);
    }

    #[test]
    fn parses_quoted_and_bare_scalars() {
        let block = "name: bare-name\ndescription: \"Quoted: with colon\"\n";
        assert_eq!(scalar_field(block, "name").as_deref(), Some("bare-name"));
        assert_eq!(
            scalar_field(block, "description").as_deref(),
            Some("Quoted: with colon")
        );
    }

    #[test]
    fn frontmatter_block_requires_closing_fence() {
        assert!(frontmatter_block("---\nname: x\n---\nbody").is_some());
        assert!(frontmatter_block("no fence").is_none());
        assert!(frontmatter_block("---\nname: x\nbody without fence").is_none());
    }
}
