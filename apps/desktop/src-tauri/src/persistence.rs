use std::{path::PathBuf, time::Duration};

use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use tauri::{Manager, Runtime};
use thiserror::Error;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct PersistenceStore {
    pool: SqlitePool,
    app_data_dir: PathBuf,
}

impl PersistenceStore {
    pub fn new(pool: SqlitePool, app_data_dir: PathBuf) -> Self {
        Self { pool, app_data_dir }
    }

    #[must_use]
    pub const fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    #[must_use]
    pub fn app_data_dir(&self) -> &PathBuf {
        &self.app_data_dir
    }
}

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("failed to resolve Kira app data directory for Persistence Store")]
    AppDataDir,
    #[error("failed to create Persistence Store directory `{path}`: {message}")]
    CreateDirectory { path: String, message: String },
    #[error("failed to connect to Persistence Store `{path}`: {message}")]
    Connect { path: String, message: String },
    #[error("failed to migrate Persistence Store `{path}`: {message}")]
    Migrate { path: String, message: String },
    #[error("failed to query Persistence Store health: {0}")]
    Query(String),
}

impl serde::Serialize for PersistenceError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn persistence_store_health(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<i64, PersistenceError> {
    sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(store.pool())
        .await
        .map_err(|error| PersistenceError::Query(error.to_string()))
}

pub async fn initialize<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PersistenceStore, PersistenceError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| PersistenceError::AppDataDir)?;

    // Use a separate database for dev builds so development
    // migration changes never conflict with an installed release's
    // recorded migration checksums.
    let db_name = if tauri::is_dev() { "kira-dev.sqlite3" } else { "kira.sqlite3" };
    let store_path = app_data_dir.join(db_name);
    let store_directory = app_data_dir.clone();

    std::fs::create_dir_all(&store_directory).map_err(|error| {
        PersistenceError::CreateDirectory {
            path: store_directory.display().to_string(),
            message: error.to_string(),
        }
    })?;

    let options = SqliteConnectOptions::new()
        .filename(&store_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|error| PersistenceError::Connect {
            path: store_path.display().to_string(),
            message: error.to_string(),
        })?;

    MIGRATOR
        .run(&pool)
        .await
        .map_err(|error| PersistenceError::Migrate {
            path: store_path.display().to_string(),
            message: error.to_string(),
        })?;

    Ok(PersistenceStore::new(pool, app_data_dir))
}
