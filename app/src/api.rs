use std::cell::RefCell;

use gloo_net::http::{Request, Response};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use url::Url;

pub const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:3000";
#[cfg(target_arch = "wasm32")]
const SERVER_URL_STORAGE_KEY: &str = "kanleaf.server_url";

thread_local! {
    static SERVER_URL: RefCell<String> = RefCell::new(load_server_url());
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    message: String,
}

#[derive(Deserialize)]
struct HealthResponse {
    status: String,
    version: String,
    database: String,
}

pub struct ServerConnection {
    pub url: String,
    pub version: String,
}

pub async fn get_json<R>(path: &str, token: &str) -> Result<R, String>
where
    R: DeserializeOwned,
{
    let response = Request::get(&url(path))
        .header("Authorization", &format!("Bearer {token}"))
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;
    decode(response).await
}

pub async fn post_json<T, R>(path: &str, token: Option<&str>, body: &T) -> Result<R, String>
where
    T: Serialize + ?Sized,
    R: DeserializeOwned,
{
    let mut request = Request::post(&url(path));
    if let Some(token) = token {
        request = request.header("Authorization", &format!("Bearer {token}"));
    }
    let response = request
        .json(body)
        .map_err(|_| "Could not prepare the request.".to_owned())?
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;
    decode(response).await
}

pub async fn patch_json<T, R>(path: &str, token: &str, body: &T) -> Result<R, String>
where
    T: Serialize + ?Sized,
    R: DeserializeOwned,
{
    let response = Request::patch(&url(path))
        .header("Authorization", &format!("Bearer {token}"))
        .json(body)
        .map_err(|_| "Could not prepare the request.".to_owned())?
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;
    decode(response).await
}

async fn decode<R>(response: Response) -> Result<R, String>
where
    R: DeserializeOwned,
{
    if response.ok() {
        response
            .json::<R>()
            .await
            .map_err(|_| "The backend returned an invalid response.".to_owned())
    } else {
        let fallback = format!("The request failed with status {}.", response.status());
        Err(response
            .json::<ApiErrorResponse>()
            .await
            .map(|error| error.message)
            .unwrap_or(fallback))
    }
}

fn url(path: &str) -> String {
    SERVER_URL.with(|server_url| format!("{}{path}", server_url.borrow()))
}

pub fn server_url() -> String {
    SERVER_URL.with(|server_url| server_url.borrow().clone())
}

pub fn configure_server_url(value: &str) -> Result<String, String> {
    let normalized = normalize_server_url(value)?;
    store_server_url(&normalized)?;
    SERVER_URL.with(|server_url| *server_url.borrow_mut() = normalized.clone());
    Ok(normalized)
}

pub async fn check_server(value: &str) -> Result<ServerConnection, String> {
    let url = normalize_server_url(value)?;
    let response = Request::get(&format!("{url}/api/health"))
        .send()
        .await
        .map_err(|_| "Could not reach this server.".to_owned())?;
    let response_ok = response.ok();
    let health = response
        .json::<HealthResponse>()
        .await
        .map_err(|_| "The server responded, but it is not a Kanleaf server.".to_owned())?;

    if health.database != "ok" {
        return Err("The Kanleaf server is reachable, but its database is unavailable.".to_owned());
    }
    if !response_ok || health.status != "ok" {
        return Err("The Kanleaf server is not healthy.".to_owned());
    }

    Ok(ServerConnection {
        url,
        version: health.version,
    })
}

fn normalize_server_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Enter a server URL.".to_owned());
    }

    let parsed = Url::parse(value)
        .map_err(|_| "Enter a valid URL starting with http:// or https://.".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Enter a valid URL starting with http:// or https://.".to_owned());
    }

    Ok(value.trim_end_matches('/').to_owned())
}

fn load_server_url() -> String {
    stored_server_url()
        .and_then(|value| normalize_server_url(&value).ok())
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_owned())
}

#[cfg(target_arch = "wasm32")]
fn stored_server_url() -> Option<String> {
    web_sys::window()?
        .local_storage()
        .ok()??
        .get_item(SERVER_URL_STORAGE_KEY)
        .ok()?
}

#[cfg(not(target_arch = "wasm32"))]
fn stored_server_url() -> Option<String> {
    None
}

#[cfg(target_arch = "wasm32")]
fn store_server_url(value: &str) -> Result<(), String> {
    web_sys::window()
        .and_then(|window| window.local_storage().ok().flatten())
        .ok_or_else(|| "Local storage is not available on this device.".to_owned())?
        .set_item(SERVER_URL_STORAGE_KEY, value)
        .map_err(|_| "Could not save the server URL on this device.".to_owned())
}

#[cfg(not(target_arch = "wasm32"))]
fn store_server_url(_value: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_http_server_urls() {
        assert_eq!(
            normalize_server_url("  http://192.168.1.10:3000///  ").unwrap(),
            "http://192.168.1.10:3000"
        );
        assert_eq!(
            normalize_server_url("https://kanleaf.example.com/").unwrap(),
            "https://kanleaf.example.com"
        );
        assert!(normalize_server_url("").is_err());
        assert!(normalize_server_url("kanleaf.example.com").is_err());
        assert!(normalize_server_url("ftp://kanleaf.example.com").is_err());
    }

    #[test]
    fn configured_server_is_used_for_api_urls() {
        let configured = configure_server_url("http://100.64.0.8:8080/").unwrap();

        assert_eq!(configured, "http://100.64.0.8:8080");
        assert_eq!(
            url("/api/workspaces"),
            "http://100.64.0.8:8080/api/workspaces"
        );

        configure_server_url(DEFAULT_SERVER_URL).unwrap();
    }
}
