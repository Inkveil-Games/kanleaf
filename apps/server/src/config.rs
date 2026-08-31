use std::{
    env,
    ffi::OsString,
    net::{AddrParseError, SocketAddr},
    path::PathBuf,
    time::Duration,
};

use http::HeaderValue;
use thiserror::Error;

use crate::domain::NormalizedEmail;

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
    pub web_dir: Option<PathBuf>,
    pub host_email: Option<NormalizedEmail>,
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
    #[error("KANLEAF_WEB_DIR must be a directory containing a readable index.html")]
    InvalidWebDir,
    #[error("KANLEAF_HOST_EMAIL must be a valid email address")]
    InvalidHostEmail,
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
        let web_dir = parse_web_dir(env::var_os("KANLEAF_WEB_DIR"))?;
        let host_email = parse_host_email(env::var_os("KANLEAF_HOST_EMAIL"))?;

        Ok(Self {
            database_url,
            data_dir,
            bind_address,
            cors_origins,
            session_ttl,
            web_dir,
            host_email,
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

fn parse_web_dir(value: Option<OsString>) -> Result<Option<PathBuf>, ConfigError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_empty() {
        return Err(ConfigError::InvalidWebDir);
    }

    let path = PathBuf::from(value);
    let index = path.join("index.html");
    if !path.is_dir() || !index.is_file() || std::fs::File::open(index).is_err() {
        return Err(ConfigError::InvalidWebDir);
    }

    Ok(Some(path))
}

fn parse_host_email(value: Option<OsString>) -> Result<Option<NormalizedEmail>, ConfigError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value
        .into_string()
        .map_err(|_| ConfigError::InvalidHostEmail)?;
    if value.trim().is_empty() {
        return Ok(None);
    }

    NormalizedEmail::new(&value)
        .map(Some)
        .map_err(|_| ConfigError::InvalidHostEmail)
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, fs, time::Duration};

    use tempfile::TempDir;

    use super::{
        parse_bind_address, parse_cors_origins, parse_host_email, parse_session_ttl, parse_web_dir,
    };

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

    #[test]
    fn accepts_an_optional_web_directory_with_an_index() {
        assert_eq!(parse_web_dir(None).unwrap(), None);

        let web_dir = TempDir::new().unwrap();
        fs::write(web_dir.path().join("index.html"), "<main>Kanleaf</main>").unwrap();

        assert_eq!(
            parse_web_dir(Some(web_dir.path().as_os_str().to_owned())).unwrap(),
            Some(web_dir.path().to_owned())
        );
    }

    #[test]
    fn rejects_empty_or_incomplete_web_directories() {
        assert!(parse_web_dir(Some(OsString::new())).is_err());

        let web_dir = TempDir::new().unwrap();
        assert!(parse_web_dir(Some(web_dir.path().as_os_str().to_owned())).is_err());
    }

    #[test]
    fn parses_an_optional_normalized_host_email() {
        assert_eq!(parse_host_email(None).unwrap(), None);
        assert_eq!(parse_host_email(Some(OsString::from("   "))).unwrap(), None);

        let email = parse_host_email(Some(OsString::from(" Host@Example.COM ")))
            .unwrap()
            .unwrap();
        assert_eq!(email.as_str(), "host@example.com");
    }

    #[test]
    fn rejects_an_invalid_non_empty_host_email() {
        assert!(parse_host_email(Some(OsString::from("not-an-email"))).is_err());
    }
}
