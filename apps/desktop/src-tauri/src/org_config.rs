use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::persistence::PersistenceStore;
use crate::settings::{app_setting_value, upsert_app_setting};

const ORG_MODEL_CATALOG_KEY: &str = "desktop.org.modelCatalog";
const ADMIN_API_URL: &str = "https://admin.kira.localhost/api/desktop/models";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub label: String,
    pub upstream_model_id: String,
    pub provider_id: String,
    pub provider_base_url: String,
    pub context_window: i32,
    pub max_output_tokens: i32,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<ModelConfig>,
}

#[derive(Debug, thiserror::Error)]
pub enum OrgConfigError {
    #[error("Failed to fetch model catalog: {0}")]
    FetchFailed(String),
    #[error("Failed to parse model catalog: {0}")]
    ParseFailed(String),
    #[error("No model catalog cached and admin is unreachable")]
    NoCacheAvailable,
    #[error("API key not configured")]
    ApiKeyNotConfigured,
}

impl serde::Serialize for OrgConfigError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub async fn get_model_catalog(pool: &SqlitePool) -> Result<ModelCatalog, OrgConfigError> {
    let cached: Option<String> = app_setting_value(pool, ORG_MODEL_CATALOG_KEY)
        .await
        .map_err(|e| OrgConfigError::FetchFailed(e.clone()))?;

    if let Some(raw) = cached {
        serde_json::from_str(&raw).map_err(|e| OrgConfigError::ParseFailed(e.to_string()))
    } else {
        Err(OrgConfigError::NoCacheAvailable)
    }
}

pub async fn refresh_model_catalog(pool: &SqlitePool) -> Result<ModelCatalog, OrgConfigError> {
    let api_key =
        crate::desktop_signin::stored_credential().ok_or(OrgConfigError::ApiKeyNotConfigured)?;

    let client =
        crate::admin_api::client().map_err(|e| OrgConfigError::FetchFailed(e.to_string()))?;
    let response = client
        .get(ADMIN_API_URL)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| OrgConfigError::FetchFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(OrgConfigError::FetchFailed(format!(
            "Admin returned {status}: {body}"
        )));
    }

    let catalog: ModelCatalog = response
        .json()
        .await
        .map_err(|e| OrgConfigError::ParseFailed(e.to_string()))?;

    let raw =
        serde_json::to_string(&catalog).map_err(|e| OrgConfigError::ParseFailed(e.to_string()))?;

    upsert_app_setting(pool, ORG_MODEL_CATALOG_KEY, &raw)
        .await
        .map_err(|e| OrgConfigError::FetchFailed(e.clone()))?;

    Ok(catalog)
}

pub async fn get_or_refresh_model_catalog(
    pool: &SqlitePool,
) -> Result<ModelCatalog, OrgConfigError> {
    match get_model_catalog(pool).await {
        Ok(catalog) => Ok(catalog),
        Err(OrgConfigError::NoCacheAvailable) => refresh_model_catalog(pool).await,
        Err(other) => Err(other),
    }
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_org_models_get(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<ModelCatalog, OrgConfigError> {
    get_model_catalog(store.pool()).await
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_org_models_refresh(
    store: tauri::State<'_, PersistenceStore>,
) -> Result<ModelCatalog, OrgConfigError> {
    refresh_model_catalog(store.pool()).await
}
