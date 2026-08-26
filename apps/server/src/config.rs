use std::{
    env,
    net::{AddrParseError, SocketAddr},
    path::PathBuf,
    time::Duration,
};

use http::HeaderValue;
use thiserror::Error;

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:3000";
const DEFAULT_CORS_ORIGINS: &str =
    "http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost";
const DEFAULT_DATA_DIR: &str = "./data";
const DEFAULT_SESSION_TTL_DAYS: &str = "30";

pub struct Config {
    pub database_url: String,
    pub data_dir: PathBuf,
    pub bind_address: SocketAddr,
    pub cors_origins: Vec<HeaderValue>,
    pub session_ttl: Duration,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("required environment variable {0} is missing")]
    Missing(&'static str),
    #[error("KANLEAF_BIND_ADDRESS must be a socket address: {0}")]
    InvalidBindAddress(#[from] AddrParseError),
    #[error("KANLEAF_CORS_ORIGINS contains an invalid origin: {0}")]
    InvalidCorsOrigin(String),
    #[error("KANLEAF_CORS_ORIGINS must contain at least one origin")]
    EmptyCorsOrigins,
    #[error("KANLEAF_SESSION_TTL_DAYS must be a positive whole number")]
    InvalidSessionTtl,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url =
            env::var("DATABASE_URL").map_err(|_| ConfigError::Missing("DATABASE_URL"))?;
        let data_dir = env::var("KANLEAF_DATA_DIR")
            .unwrap_or_else(|_| DEFAULT_DATA_DIR.to_owned())
            .into();
        let bind_address = parse_bind_address(
            &env::var("KANLEAF_BIND_ADDRESS").unwrap_or_else(|_| DEFAULT_BIND_ADDRESS.to_owned()),
        )?;
        let cors_origins = parse_cors_origins(
            &env::var("KANLEAF_CORS_ORIGINS").unwrap_or_else(|_| DEFAULT_CORS_ORIGINS.to_owned()),
        )?;
        let session_ttl = parse_session_ttl(
            &env::var("KANLEAF_SESSION_TTL_DAYS")
                .unwrap_or_else(|_| DEFAULT_SESSION_TTL_DAYS.to_owned()),
        )?;

        Ok(Self {
            database_url,
            data_dir,
            bind_address,
            cors_origins,
            session_ttl,
        })
    }
}

fn parse_bind_address(value: &str) -> Result<SocketAddr, ConfigError> {
    Ok(value.parse()?)
}

fn parse_cors_origins(value: &str) -> Result<Vec<HeaderValue>, ConfigError> {
    let origins = value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(|origin| {
            HeaderValue::from_str(origin)
                .map_err(|_| ConfigError::InvalidCorsOrigin(origin.to_owned()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if origins.is_empty() {
        return Err(ConfigError::EmptyCorsOrigins);
    }

    Ok(origins)
}

fn parse_session_ttl(value: &str) -> Result<Duration, ConfigError> {
    let days = value
        .parse::<u64>()
        .ok()
        .filter(|days| *days > 0)
        .ok_or(ConfigError::InvalidSessionTtl)?;
    let seconds = days
        .checked_mul(24 * 60 * 60)
        .ok_or(ConfigError::InvalidSessionTtl)?;
    Ok(Duration::from_secs(seconds))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{parse_bind_address, parse_cors_origins, parse_session_ttl};

    #[test]
    fn parses_server_configuration_values() {
        assert_eq!(parse_bind_address("0.0.0.0:8080").unwrap().port(), 8080);
        assert_eq!(
            parse_cors_origins("https://kanleaf.example.com, tauri://localhost")
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            parse_session_ttl("7").unwrap(),
            Duration::from_secs(7 * 24 * 60 * 60)
        );
    }

    #[test]
    fn rejects_empty_origins_and_non_positive_session_ttl() {
        assert!(parse_cors_origins(" , ").is_err());
        assert!(parse_session_ttl("0").is_err());
        assert!(parse_session_ttl("many").is_err());
    }
}
