//! Shared child-process spawning helpers.

/// Prevents a child process from allocating a console window when it is spawned
/// from the GUI process on Windows (the `CREATE_NO_WINDOW` creation flag).
///
/// The desktop app has no console of its own, so every console subprocess it
/// launches (`git`, shells, the agent runtime) would otherwise get a fresh
/// console window allocated by Windows, flashing on screen. Applying this flag
/// suppresses that window.
///
/// No-op on non-Windows platforms.
pub(crate) fn hide_console_window(command: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(target_os = "windows"))]
    let _ = command;
}
