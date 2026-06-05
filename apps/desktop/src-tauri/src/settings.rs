use std::{ffi::OsStr, path::Path};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::Manager;
use thiserror::Error;
use uuid::Uuid;

use crate::persistence::PersistenceStore;

const APPEARANCE_THEME_KEY: &str = "appearance.theme";
const APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY: &str =
    "appearance.agentThread.showRawEventStream";
const NOTIFICATION_ENABLED_KEY: &str = "notifications.enabled";
const NOTIFICATION_VOLUME_KEY: &str = "notifications.volume";
const NOTIFICATION_SELECTED_SOUND_ID_KEY: &str = "notifications.selectedSoundId";
const NOTIFICATION_CUSTOM_SOUNDS_KEY: &str = "notifications.customSounds";
const DEFAULT_APPEARANCE_THEME: AppearanceTheme = AppearanceTheme::Dark;
const DEFAULT_AGENT_THREAD_SHOW_RAW_EVENT_STREAM: bool = false;
const DEFAULT_NOTIFICATION_ENABLED: bool = true;
const DEFAULT_NOTIFICATION_VOLUME: f32 = 0.8;
const DEFAULT_NOTIFICATION_SELECTED_SOUND_ID: &str = "bundled:ding";
const MAX_CUSTOM_NOTIFICATION_SOUND_BYTES: usize = 5 * 1024 * 1024;
const CUSTOM_NOTIFICATION_SOUND_DIRECTORY: &str = "notification-sounds";

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettingsUpdateInput {
    enabled: bool,
    volume: f32,
    selected_sound_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSoundImportInput {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledNotificationSound {
    id: String,
    label: String,
    kind: NotificationSoundKind,
    url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomNotificationSound {
    id: String,
    label: String,
    kind: NotificationSoundKind,
    path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationSoundKind {
    Bundled,
    Custom,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    enabled: bool,
    volume: f32,
    selected_sound_id: String,
    bundled_sounds: Vec<BundledNotificationSound>,
    custom_sounds: Vec<CustomNotificationSound>,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Appearance theme is invalid in Persistence Store: {0}")]
    InvalidAppearanceTheme(String),
    #[error(
        "Appearance Agent Thread raw event stream setting is invalid in Persistence Store: {0}"
    )]
    InvalidAgentThreadShowRawEventStream(String),
    #[error("Notification enabled setting is invalid in Persistence Store: {0}")]
    InvalidNotificationEnabled(String),
    #[error("Notification volume setting is invalid in Persistence Store: {0}")]
    InvalidNotificationVolume(String),
    #[error("Notification volume must be between 0 and 1: {0}")]
    NotificationVolumeOutOfRange(f32),
    #[error("Notification selected sound is unknown: {0}")]
    UnknownNotificationSound(String),
    #[error("Notification custom sounds setting is invalid in Persistence Store: {0}")]
    InvalidCustomNotificationSounds(String),
    #[error("Custom notification sound file type is unsupported: {0}")]
    UnsupportedCustomNotificationSoundFile(String),
    #[error("Custom notification sound is too large. Maximum size is 5 MiB")]
    CustomNotificationSoundTooLarge,
    #[error("failed to read Appearance settings: {0}")]
    Read(String),
    #[error("failed to update Appearance settings: {0}")]
    Update(String),
    #[error("failed to import notification sound: {0}")]
    ImportNotificationSound(String),
    #[error("failed to remove notification sound: {0}")]
    RemoveNotificationSound(String),
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

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn notification_settings_get(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<NotificationSettings, SettingsError> {
    get_notification_settings(store.pool()).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State by value"
)]
pub async fn notification_settings_update(
    input: NotificationSettingsUpdateInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<NotificationSettings, SettingsError> {
    update_notification_settings(store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State and AppHandle by value"
)]
pub async fn notification_sound_import(
    app: tauri::AppHandle,
    input: NotificationSoundImportInput,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<CustomNotificationSound, SettingsError> {
    import_notification_sound(&app, store.pool(), input).await
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require State and AppHandle by value"
)]
pub async fn notification_sound_remove(
    app: tauri::AppHandle,
    sound_id: String,
    store: tauri::State<'_, PersistenceStore>,
) -> Result<NotificationSettings, SettingsError> {
    remove_notification_sound(&app, store.pool(), &sound_id).await
}

async fn get_appearance_settings(pool: &SqlitePool) -> Result<AppearanceSettings, SettingsError> {
    let stored_theme = app_setting_value(pool, APPEARANCE_THEME_KEY)
        .await
        .map_err(SettingsError::Read)?;

    let theme = match stored_theme {
        Some(value) => AppearanceTheme::from_persisted_value(&value)?,
        None => DEFAULT_APPEARANCE_THEME,
    };

    let stored_agent_thread_show_raw_event_stream =
        app_setting_value(pool, APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY)
            .await
            .map_err(SettingsError::Read)?;

    let agent_thread_show_raw_event_stream = match stored_agent_thread_show_raw_event_stream {
        Some(value) => persisted_bool_from_value(&value).map_err(|error| match error {
            SettingsError::InvalidNotificationEnabled(value) => {
                SettingsError::InvalidAgentThreadShowRawEventStream(value)
            }
            other => other,
        })?,
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

    upsert_app_setting_in_transaction(
        &mut transaction,
        APPEARANCE_THEME_KEY,
        input.theme.as_persisted_value(),
    )
    .await
    .map_err(SettingsError::Update)?;

    upsert_app_setting_in_transaction(
        &mut transaction,
        APPEARANCE_AGENT_THREAD_SHOW_RAW_EVENT_STREAM_KEY,
        persisted_bool_value(input.agent_thread_show_raw_event_stream),
    )
    .await
    .map_err(SettingsError::Update)?;

    transaction
        .commit()
        .await
        .map_err(|error| SettingsError::Update(error.to_string()))?;

    Ok(AppearanceSettings {
        theme: input.theme,
        agent_thread_show_raw_event_stream: input.agent_thread_show_raw_event_stream,
    })
}

async fn get_notification_settings(
    pool: &SqlitePool,
) -> Result<NotificationSettings, SettingsError> {
    let stored_enabled = app_setting_value(pool, NOTIFICATION_ENABLED_KEY)
        .await
        .map_err(SettingsError::Read)?;
    let enabled = match stored_enabled {
        Some(value) => persisted_bool_from_value(&value)?,
        None => DEFAULT_NOTIFICATION_ENABLED,
    };

    let volume = get_notification_volume(pool).await?;
    let custom_sounds = get_custom_notification_sounds(pool).await?;
    let stored_selected_sound_id = app_setting_value(pool, NOTIFICATION_SELECTED_SOUND_ID_KEY)
        .await
        .map_err(SettingsError::Read)?;
    let selected_sound_id = stored_selected_sound_id
        .unwrap_or_else(|| DEFAULT_NOTIFICATION_SELECTED_SOUND_ID.to_string());
    validate_notification_sound_id(&selected_sound_id, &custom_sounds)?;

    Ok(NotificationSettings {
        enabled,
        volume,
        selected_sound_id,
        bundled_sounds: bundled_notification_sounds(),
        custom_sounds,
    })
}

async fn update_notification_settings(
    pool: &SqlitePool,
    input: NotificationSettingsUpdateInput,
) -> Result<NotificationSettings, SettingsError> {
    let custom_sounds = get_custom_notification_sounds(pool).await?;
    validate_notification_volume(input.volume)?;
    validate_notification_sound_id(&input.selected_sound_id, &custom_sounds)?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| SettingsError::Update(error.to_string()))?;

    upsert_app_setting_in_transaction(
        &mut transaction,
        NOTIFICATION_ENABLED_KEY,
        persisted_bool_value(input.enabled),
    )
    .await
    .map_err(SettingsError::Update)?;

    upsert_app_setting_in_transaction(
        &mut transaction,
        NOTIFICATION_VOLUME_KEY,
        &input.volume.to_string(),
    )
    .await
    .map_err(SettingsError::Update)?;

    upsert_app_setting_in_transaction(
        &mut transaction,
        NOTIFICATION_SELECTED_SOUND_ID_KEY,
        &input.selected_sound_id,
    )
    .await
    .map_err(SettingsError::Update)?;

    transaction
        .commit()
        .await
        .map_err(|error| SettingsError::Update(error.to_string()))?;

    Ok(NotificationSettings {
        enabled: input.enabled,
        volume: input.volume,
        selected_sound_id: input.selected_sound_id,
        bundled_sounds: bundled_notification_sounds(),
        custom_sounds,
    })
}

async fn import_notification_sound(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    input: NotificationSoundImportInput,
) -> Result<CustomNotificationSound, SettingsError> {
    if input.bytes.len() > MAX_CUSTOM_NOTIFICATION_SOUND_BYTES {
        return Err(SettingsError::CustomNotificationSoundTooLarge);
    }

    let extension = validated_audio_extension(&input.file_name)?;
    let id = format!("custom:{}", Uuid::new_v4());
    let file_name = format!("{}.{extension}", id.replace(':', "-"));
    let sound_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| SettingsError::ImportNotificationSound(error.to_string()))?
        .join(CUSTOM_NOTIFICATION_SOUND_DIRECTORY);
    tokio::fs::create_dir_all(&sound_directory)
        .await
        .map_err(|error| SettingsError::ImportNotificationSound(error.to_string()))?;
    let sound_path = sound_directory.join(file_name);
    tokio::fs::write(&sound_path, input.bytes)
        .await
        .map_err(|error| SettingsError::ImportNotificationSound(error.to_string()))?;

    let mut custom_sounds = get_custom_notification_sounds(pool).await?;
    let sound = CustomNotificationSound {
        id,
        label: notification_sound_label_from_file_name(&input.file_name),
        kind: NotificationSoundKind::Custom,
        path: path_to_string(&sound_path)?,
    };
    custom_sounds.push(sound.clone());
    persist_custom_notification_sounds(pool, &custom_sounds).await?;

    Ok(sound)
}

async fn remove_notification_sound(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    sound_id: &str,
) -> Result<NotificationSettings, SettingsError> {
    let mut custom_sounds = get_custom_notification_sounds(pool).await?;
    let sound_index = custom_sounds
        .iter()
        .position(|sound| sound.id == sound_id)
        .ok_or_else(|| SettingsError::UnknownNotificationSound(sound_id.to_string()))?;
    let sound = custom_sounds.remove(sound_index);

    remove_app_owned_notification_sound_file(app, &sound.path).await?;
    persist_custom_notification_sounds(pool, &custom_sounds).await?;

    let current_settings =
        get_notification_settings_without_validation(pool, custom_sounds).await?;
    if current_settings.selected_sound_id == sound_id {
        update_notification_settings(
            pool,
            NotificationSettingsUpdateInput {
                enabled: current_settings.enabled,
                volume: current_settings.volume,
                selected_sound_id: DEFAULT_NOTIFICATION_SELECTED_SOUND_ID.to_string(),
            },
        )
        .await
    } else {
        Ok(current_settings)
    }
}

async fn get_notification_settings_without_validation(
    pool: &SqlitePool,
    custom_sounds: Vec<CustomNotificationSound>,
) -> Result<NotificationSettings, SettingsError> {
    let stored_enabled = app_setting_value(pool, NOTIFICATION_ENABLED_KEY)
        .await
        .map_err(SettingsError::Read)?;
    let enabled = match stored_enabled {
        Some(value) => persisted_bool_from_value(&value)?,
        None => DEFAULT_NOTIFICATION_ENABLED,
    };
    let volume = get_notification_volume(pool).await?;
    let selected_sound_id = app_setting_value(pool, NOTIFICATION_SELECTED_SOUND_ID_KEY)
        .await
        .map_err(SettingsError::Read)?
        .unwrap_or_else(|| DEFAULT_NOTIFICATION_SELECTED_SOUND_ID.to_string());

    Ok(NotificationSettings {
        enabled,
        volume,
        selected_sound_id,
        bundled_sounds: bundled_notification_sounds(),
        custom_sounds,
    })
}

async fn remove_app_owned_notification_sound_file(
    app: &tauri::AppHandle,
    sound_path: &str,
) -> Result<(), SettingsError> {
    let app_sound_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| SettingsError::RemoveNotificationSound(error.to_string()))?
        .join(CUSTOM_NOTIFICATION_SOUND_DIRECTORY);
    let canonical_directory = tokio::fs::canonicalize(&app_sound_directory)
        .await
        .map_err(|error| SettingsError::RemoveNotificationSound(error.to_string()))?;
    let canonical_sound_path = tokio::fs::canonicalize(sound_path)
        .await
        .map_err(|error| SettingsError::RemoveNotificationSound(error.to_string()))?;

    if !canonical_sound_path.starts_with(canonical_directory) {
        return Err(SettingsError::RemoveNotificationSound(format!(
            "refusing to remove a sound outside Kira app data: {sound_path}"
        )));
    }

    tokio::fs::remove_file(canonical_sound_path)
        .await
        .map_err(|error| SettingsError::RemoveNotificationSound(error.to_string()))
}

async fn get_notification_volume(pool: &SqlitePool) -> Result<f32, SettingsError> {
    let stored_volume = app_setting_value(pool, NOTIFICATION_VOLUME_KEY)
        .await
        .map_err(SettingsError::Read)?;
    match stored_volume {
        Some(value) => {
            let volume = value
                .parse::<f32>()
                .map_err(|error| SettingsError::InvalidNotificationVolume(error.to_string()))?;
            validate_notification_volume(volume)?;
            Ok(volume)
        }
        None => Ok(DEFAULT_NOTIFICATION_VOLUME),
    }
}

async fn get_custom_notification_sounds(
    pool: &SqlitePool,
) -> Result<Vec<CustomNotificationSound>, SettingsError> {
    let stored_custom_sounds = app_setting_value(pool, NOTIFICATION_CUSTOM_SOUNDS_KEY)
        .await
        .map_err(SettingsError::Read)?;
    match stored_custom_sounds {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| SettingsError::InvalidCustomNotificationSounds(error.to_string())),
        None => Ok(Vec::new()),
    }
}

async fn persist_custom_notification_sounds(
    pool: &SqlitePool,
    custom_sounds: &[CustomNotificationSound],
) -> Result<(), SettingsError> {
    let value = serde_json::to_string(custom_sounds)
        .map_err(|error| SettingsError::InvalidCustomNotificationSounds(error.to_string()))?;
    upsert_app_setting(pool, NOTIFICATION_CUSTOM_SOUNDS_KEY, &value)
        .await
        .map_err(SettingsError::Update)
}

fn validate_notification_volume(volume: f32) -> Result<(), SettingsError> {
    if (0.0..=1.0).contains(&volume) {
        return Ok(());
    }

    Err(SettingsError::NotificationVolumeOutOfRange(volume))
}

fn validate_notification_sound_id(
    sound_id: &str,
    custom_sounds: &[CustomNotificationSound],
) -> Result<(), SettingsError> {
    if bundled_notification_sounds()
        .iter()
        .any(|sound| sound.id == sound_id)
        || custom_sounds.iter().any(|sound| sound.id == sound_id)
    {
        return Ok(());
    }

    Err(SettingsError::UnknownNotificationSound(
        sound_id.to_string(),
    ))
}

fn bundled_notification_sounds() -> Vec<BundledNotificationSound> {
    [
        ("bundled:beep", "Beep", "/notification-sounds/beep.mp3"),
        ("bundled:blip", "Blip", "/notification-sounds/blip.mp3"),
        ("bundled:blop", "Blop", "/notification-sounds/blop.mp3"),
        ("bundled:bong", "Bong", "/notification-sounds/bong.mp3"),
        ("bundled:clack", "Clack", "/notification-sounds/clack.mp3"),
        ("bundled:ding", "Ding", "/notification-sounds/ding.mp3"),
        ("bundled:sonar", "Sonar", "/notification-sounds/sonar.mp3"),
        ("bundled:thump", "Thump", "/notification-sounds/thump.mp3"),
        (
            "bundled:two-tone",
            "Two-tone",
            "/notification-sounds/two-tone.mp3",
        ),
    ]
    .into_iter()
    .map(|(id, label, url)| BundledNotificationSound {
        id: id.to_string(),
        label: label.to_string(),
        kind: NotificationSoundKind::Bundled,
        url: url.to_string(),
    })
    .collect()
}

fn validated_audio_extension(file_name: &str) -> Result<&'static str, SettingsError> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(OsStr::to_str)
        .ok_or_else(|| {
            SettingsError::UnsupportedCustomNotificationSoundFile(file_name.to_string())
        })?;

    match extension.to_ascii_lowercase().as_str() {
        "mp3" => Ok("mp3"),
        "wav" => Ok("wav"),
        "ogg" => Ok("ogg"),
        "flac" => Ok("flac"),
        "m4a" => Ok("m4a"),
        invalid => Err(SettingsError::UnsupportedCustomNotificationSoundFile(
            invalid.to_string(),
        )),
    }
}

fn notification_sound_label_from_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|stem| !stem.trim().is_empty())
        .map_or_else(|| "Custom sound".to_string(), ToString::to_string)
}

fn path_to_string(path: &Path) -> Result<String, SettingsError> {
    path.to_str().map(ToString::to_string).ok_or_else(|| {
        SettingsError::ImportNotificationSound("sound path is not valid UTF-8".to_string())
    })
}

async fn app_setting_value(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())
}

async fn upsert_app_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn upsert_app_setting_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    key: &str,
    value: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

const fn persisted_bool_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn persisted_bool_from_value(value: &str) -> Result<bool, SettingsError> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        invalid => Err(SettingsError::InvalidNotificationEnabled(
            invalid.to_string(),
        )),
    }
}
