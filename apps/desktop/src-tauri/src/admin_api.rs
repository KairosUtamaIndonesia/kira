//! Shared HTTP access to the hosted cloud API.
//!
//! All desktop-to-cloud calls go through [`client`] so the dev-environment
//! transport quirks are handled in exactly one place.

#[derive(Debug, thiserror::Error)]
pub enum CloudConfigError {
    #[error("KIRA_CLOUD_URL environment variable is not set. Set it in apps/desktop/src-tauri/.env or your shell.")]
    MissingCloudUrl,
    #[error("KIRA_CLOUD_URL is not a valid URL: {0}")]
    InvalidCloudUrl(String),
    #[error("Failed to build HTTP client: {0}")]
    HttpClient(String),
}

impl serde::Serialize for CloudConfigError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Returns the cloud base URL from the `KIRA_CLOUD_URL` env var.
///
/// # Errors
///
/// Returns [`CloudConfigError::MissingCloudUrl`] if the env var is not set,
/// or [`CloudConfigError::InvalidCloudUrl`] if it is not a valid URL.
pub fn cloud_base_url() -> Result<String, CloudConfigError> {
    let raw = std::env::var("KIRA_CLOUD_URL").map_err(|_| CloudConfigError::MissingCloudUrl)?;
    reqwest::Url::parse(&raw)
        .map(|url| url.to_string())
        .map_err(|e| CloudConfigError::InvalidCloudUrl(format!("{e}: {raw}")))
}

/// Returns the hostname of the cloud app, derived from the cloud base URL.
///
/// # Errors
///
/// Returns [`CloudConfigError`] if `KIRA_CLOUD_URL` is missing or invalid.
pub fn cloud_host() -> Result<String, CloudConfigError> {
    let url = cloud_base_url()?;
    reqwest::Url::parse(&url)
        .map_err(|e| CloudConfigError::InvalidCloudUrl(e.to_string()))?
        .host_str()
        .map(str::to_owned)
        .ok_or_else(|| CloudConfigError::InvalidCloudUrl(format!("no hostname in {url}")))
}

/// Builds a `reqwest` client configured for the hosted cloud API.
///
/// In dev builds the cloud app is served by `portless` on loopback `:443` with a
/// locally generated CA. Two things break native HTTP clients there that do not
/// affect the Chromium webview:
///
/// 1. The OS resolver does not map `*.localhost` to loopback (only browsers
///    do), so we pin the host to `127.0.0.1:443` explicitly.
/// 2. `reqwest`'s bundled roots do not trust the portless CA, so we accept the
///    local certificate.
///
/// Both are gated to debug builds; release builds use normal DNS and TLS.
///
/// # Errors
///
/// Returns an error if the underlying TLS backend fails to initialize.
pub fn client() -> Result<reqwest::Client, CloudConfigError> {
    let builder = reqwest::Client::builder();

    #[cfg(debug_assertions)]
    let builder = builder
        .resolve(
            &cloud_host()?,
            std::net::SocketAddr::from(([127, 0, 0, 1], 443)),
        )
        .danger_accept_invalid_certs(true);

    builder
        .build()
        .map_err(|e| CloudConfigError::HttpClient(e.to_string()))
}
