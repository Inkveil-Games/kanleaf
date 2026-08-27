use serde::Deserialize;
use thiserror::Error;

const MAX_EMAIL_LENGTH: usize = 320;
const MIN_PASSWORD_LENGTH: usize = 10;
const MAX_PASSWORD_BYTES: usize = 1024;
const MAX_RESOURCE_NAME_LENGTH: usize = 120;
const MAX_TASK_TITLE_LENGTH: usize = 300;
const MAX_CONFIGURATION_DESCRIPTION_LENGTH: usize = 500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedEmail(String);

impl NormalizedEmail {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let value = value.trim().to_lowercase();
        let Some((local, domain)) = value.split_once('@') else {
            return Err(ValidationError::new("Enter a valid email address"));
        };

        let invalid = local.is_empty()
            || domain.is_empty()
            || domain.contains('@')
            || value.chars().count() > MAX_EMAIL_LENGTH
            || value.chars().any(char::is_whitespace);
        if invalid {
            return Err(ValidationError::new("Enter a valid email address"));
        }

        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub struct ValidatedPassword(String);

impl ValidatedPassword {
    pub fn new(value: String) -> Result<Self, ValidationError> {
        if value.chars().count() < MIN_PASSWORD_LENGTH {
            return Err(ValidationError::new(
                "Password must contain at least 10 characters",
            ));
        }
        if value.len() > MAX_PASSWORD_BYTES {
            return Err(ValidationError::new("Password is too long"));
        }

        Ok(Self(value))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResourceName(String);

impl ResourceName {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let value = value.trim();
        if value.is_empty() {
            return Err(ValidationError::new("Name cannot be empty"));
        }
        if value.chars().count() > MAX_RESOURCE_NAME_LENGTH {
            return Err(ValidationError::new("Name cannot exceed 120 characters"));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskTitle(String);

impl TaskTitle {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let value = value.trim();
        if value.is_empty() {
            return Err(ValidationError::new("Task title cannot be empty"));
        }
        if value.chars().count() > MAX_TASK_TITLE_LENGTH {
            return Err(ValidationError::new(
                "Task title cannot exceed 300 characters",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    #[default]
    None,
    Low,
    Medium,
    High,
    Urgent,
}

impl TaskPriority {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStateGroup {
    Backlog,
    Todo,
    InProgress,
    Done,
    Canceled,
}

impl TaskStateGroup {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HexColor(String);

impl HexColor {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let valid = value.len() == 7
            && value.starts_with('#')
            && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
        if !valid {
            return Err(ValidationError::new(
                "Color must use six-digit hexadecimal notation",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigurationDescription(String);

impl ConfigurationDescription {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        if value.chars().count() > MAX_CONFIGURATION_DESCRIPTION_LENGTH {
            return Err(ValidationError::new(
                "Description cannot exceed 500 characters",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskTypeIcon(String);

impl TaskTypeIcon {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let mut characters = value.chars();
        let valid_start = characters
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit());
        let valid_rest = characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
                || character == '_'
        });
        if !valid_start || !valid_rest || value.len() > 32 {
            return Err(ValidationError::new(
                "Task type icon must be a lowercase icon identifier",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ValidationError {
    message: &'static str,
}

impl ValidationError {
    const fn new(message: &'static str) -> Self {
        Self { message }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ConfigurationDescription, HexColor, NormalizedEmail, ResourceName, TaskPriority,
        TaskStateGroup, TaskTitle, TaskTypeIcon, ValidatedPassword,
    };

    #[test]
    fn normalizes_valid_email_addresses() {
        let email = NormalizedEmail::new("  Person@Example.COM ").unwrap();
        assert_eq!(email.as_str(), "person@example.com");
    }

    #[test]
    fn rejects_malformed_email_addresses() {
        for email in ["", "person", "@example.com", "person@", "a@b@c"] {
            assert!(NormalizedEmail::new(email).is_err(), "accepted {email}");
        }
    }

    #[test]
    fn bounds_password_work() {
        assert!(ValidatedPassword::new("short".to_owned()).is_err());
        assert!(ValidatedPassword::new("long enough".to_owned()).is_ok());
        assert!(ValidatedPassword::new("x".repeat(1025)).is_err());
    }

    #[test]
    fn trims_and_bounds_resource_names() {
        assert_eq!(
            ResourceName::new("  Kanleaf  ").unwrap().as_str(),
            "Kanleaf"
        );
        assert!(ResourceName::new("   ").is_err());
        assert!(ResourceName::new(&"x".repeat(121)).is_err());
    }

    #[test]
    fn validates_task_metadata() {
        assert_eq!(
            TaskTitle::new("  Ship v0.1  ").unwrap().as_str(),
            "Ship v0.1"
        );
        assert!(TaskTitle::new(" ").is_err());
        assert!(TaskTitle::new(&"x".repeat(301)).is_err());
        assert_eq!(TaskPriority::High.as_str(), "high");
        assert_eq!(TaskPriority::Urgent.as_str(), "urgent");
    }

    #[test]
    fn validates_workspace_task_vocabulary() {
        assert_eq!(HexColor::new("#22A06B").unwrap().as_str(), "#22A06B");
        assert!(HexColor::new("green").is_err());
        assert_eq!(TaskStateGroup::InProgress.as_str(), "in_progress");
        assert_eq!(
            TaskTypeIcon::new("check-square").unwrap().as_str(),
            "check-square"
        );
        assert!(TaskTypeIcon::new("Check Square").is_err());
        assert!(ConfigurationDescription::new(&"x".repeat(501)).is_err());
    }
}
