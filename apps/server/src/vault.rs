use std::{fmt::Write as _, io, path::PathBuf, sync::Arc};

use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};
use uuid::Uuid;

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

pub struct PageTrash {
    original: PathBuf,
    trashed: PathBuf,
}

#[derive(Debug, Eq, PartialEq)]
pub struct VaultDocument {
    pub content: String,
    pub revision: String,
}

#[derive(Clone, Copy)]
enum DocumentIdentity {
    Task(Uuid),
    Page(Uuid),
}

impl DocumentIdentity {
    const fn id(self) -> Uuid {
        match self {
            Self::Task(id) | Self::Page(id) => id,
        }
    }

    const fn directory(self) -> &'static str {
        match self {
            Self::Task(_) => "Tasks",
            Self::Page(_) => "Pages",
        }
    }
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault I/O operation failed")]
    Io(#[from] io::Error),
    #[error("an existing Markdown document contains data")]
    ExistingDocument,
    #[error("the Markdown document changed after it was opened")]
    RevisionConflict,
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
        task_id: Uuid,
    ) -> Result<(), VaultError> {
        self.create(workspace_id, DocumentIdentity::Task(task_id))
            .await
    }

    pub async fn create_page_document(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
    ) -> Result<(), VaultError> {
        self.create(workspace_id, DocumentIdentity::Page(document_id))
            .await
    }

    async fn create(
        &self,
        workspace_id: Uuid,
        identity: DocumentIdentity,
    ) -> Result<(), VaultError> {
        let path = self.document_path(workspace_id, identity);
        fs::create_dir_all(self.document_directory(workspace_id, identity)).await?;

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(mut file) => {
                file.flush().await?;
                file.sync_all().await?;
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if fs::metadata(path).await?.len() == 0 {
                    Ok(())
                } else {
                    Err(VaultError::ExistingDocument)
                }
            }
            Err(error) => Err(error.into()),
        }
    }

    pub async fn read_task_document(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
    ) -> Result<VaultDocument, VaultError> {
        self.read(workspace_id, DocumentIdentity::Task(task_id))
            .await
    }

    pub async fn read_page_document(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
    ) -> Result<VaultDocument, VaultError> {
        self.read(workspace_id, DocumentIdentity::Page(document_id))
            .await
    }

    async fn read(
        &self,
        workspace_id: Uuid,
        identity: DocumentIdentity,
    ) -> Result<VaultDocument, VaultError> {
        let content = fs::read_to_string(self.document_path(workspace_id, identity)).await?;
        Ok(VaultDocument {
            revision: content_revision(content.as_bytes()),
            content,
        })
    }

    pub async fn write_task_document(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
        content: &str,
        base_revision: &str,
    ) -> Result<String, VaultError> {
        self.write(
            workspace_id,
            DocumentIdentity::Task(task_id),
            content,
            base_revision,
        )
        .await
    }

    pub async fn write_page_document(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
        content: &str,
        base_revision: &str,
    ) -> Result<String, VaultError> {
        self.write(
            workspace_id,
            DocumentIdentity::Page(document_id),
            content,
            base_revision,
        )
        .await
    }

    async fn write(
        &self,
        workspace_id: Uuid,
        identity: DocumentIdentity,
        content: &str,
        base_revision: &str,
    ) -> Result<String, VaultError> {
        let destination = self.document_path(workspace_id, identity);
        let current = fs::read(&destination).await?;
        if content_revision(&current) != base_revision {
            return Err(VaultError::RevisionConflict);
        }

        let directory = self.document_directory(workspace_id, identity);
        fs::create_dir_all(&directory).await?;
        let temporary = directory.join(format!(".{}.{}.tmp", identity.id(), Uuid::new_v4()));

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
            fs::rename(&temporary, &destination).await?;
            Ok::<(), io::Error>(())
        }
        .await;

        if write_result.is_err() {
            let _ = fs::remove_file(&temporary).await;
        }
        write_result?;
        Ok(content_revision(content.as_bytes()))
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
    ) -> Result<Option<TaskTrash>, VaultError> {
        let original = self.document_path(workspace_id, DocumentIdentity::Task(task_id));
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

    pub async fn trash_page(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
    ) -> Result<Option<PageTrash>, VaultError> {
        let original = self.document_path(workspace_id, DocumentIdentity::Page(document_id));
        match fs::metadata(&original).await {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }

        let directory = self.data_dir.join("trash").join("pages");
        fs::create_dir_all(&directory).await?;
        let trashed = directory.join(format!("{workspace_id}.{document_id}.{}", Uuid::new_v4()));
        fs::rename(&original, &trashed).await?;
        Ok(Some(PageTrash { original, trashed }))
    }

    pub async fn restore_page(&self, trash: &PageTrash) -> Result<(), VaultError> {
        if let Some(parent) = trash.original.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(&trash.trashed, &trash.original).await?;
        Ok(())
    }

    pub async fn purge_page_trash(&self, trash: &PageTrash) -> Result<(), VaultError> {
        match fs::remove_file(&trash.trashed).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn document_path(&self, workspace_id: Uuid, identity: DocumentIdentity) -> PathBuf {
        self.document_directory(workspace_id, identity)
            .join(format!("{}.md", identity.id()))
    }

    fn document_directory(&self, workspace_id: Uuid, identity: DocumentIdentity) -> PathBuf {
        self.workspace_directory(workspace_id)
            .join(identity.directory())
    }

    fn workspace_directory(&self, workspace_id: Uuid) -> PathBuf {
        self.data_dir.join("vaults").join(workspace_id.to_string())
    }
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

    use super::{Vault, VaultError};

    #[tokio::test]
    async fn stores_markdown_faithfully_at_stable_id_paths() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());
        let markdown = "# Heading\n\n  Preserve this spacing.  \n\n- [ ] Item\n";

        vault
            .create_task_document(workspace_id, task_id)
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, task_id)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, task_id, markdown, &revision)
            .await
            .unwrap();

        assert_eq!(
            vault
                .read_task_document(workspace_id, task_id)
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
                    .join("Tasks")
                    .join(format!("{task_id}.md"))
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
        let vault = Vault::new(data_dir.path().to_owned());

        vault
            .create_task_document(workspace_id, task_id)
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, task_id)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, task_id, "existing", &revision)
            .await
            .unwrap();

        assert!(matches!(
            vault.create_task_document(workspace_id, task_id).await,
            Err(VaultError::ExistingDocument)
        ));
    }

    #[tokio::test]
    async fn workspace_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_task_document(workspace_id, task_id)
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, task_id)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, task_id, "recoverable", &revision)
            .await
            .unwrap();

        let trashed = vault.trash_workspace(workspace_id).await.unwrap().unwrap();
        assert!(
            vault
                .read_task_document(workspace_id, task_id)
                .await
                .is_err()
        );
        vault.restore_workspace(&trashed).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, task_id)
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
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_task_document(workspace_id, task_id)
            .await
            .unwrap();
        let revision = vault
            .read_task_document(workspace_id, task_id)
            .await
            .unwrap()
            .revision;
        vault
            .write_task_document(workspace_id, task_id, "recoverable", &revision)
            .await
            .unwrap();

        let trashed = vault
            .trash_task(workspace_id, task_id)
            .await
            .unwrap()
            .unwrap();
        assert!(
            vault
                .read_task_document(workspace_id, task_id)
                .await
                .is_err()
        );
        vault.restore_task(&trashed).await.unwrap();
        assert_eq!(
            vault
                .read_task_document(workspace_id, task_id)
                .await
                .unwrap()
                .content,
            "recoverable"
        );

        let trashed = vault
            .trash_task(workspace_id, task_id)
            .await
            .unwrap()
            .unwrap();
        vault.purge_task_trash(&trashed).await.unwrap();
        assert!(vault.restore_task(&trashed).await.is_err());
    }

    #[tokio::test]
    async fn stores_pages_separately_with_stable_file_identity() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let document_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());

        vault
            .create_page_document(workspace_id, document_id)
            .await
            .unwrap();
        let revision = vault
            .read_page_document(workspace_id, document_id)
            .await
            .unwrap()
            .revision;
        vault
            .write_page_document(
                workspace_id,
                document_id,
                "# Notes\n\nUTF-8: tiếng Việt\n",
                &revision,
            )
            .await
            .unwrap();

        let path = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Pages")
            .join(format!("{document_id}.md"));
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "# Notes\n\nUTF-8: tiếng Việt\n"
        );
    }

    #[tokio::test]
    async fn rejects_stale_revisions_without_overwriting_external_edits() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let document_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_page_document(workspace_id, document_id)
            .await
            .unwrap();
        let stale_revision = vault
            .read_page_document(workspace_id, document_id)
            .await
            .unwrap()
            .revision;
        let directory = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Pages");
        std::fs::write(
            directory.join(format!("{document_id}.md")),
            "external change",
        )
        .unwrap();

        assert!(matches!(
            vault
                .write_page_document(workspace_id, document_id, "local change", &stale_revision,)
                .await,
            Err(VaultError::RevisionConflict)
        ));
        assert_eq!(
            vault
                .read_page_document(workspace_id, document_id)
                .await
                .unwrap()
                .content,
            "external change"
        );
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn page_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let document_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .create_page_document(workspace_id, document_id)
            .await
            .unwrap();

        let trashed = vault
            .trash_page(workspace_id, document_id)
            .await
            .unwrap()
            .unwrap();
        vault.restore_page(&trashed).await.unwrap();
        assert!(
            vault
                .read_page_document(workspace_id, document_id)
                .await
                .is_ok()
        );

        let trashed = vault
            .trash_page(workspace_id, document_id)
            .await
            .unwrap()
            .unwrap();
        vault.purge_page_trash(&trashed).await.unwrap();
        assert!(vault.restore_page(&trashed).await.is_err());
    }
}
