use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
    thread,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use thiserror::Error;

const TERMINAL_REPLAY_BUFFER_LIMIT: usize = 1_000_000;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    rows: u16,
    cols: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnOptions {
    working_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnInput {
    id: String,
    subscription_id: String,
    after_sequence: u64,
    size: TerminalSize,
    options: TerminalSpawnOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachInput {
    id: String,
    subscription_id: String,
    after_sequence: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output {
        id: String,
        sequence: u64,
        data: String,
    },
    Exited {
        id: String,
        code: u32,
    },
    Error {
        id: String,
        message: String,
    },
}

#[derive(Debug, Error)]
pub enum TerminalError {
    #[error(
        "terminal size must be at least 1 row and 1 column, got {rows} rows and {cols} columns"
    )]
    InvalidSize { rows: u16, cols: u16 },
    #[error("terminal session already exists: {0}")]
    DuplicateSession(String),
    #[error("terminal session was not found: {0}")]
    MissingSession(String),
    #[error("terminal session registry is unavailable because its lock is poisoned")]
    RegistryPoisoned,
    #[error("failed to open terminal PTY: {0}")]
    OpenPty(String),
    #[error("terminal working directory is required")]
    MissingWorkingDirectory,
    #[error("terminal working directory does not exist: {0}")]
    WorkingDirectoryDoesNotExist(String),
    #[error("terminal working directory is not a directory: {0}")]
    WorkingDirectoryIsNotDirectory(String),
    #[error("failed to spawn shell `{shell}`: {message}")]
    SpawnShell { shell: String, message: String },
    #[error("failed to clone terminal output reader for session {id}: {message}")]
    CloneReader { id: String, message: String },
    #[error("failed to take terminal input writer for session {id}: {message}")]
    TakeWriter { id: String, message: String },
    #[error("failed to write to terminal session {id}: {message}")]
    Write { id: String, message: String },
    #[error("failed to resize terminal session {id}: {message}")]
    Resize { id: String, message: String },
    #[error("failed to kill terminal session {id}: {message}")]
    Kill { id: String, message: String },
    #[error(
        "terminal session {id} cannot replay output after sequence {after_sequence}; retained output starts at sequence {oldest_sequence}"
    )]
    ReplayUnavailable {
        id: String,
        after_sequence: u64,
        oldest_sequence: u64,
    },
}

impl serde::Serialize for TerminalError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[derive(Clone, Default)]
pub struct TerminalRegistry {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

#[derive(Clone)]
struct TerminalOutputChunk {
    sequence: u64,
    data: String,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    subscribers: Vec<TerminalSubscriber>,
    next_sequence: u64,
    replay_chunks: VecDeque<TerminalOutputChunk>,
    replay_buffer_bytes: usize,
}

struct TerminalSubscriber {
    id: String,
    on_event: Channel<TerminalEvent>,
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_spawn(
    input: TerminalSpawnInput,
    on_event: Channel<TerminalEvent>,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let pty_size = validate_size(input.size)?;
    let working_directory = validate_working_directory(&input.options.working_directory)?;
    let id = input.id;
    {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| TerminalError::RegistryPoisoned)?;
        if let Some(session) = sessions.get_mut(&id) {
            let replay_chunks = replay_chunks_after(session, &id, input.after_sequence)?;
            session.subscribers.clear();
            session.subscribers.push(TerminalSubscriber {
                id: input.subscription_id,
                on_event: on_event.clone(),
            });
            drop(sessions);

            for chunk in replay_chunks {
                if on_event
                    .send(TerminalEvent::Output {
                        id: id.clone(),
                        sequence: chunk.sequence,
                        data: chunk.data,
                    })
                    .is_err()
                {
                    return Ok(());
                }
            }

            return Ok(());
        }
    }

    let shell = default_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size)
        .map_err(|error| TerminalError::OpenPty(error.to_string()))?;

    let mut command = CommandBuilder::new(&shell);
    command.cwd(&working_directory);
    let mut child =
        pair.slave
            .spawn_command(command)
            .map_err(|error| TerminalError::SpawnShell {
                shell: shell.clone(),
                message: error.to_string(),
            })?;
    let killer = child.clone_killer();
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            kill_spawned_child(&id, &mut child)?;
            return Err(TerminalError::CloneReader {
                id: id.clone(),
                message: error.to_string(),
            });
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            kill_spawned_child(&id, &mut child)?;
            return Err(TerminalError::TakeWriter {
                id: id.clone(),
                message: error.to_string(),
            });
        }
    };

    {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| TerminalError::RegistryPoisoned)?;
        if sessions.contains_key(&id) {
            kill_spawned_child(&id, &mut child)?;
            return Err(TerminalError::DuplicateSession(id));
        }
        sessions.insert(
            id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                killer,
                subscribers: vec![TerminalSubscriber {
                    id: input.subscription_id,
                    on_event,
                }],
                next_sequence: 1,
                replay_chunks: VecDeque::new(),
                replay_buffer_bytes: 0,
            },
        );
    }

    spawn_output_reader(id.clone(), reader, registry.sessions.clone());
    spawn_exit_waiter(id, registry.sessions.clone(), child);

    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_attach(
    input: TerminalAttachInput,
    on_event: Channel<TerminalEvent>,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(&input.id)
        .ok_or_else(|| TerminalError::MissingSession(input.id.clone()))?;
    let replay_chunks = replay_chunks_after(session, &input.id, input.after_sequence)?;

    session.subscribers.clear();
    session.subscribers.push(TerminalSubscriber {
        id: input.subscription_id,
        on_event: on_event.clone(),
    });
    drop(sessions);

    for chunk in replay_chunks {
        if on_event
            .send(TerminalEvent::Output {
                id: input.id.clone(),
                sequence: chunk.sequence,
                data: chunk.data,
            })
            .is_err()
        {
            return Ok(());
        }
    }

    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_detach(
    id: &str,
    subscription_id: &str,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    session
        .subscribers
        .retain(|subscriber| subscriber.id != subscription_id);
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_write(
    id: &str,
    data: &str,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|()| session.writer.flush())
        .map_err(|error| TerminalError::Write {
            id: id.to_string(),
            message: error.to_string(),
        })
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_resize(
    id: &str,
    size: TerminalSize,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let pty_size = validate_size(size)?;
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    session
        .master
        .resize(pty_size)
        .map_err(|error| TerminalError::Resize {
            id: id.to_string(),
            message: error.to_string(),
        })
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub fn terminal_kill(
    id: &str,
    registry: tauri::State<'_, TerminalRegistry>,
) -> Result<(), TerminalError> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    session.killer.kill().map_err(|error| TerminalError::Kill {
        id: id.to_string(),
        message: error.to_string(),
    })?;
    sessions.remove(id);
    Ok(())
}

fn kill_spawned_child(
    id: &str,
    child: &mut Box<dyn portable_pty::Child + Send + Sync>,
) -> Result<(), TerminalError> {
    child.kill().map_err(|error| TerminalError::Kill {
        id: id.to_string(),
        message: error.to_string(),
    })
}

fn validate_working_directory(working_directory: &str) -> Result<String, TerminalError> {
    let trimmed_working_directory = working_directory.trim();
    if trimmed_working_directory.is_empty() {
        return Err(TerminalError::MissingWorkingDirectory);
    }

    let path = Path::new(trimmed_working_directory);
    if !path.exists() {
        return Err(TerminalError::WorkingDirectoryDoesNotExist(
            trimmed_working_directory.to_string(),
        ));
    }

    if !path.is_dir() {
        return Err(TerminalError::WorkingDirectoryIsNotDirectory(
            trimmed_working_directory.to_string(),
        ));
    }

    Ok(trimmed_working_directory.to_string())
}

fn validate_size(size: TerminalSize) -> Result<PtySize, TerminalError> {
    if size.rows == 0 || size.cols == 0 {
        return Err(TerminalError::InvalidSize {
            rows: size.rows,
            cols: size.cols,
        });
    }

    Ok(PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn default_shell() -> String {
    // TODO(#1): Replace this platform default with a settings-backed shell preference.
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }

    #[cfg(not(windows))]
    {
        match std::env::var("SHELL") {
            Ok(shell) => shell,
            Err(_) => "/bin/sh".to_string(),
        }
    }
}

fn spawn_output_reader(
    id: String,
    mut reader: Box<dyn Read + Send>,
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
) {
    let _reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                    if broadcast_terminal_output(&sessions, &id, data).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _broadcast_result = broadcast_terminal_event(
                        &sessions,
                        &id,
                        &TerminalEvent::Error {
                            id: id.clone(),
                            message: format!("failed to read terminal output: {error}"),
                        },
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_exit_waiter(
    id: String,
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) {
    let _waiter_thread = thread::spawn(move || match child.wait() {
        Ok(status) => {
            let _broadcast_result = broadcast_terminal_event(
                &sessions,
                &id,
                &TerminalEvent::Exited {
                    id: id.clone(),
                    code: status.exit_code(),
                },
            );
            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&id);
            }
        }
        Err(error) => {
            let _broadcast_result = broadcast_terminal_event(
                &sessions,
                &id,
                &TerminalEvent::Error {
                    id: id.clone(),
                    message: format!("failed to wait for terminal process: {error}"),
                },
            );
        }
    });
}

fn broadcast_terminal_output(
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: &str,
    data: String,
) -> Result<(), TerminalError> {
    let mut sessions = sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    let sequence = session.next_sequence;
    session.next_sequence = session.next_sequence.saturating_add(1);
    append_terminal_replay(session, sequence, data.clone());
    let event = TerminalEvent::Output {
        id: id.to_string(),
        sequence,
        data,
    };
    session
        .subscribers
        .retain(|subscriber| subscriber.on_event.send(event.clone()).is_ok());
    Ok(())
}

fn broadcast_terminal_event(
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: &str,
    event: &TerminalEvent,
) -> Result<(), TerminalError> {
    let mut sessions = sessions
        .lock()
        .map_err(|_| TerminalError::RegistryPoisoned)?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| TerminalError::MissingSession(id.to_string()))?;
    session
        .subscribers
        .retain(|subscriber| subscriber.on_event.send(event.clone()).is_ok());
    Ok(())
}

fn replay_chunks_after(
    session: &TerminalSession,
    id: &str,
    after_sequence: u64,
) -> Result<Vec<TerminalOutputChunk>, TerminalError> {
    let oldest_sequence = match session.replay_chunks.front() {
        Some(chunk) => chunk.sequence,
        None => return Ok(Vec::new()),
    };

    if after_sequence != 0 && oldest_sequence > after_sequence.saturating_add(1) {
        return Err(TerminalError::ReplayUnavailable {
            id: id.to_string(),
            after_sequence,
            oldest_sequence,
        });
    }

    Ok(session
        .replay_chunks
        .iter()
        .filter(|chunk| chunk.sequence > after_sequence)
        .cloned()
        .collect())
}

fn append_terminal_replay(session: &mut TerminalSession, sequence: u64, data: String) {
    session.replay_buffer_bytes = session.replay_buffer_bytes.saturating_add(data.len());
    session
        .replay_chunks
        .push_back(TerminalOutputChunk { sequence, data });

    while session.replay_buffer_bytes > TERMINAL_REPLAY_BUFFER_LIMIT {
        let Some(chunk) = session.replay_chunks.pop_front() else {
            session.replay_buffer_bytes = 0;
            return;
        };
        session.replay_buffer_bytes = session.replay_buffer_bytes.saturating_sub(chunk.data.len());
    }
}
