use serde::Deserialize;
use thiserror::Error;

const MAX_EMAIL_LENGTH: usize = 320;
const MIN_PASSWORD_LENGTH: usize = 10;
const MAX_PASSWORD_BYTES: usize = 1024;
const MAX_RESOURCE_NAME_LENGTH: usize = 120;
const MAX_TASK_TITLE_LENGTH: usize = 300;

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
pub enum TaskStatus {
    #[default]
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
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
}

impl TaskPriority {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
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
        NormalizedEmail, ResourceName, TaskPriority, TaskStatus, TaskTitle, ValidatedPassword,
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
        assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
        assert_eq!(TaskPriority::High.as_str(), "high");
    }
}
