use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};

const IDENTITY_KEY: &str = "desktop.signin.identity";
const KEYRING_SERVICE: &str = "com.kira.desktop";
const KEYRING_ACCOUNT: &str = "organization-desktop-access";
const CALLBACK_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, thiserror::Error)]
pub enum SigninError {
    #[error("Failed to reach admin: {0}")]
    Unreachable(String),
    #[error("Admin returned an unexpected response: {0}")]
    UnexpectedResponse(String),
    #[error("Failed to open the sign-in page: {0}")]
    OpenFailed(String),
    #[error("Sign-in timed out before completing")]
    TimedOut,
    #[error("Sign-in could not be verified (state mismatch)")]
    StateMismatch,
    #[error("Local sign-in listener failed: {0}")]
    Loopback(String),
    #[error("Failed to store the sign-in credential: {0}")]
    StorageFailed(String),
    #[error("Failed to read local sign-in state: {0}")]
    LocalState(String),
}

impl serde::Serialize for SigninError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Non-secret sign-in identity persisted in `app_settings`. The credential
/// itself lives in the OS keychain, never here.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SigninIdentity {
    user_name: String,
    user_email: String,
    organization_id: String,
    organization_name: String,
    org_role: Option<String>,
    is_platform_admin: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigninStatus {
    pub signed_in: bool,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub organization_id: Option<String>,
    pub organization_name: Option<String>,
    pub org_role: Option<String>,
    pub is_platform_admin: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigninComplete {
    pub user_name: String,
    pub user_email: String,
    pub organization_id: String,
    pub organization_name: String,
    pub org_role: Option<String>,
    pub is_platform_admin: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimResponse {
    api_key: String,
    organization_id: String,
    organization_name: String,
    user_name: String,
    user_email: String,
    #[serde(default)]
    org_role: Option<String>,
    is_platform_admin: bool,
}

/// Reads the stored desktop-access credential from the OS keychain. Returns
/// `None` when the user is not signed in.
#[must_use]
pub fn stored_credential() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).ok()?;
    entry.get_password().ok()
}

fn credential_entry() -> Result<keyring::Entry, SigninError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| SigninError::StorageFailed(error.to_string()))
}

fn store_credential(secret: &str) -> Result<(), SigninError> {
    credential_entry()?
        .set_password(secret)
        .map_err(|error| SigninError::StorageFailed(error.to_string()))
}

fn clear_credential() -> Result<(), SigninError> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SigninError::StorageFailed(error.to_string())),
    }
}

async fn read_identity(pool: &SqlitePool) -> Result<Option<SigninIdentity>, SigninError> {
    let raw = crate::settings::app_setting_value(pool, IDENTITY_KEY)
        .await
        .map_err(SigninError::LocalState)?;
    match raw {
        Some(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|error| SigninError::LocalState(error.to_string())),
        None => Ok(None),
    }
}

async fn write_identity(pool: &SqlitePool, identity: &SigninIdentity) -> Result<(), SigninError> {
    let raw = serde_json::to_string(identity)
        .map_err(|error| SigninError::LocalState(error.to_string()))?;
    crate::settings::upsert_app_setting(pool, IDENTITY_KEY, &raw)
        .await
        .map_err(SigninError::LocalState)
}

async fn clear_identity(pool: &SqlitePool) -> Result<(), SigninError> {
    sqlx::query("DELETE FROM app_settings WHERE key = ?")
        .bind(IDENTITY_KEY)
        .execute(pool)
        .await
        .map_err(|error| SigninError::LocalState(error.to_string()))?;
    Ok(())
}

async fn respond(stream: &mut tokio::net::TcpStream, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Kira</title></head>\
         <body style=\"font-family:sans-serif;text-align:center;padding-top:4rem\">\
         <h1>{message}</h1></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

/// Waits for the browser to redirect to the loopback callback and returns the
/// `(code, state)` pair from its query string.
async fn accept_callback(listener: &TcpListener) -> Result<(String, String), SigninError> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|error| SigninError::Loopback(error.to_string()))?;

        let mut buffer = [0u8; 4096];
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| SigninError::Loopback(error.to_string()))?;
        let request = String::from_utf8_lossy(&buffer[..read]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1));

        let Some(target) = target else {
            respond(&mut stream, "Bad request.").await;
            continue;
        };

        if !target.starts_with("/callback") {
            respond(&mut stream, "Waiting for sign-in...").await;
            continue;
        }

        let Ok(url) = reqwest::Url::parse(&format!("http://localhost{target}")) else {
            respond(&mut stream, "Bad request.").await;
            continue;
        };

        let mut code = None;
        let mut state = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => state = Some(value.into_owned()),
                _ => {}
            }
        }

        if let (Some(code), Some(state)) = (code, state) {
            respond(&mut stream, "Signed in. You can return to Kira.").await;
            return Ok((code, state));
        }

        respond(&mut stream, "Missing sign-in parameters.").await;
    }
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_signin_status(
    store: State<'_, crate::persistence::PersistenceStore>,
) -> Result<SigninStatus, SigninError> {
    match (stored_credential(), read_identity(store.pool()).await?) {
        (Some(_), Some(identity)) => Ok(SigninStatus {
            signed_in: true,
            user_name: Some(identity.user_name),
            user_email: Some(identity.user_email),
            organization_id: Some(identity.organization_id),
            organization_name: Some(identity.organization_name),
            org_role: identity.org_role,
            is_platform_admin: identity.is_platform_admin,
        }),
        _ => Ok(SigninStatus {
            signed_in: false,
            user_name: None,
            user_email: None,
            organization_id: None,
            organization_name: None,
            org_role: None,
            is_platform_admin: false,
        }),
    }
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_signin_begin(
    app: AppHandle,
    store: State<'_, crate::persistence::PersistenceStore>,
) -> Result<SigninComplete, SigninError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| SigninError::Loopback(error.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|error| SigninError::Loopback(error.to_string()))?
        .port();

    let state = uuid::Uuid::new_v4().to_string();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let signin_url_base = format!("{}/desktop-signin", crate::cloud_api::cloud_base_url());
    let mut signin_url = reqwest::Url::parse(&signin_url_base)
        .map_err(|error| SigninError::UnexpectedResponse(error.to_string()))?;
    signin_url
        .query_pairs_mut()
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state);

    app.opener()
        .open_url(signin_url.as_str(), None::<&str>)
        .map_err(|error| SigninError::OpenFailed(error.to_string()))?;

    let (code, returned_state) = match timeout(
        Duration::from_secs(CALLBACK_TIMEOUT_SECS),
        accept_callback(&listener),
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => return Err(SigninError::TimedOut),
    };

    if returned_state != state {
        return Err(SigninError::StateMismatch);
    }

    let client =
        crate::cloud_api::client().map_err(|error| SigninError::Unreachable(error.to_string()))?;
    let response = client
        .post(format!(
            "{}/api/desktop/signin/claim",
            crate::cloud_api::cloud_base_url()
        ))
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|error| SigninError::Unreachable(error.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(SigninError::UnexpectedResponse(format!(
            "signin/claim returned {status}"
        )));
    }
    let claim: ClaimResponse = response
        .json()
        .await
        .map_err(|error| SigninError::UnexpectedResponse(error.to_string()))?;
    store_credential(&claim.api_key)?;
    write_identity(
        store.pool(),
        &SigninIdentity {
            user_name: claim.user_name.clone(),
            user_email: claim.user_email.clone(),
            organization_id: claim.organization_id.clone(),
            organization_name: claim.organization_name.clone(),
            org_role: claim.org_role.clone(),
            is_platform_admin: claim.is_platform_admin,
        },
    )
    .await?;
    Ok(SigninComplete {
        user_name: claim.user_name,
        user_email: claim.user_email,
        organization_id: claim.organization_id,
        organization_name: claim.organization_name,
        org_role: claim.org_role,
        is_platform_admin: claim.is_platform_admin,
    })
}

#[tauri::command]
#[allow(clippy::used_underscore_binding)]
pub async fn desktop_sign_out(
    store: State<'_, crate::persistence::PersistenceStore>,
) -> Result<(), SigninError> {
    clear_credential()?;
    clear_identity(store.pool()).await?;
    Ok(())
}
