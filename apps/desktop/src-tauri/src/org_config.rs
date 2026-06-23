use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub reasoning: Option<bool>,
    pub thinking: Option<bool>,
    pub tool_calling: Option<bool>,
    pub vision: Option<bool>,
}

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
    pub max_input_tokens: Option<i32>,
    pub capabilities: Option<ModelCapabilities>,
    pub api_key: Option<String>,
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
    #[error("API key not configured")]
    ApiKeyNotConfigured,
}

impl serde::Serialize for OrgConfigError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl IntoResponse for OrgConfigError {
    fn into_response(self) -> Response {
        let status = match &self {
            OrgConfigError::ApiKeyNotConfigured => axum::http::StatusCode::UNAUTHORIZED,
            OrgConfigError::FetchFailed(_) => axum::http::StatusCode::BAD_GATEWAY,
            OrgConfigError::ParseFailed(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            axum::Json(serde_json::json!({"error": self.to_string()})),
        )
            .into_response()
    }
}

pub async fn fetch_model_catalog() -> Result<ModelCatalog, OrgConfigError> {
    let api_key =
        crate::desktop_signin::stored_credential().ok_or(OrgConfigError::ApiKeyNotConfigured)?;

    let client =
        crate::cloud_api::client().map_err(|e| OrgConfigError::FetchFailed(e.to_string()))?;
    let response = client
        .get(format!(
            "{}/api/desktop/models",
            crate::cloud_api::cloud_base_url()
        ))
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| OrgConfigError::FetchFailed(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| OrgConfigError::FetchFailed(e.to_string()))?;

    if !status.is_success() {
        return Err(OrgConfigError::FetchFailed(format!(
            "Admin returned {status}: {body}"
        )));
    }

    serde_json::from_str(&body).map_err(|e| {
        OrgConfigError::ParseFailed(format!("{e}; admin returned {}", response_preview(&body)))
    })
}

fn response_preview(body: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 500;
    let preview: String = body.chars().take(MAX_PREVIEW_CHARS).collect();
    if body.chars().count() > MAX_PREVIEW_CHARS {
        format!("{preview}…")
    } else {
        preview
    }
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_org_models_get() -> Result<ModelCatalog, OrgConfigError> {
    fetch_model_catalog().await
}
