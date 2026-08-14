use serde::{Deserialize, Serialize};

use crate::api::post_json;

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

pub async fn email_exists(email: &str) -> Result<bool, String> {
    post_json::<_, EmailStatusResponse>("/api/auth/email", None, &EmailRequest { email })
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
        None,
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
    post_json::<_, AuthResponse>("/api/auth/login", None, &LoginRequest { email, password })
        .await
        .map(|response| response.token)
}

pub async fn logout(token: &str) -> Result<(), String> {
    post_json::<_, MessageResponse>("/api/auth/logout", None, &LogoutRequest { token })
        .await
        .map(|_| ())
}

pub async fn request_password_reset(email: &str) -> Result<String, String> {
    post_json::<_, MessageResponse>("/api/auth/forgot-password", None, &EmailRequest { email })
        .await
        .map(|response| response.message)
}
