//! Shared HTTP access to the hosted cloud API.
//!
//! All desktop-to-cloud calls go through [`client`] so the dev-environment
//! transport quirks are handled in exactly one place.
//!
//! The cloud URL is baked into the binary at compile time via `KIRA_CLOUD_URL`.
//! Set it in `.env` for local dev, or as a CI/repo variable in GitHub Actions.

/// The cloud admin URL, embedded at compile time via `env!("KIRA_CLOUD_URL")`.
/// Set `KIRA_CLOUD_URL` in `.env` or your shell before building.
pub fn cloud_base_url() -> &'static str {
    env!("KIRA_CLOUD_URL")
}

/// The hostname of the cloud app, derived from [`cloud_base_url()`].
#[allow(clippy::expect_used)]
pub fn cloud_host() -> String {
    let url = reqwest::Url::parse(cloud_base_url()).expect("KIRA_CLOUD_URL must be a valid URL");
    url.host_str()
        .expect("KIRA_CLOUD_URL must contain a hostname")
        .to_owned()
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
#[allow(clippy::used_underscore_binding)]
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
