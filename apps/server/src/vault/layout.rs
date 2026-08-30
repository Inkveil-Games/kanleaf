use std::path::PathBuf;

use crate::domain::{LibraryStorageName, VaultStorageName};

use super::{MAX_LIBRARY_DEPTH, MAX_LIBRARY_RELATIVE_PATH_BYTES, VaultError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectPath {
    storage_name: VaultStorageName,
}

impl ProjectPath {
    pub fn parse(storage_name: &str) -> Result<Self, VaultError> {
        Ok(Self {
            storage_name: VaultStorageName::parse(storage_name)
                .map_err(|_| VaultError::InvalidManagedPath)?,
        })
    }

    pub(super) fn relative_directory(&self) -> PathBuf {
        PathBuf::from("Projects").join(self.storage_name.as_str())
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

    fn project(storage_name: &str) -> Result<Self, VaultError> {
        Ok(Self {
            project: Some(ProjectPath::parse(storage_name)?),
        })
    }

    fn content_directory(&self, kind: &str) -> PathBuf {
        self.project.as_ref().map_or_else(
            || PathBuf::from(kind),
            |project| project.relative_directory().join(kind),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskPath {
    scope: ContentScope,
    storage_name: VaultStorageName,
}

impl TaskPath {
    pub fn inbox(storage_name: &str) -> Result<Self, VaultError> {
        Self::parse(None, storage_name)
    }

    pub fn project(project_storage_name: &str, storage_name: &str) -> Result<Self, VaultError> {
        Self::parse(Some(project_storage_name), storage_name)
    }

    pub fn parse(
        project_storage_name: Option<&str>,
        storage_name: &str,
    ) -> Result<Self, VaultError> {
        let scope = project_storage_name
            .map_or_else(|| Ok(ContentScope::workspace()), ContentScope::project)?;
        Ok(Self {
            scope,
            storage_name: VaultStorageName::parse(storage_name)
                .map_err(|_| VaultError::InvalidManagedPath)?,
        })
    }

    pub fn display(&self) -> String {
        self.relative_file().to_string_lossy().replace('\\', "/")
    }

    pub(super) fn relative_file(&self) -> PathBuf {
        self.scope
            .content_directory("Todo")
            .join(format!("{}.md", self.storage_name.as_str()))
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
        project_storage_name: Option<&str>,
        segments: impl IntoIterator<Item = &'a str>,
    ) -> Result<Self, VaultError> {
        let scope = project_storage_name
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

    pub(super) fn project_storage_name(&self) -> Option<&str> {
        self.scope
            .project
            .as_ref()
            .map(|project| project.storage_name.as_str())
    }

    pub(super) fn relative_file(&self) -> PathBuf {
        self.relative_file_under(self.scope.content_directory("Wiki"))
    }

    pub(super) fn legacy_relative_file(&self, root: &str) -> PathBuf {
        self.relative_file_under(PathBuf::from(root))
    }

    fn relative_file_under(&self, mut path: PathBuf) -> PathBuf {
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
        let mut path = self.scope.content_directory("Wiki");
        for segment in &self.segments {
            path.push(segment.as_str());
        }
        path
    }
}

#[cfg(test)]
mod tests {
    use super::{LibraryPath, ProjectPath, TaskPath};

    #[test]
    fn resolves_workspace_and_project_content_roots() {
        assert_eq!(
            TaskPath::inbox("triage--a1b2c3").unwrap().relative_file(),
            std::path::Path::new("Todo/triage--a1b2c3.md")
        );
        assert_eq!(
            TaskPath::project("kanleaf--d4e5f6", "export--b7c8d9")
                .unwrap()
                .relative_file(),
            std::path::Path::new("Projects/kanleaf--d4e5f6/Todo/export--b7c8d9.md")
        );
        assert_eq!(
            LibraryPath::parse_scoped(Some("kanleaf--d4e5f6"), ["getting_started", "install"],)
                .unwrap()
                .relative_file(),
            std::path::Path::new("Projects/kanleaf--d4e5f6/Wiki/getting_started/install.md")
        );
        assert_eq!(
            ProjectPath::parse("kanleaf--d4e5f6")
                .unwrap()
                .relative_directory(),
            std::path::Path::new("Projects/kanleaf--d4e5f6")
        );
    }

    #[test]
    fn rejects_untyped_managed_segments() {
        assert!(TaskPath::inbox("../task").is_err());
        assert!(TaskPath::project("../project", "task--a1b2c3").is_err());
        assert!(LibraryPath::parse_scoped(Some("project"), ["note"]).is_err());
    }
}
