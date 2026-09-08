use std::{
    env,
    ffi::OsString,
    net::{AddrParseError, SocketAddr},
    path::PathBuf,
    time::Duration,
};

use http::HeaderValue;
use lettre::Address;
use thiserror::Error;
use url::{Host, Url};

use crate::domain::NormalizedEmail;

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:3000";
const DEFAULT_CORS_ORIGINS: &str =
    "http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost";
const DEFAULT_DATA_DIR: &str = "./data";
const DEFAULT_SESSION_TTL_DAYS: &str = "30";
const DEFAULT_SMTP_PORT: &str = "587";
const DEFAULT_SMTP_SECURITY: &str = "starttls";
const DEFAULT_MAIL_FROM_NAME: &str = "Kanleaf";

pub struct Config {
    pub database_url: String,
    pub data_dir: PathBuf,
    pub bind_address: SocketAddr,
    pub cors_origins: Vec<HeaderValue>,
    pub session_ttl: Duration,
    pub web_dir: Option<PathBuf>,
    pub host_email: Option<NormalizedEmail>,
    pub mail: MailConfig,
}

pub struct MailConfig {
    pub public_url: Option<Url>,
    pub smtp: Option<SmtpConfig>,
}

pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub security: SmtpSecurity,
    pub credentials: Option<SmtpCredentials>,
    pub from_name: String,
    pub from_email: String,
}

pub struct SmtpCredentials {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SmtpSecurity {
    StartTls,
    Tls,
    None,
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
    #[error("{0} must contain valid Unicode")]
    InvalidEnvironmentValue(&'static str),
    #[error(
        "KANLEAF_PUBLIC_URL must be an HTTP(S) origin without credentials, a path, query, or fragment"
    )]
    InvalidPublicUrl,
    #[error("KANLEAF_SMTP_HOST must be a valid hostname or IP address")]
    InvalidSmtpHost,
    #[error("KANLEAF_SMTP_PORT must be an integer between 1 and 65535")]
    InvalidSmtpPort,
    #[error("KANLEAF_SMTP_SECURITY must be starttls, tls, or none")]
    InvalidSmtpSecurity,
    #[error(
        "KANLEAF_SMTP_USERNAME and KANLEAF_SMTP_PASSWORD must either both be set or both be empty"
    )]
    IncompleteSmtpCredentials,
    #[error("SMTP credentials require starttls or tls security")]
    InsecureSmtpCredentials,
    #[error(
        "KANLEAF_MAIL_FROM_NAME must be a non-empty single-line name of at most 120 characters"
    )]
    InvalidMailFromName,
    #[error("KANLEAF_MAIL_FROM_EMAIL must be a valid email address when SMTP is enabled")]
    InvalidMailFromEmail,
    #[error("KANLEAF_PUBLIC_URL is required when SMTP is enabled")]
    MissingPublicUrl,
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
        let mail = parse_mail_config(MailEnvironment::from_env()?)?;

        Ok(Self {
            database_url,
            data_dir,
            bind_address,
            cors_origins,
            session_ttl,
            web_dir,
            host_email,
            mail,
        })
    }
}

struct MailEnvironment {
    public_url: Option<String>,
    smtp_host: Option<String>,
    smtp_port: Option<String>,
    smtp_username: Option<String>,
    smtp_password: Option<String>,
    smtp_security: Option<String>,
    from_name: Option<String>,
    from_email: Option<String>,
}

impl MailEnvironment {
    fn from_env() -> Result<Self, ConfigError> {
        let public_url = optional_environment("KANLEAF_PUBLIC_URL")?;
        let smtp_host = optional_environment("KANLEAF_SMTP_HOST")?;
        if non_empty(smtp_host.as_deref()).is_none() {
            return Ok(Self {
                public_url,
                smtp_host,
                smtp_port: None,
                smtp_username: None,
                smtp_password: None,
                smtp_security: None,
                from_name: None,
                from_email: None,
            });
        }
        Ok(Self {
            public_url,
            smtp_host,
            smtp_port: optional_environment("KANLEAF_SMTP_PORT")?,
            smtp_username: optional_environment("KANLEAF_SMTP_USERNAME")?,
            smtp_password: optional_environment("KANLEAF_SMTP_PASSWORD")?,
            smtp_security: optional_environment("KANLEAF_SMTP_SECURITY")?,
            from_name: optional_environment("KANLEAF_MAIL_FROM_NAME")?,
            from_email: optional_environment("KANLEAF_MAIL_FROM_EMAIL")?,
        })
    }
}

fn optional_environment(name: &'static str) -> Result<Option<String>, ConfigError> {
    env::var_os(name)
        .map(|value| {
            value
                .into_string()
                .map_err(|_| ConfigError::InvalidEnvironmentValue(name))
        })
        .transpose()
}

fn parse_mail_config(values: MailEnvironment) -> Result<MailConfig, ConfigError> {
    let public_url = parse_public_url(values.public_url.as_deref())?;
    let Some(host) = non_empty(values.smtp_host.as_deref()) else {
        return Ok(MailConfig {
            public_url,
            smtp: None,
        });
    };
    if Host::parse(host).is_err() {
        return Err(ConfigError::InvalidSmtpHost);
    }

    let port = values
        .smtp_port
        .as_deref()
        .unwrap_or(DEFAULT_SMTP_PORT)
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or(ConfigError::InvalidSmtpPort)?;
    let security = match values
        .smtp_security
        .as_deref()
        .unwrap_or(DEFAULT_SMTP_SECURITY)
        .trim()
    {
        "starttls" => SmtpSecurity::StartTls,
        "tls" => SmtpSecurity::Tls,
        "none" => SmtpSecurity::None,
        _ => return Err(ConfigError::InvalidSmtpSecurity),
    };
    let username = non_empty_preserving(values.smtp_username);
    let password = non_empty_preserving(values.smtp_password);
    let credentials = match (username, password) {
        (Some(username), Some(password)) => Some(SmtpCredentials { username, password }),
        (None, None) => None,
        _ => return Err(ConfigError::IncompleteSmtpCredentials),
    };
    if security == SmtpSecurity::None && credentials.is_some() {
        return Err(ConfigError::InsecureSmtpCredentials);
    }

    let from_name = values
        .from_name
        .as_deref()
        .and_then(|value| non_empty(Some(value)))
        .unwrap_or(DEFAULT_MAIL_FROM_NAME);
    if from_name.chars().count() > 120 || from_name.chars().any(char::is_control) {
        return Err(ConfigError::InvalidMailFromName);
    }
    let from_email =
        non_empty(values.from_email.as_deref()).ok_or(ConfigError::InvalidMailFromEmail)?;
    if from_email.parse::<Address>().is_err() {
        return Err(ConfigError::InvalidMailFromEmail);
    }

    Ok(MailConfig {
        public_url: Some(public_url.ok_or(ConfigError::MissingPublicUrl)?),
        smtp: Some(SmtpConfig {
            host: host.to_owned(),
            port,
            security,
            credentials,
            from_name: from_name.to_owned(),
            from_email: from_email.to_owned(),
        }),
    })
}

fn parse_public_url(value: Option<&str>) -> Result<Option<Url>, ConfigError> {
    let Some(value) = value.and_then(|value| non_empty(Some(value))) else {
        return Ok(None);
    };
    let url = Url::parse(value).map_err(|_| ConfigError::InvalidPublicUrl)?;
    let valid = matches!(url.scheme(), "http" | "https")
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none();
    if !valid {
        return Err(ConfigError::InvalidPublicUrl);
    }
    Ok(Some(url))
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn non_empty_preserving(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
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
        ConfigError, MailEnvironment, SmtpSecurity, parse_bind_address, parse_cors_origins,
        parse_host_email, parse_mail_config, parse_session_ttl, parse_web_dir,
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

    #[test]
    fn disables_smtp_when_the_host_is_absent() {
        let config = parse_mail_config(mail_environment()).unwrap();
        assert!(config.smtp.is_none());

        let config = parse_mail_config(MailEnvironment {
            smtp_host: Some("   ".to_owned()),
            ..mail_environment()
        })
        .unwrap();
        assert!(config.smtp.is_none());
        assert!(config.public_url.is_none());

        let config = parse_mail_config(MailEnvironment {
            smtp_password: Some("ignored-partial-secret".to_owned()),
            ..mail_environment()
        })
        .unwrap();
        assert!(config.smtp.is_none());
    }

    #[test]
    fn enables_complete_smtp_configuration() {
        let config = parse_mail_config(valid_smtp_environment()).unwrap();
        let smtp = config.smtp.unwrap();
        assert_eq!(
            config.public_url.unwrap().as_str(),
            "https://kanleaf.example.com/"
        );
        assert_eq!(smtp.host, "smtp.example.com");
        assert_eq!(smtp.port, 587);
        assert_eq!(smtp.security, SmtpSecurity::StartTls);
        assert_eq!(smtp.from_name, "Kanleaf Team");
        assert_eq!(smtp.from_email, "notifications@example.com");
        assert_eq!(smtp.credentials.unwrap().username, "smtp-user");
    }

    #[test]
    fn rejects_invalid_enabled_smtp_values_without_exposing_secrets() {
        let cases = [
            (
                MailEnvironment {
                    smtp_host: Some("not a host".to_owned()),
                    ..valid_smtp_environment()
                },
                ConfigError::InvalidSmtpHost,
            ),
            (
                MailEnvironment {
                    smtp_port: Some("70000".to_owned()),
                    ..valid_smtp_environment()
                },
                ConfigError::InvalidSmtpPort,
            ),
            (
                MailEnvironment {
                    smtp_security: Some("opportunistic".to_owned()),
                    ..valid_smtp_environment()
                },
                ConfigError::InvalidSmtpSecurity,
            ),
            (
                MailEnvironment {
                    from_email: Some("not-an-address".to_owned()),
                    ..valid_smtp_environment()
                },
                ConfigError::InvalidMailFromEmail,
            ),
            (
                MailEnvironment {
                    public_url: Some("ftp://kanleaf.example.com/path?secret=yes".to_owned()),
                    ..valid_smtp_environment()
                },
                ConfigError::InvalidPublicUrl,
            ),
            (
                MailEnvironment {
                    smtp_password: Some("top-secret-password".to_owned()),
                    smtp_username: None,
                    ..valid_smtp_environment()
                },
                ConfigError::IncompleteSmtpCredentials,
            ),
        ];

        for (environment, expected) in cases {
            let error = parse_mail_config(environment).err().unwrap();
            assert_eq!(error.to_string(), expected.to_string());
            assert!(!error.to_string().contains("top-secret-password"));
        }
    }

    #[test]
    fn requires_public_url_and_safe_credentials_for_enabled_smtp() {
        let missing_url = parse_mail_config(MailEnvironment {
            public_url: None,
            ..valid_smtp_environment()
        })
        .err()
        .unwrap();
        assert_eq!(
            missing_url.to_string(),
            ConfigError::MissingPublicUrl.to_string()
        );

        let insecure = parse_mail_config(MailEnvironment {
            smtp_security: Some("none".to_owned()),
            ..valid_smtp_environment()
        })
        .err()
        .unwrap();
        assert_eq!(
            insecure.to_string(),
            ConfigError::InsecureSmtpCredentials.to_string()
        );
    }

    fn mail_environment() -> MailEnvironment {
        MailEnvironment {
            public_url: None,
            smtp_host: None,
            smtp_port: None,
            smtp_username: None,
            smtp_password: None,
            smtp_security: None,
            from_name: None,
            from_email: None,
        }
    }

    fn valid_smtp_environment() -> MailEnvironment {
        MailEnvironment {
            public_url: Some("https://kanleaf.example.com".to_owned()),
            smtp_host: Some("smtp.example.com".to_owned()),
            smtp_port: Some("587".to_owned()),
            smtp_username: Some("smtp-user".to_owned()),
            smtp_password: Some("top-secret-password".to_owned()),
            smtp_security: Some("starttls".to_owned()),
            from_name: Some("Kanleaf Team".to_owned()),
            from_email: Some("notifications@example.com".to_owned()),
        }
    }
}
