use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;

use crate::persistence::PersistenceStore;

const APPEARANCE_THEME_KEY: &str = "appearance.theme";
const APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY: &str =
    "appearance.agentThread.showRawEventStream";
const DEFAULT_APPEARANCE_THEME: AppearanceTheme = AppearanceTheme::Dark;
const DEFAULT_AGENT_THREAD_SHOW_RAW_EVENT_STREAM: bool = false;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppearanceTheme {
    Light,
    Dark,
}

impl AppearanceTheme {
    const fn as_persisted_value(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn from_persisted_value(value: &str) -> Result<Self, SettingsError> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            invalid => Err(SettingsError::InvalidAppearanceTheme(invalid.to_string())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettingsUpdateInput {
    theme: AppearanceTheme,
    agent_thread_show_raw_event_stream: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    theme: AppearanceTheme,
    agent_thread_show_raw_event_stream: bool,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Appearance theme is invalid in Persistence Store: {0}")]
    InvalidAppearanceTheme(String),
    #[error("Appearance Agent Thread raw event stream setting is invalid in Persistence Store: {0}")]
    InvalidAgentThreadShowRawEventStream(String),
    #[error("failed to read Appearance settings: {0}")]
    Read(String),
    #[error("failed to update Appearance settings: {0}")]
    Update(String),
}

impl serde::Serialize for SettingsError {
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
pub async fn appearance_settings_get(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<AppearanceSettings, SettingsError> {
    get_appearance_settings(store.pool()).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn appearance_settings_update(
    input: AppearanceSettingsUpdateInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<AppearanceSettings, SettingsError> {
    update_appearance_settings(store.pool(), input).await
}

async fn get_appearance_settings(pool: &SqlitePool) -> Result<AppearanceSettings, SettingsError> {
    let stored_theme =
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = ?")
            .bind(APPEARANCE_THEME_KEY)
            .fetch_optional(pool)
            .await
            .map_err(|error| SettingsError::Read(error.to_string()))?;

    let theme = match stored_theme {
        Some(value) => AppearanceTheme::from_persisted_value(&value)?,
        None => DEFAULT_APPEARANCE_THEME,
    };

    let stored_agent_thread_show_raw_event_stream = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = ?",
    )
    .bind(APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY)
    .fetch_optional(pool)
    .await
    .map_err(|error| SettingsError::Read(error.to_string()))?;

    let agent_thread_show_raw_event_stream = match stored_agent_thread_show_raw_event_stream {
        Some(value) => persisted_bool_from_value(&value)?,
        None => DEFAULT_AGENT_THREAD_SHOW_RAW_EVENT_STREAM,
    };

    Ok(AppearanceSettings {
        theme,
        agent_thread_show_raw_event_stream,
    })
}

async fn update_appearance_settings(
    pool: &SqlitePool,
    input: AppearanceSettingsUpdateInput,
) -> Result<AppearanceSettings, SettingsError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| SettingsError::Update(error.to_string()))?;

    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(APPEARANCE_THEME_KEY)
    .bind(input.theme.as_persisted_value())
    .execute(&mut *transaction)
    .await
    .map_err(|error| SettingsError::Update(error.to_string()))?;

    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY)
    .bind(persisted_bool_value(input.agent_thread_show_raw_event_stream))
    .execute(&mut *transaction)
    .await
    .map_err(|error| SettingsError::Update(error.to_string()))?;

    transaction
        .commit()
        .await
        .map_err(|error| SettingsError::Update(error.to_string()))?;

    Ok(AppearanceSettings {
        theme: input.theme,
        agent_thread_show_raw_event_stream: input.agent_thread_show_raw_event_stream,
    })
}

const fn persisted_bool_value(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

fn persisted_bool_from_value(value: &str) -> Result<bool, SettingsError> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        invalid => Err(SettingsError::InvalidAgentThreadShowRawEventStream(
            invalid.to_string(),
        )),
    }
}
