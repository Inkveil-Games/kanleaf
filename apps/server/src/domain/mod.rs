use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const MAX_EMAIL_LENGTH: usize = 320;
const MIN_PASSWORD_LENGTH: usize = 10;
const MAX_PASSWORD_BYTES: usize = 1024;
const MAX_RESOURCE_NAME_LENGTH: usize = 120;
const MAX_TASK_TITLE_LENGTH: usize = 300;
const MAX_DOCUMENT_TITLE_LENGTH: usize = 300;
pub const MAX_LIBRARY_STORAGE_NAME_BYTES: usize = 120;
pub const MAX_VAULT_STORAGE_NAME_BYTES: usize = 120;
const MAX_CONFIGURATION_DESCRIPTION_LENGTH: usize = 500;
const MAX_PROJECT_DESCRIPTION_LENGTH: usize = 2000;

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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentTitle(String);

impl DocumentTitle {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let value = value.trim();
        if value.is_empty() {
            return Err(ValidationError::new("Document title cannot be empty"));
        }
        if value.chars().count() > MAX_DOCUMENT_TITLE_LENGTH {
            return Err(ValidationError::new(
                "Document title cannot exceed 300 characters",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibraryStorageName(String);

impl LibraryStorageName {
    pub fn from_title(value: &str) -> Self {
        let mut name = String::new();
        let mut separator = false;
        for character in value.trim().chars().flat_map(char::to_lowercase) {
            if character.is_alphanumeric() {
                if separator && !name.is_empty() {
                    name.push('_');
                }
                name.push(character);
                separator = false;
            } else if character.is_whitespace() || matches!(character, '-' | '_') {
                separator = !name.is_empty();
            }
        }
        trim_to_byte_limit(&mut name, MAX_LIBRARY_STORAGE_NAME_BYTES);
        if name.is_empty() {
            name.push_str("note");
        } else if is_windows_reserved_name(&name) {
            name.insert_str(0, "note_");
        }
        Self(name)
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        let valid = !value.is_empty()
            && value.len() <= MAX_LIBRARY_STORAGE_NAME_BYTES
            && value == value.to_lowercase()
            && value
                .chars()
                .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
            && !is_windows_reserved_name(value);
        if !valid {
            return Err(ValidationError::new(
                "Library storage name is not a portable filename",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn candidate(&self, sequence: usize) -> Self {
        if sequence <= 1 {
            return self.clone();
        }
        let suffix = format!("_{sequence}");
        let mut base = self.0.clone();
        trim_to_byte_limit(
            &mut base,
            MAX_LIBRARY_STORAGE_NAME_BYTES.saturating_sub(suffix.len()),
        );
        Self(format!("{base}{suffix}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultStorageName(String);

impl VaultStorageName {
    pub fn from_initial_name(value: &str, id: Uuid) -> Self {
        let mut name = String::new();
        let mut separator = false;
        for character in value.trim().chars().flat_map(char::to_lowercase) {
            if character.is_alphanumeric() {
                if separator && !name.is_empty() {
                    name.push('-');
                }
                name.push(character);
                separator = false;
            } else {
                separator = !name.is_empty();
            }
        }
        trim_to_byte_limit(&mut name, MAX_VAULT_STORAGE_NAME_BYTES - 8);
        if name.is_empty() {
            name.push_str("item");
        }
        let simple_id = id.simple().to_string();
        Self(format!("{name}--{}", &simple_id[..6]))
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        let Some((name, suffix)) = value.rsplit_once("--") else {
            return Err(invalid_vault_storage_name());
        };
        let valid = value.len() <= MAX_VAULT_STORAGE_NAME_BYTES
            && value == value.to_lowercase()
            && !name.is_empty()
            && !name.starts_with('-')
            && !name.ends_with('-')
            && !name.contains("--")
            && name
                .chars()
                .all(|character| character.is_alphanumeric() || character == '-')
            && suffix.len() == 6
            && suffix
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase());
        if !valid {
            return Err(invalid_vault_storage_name());
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn invalid_vault_storage_name() -> ValidationError {
    ValidationError::new("Vault storage name is not a portable filename")
}

fn trim_to_byte_limit(value: &mut String, limit: usize) {
    if value.len() <= limit {
        return;
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    while value.ends_with(['_', '-']) {
        value.pop();
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    matches!(value, "con" | "prn" | "aux" | "nul")
        || value
            .strip_prefix("com")
            .or_else(|| value.strip_prefix("lpt"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectIdentifier(String);

impl ProjectIdentifier {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        let normalized = value.trim().to_ascii_uppercase();
        let mut characters = normalized.chars();
        let valid_start = characters
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric());
        let valid_rest =
            characters.all(|character| character.is_ascii_alphanumeric() || character == '-');
        if !valid_start || !valid_rest || !(2..=12).contains(&normalized.len()) {
            return Err(ValidationError::new(
                "Project identifier must be 2-12 letters, numbers, or hyphens",
            ));
        }
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectDescription(String);

impl ProjectDescription {
    pub fn new(value: &str) -> Result<Self, ValidationError> {
        if value.chars().count() > MAX_PROJECT_DESCRIPTION_LENGTH {
            return Err(ValidationError::new(
                "Project description cannot exceed 2000 characters",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectVisibility {
    Private,
    Open,
}

impl ProjectVisibility {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Open => "open",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectRole {
    Admin,
    Contributor,
    Commenter,
    Viewer,
}

impl ProjectRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Contributor => "contributor",
            Self::Commenter => "commenter",
            Self::Viewer => "viewer",
        }
    }

    pub const fn can_edit(self) -> bool {
        matches!(self, Self::Admin | Self::Contributor)
    }

    pub const fn can_manage(self) -> bool {
        matches!(self, Self::Admin)
    }

    pub fn from_database(value: &str) -> Option<Self> {
        match value {
            "admin" => Some(Self::Admin),
            "contributor" => Some(Self::Contributor),
            "commenter" => Some(Self::Commenter),
            "viewer" => Some(Self::Viewer),
            _ => None,
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
        ConfigurationDescription, DocumentTitle, HexColor, LibraryStorageName, NormalizedEmail,
        ProjectDescription, ProjectIdentifier, ProjectRole, ProjectVisibility, ResourceName,
        TaskPriority, TaskStateGroup, TaskTitle, TaskTypeIcon, ValidatedPassword, VaultStorageName,
    };
    use uuid::Uuid;

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
    fn trims_and_bounds_document_titles() {
        assert_eq!(
            DocumentTitle::new("  Architecture  ").unwrap().as_str(),
            "Architecture"
        );
        assert!(DocumentTitle::new(" ").is_err());
        assert!(DocumentTitle::new(&"x".repeat(301)).is_err());
    }

    #[test]
    fn creates_portable_library_storage_names() {
        assert_eq!(
            LibraryStorageName::from_title("  Bắt đầu / Getting-Started  ").as_str(),
            "bắt_đầu_getting_started"
        );
        assert_eq!(LibraryStorageName::from_title("CON").as_str(), "note_con");
        assert_eq!(LibraryStorageName::from_title("../").as_str(), "note");

        let long = LibraryStorageName::from_title(&"界".repeat(100));
        assert!(long.as_str().len() <= 120);
        assert!(long.as_str().is_char_boundary(long.as_str().len()));
        assert!(long.candidate(2).as_str().len() <= 120);
        assert_eq!(
            LibraryStorageName::from_title("Getting started")
                .candidate(2)
                .as_str(),
            "getting_started_2"
        );
    }

    #[test]
    fn creates_stable_vault_storage_names() {
        let id = Uuid::parse_str("b7c8d9e4-f120-44ea-8fd1-74948a86ccf1").unwrap();
        assert_eq!(
            VaultStorageName::from_initial_name("  Implement export / backup  ", id).as_str(),
            "implement-export-backup--b7c8d9"
        );
        assert_eq!(
            VaultStorageName::from_initial_name("../", id).as_str(),
            "item--b7c8d9"
        );
        assert_eq!(
            VaultStorageName::from_initial_name("CON", id).as_str(),
            "con--b7c8d9"
        );

        let unicode = VaultStorageName::from_initial_name(&"界".repeat(100), id);
        assert!(unicode.as_str().len() <= 120);
        assert!(unicode.as_str().is_char_boundary(unicode.as_str().len()));
        assert_eq!(VaultStorageName::parse(unicode.as_str()).unwrap(), unicode);
        for invalid in [
            "project",
            "project--12345",
            "../x--123456",
            "Project--123456",
        ] {
            assert!(
                VaultStorageName::parse(invalid).is_err(),
                "accepted {invalid}"
            );
        }
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

    #[test]
    fn validates_project_vocabulary() {
        assert_eq!(ProjectIdentifier::new(" kan-1 ").unwrap().as_str(), "KAN-1");
        assert!(ProjectIdentifier::new("bad identifier").is_err());
        assert!(ProjectDescription::new(&"x".repeat(2001)).is_err());
        assert_eq!(ProjectVisibility::Open.as_str(), "open");
        assert!(ProjectRole::Contributor.can_edit());
        assert!(!ProjectRole::Viewer.can_edit());
    }
}
