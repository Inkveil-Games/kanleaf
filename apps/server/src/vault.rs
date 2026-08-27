use std::{io, path::PathBuf, sync::Arc};

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

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault I/O operation failed")]
    Io(#[from] io::Error),
    #[error("an existing task document contains data")]
    ExistingDocument,
}

impl Vault {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir: Arc::new(data_dir),
        }
    }

    pub async fn create_document(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
    ) -> Result<(), VaultError> {
        let path = self.task_path(workspace_id, task_id);
        fs::create_dir_all(self.task_directory(workspace_id)).await?;

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

    pub async fn read_document(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
    ) -> Result<String, VaultError> {
        Ok(fs::read_to_string(self.task_path(workspace_id, task_id)).await?)
    }

    pub async fn write_document(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
        content: &str,
    ) -> Result<(), VaultError> {
        let destination = self.task_path(workspace_id, task_id);
        let directory = self.task_directory(workspace_id);
        fs::create_dir_all(&directory).await?;
        let temporary = directory.join(format!(".{task_id}.{}.tmp", Uuid::new_v4()));

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
        Ok(write_result?)
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
        let original = self.task_path(workspace_id, task_id);
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

    fn task_path(&self, workspace_id: Uuid, task_id: Uuid) -> PathBuf {
        self.task_directory(workspace_id)
            .join(format!("{task_id}.md"))
    }

    fn task_directory(&self, workspace_id: Uuid) -> PathBuf {
        self.workspace_directory(workspace_id).join("Tasks")
    }

    fn workspace_directory(&self, workspace_id: Uuid) -> PathBuf {
        self.data_dir.join("vaults").join(workspace_id.to_string())
    }
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

        vault.create_document(workspace_id, task_id).await.unwrap();
        vault
            .write_document(workspace_id, task_id, markdown)
            .await
            .unwrap();

        assert_eq!(
            vault.read_document(workspace_id, task_id).await.unwrap(),
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

        vault.create_document(workspace_id, task_id).await.unwrap();
        vault
            .write_document(workspace_id, task_id, "existing")
            .await
            .unwrap();

        assert!(matches!(
            vault.create_document(workspace_id, task_id).await,
            Err(VaultError::ExistingDocument)
        ));
    }

    #[tokio::test]
    async fn workspace_trash_can_be_restored_or_purged() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());
        vault.create_document(workspace_id, task_id).await.unwrap();
        vault
            .write_document(workspace_id, task_id, "recoverable")
            .await
            .unwrap();

        let trashed = vault.trash_workspace(workspace_id).await.unwrap().unwrap();
        assert!(vault.read_document(workspace_id, task_id).await.is_err());
        vault.restore_workspace(&trashed).await.unwrap();
        assert_eq!(
            vault.read_document(workspace_id, task_id).await.unwrap(),
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
        vault.create_document(workspace_id, task_id).await.unwrap();
        vault
            .write_document(workspace_id, task_id, "recoverable")
            .await
            .unwrap();

        let trashed = vault
            .trash_task(workspace_id, task_id)
            .await
            .unwrap()
            .unwrap();
        assert!(vault.read_document(workspace_id, task_id).await.is_err());
        vault.restore_task(&trashed).await.unwrap();
        assert_eq!(
            vault.read_document(workspace_id, task_id).await.unwrap(),
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
}
