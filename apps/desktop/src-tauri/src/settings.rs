use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;

use crate::persistence::PersistenceStore;

const APPEARANCE_THEME_KEY: &str = "appearance.theme";
const DEFAULT_APPEARANCE_THEME: AppearanceTheme = AppearanceTheme::Dark;

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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    theme: AppearanceTheme,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Appearance theme is invalid in Persistence Store: {0}")]
    InvalidAppearanceTheme(String),
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

    Ok(AppearanceSettings { theme })
}

async fn update_appearance_settings(
    pool: &SqlitePool,
    input: AppearanceSettingsUpdateInput,
) -> Result<AppearanceSettings, SettingsError> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(APPEARANCE_THEME_KEY)
    .bind(input.theme.as_persisted_value())
    .execute(pool)
    .await
    .map_err(|error| SettingsError::Update(error.to_string()))?;

    Ok(AppearanceSettings { theme: input.theme })
}
