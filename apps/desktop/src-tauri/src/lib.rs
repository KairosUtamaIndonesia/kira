#![deny(unsafe_code)]
#![deny(clippy::dbg_macro)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(clippy::todo)]
#![deny(clippy::unimplemented)]
#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]

mod admin_api;
mod agent_runtime;
mod browser;
mod browser_selector;
mod desktop_signin;
mod editor;
mod explorer;
mod memory;
mod org_config;
mod persistence;
mod projects;
mod search;
mod settings;
mod skills;
mod source_control;
mod terminal;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

/// Starts the Tauri application.
///
/// # Errors
///
/// Returns an error if Tauri fails to initialize plugins, create the application context, or run
/// the application event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() -> tauri::Result<()> {
    // Load .env file if present (local dev builds).
    // Ignores errors — missing file is fine in production.
    let _ = dotenvy::dotenv();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        // Single instance plugin can be added here if needed.
    }

    builder
        .setup(|app| {
            let persistence_store =
                tauri::async_runtime::block_on(persistence::initialize(app.handle()))?;
            app.manage(persistence_store);
            Ok(())
        })
        .manage(terminal::TerminalRegistry::default())
        .manage(agent_runtime::AgentRuntimeRegistry::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            settings::appearance_settings_get,
            settings::appearance_settings_update,
            settings::notification_settings_get,
            settings::notification_settings_update,
            settings::notification_sound_import,
            settings::notification_sound_read,
            settings::notification_sound_remove,
            settings::terminal_settings_get,
            settings::terminal_settings_update,
            settings::guardrails_settings_get,
            settings::guardrails_settings_update,
            desktop_signin::desktop_signin_status,
            desktop_signin::desktop_signin_begin,
            desktop_signin::desktop_sign_out,
            agent_runtime::agent_thread_context_usage_get,
            agent_runtime::generate_commit_message,
            agent_runtime::generate_agent_thread_title,
            agent_runtime::prepare_agent_thread,
            agent_runtime::start_agent_runtime,
            org_config::desktop_org_models_get,
            editor::editor_file_read,
            editor::editor_file_delete,
            editor::editor_file_write,
            explorer::explorer_directory_children,
            explorer::explorer_file_reference_suggestions,
            explorer::explorer_tree,
            memory::memory_get_entries,
            memory::memory_list_projects,
            memory::memory_update_entry,
            persistence::persistence_store_health,
            projects::cowork_agent_thread_panels_list,
            projects::cowork_project_create,
            projects::project_file_copy,
            projects::project_create,
            projects::project_list,
            projects::project_open,
            projects::project_open_last,
            projects::project_session_open,
            projects::project_session_create,
            projects::project_session_delete,
            projects::project_sessions_list,
            projects::project_remove,
            projects::project_rename,
            projects::session_layout_update,
            search::project_search,
            terminal::terminal_attach,
            terminal::terminal_detach,
            terminal::terminal_kill,
            terminal::terminal_resize,
            terminal::terminal_spawn,
            terminal::terminal_write,
            projects::workspace_agent_thread_panel_create,
            projects::workspace_file_editor_panel_open,
            projects::workspace_panel_delete,
            projects::workspace_panel_rename,
            projects::workspace_source_control_diff_panel_open,
            projects::workspace_terminal_panel_create,
            projects::workspace_terminal_snapshot_delete,
            projects::workspace_terminal_snapshot_get,
            projects::workspace_terminal_snapshot_save,
            source_control::source_control_commit,
            source_control::source_control_diff,
            source_control::source_control_discard_path,
            source_control::source_control_discard_paths,
            source_control::source_control_stage_path,
            source_control::source_control_stage_paths,
            skills::skills_expand,
            source_control::source_control_status,
            skills::skills_list,
            source_control::source_control_unstage_path,
            source_control::source_control_staged_diff_log,
            source_control::source_control_unstage_paths,
            projects::workspace_browser_panel_create,
            projects::workspace_browser_panel_url_update,
            browser::browser_panel_open,
            browser::browser_panel_set_bounds,
            browser::browser_panel_hide,
            browser::browser_panel_navigate,
            browser::browser_panel_reload,
            browser::browser_panel_go_back,
            browser::browser_panel_go_forward,
            browser::browser_panel_close,
            browser::browser_close_orphans,
            browser::browser_panel_set_selector_mode
        ])
        .run(tauri::generate_context!())
}
