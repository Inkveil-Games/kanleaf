use std::{
    collections::HashSet,
    fmt::Write as _,
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};
use uuid::Uuid;

mod layout;
mod library_operation;
mod migration;
mod task_operation;

pub use layout::{LibraryPath, ProjectPath, TaskPath};
pub use library_operation::{
    LegacyLibraryMove, LibraryMove, LibraryTrash, PendingLibraryOperation,
    PendingLibraryOperationKind,
};
pub use migration::{
    PendingWorkspaceLayoutMigration, StagedWorkspaceLayout, TaskMigrationFile, WikiMigrationFile,
    WorkspaceLayoutMigration,
};
pub use task_operation::{PendingTaskMove, TaskMove};

const MAX_LIBRARY_DEPTH: usize = 12;
const MAX_LIBRARY_RELATIVE_PATH_BYTES: usize = 240;
const MAX_SYNC_TASK_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone)]
pub struct Vault {
    data_dir: Arc<PathBuf>,
}

pub struct WorkspaceTrash {
    original: PathBuf,
    trashed: PathBuf,
}

pub struct TaskTrash {
    original: PathBuf,
    trashed: PathBuf,
}

#[derive(Debug)]
pub struct TaskVaultScan {
    pub files: Vec<ScannedTaskFile>,
    pub issues: Vec<TaskVaultScanIssue>,
}

#[derive(Debug)]
pub struct ScannedTaskFile {
    pub path: TaskPath,
    pub relative_path: String,
    pub document: VaultDocument,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskVaultScanIssueKind {
    InvalidEntry,
    UnmanagedEntry,
    UnknownProject,
    OversizedFile,
}

#[derive(Debug)]
pub struct TaskVaultScanIssue {
    pub relative_path: String,
    pub kind: TaskVaultScanIssueKind,
}

#[derive(Debug, Eq, PartialEq)]
pub struct VaultDocument {
    pub content: String,
    pub revision: String,
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault I/O operation failed")]
    Io(#[from] io::Error),
    #[error("an existing Markdown document contains data")]
    ExistingDocument,
    #[error("the Markdown document changed after it was opened")]
    RevisionConflict,
    #[error("the Library path is invalid")]
    InvalidLibraryPath,
    #[error("the managed vault path is invalid")]
    InvalidManagedPath,
}

impl Vault {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir: Arc::new(data_dir),
        }
    }

    pub async fn create_task_document(
        &self,
        workspace_id: Uuid,
        path: &TaskPath,
        content: &str,
    ) -> Result<(), VaultError> {
        let destination = self.task_file(workspace_id, path);
        self.ensure_safe_managed_parent(workspace_id, &destination)
            .await?;
        create_new_file(&destination, content).await
    }

    pub async fn create_page_document(
        &self,
        workspace_id: Uuid,
        path: &LibraryPath,
    ) -> Result<(), VaultError> {
        let destination = self.library_file(workspace_id, path);
        self.ensure_safe_library_parent(workspace_id, &destination)
            .await?;
        create_empty_file(&destination).await
    }

    pub async fn read_task_document(
        &self,
        workspace_id: Uuid,
        path: &TaskPath,
    ) -> Result<VaultDocument, VaultError> {
        let path = self.task_file(workspace_id, path);
        self.ensure_regular_managed_file(workspace_id, &path)
            .await?;
        read_document(&path).await
    }

    pub async fn read_page_document(
        &self,
        workspace_id: Uuid,
        path: &LibraryPath,
    ) -> Result<VaultDocument, VaultError> {
        let path = self.library_file(workspace_id, path);
        self.ensure_regular_library_file(workspace_id, &path)
            .await?;
        read_document(&path).await
    }

    pub async fn write_task_document(
        &self,
        workspace_id: Uuid,
        path: &TaskPath,
        content: &str,
        base_revision: &str,
    ) -> Result<String, VaultError> {
        let destination = self.task_file(workspace_id, path);
        self.ensure_regular_managed_file(workspace_id, &destination)
            .await?;
        write_document(&destination, content, base_revision).await
    }

    pub async fn write_page_document(
        &self,
        workspace_id: Uuid,
        path: &LibraryPath,
        content: &str,
        base_revision: &str,
    ) -> Result<String, VaultError> {
        let destination = self.library_file(workspace_id, path);
        self.ensure_regular_library_file(workspace_id, &destination)
            .await?;
        write_document(&destination, content, base_revision).await
    }

    pub async fn scan_task_documents(
        &self,
        workspace_id: Uuid,
        project_storage_names: &[String],
    ) -> Result<TaskVaultScan, VaultError> {
        let mut scan = TaskVaultScan {
            files: Vec::new(),
            issues: Vec::new(),
        };
        self.scan_task_directory(workspace_id, None, &mut scan)
            .await?;

        let known_projects = project_storage_names.iter().collect::<HashSet<_>>();
        let projects_directory = self.workspace_directory(workspace_id).join("Projects");
        let mut entries = match safe_read_directory(&projects_directory).await? {
            Some(entries) => entries,
            None => return Ok(scan),
        };
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let relative_path = format!("Projects/{name}");
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                scan.issues.push(TaskVaultScanIssue {
                    relative_path,
                    kind: TaskVaultScanIssueKind::InvalidEntry,
                });
                continue;
            }
            if !known_projects.contains(&name) {
                scan.issues.push(TaskVaultScanIssue {
                    relative_path,
                    kind: TaskVaultScanIssueKind::UnknownProject,
                });
                continue;
            }
            self.scan_task_directory(workspace_id, Some(&name), &mut scan)
                .await?;
        }
        Ok(scan)
    }

    async fn scan_task_directory(
        &self,
        workspace_id: Uuid,
        project_storage_name: Option<&str>,
        scan: &mut TaskVaultScan,
    ) -> Result<(), VaultError> {
        let directory = project_storage_name.map_or_else(
            || self.workspace_directory(workspace_id).join("Todo"),
            |project| {
                self.workspace_directory(workspace_id)
                    .join("Projects")
                    .join(project)
                    .join("Todo")
            },
        );
        let Some(mut entries) = safe_read_directory(&directory).await? else {
            return Ok(());
        };
        while let Some(entry) = entries.next_entry().await? {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let relative_path = project_storage_name.map_or_else(
                || format!("Todo/{file_name}"),
                |project| format!("Projects/{project}/Todo/{file_name}"),
            );
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                scan.issues.push(TaskVaultScanIssue {
                    relative_path,
                    kind: TaskVaultScanIssueKind::InvalidEntry,
                });
                continue;
            }
            if metadata.len() > MAX_SYNC_TASK_BYTES {
                scan.issues.push(TaskVaultScanIssue {
                    relative_path,
                    kind: TaskVaultScanIssueKind::OversizedFile,
                });
                continue;
            }
            let Some(storage_name) = file_name.strip_suffix(".md") else {
                scan.issues.push(TaskVaultScanIssue {
                    relative_path,
                    kind: TaskVaultScanIssueKind::UnmanagedEntry,
                });
                continue;
            };
            let path = match TaskPath::parse(project_storage_name, storage_name) {
                Ok(path) => path,
                Err(_) => {
                    scan.issues.push(TaskVaultScanIssue {
                        relative_path,
                        kind: TaskVaultScanIssueKind::InvalidEntry,
                    });
                    continue;
                }
            };
            let document = self.read_task_document(workspace_id, &path).await?;
            scan.files.push(ScannedTaskFile {
                relative_path,
                path,
                document,
            });
        }
        Ok(())
    }

    pub async fn trash_workspace(
        &self,
        workspace_id: Uuid,
    ) -> Result<Option<WorkspaceTrash>, VaultError> {
        let original = self.workspace_directory(workspace_id);
        match fs::metadata(&original).await {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }

        let trash_directory = self.data_dir.join("trash").join("workspaces");
        fs::create_dir_all(&trash_directory).await?;
        let trashed = trash_directory.join(format!("{workspace_id}.{}", Uuid::new_v4()));
        fs::rename(&original, &trashed).await?;
        Ok(Some(WorkspaceTrash { original, trashed }))
    }

    pub async fn restore_workspace(&self, trash: &WorkspaceTrash) -> Result<(), VaultError> {
        if let Some(parent) = trash.original.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(&trash.trashed, &trash.original).await?;
        Ok(())
    }

    pub async fn purge_workspace_trash(&self, trash: &WorkspaceTrash) -> Result<(), VaultError> {
        match fs::remove_dir_all(&trash.trashed).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn trash_task(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
        path: &TaskPath,
    ) -> Result<Option<TaskTrash>, VaultError> {
        let original = self.task_file(workspace_id, path);
        match fs::metadata(&original).await {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }

        let directory = self.data_dir.join("trash").join("tasks");
        fs::create_dir_all(&directory).await?;
        let trashed = directory.join(format!("{workspace_id}.{task_id}.{}", Uuid::new_v4()));
        fs::rename(&original, &trashed).await?;
        Ok(Some(TaskTrash { original, trashed }))
    }

    pub async fn restore_task(&self, trash: &TaskTrash) -> Result<(), VaultError> {
        if let Some(parent) = trash.original.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(&trash.trashed, &trash.original).await?;
        Ok(())
    }

    pub async fn purge_task_trash(&self, trash: &TaskTrash) -> Result<(), VaultError> {
        match fs::remove_file(&trash.trashed).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn remove_unattached_library_file(
        &self,
        workspace_id: Uuid,
        path: &LibraryPath,
    ) -> Result<(), VaultError> {
        let path = self.library_file(workspace_id, path);
        self.ensure_regular_library_file(workspace_id, &path)
            .await?;
        fs::remove_file(path).await?;
        Ok(())
    }

    pub async fn remove_unattached_task_file(
        &self,
        workspace_id: Uuid,
        path: &TaskPath,
    ) -> Result<(), VaultError> {
        let path = self.task_file(workspace_id, path);
        self.ensure_regular_managed_file(workspace_id, &path)
            .await?;
        fs::remove_file(path).await?;
        Ok(())
    }

    fn task_file(&self, workspace_id: Uuid, path: &TaskPath) -> PathBuf {
        self.workspace_directory(workspace_id)
            .join(path.relative_file())
    }

    fn workspace_directory(&self, workspace_id: Uuid) -> PathBuf {
        self.data_dir.join("vaults").join(workspace_id.to_string())
    }

    fn library_file(&self, workspace_id: Uuid, path: &LibraryPath) -> PathBuf {
        self.workspace_directory(workspace_id)
            .join(path.relative_file())
    }

    fn library_companion_directory(&self, workspace_id: Uuid, path: &LibraryPath) -> PathBuf {
        self.workspace_directory(workspace_id)
            .join(path.relative_companion_directory())
    }

    async fn ensure_safe_library_parent(
        &self,
        workspace_id: Uuid,
        destination: &Path,
    ) -> Result<(), VaultError> {
        self.verify_managed_ancestors(workspace_id, destination, true)
            .await
    }

    async fn ensure_regular_library_file(
        &self,
        workspace_id: Uuid,
        path: &Path,
    ) -> Result<(), VaultError> {
        self.ensure_regular_managed_file(workspace_id, path).await
    }

    async fn ensure_safe_managed_parent(
        &self,
        workspace_id: Uuid,
        destination: &Path,
    ) -> Result<(), VaultError> {
        self.verify_managed_ancestors(workspace_id, destination, true)
            .await
    }

    async fn ensure_regular_managed_file(
        &self,
        workspace_id: Uuid,
        path: &Path,
    ) -> Result<(), VaultError> {
        self.verify_managed_ancestors(workspace_id, path, false)
            .await?;
        let metadata = fs::symlink_metadata(path).await?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(VaultError::InvalidManagedPath);
        }
        Ok(())
    }

    async fn verify_managed_ancestors(
        &self,
        workspace_id: Uuid,
        destination: &Path,
        create: bool,
    ) -> Result<(), VaultError> {
        let workspace = self.workspace_directory(workspace_id);
        let parent = destination.parent().ok_or(VaultError::InvalidManagedPath)?;
        let relative = parent
            .strip_prefix(&workspace)
            .map_err(|_| VaultError::InvalidManagedPath)?;
        let mut current = self.data_dir.as_ref().clone();
        for component in Path::new("vaults")
            .join(workspace_id.to_string())
            .join(relative)
            .components()
        {
            current.push(component);
            match fs::symlink_metadata(&current).await {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err(VaultError::InvalidManagedPath);
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound && create => {
                    match fs::create_dir(&current).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }
}

async fn safe_read_directory(path: &Path) -> Result<Option<fs::ReadDir>, VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(VaultError::InvalidManagedPath)
        }
        Ok(_) => Ok(Some(fs::read_dir(path).await?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

async fn create_empty_file(path: &Path) -> Result<(), VaultError> {
    create_new_file(path, "").await
}

async fn create_new_file(path: &Path, content: &str) -> Result<(), VaultError> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
    {
        Ok(mut file) => {
            file.write_all(content.as_bytes()).await?;
            file.flush().await?;
            file.sync_all().await?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path).await?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(VaultError::InvalidLibraryPath);
            }
            if metadata.len() == 0 && content.is_empty() {
                Ok(())
            } else {
                Err(VaultError::ExistingDocument)
            }
        }
        Err(error) => Err(error.into()),
    }
}

async fn read_document(path: &Path) -> Result<VaultDocument, VaultError> {
    let content = fs::read_to_string(path).await?;
    Ok(VaultDocument {
        revision: content_revision(content.as_bytes()),
        content,
    })
}

async fn write_document(
    destination: &Path,
    content: &str,
    base_revision: &str,
) -> Result<String, VaultError> {
    let current = fs::read(destination).await?;
    if content_revision(&current) != base_revision {
        return Err(VaultError::RevisionConflict);
    }

    let directory = destination.parent().ok_or(VaultError::InvalidLibraryPath)?;
    let temporary = directory.join(format!(".{}.tmp", Uuid::new_v4()));
    let write_result = async {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        file.write_all(content.as_bytes()).await?;
        file.flush().await?;
        file.sync_all().await?;
        drop(file);
        fs::rename(&temporary, destination).await?;
        Ok::<(), io::Error>(())
    }
    .await;

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    write_result?;
    Ok(content_revision(content.as_bytes()))
}

fn content_revision(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    let mut revision = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut revision, "{byte:02x}").expect("writing to String cannot fail");
    }
    revision
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;
    use uuid::Uuid;

    use crate::domain::VaultStorageName;

    use super::{LibraryPath, TaskPath, Vault, VaultError};

    fn library_path(segments: &[&str]) -> LibraryPath {
        LibraryPath::parse(segments.iter().copied()).unwrap()
    }

    fn task_path(task_id: Uuid) -> TaskPath {
        let name = VaultStorageName::from_initial_name("Task", task_id);
        TaskPath::inbox(name.as_str()).unwrap()
    }

    #[tokio::test]
    async fn stores_markdown_faithfully_at_stable_id_paths() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let task_path = task_path(task_id);
        let vault = Vault::new(data_dir.path().to_owned());
        let markdown = "# Heading\n\n  Preserve this spacing.  \n\n- [ ] Item\n";

        vault
            .create_task_document(workspace_id, &task_path, "")
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, &task_path)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, &task_path, markdown, &revision)
            .await
            .unwrap();

        assert_eq!(
            vault
                .read_task_document(workspace_id, &task_path)
                .await
                .unwrap()
                .content,
            markdown
        );
        assert_eq!(
            std::fs::read_to_string(
                data_dir
                    .path()
                    .join("vaults")
                    .join(workspace_id.to_string())
                    .join("Todo")
                    .join(format!(
                        "{}.md",
                        VaultStorageName::from_initial_name("Task", task_id).as_str()
                    ))
            )
            .unwrap(),
            markdown
        );
    }

    #[tokio::test]
    async fn never_replaces_an_unattached_existing_document() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let task_path = task_path(task_id);
        let vault = Vault::new(data_dir.path().to_owned());

        vault
            .create_task_document(workspace_id, &task_path, "")
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, &task_path)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, &task_path, "existing", &revision)
            .await
            .unwrap();

        assert!(matches!(
            vault
                .create_task_document(workspace_id, &task_path, "")
                .await,
            Err(VaultError::ExistingDocument)
        ));
    }

    #[tokio::test]
    async fn workspace_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let task_path = task_path(task_id);
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_task_document(workspace_id, &task_path, "")
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, &task_path)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, &task_path, "recoverable", &revision)
            .await
            .unwrap();

        let trashed = vault.trash_workspace(workspace_id).await.unwrap().unwrap();
        assert!(
            vault
                .read_task_document(workspace_id, &task_path)
                .await
                .is_err()
        );
        vault.restore_workspace(&trashed).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, &task_path)
                .await
                .unwrap()
                .content,
            "recoverable"
        );

        let trashed = vault.trash_workspace(workspace_id).await.unwrap().unwrap();
        vault.purge_workspace_trash(&trashed).await.unwrap();
        assert!(vault.restore_workspace(&trashed).await.is_err());
    }

    #[tokio::test]
    async fn task_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let task_path = task_path(task_id);
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_task_document(workspace_id, &task_path, "")
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, &task_path)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, &task_path, "recoverable", &revision)
            .await
            .unwrap();

        let trashed = vault
            .trash_task(workspace_id, task_id, &task_path)
            .await
            .unwrap()
            .unwrap();
        assert!(
            vault
                .read_task_document(workspace_id, &task_path)
                .await
                .is_err()
        );
        vault.restore_task(&trashed).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, &task_path)
                .await
                .unwrap()
                .content,
            "recoverable"
        );

        let trashed = vault
            .trash_task(workspace_id, task_id, &task_path)
            .await
            .unwrap()
            .unwrap();
        vault.purge_task_trash(&trashed).await.unwrap();
        assert!(vault.restore_task(&trashed).await.is_err());
    }

    #[tokio::test]
    async fn stores_library_notes_in_portable_companion_paths() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let path = library_path(&["getting_started", "installation"]);
        let vault = Vault::new(data_dir.path().to_owned());

        vault
            .create_page_document(workspace_id, &path)
            .await
            .unwrap();
        let revision = vault
            .read_page_document(workspace_id, &path)
            .await
            .unwrap()
            .revision;
        vault
            .write_page_document(
                workspace_id,
                &path,
                "# Notes\n\nUTF-8: tiếng Việt\n",
                &revision,
            )
            .await
            .unwrap();

        let path = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Wiki")
            .join("getting_started")
            .join("installation.md");
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "# Notes\n\nUTF-8: tiếng Việt\n"
        );
    }

    #[tokio::test]
    async fn rejects_stale_revisions_without_overwriting_external_edits() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let path = library_path(&["external_edits"]);
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_page_document(workspace_id, &path)
            .await
            .unwrap();
        let stale_revision = vault
            .read_page_document(workspace_id, &path)
            .await
            .unwrap()
            .revision;
        let directory = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Wiki");
        std::fs::write(directory.join("external_edits.md"), "external change").unwrap();

        assert!(matches!(
            vault
                .write_page_document(workspace_id, &path, "local change", &stale_revision,)
                .await,
            Err(VaultError::RevisionConflict)
        ));
        assert_eq!(
            vault
                .read_page_document(workspace_id, &path)
                .await
                .unwrap()
                .content,
            "external change"
        );
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn library_subtree_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let path = library_path(&["recoverable"]);
        let child_path = library_path(&["recoverable", "child"]);
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_page_document(workspace_id, &path)
            .await
            .unwrap();
        vault
            .create_page_document(workspace_id, &child_path)
            .await
            .unwrap();

        let trashed = vault
            .trash_library_tree(workspace_id, Uuid::new_v4(), &path)
            .await
            .unwrap();
        vault.restore_library_trash(&trashed).await.unwrap();
        assert!(vault.read_page_document(workspace_id, &path).await.is_ok());
        assert!(
            vault
                .read_page_document(workspace_id, &child_path)
                .await
                .is_ok()
        );

        let trashed = vault
            .trash_library_tree(workspace_id, Uuid::new_v4(), &path)
            .await
            .unwrap();
        vault.purge_library_trash(&trashed).await.unwrap();
        assert!(vault.restore_library_trash(&trashed).await.is_err());
    }

    #[tokio::test]
    async fn library_moves_include_the_companion_subtree_and_can_roll_back() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let source = library_path(&["source"]);
        let source_child = library_path(&["source", "child"]);
        let destination_parent = library_path(&["destination"]);
        let destination = library_path(&["destination", "source"]);
        let destination_child = library_path(&["destination", "source", "child"]);
        let vault = Vault::new(data_dir.path().to_owned());
        for path in [&source, &source_child, &destination_parent] {
            vault
                .create_page_document(workspace_id, path)
                .await
                .unwrap();
        }

        let movement = vault
            .move_library_tree(workspace_id, Uuid::new_v4(), &source, &destination)
            .await
            .unwrap()
            .unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &destination)
                .await
                .is_ok()
        );
        assert!(
            vault
                .read_page_document(workspace_id, &destination_child)
                .await
                .is_ok()
        );
        vault.rollback_library_move(&movement).await.unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &source)
                .await
                .is_ok()
        );
        assert!(
            vault
                .read_page_document(workspace_id, &source_child)
                .await
                .is_ok()
        );

        let movement = vault
            .move_library_tree(workspace_id, Uuid::new_v4(), &source, &destination)
            .await
            .unwrap()
            .unwrap();
        vault.finish_library_move(&movement).await.unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &source)
                .await
                .is_err()
        );
        assert!(vault.pending_library_operations().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn operation_manifests_recover_interrupted_moves_and_deletes() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let document_id = Uuid::new_v4();
        let source = library_path(&["source"]);
        let destination_parent = library_path(&["destination"]);
        let destination = library_path(&["destination", "source"]);
        let child = library_path(&["source", "child"]);
        let vault = Vault::new(data_dir.path().to_owned());
        for path in [&source, &child, &destination_parent] {
            vault
                .create_page_document(workspace_id, path)
                .await
                .unwrap();
        }

        let _interrupted = vault
            .move_library_tree(workspace_id, document_id, &source, &destination)
            .await
            .unwrap();
        let pending = vault.pending_library_operations().await.unwrap();
        assert_eq!(pending.len(), 1);
        vault
            .recover_library_move(&pending[0], false)
            .await
            .unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &source)
                .await
                .is_ok()
        );

        let _interrupted = vault
            .move_library_tree(workspace_id, document_id, &source, &destination)
            .await
            .unwrap();
        let pending = vault.pending_library_operations().await.unwrap();
        vault.recover_library_move(&pending[0], true).await.unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &destination)
                .await
                .is_ok()
        );

        let _interrupted = vault
            .trash_library_tree(workspace_id, document_id, &destination)
            .await
            .unwrap();
        let pending = vault.pending_library_operations().await.unwrap();
        vault
            .recover_library_delete(&pending[0], true)
            .await
            .unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &destination)
                .await
                .is_ok()
        );

        let _interrupted = vault
            .trash_library_tree(workspace_id, document_id, &destination)
            .await
            .unwrap();
        let pending = vault.pending_library_operations().await.unwrap();
        vault
            .recover_library_delete(&pending[0], false)
            .await
            .unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, &destination)
                .await
                .is_err()
        );
        assert!(vault.pending_library_operations().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn task_move_manifests_reconcile_with_the_database_decision() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let source = task_path(task_id);
        let destination = TaskPath::project(
            "project--a1b2c3",
            source
                .relative_file()
                .file_stem()
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_task_document(workspace_id, &source, "properties and body")
            .await
            .unwrap();

        let _interrupted = vault
            .move_task(workspace_id, task_id, &source, &destination)
            .await
            .unwrap();
        let pending = vault.pending_task_moves().await.unwrap();
        vault.recover_task_move(&pending[0], false).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, &source)
                .await
                .unwrap()
                .content,
            "properties and body"
        );

        let _interrupted = vault
            .move_task(workspace_id, task_id, &source, &destination)
            .await
            .unwrap();
        let pending = vault.pending_task_moves().await.unwrap();
        vault.recover_task_move(&pending[0], true).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, &destination)
                .await
                .unwrap()
                .content,
            "properties and body"
        );
        assert!(vault.pending_task_moves().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn workspace_layout_manifest_recovers_both_sides_of_the_database_commit() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let workspace = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string());
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(workspace.join("legacy.md"), "legacy").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let staged = vault
            .stage_workspace_layout_v2(workspace_id, &[], &[])
            .await
            .unwrap();
        let _interrupted = vault.activate_workspace_layout_v2(staged).await.unwrap();
        let pending = vault.pending_workspace_layout_migrations().await.unwrap();
        vault
            .recover_workspace_layout_migration(&pending[0], false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(workspace.join("legacy.md")).unwrap(),
            "legacy"
        );

        let staged = vault
            .stage_workspace_layout_v2(workspace_id, &[], &[])
            .await
            .unwrap();
        let _interrupted = vault.activate_workspace_layout_v2(staged).await.unwrap();
        let pending = vault.pending_workspace_layout_migrations().await.unwrap();
        vault
            .recover_workspace_layout_migration(&pending[0], true)
            .await
            .unwrap();
        assert!(workspace.is_dir());
        assert!(
            vault
                .pending_workspace_layout_migrations()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn task_paths_reject_symlinked_managed_ancestors() {
        let data_dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let project = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Projects")
            .join("project--a1b2c3");
        std::fs::create_dir_all(project.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(outside.path(), project).unwrap();
        let path = TaskPath::project("project--a1b2c3", "task--d4e5f6").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        assert!(matches!(
            vault
                .create_task_document(workspace_id, &path, "must stay inside the vault")
                .await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[test]
    fn rejects_unsafe_or_excessive_library_paths() {
        assert!(LibraryPath::parse(["..", "escape"]).is_err());
        assert!(LibraryPath::parse(std::iter::repeat_n("note", 13)).is_err());
        assert!(LibraryPath::parse(["con"]).is_err());
    }
}
