#![deny(unsafe_code)]
#![deny(clippy::dbg_macro)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(clippy::todo)]
#![deny(clippy::unimplemented)]
#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]

mod agent_runtime;
mod editor;
mod explorer;
mod persistence;
mod projects;
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
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            agent_runtime::prepare_agent_thread,
            agent_runtime::start_agent_runtime,
            editor::editor_file_read,
            explorer::explorer_directory_children,
            explorer::explorer_tree,
            persistence::persistence_store_health,
            projects::project_create,
            projects::project_list,
            projects::project_open,
            projects::project_open_last,
            projects::project_remove,
            projects::project_rename,
            projects::session_layout_update,
            terminal::terminal_attach,
            terminal::terminal_detach,
            terminal::terminal_kill,
            terminal::terminal_resize,
            terminal::terminal_spawn,
            terminal::terminal_write,
            projects::workspace_file_editor_panel_open,
            projects::workspace_panel_delete,
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
            source_control::source_control_status,
            source_control::source_control_unstage_path,
            source_control::source_control_unstage_paths
        ])
        .run(tauri::generate_context!())
}
