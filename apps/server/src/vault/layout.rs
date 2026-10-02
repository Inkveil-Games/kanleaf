use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::domain::{LibraryStorageName, ProjectIdentifier, WorkspaceIdentifier};

use super::{MAX_LIBRARY_DEPTH, MAX_LIBRARY_RELATIVE_PATH_BYTES, VaultError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspacePath {
    workspace_id: Uuid,
    identifier: WorkspaceIdentifier,
}

impl WorkspacePath {
    pub fn parse(workspace_id: Uuid, identifier: &str) -> Result<Self, VaultError> {
        Ok(Self {
            workspace_id,
            identifier: WorkspaceIdentifier::new(identifier)
                .map_err(|_| VaultError::InvalidManagedPath)?,
        })
    }

    pub fn workspace_id(&self) -> Uuid {
        self.workspace_id
    }

    pub fn identifier(&self) -> &str {
        self.identifier.as_str()
    }

    pub(super) fn relative_directory(&self) -> PathBuf {
        PathBuf::from(self.identifier.as_str())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectPath {
    identifier: ProjectIdentifier,
}

impl ProjectPath {
    pub fn parse(identifier: &str) -> Result<Self, VaultError> {
        Ok(Self {
            identifier: ProjectIdentifier::new(identifier)
                .map_err(|_| VaultError::InvalidManagedPath)?,
        })
    }

    pub(super) fn identifier(&self) -> &str {
        self.identifier.as_str()
    }

    pub(super) fn relative_directory(&self) -> PathBuf {
        PathBuf::from("projects").join(self.identifier.as_str())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContentScope {
    project: Option<ProjectPath>,
}

impl ContentScope {
    fn workspace() -> Self {
        Self { project: None }
    }

    fn project(identifier: &str) -> Result<Self, VaultError> {
        Ok(Self {
            project: Some(ProjectPath::parse(identifier)?),
        })
    }

    fn library_directory(&self) -> PathBuf {
        self.project.as_ref().map_or_else(
            || PathBuf::from("library"),
            |project| project.relative_directory().join("library"),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskPath {
    number: i64,
}

impl TaskPath {
    pub fn parse(number: i64) -> Result<Self, VaultError> {
        if number <= 0 {
            return Err(VaultError::InvalidManagedPath);
        }
        Ok(Self { number })
    }

    pub fn number(&self) -> i64 {
        self.number
    }

    pub fn display(&self) -> String {
        self.relative_file().to_string_lossy().replace('\\', "/")
    }

    pub(super) fn relative_file(&self) -> PathBuf {
        PathBuf::from("tasks").join(format!("{}.md", self.number))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibraryPath {
    scope: ContentScope,
    segments: Vec<LibraryStorageName>,
}

impl LibraryPath {
    pub fn parse<'a>(segments: impl IntoIterator<Item = &'a str>) -> Result<Self, VaultError> {
        Self::parse_scoped(None, segments)
    }

    pub fn parse_scoped<'a>(
        project_identifier: Option<&str>,
        segments: impl IntoIterator<Item = &'a str>,
    ) -> Result<Self, VaultError> {
        let scope = project_identifier
            .map_or_else(|| Ok(ContentScope::workspace()), ContentScope::project)?;
        let segments = segments
            .into_iter()
            .map(LibraryStorageName::parse)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| VaultError::InvalidLibraryPath)?;
        if segments.is_empty() || segments.len() > MAX_LIBRARY_DEPTH {
            return Err(VaultError::InvalidLibraryPath);
        }
        let path = Self { scope, segments };
        if path.relative_file().to_string_lossy().len() > MAX_LIBRARY_RELATIVE_PATH_BYTES {
            return Err(VaultError::InvalidLibraryPath);
        }
        Ok(path)
    }

    pub fn display(&self) -> String {
        self.relative_file().to_string_lossy().replace('\\', "/")
    }

    pub(super) fn storage_segments(&self) -> Vec<String> {
        self.segments
            .iter()
            .map(|segment| segment.as_str().to_owned())
            .collect()
    }

    pub(super) fn project_identifier(&self) -> Option<&str> {
        self.scope.project.as_ref().map(ProjectPath::identifier)
    }

    pub(super) fn relative_file(&self) -> PathBuf {
        self.relative_file_under(self.scope.library_directory())
    }

    pub(super) fn relative_file_under(&self, mut path: PathBuf) -> PathBuf {
        let mut segments = self.segments.iter();
        let Some(mut leaf) = segments.next() else {
            return path;
        };
        for segment in segments {
            path.push(leaf.as_str());
            leaf = segment;
        }
        path.join(format!("{}.md", leaf.as_str()))
    }

    pub(super) fn relative_companion_directory(&self) -> PathBuf {
        let mut path = self.scope.library_directory();
        for segment in &self.segments {
            path.push(segment.as_str());
        }
        path
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPath {
    file_name: String,
}

impl AssetPath {
    pub fn parse_image(file_name: &str) -> Result<Self, VaultError> {
        let path = Path::new(file_name);
        if path.components().count() != 1
            || path.file_name().and_then(|name| name.to_str()) != Some(file_name)
        {
            return Err(VaultError::InvalidManagedPath);
        }
        let Some((stem, extension)) = file_name.rsplit_once('.') else {
            return Err(VaultError::InvalidManagedPath);
        };
        let id = Uuid::parse_str(stem).map_err(|_| VaultError::InvalidManagedPath)?;
        if stem != id.hyphenated().to_string()
            || !matches!(extension, "png" | "jpg" | "gif" | "webp")
        {
            return Err(VaultError::InvalidManagedPath);
        }
        Ok(Self {
            file_name: file_name.to_owned(),
        })
    }

    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    pub(super) fn relative_file(&self) -> PathBuf {
        PathBuf::from("assets/images").join(&self.file_name)
    }
}

#[cfg(test)]
mod tests {
    use super::{AssetPath, LibraryPath, ProjectPath, TaskPath, WorkspacePath};
    use uuid::Uuid;

    #[test]
    fn resolves_canonical_workspace_project_task_and_library_paths() {
        let workspace_id = Uuid::parse_str("cb751ae4-07e3-4f79-8410-322549dd50f3").unwrap();
        assert_eq!(
            WorkspacePath::parse(workspace_id, "kanleaf")
                .unwrap()
                .relative_directory(),
            std::path::Path::new("kanleaf")
        );
        assert_eq!(
            TaskPath::parse(42).unwrap().relative_file(),
            std::path::Path::new("tasks/42.md")
        );
        assert_eq!(
            LibraryPath::parse_scoped(Some("kanleaf-core"), ["getting_started", "install"],)
                .unwrap()
                .relative_file(),
            std::path::Path::new("projects/kanleaf-core/library/getting_started/install.md")
        );
        assert_eq!(
            LibraryPath::parse(["architecture", "backend"])
                .unwrap()
                .relative_file(),
            std::path::Path::new("library/architecture/backend.md")
        );
        assert_eq!(
            ProjectPath::parse("kanleaf-core")
                .unwrap()
                .relative_directory(),
            std::path::Path::new("projects/kanleaf-core")
        );
        assert_eq!(
            AssetPath::parse_image("0199a9f0-4e21-7f4b-9d85-28c021c731d1.png")
                .unwrap()
                .relative_file(),
            std::path::Path::new("assets/images/0199a9f0-4e21-7f4b-9d85-28c021c731d1.png")
        );
    }

    #[test]
    fn rejects_untyped_managed_segments() {
        let workspace_id = Uuid::new_v4();
        assert!(WorkspacePath::parse(workspace_id, "../workspace").is_err());
        assert!(ProjectPath::parse("../project").is_err());
        assert!(TaskPath::parse(0).is_err());
        assert!(TaskPath::parse(-1).is_err());
        assert!(LibraryPath::parse_scoped(Some("../project"), ["note"]).is_err());
        assert!(LibraryPath::parse(["..", "escape"]).is_err());
        assert!(AssetPath::parse_image("../../escape.png").is_err());
        assert!(AssetPath::parse_image("CON.png").is_err());
        assert!(AssetPath::parse_image("not-opaque.png").is_err());
    }
}
