#![deny(unsafe_code)]
#![deny(clippy::dbg_macro)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(clippy::todo)]
#![deny(clippy::unimplemented)]
#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]

mod persistence;
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
        .setup(|app| {
            let persistence_store =
                tauri::async_runtime::block_on(persistence::initialize(app.handle()))?;
            app.manage(persistence_store);
            Ok(())
        })
        .manage(terminal::TerminalRegistry::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            persistence::persistence_store_health,
            terminal::terminal_kill,
            terminal::terminal_resize,
            terminal::terminal_spawn,
            terminal::terminal_write
        ])
        .run(tauri::generate_context!())
}
