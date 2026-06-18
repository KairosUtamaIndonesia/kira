//! Shared HTTP access to the hosted cloud API.
//!
//! All desktop-to-cloud calls go through [`client`] so the dev-environment
//! transport quirks are handled in exactly one place.

const DEFAULT_CLOUD_URL: &str = "https://cloud.kira.localhost";
const DEFAULT_CLOUD_HOST: &str = "cloud.kira.localhost";

/// Returns the cloud base URL. Override with the `KIRA_CLOUD_URL` env var.
pub fn cloud_base_url() -> String {
    std::env::var("KIRA_CLOUD_URL").unwrap_or_else(|_| DEFAULT_CLOUD_URL.to_owned())
}

/// Returns the hostname of the cloud app, derived from the cloud base URL.
pub fn cloud_host() -> String {
    reqwest::Url::parse(&cloud_base_url())
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_CLOUD_HOST.to_owned())
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
pub fn client() -> Result<reqwest::Client, reqwest::Error> {
    let builder = reqwest::Client::builder();

    #[cfg(debug_assertions)]
    let builder = builder
        .resolve(
            &cloud_host(),
            std::net::SocketAddr::from(([127, 0, 0, 1], 443)),
        )
        .danger_accept_invalid_certs(true);

    builder.build()
}
