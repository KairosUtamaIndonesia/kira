//! Shared child-process spawning helpers.

/// Prevents a child process from allocating a console window when it is spawned
/// from the GUI process on Windows (the `CREATE_NO_WINDOW` creation flag).
#[cfg(target_os = "windows")]
pub(crate) fn hide_console_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn hide_console_window(_command: &mut std::process::Command) {}
