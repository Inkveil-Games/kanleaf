use std::{io, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use crate::domain::VaultStorageName;

use super::workspace_deletion::{
    ensure_absent, ensure_regular_directory, regular_directory_exists, remove_file_if_present,
    remove_regular_directory_if_present, sync_directory,
};
use super::{Vault, VaultError};

const PROJECT_DELETION_OPERATION: &str = "project_delete";

#[derive(Debug)]
pub(crate) struct ProjectDeletion {
    workspace_id: Uuid,
    project_id: Uuid,
    storage_name: String,
    trash_id: Uuid,
    vault_present: bool,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct ProjectDeletionManifest {
    operation: String,
    workspace_id: Uuid,
    project_id: Uuid,
    storage_name: String,
    trash_id: Uuid,
    vault_present: bool,
}

impl ProjectDeletion {
    pub(crate) const fn project_id(&self) -> Uuid {
        self.project_id
    }
}

impl Vault {
    pub(crate) async fn begin_project_deletion(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        storage_name: &str,
    ) -> Result<ProjectDeletion, VaultError> {
        VaultStorageName::parse(storage_name).map_err(|_| VaultError::InvalidManagedPath)?;
        let original = self.project_directory(workspace_id, storage_name);
        let vault_present = regular_directory_exists(&original).await?;
        let trash_id = Uuid::new_v4();
        let trash = self.project_deletion_trash(workspace_id, project_id, trash_id);
        ensure_absent(&trash).await?;
        self.ensure_project_deletion_directories().await?;

        let manifest = self
            .write_project_deletion_manifest(&ProjectDeletionManifest {
                operation: PROJECT_DELETION_OPERATION.to_owned(),
                workspace_id,
                project_id,
                storage_name: storage_name.to_owned(),
                trash_id,
                vault_present,
            })
            .await?;
        let deletion = ProjectDeletion {
            workspace_id,
            project_id,
            storage_name: storage_name.to_owned(),
            trash_id,
            vault_present,
            manifest,
        };
        if vault_present {
            if let Err(error) = fs::rename(&original, &trash).await {
                let _ = remove_file_if_present(&deletion.manifest).await;
                return Err(error.into());
            }
            if let Err(error) = self.sync_project_deletion_parents(workspace_id).await {
                return match self.rollback_project_deletion(&deletion).await {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(io::Error::other(format!(
                        "failed to sync staged Project deletion ({error}); rollback failed ({rollback_error})"
                    ))
                    .into()),
                };
            }
        }
        Ok(deletion)
    }

    pub(crate) async fn rollback_project_deletion(
        &self,
        deletion: &ProjectDeletion,
    ) -> Result<(), VaultError> {
        if deletion.vault_present {
            let original = self.project_directory(deletion.workspace_id, &deletion.storage_name);
            let trash = self.project_deletion_trash(
                deletion.workspace_id,
                deletion.project_id,
                deletion.trash_id,
            );
            match (
                regular_directory_exists(&original).await?,
                regular_directory_exists(&trash).await?,
            ) {
                (true, false) => {}
                (false, true) => {
                    if let Some(parent) = original.parent() {
                        ensure_regular_directory(parent).await?;
                    }
                    fs::rename(trash, original).await?;
                    self.sync_project_deletion_parents(deletion.workspace_id)
                        .await?;
                }
                (true, true) => return Err(VaultError::ExistingDocument),
                (false, false) => {
                    return Err(io::Error::new(
                        io::ErrorKind::NotFound,
                        "Project deletion lost both the live and trashed vault",
                    )
                    .into());
                }
            }
        }
        remove_file_if_present(&deletion.manifest).await?;
        sync_directory(&self.project_deletion_manifest_directory()).await
    }

    pub(crate) async fn finish_project_deletion(
        &self,
        deletion: &ProjectDeletion,
    ) -> Result<(), VaultError> {
        remove_regular_directory_if_present(
            &self.project_directory(deletion.workspace_id, &deletion.storage_name),
        )
        .await?;
        remove_regular_directory_if_present(&self.project_deletion_trash(
            deletion.workspace_id,
            deletion.project_id,
            deletion.trash_id,
        ))
        .await?;
        self.sync_project_deletion_parents(deletion.workspace_id)
            .await?;
        remove_file_if_present(&deletion.manifest).await?;
        sync_directory(&self.project_deletion_manifest_directory()).await
    }

    pub(crate) async fn pending_project_deletions(
        &self,
    ) -> Result<Vec<ProjectDeletion>, VaultError> {
        let directory = self.project_deletion_manifest_directory();
        let mut entries = match fs::read_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut deletions = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if !entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(".project-deletion.json"))
            {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(VaultError::InvalidManagedPath);
            }
            let bytes = fs::read(entry.path()).await?;
            let manifest: ProjectDeletionManifest = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if manifest.operation != PROJECT_DELETION_OPERATION
                || VaultStorageName::parse(&manifest.storage_name).is_err()
            {
                return Err(VaultError::InvalidManagedPath);
            }
            deletions.push(ProjectDeletion {
                workspace_id: manifest.workspace_id,
                project_id: manifest.project_id,
                storage_name: manifest.storage_name,
                trash_id: manifest.trash_id,
                vault_present: manifest.vault_present,
                manifest: entry.path(),
            });
        }
        deletions.sort_by_key(ProjectDeletion::project_id);
        Ok(deletions)
    }

    fn project_directory(&self, workspace_id: Uuid, storage_name: &str) -> PathBuf {
        self.workspace_directory(workspace_id)
            .join("Projects")
            .join(storage_name)
    }

    async fn ensure_project_deletion_directories(&self) -> Result<(), VaultError> {
        let vaults = self.data_dir.join("vaults");
        let trash = vaults.join(".trash");
        ensure_regular_directory(&vaults).await?;
        ensure_regular_directory(&trash).await?;
        ensure_regular_directory(&trash.join("projects")).await?;
        ensure_regular_directory(&trash.join("project-deletions")).await?;
        sync_directory(self.data_dir.as_path()).await?;
        sync_directory(&vaults).await?;
        sync_directory(&trash).await?;
        sync_directory(&trash.join("projects")).await?;
        sync_directory(&trash.join("project-deletions")).await
    }

    fn project_deletion_trash(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        trash_id: Uuid,
    ) -> PathBuf {
        self.data_dir
            .join("vaults/.trash/projects")
            .join(format!("{workspace_id}.{project_id}.{trash_id}"))
    }

    fn project_deletion_manifest_directory(&self) -> PathBuf {
        self.data_dir.join("vaults/.trash/project-deletions")
    }

    async fn sync_project_deletion_parents(&self, workspace_id: Uuid) -> Result<(), VaultError> {
        let projects = self.workspace_directory(workspace_id).join("Projects");
        if regular_directory_exists(&projects).await? {
            sync_directory(&projects).await?;
        }
        sync_directory(&self.data_dir.join("vaults/.trash/projects")).await
    }

    async fn write_project_deletion_manifest(
        &self,
        deletion: &ProjectDeletionManifest,
    ) -> Result<PathBuf, VaultError> {
        let path = self
            .project_deletion_manifest_directory()
            .join(format!("{}.project-deletion.json", Uuid::new_v4()));
        let bytes = serde_json::to_vec(deletion)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await?;
        file.write_all(&bytes).await?;
        file.flush().await?;
        file.sync_all().await?;
        sync_directory(&self.project_deletion_manifest_directory()).await?;
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;
    use uuid::Uuid;

    use super::super::Vault;

    #[tokio::test]
    async fn project_directory_deletion_can_be_recovered_on_either_side_of_commit() {
        let data_dir = TempDir::new().unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        let workspace_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let storage_name = format!("project--{}", &project_id.simple().to_string()[..6]);
        let project_directory = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Projects")
            .join(&storage_name);
        fs::create_dir_all(project_directory.join("Todo")).unwrap();
        fs::write(project_directory.join("Todo/task.md"), "# Keep me\n").unwrap();

        let deletion = vault
            .begin_project_deletion(workspace_id, project_id, &storage_name)
            .await
            .unwrap();
        assert!(!project_directory.exists());
        assert_eq!(vault.pending_project_deletions().await.unwrap().len(), 1);
        vault.rollback_project_deletion(&deletion).await.unwrap();
        assert!(project_directory.join("Todo/task.md").exists());
        assert!(vault.pending_project_deletions().await.unwrap().is_empty());

        let deletion = vault
            .begin_project_deletion(workspace_id, project_id, &storage_name)
            .await
            .unwrap();
        vault.finish_project_deletion(&deletion).await.unwrap();
        assert!(!project_directory.exists());
        assert!(vault.pending_project_deletions().await.unwrap().is_empty());
    }
}
