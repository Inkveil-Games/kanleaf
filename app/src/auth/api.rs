use gloo_net::http::Request;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

const API_BASE_URL: &str = "http://127.0.0.1:3000";

#[derive(Serialize)]
struct EmailRequest<'a> {
    email: &'a str,
}

#[derive(Deserialize)]
struct EmailStatusResponse {
    exists: bool,
}

#[derive(Serialize)]
struct RegisterRequest<'a> {
    email: &'a str,
    password: &'a str,
    password_confirmation: &'a str,
}

#[derive(Serialize)]
struct LoginRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct LogoutRequest<'a> {
    token: &'a str,
}

#[derive(Deserialize)]
struct AuthResponse {
    token: String,
}

#[derive(Deserialize)]
struct MessageResponse {
    message: String,
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    message: String,
}

pub async fn email_exists(email: &str) -> Result<bool, String> {
    post_json::<_, EmailStatusResponse>("/api/auth/email", &EmailRequest { email })
        .await
        .map(|response| response.exists)
}

pub async fn register(
    email: &str,
    password: &str,
    password_confirmation: &str,
) -> Result<String, String> {
    post_json::<_, AuthResponse>(
        "/api/auth/register",
        &RegisterRequest {
            email,
            password,
            password_confirmation,
        },
    )
    .await
    .map(|response| response.token)
}

pub async fn login(email: &str, password: &str) -> Result<String, String> {
    post_json::<_, AuthResponse>("/api/auth/login", &LoginRequest { email, password })
        .await
        .map(|response| response.token)
}

pub async fn logout(token: &str) -> Result<(), String> {
    post_json::<_, MessageResponse>("/api/auth/logout", &LogoutRequest { token })
        .await
        .map(|_| ())
}

pub async fn request_password_reset(email: &str) -> Result<String, String> {
    post_json::<_, MessageResponse>("/api/auth/forgot-password", &EmailRequest { email })
        .await
        .map(|response| response.message)
}

async fn post_json<T, R>(path: &str, body: &T) -> Result<R, String>
where
    T: Serialize + ?Sized,
    R: DeserializeOwned,
{
    let response = Request::post(&format!("{API_BASE_URL}{path}"))
        .json(body)
        .map_err(|_| "Could not prepare the request.".to_owned())?
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;

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
