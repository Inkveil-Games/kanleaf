use std::{future::Future, io, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use super::{Vault, VaultError};

const WORKSPACE_DELETION_OPERATION: &str = "workspace_delete";

#[derive(Debug)]
pub(crate) struct WorkspaceDeletion {
    workspace_id: Uuid,
    trash_id: Uuid,
    vault_present: bool,
    export_staging_keys: Vec<Uuid>,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct WorkspaceDeletionManifest {
    operation: String,
    workspace_id: Uuid,
    trash_id: Uuid,
    vault_present: bool,
    export_staging_keys: Vec<Uuid>,
}

impl WorkspaceDeletion {
    pub(crate) const fn workspace_id(&self) -> Uuid {
        self.workspace_id
    }
}

impl Vault {
    pub(crate) async fn begin_workspace_deletion(
        &self,
        workspace_id: Uuid,
        mut export_staging_keys: Vec<Uuid>,
    ) -> Result<WorkspaceDeletion, VaultError> {
        let original = self.workspace_directory(workspace_id);
        let vault_present = regular_directory_exists(&original).await?;
        let trash_id = Uuid::new_v4();
        let trash = self.workspace_deletion_trash(workspace_id, trash_id);
        ensure_absent(&trash).await?;

        export_staging_keys.sort_unstable();
        export_staging_keys.dedup();
        self.ensure_workspace_deletion_directories().await?;
        let manifest = self
            .write_workspace_deletion_manifest(&WorkspaceDeletionManifest {
                operation: WORKSPACE_DELETION_OPERATION.to_owned(),
                workspace_id,
                trash_id,
                vault_present,
                export_staging_keys: export_staging_keys.clone(),
            })
            .await?;

        let deletion = WorkspaceDeletion {
            workspace_id,
            trash_id,
            vault_present,
            export_staging_keys,
            manifest,
        };
        if vault_present {
            self.stage_workspace_vault(&deletion, async {
                sync_directory(&self.data_dir.join("vaults")).await?;
                sync_directory(&self.data_dir.join("vaults/.trash/workspaces")).await
            })
            .await?;
        }

        Ok(deletion)
    }

    pub(crate) async fn rollback_workspace_deletion(
        &self,
        deletion: &WorkspaceDeletion,
    ) -> Result<(), VaultError> {
        if deletion.vault_present {
            let original = self.workspace_directory(deletion.workspace_id);
            let trash = self.workspace_deletion_trash(deletion.workspace_id, deletion.trash_id);
            match (
                regular_directory_exists(&original).await?,
                regular_directory_exists(&trash).await?,
            ) {
                (true, false) => {}
                (false, true) => {
                    fs::rename(trash, original).await?;
                    sync_directory(&self.data_dir.join("vaults/.trash/workspaces")).await?;
                    sync_directory(&self.data_dir.join("vaults")).await?;
                }
                (true, true) => return Err(VaultError::ExistingDocument),
                (false, false) => {
                    return Err(io::Error::new(
                        io::ErrorKind::NotFound,
                        "Workspace deletion lost both the live and trashed vault",
                    )
                    .into());
                }
            }
        }
        remove_file_if_present(&deletion.manifest).await?;
        sync_directory(&self.workspace_deletion_manifest_directory()).await
    }

    pub(crate) async fn finish_workspace_deletion(
        &self,
        deletion: &WorkspaceDeletion,
    ) -> Result<(), VaultError> {
        remove_regular_directory_if_present(&self.workspace_directory(deletion.workspace_id))
            .await?;
        remove_regular_directory_if_present(
            &self.workspace_deletion_trash(deletion.workspace_id, deletion.trash_id),
        )
        .await?;
        self.discard_workspace_layout_copies(deletion.workspace_id)
            .await?;
        sync_directory(&self.data_dir.join("vaults")).await?;
        sync_directory(&self.data_dir.join("vaults/.trash/workspaces")).await?;
        for staging_key in &deletion.export_staging_keys {
            self.remove_export_artifact(*staging_key).await?;
        }
        self.discard_workspace_task_moves(deletion.workspace_id)
            .await?;
        self.discard_workspace_task_trash(deletion.workspace_id)
            .await?;
        self.discard_workspace_library_operations(deletion.workspace_id)
            .await?;
        sync_directory_if_present(&self.data_dir.join("operations")).await?;
        sync_directory_if_present(&self.data_dir.join("trash/library")).await?;
        remove_file_if_present(&deletion.manifest).await?;
        sync_directory(&self.workspace_deletion_manifest_directory()).await
    }

    async fn stage_workspace_vault<F>(
        &self,
        deletion: &WorkspaceDeletion,
        sync_after_rename: F,
    ) -> Result<(), VaultError>
    where
        F: Future<Output = Result<(), VaultError>>,
    {
        let original = self.workspace_directory(deletion.workspace_id);
        let trash = self.workspace_deletion_trash(deletion.workspace_id, deletion.trash_id);
        if let Err(error) = fs::rename(&original, &trash).await {
            let _ = remove_file_if_present(&deletion.manifest).await;
            let _ = sync_directory(&self.workspace_deletion_manifest_directory()).await;
            return Err(error.into());
        }

        if let Err(sync_error) = sync_after_rename.await {
            return match self.rollback_workspace_deletion(deletion).await {
                Ok(()) => Err(sync_error),
                Err(rollback_error) => Err(io::Error::other(format!(
                    "failed to sync staged Workspace deletion ({sync_error}); rollback failed ({rollback_error})"
                ))
                .into()),
            };
        }
        Ok(())
    }

    async fn discard_workspace_task_trash(&self, workspace_id: Uuid) -> Result<(), VaultError> {
        let directory = self.data_dir.join("trash/tasks");
        let mut entries = match fs::read_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let prefix = format!("{workspace_id}.");
        while let Some(entry) = entries.next_entry().await? {
            let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !file_name.starts_with(&prefix) {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                return Err(VaultError::InvalidManagedPath);
            }
            remove_file_if_present(&entry.path()).await?;
        }
        sync_directory(&directory).await
    }

    async fn discard_workspace_layout_copies(&self, workspace_id: Uuid) -> Result<(), VaultError> {
        let vaults = self.data_dir.join("vaults");
        let legacy_prefix = format!("{workspace_id}.legacy-");
        let staging_prefix = format!(".{workspace_id}.v2-staging.");
        let mut entries = fs::read_dir(&vaults).await?;
        let mut copies = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let managed = file_name
                .strip_prefix(&legacy_prefix)
                .is_some_and(|suffix| !suffix.is_empty())
                || file_name
                    .strip_prefix(&staging_prefix)
                    .is_some_and(|suffix| !suffix.is_empty());
            if !managed {
                continue;
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(VaultError::InvalidManagedPath);
            }
            copies.push(path);
        }
        copies.sort_unstable();
        for copy in copies {
            remove_regular_directory_if_present(&copy).await?;
        }
        Ok(())
    }

    pub(crate) async fn pending_workspace_deletions(
        &self,
    ) -> Result<Vec<WorkspaceDeletion>, VaultError> {
        let directory = self.workspace_deletion_manifest_directory();
        let mut entries = match fs::read_dir(directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut deletions = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if !entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(".workspace-deletion.json"))
            {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(VaultError::InvalidManagedPath);
            }
            let bytes = fs::read(entry.path()).await?;
            let mut manifest: WorkspaceDeletionManifest = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if manifest.operation != WORKSPACE_DELETION_OPERATION {
                return Err(VaultError::InvalidManagedPath);
            }
            manifest.export_staging_keys.sort_unstable();
            manifest.export_staging_keys.dedup();
            deletions.push(WorkspaceDeletion {
                workspace_id: manifest.workspace_id,
                trash_id: manifest.trash_id,
                vault_present: manifest.vault_present,
                export_staging_keys: manifest.export_staging_keys,
                manifest: entry.path(),
            });
        }
        deletions.sort_by_key(WorkspaceDeletion::workspace_id);
        Ok(deletions)
    }

    async fn ensure_workspace_deletion_directories(&self) -> Result<(), VaultError> {
        let vaults = self.data_dir.join("vaults");
        let trash = vaults.join(".trash");
        ensure_regular_directory(&vaults).await?;
        ensure_regular_directory(&trash).await?;
        ensure_regular_directory(&trash.join("workspaces")).await?;
        ensure_regular_directory(&trash.join("workspace-deletions")).await?;
        sync_directory(self.data_dir.as_path()).await?;
        sync_directory(&vaults).await?;
        sync_directory(&trash).await?;
        sync_directory(&trash.join("workspaces")).await?;
        sync_directory(&trash.join("workspace-deletions")).await
    }

    fn workspace_deletion_trash(&self, workspace_id: Uuid, trash_id: Uuid) -> PathBuf {
        self.data_dir
            .join("vaults")
            .join(".trash")
            .join("workspaces")
            .join(format!("{workspace_id}.{trash_id}"))
    }

    fn workspace_deletion_manifest_directory(&self) -> PathBuf {
        self.data_dir
            .join("vaults")
            .join(".trash")
            .join("workspace-deletions")
    }

    async fn write_workspace_deletion_manifest(
        &self,
        deletion: &WorkspaceDeletionManifest,
    ) -> Result<PathBuf, VaultError> {
        let path = self
            .workspace_deletion_manifest_directory()
            .join(format!("{}.workspace-deletion.json", Uuid::new_v4()));
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
        sync_directory(&self.workspace_deletion_manifest_directory()).await?;
        Ok(path)
    }
}

async fn ensure_regular_directory(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::create_dir(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if regular_directory_exists(path).await? {
                Ok(())
            } else {
                Err(VaultError::InvalidManagedPath)
            }
        }
        Err(error) => Err(error.into()),
    }
}

async fn regular_directory_exists(path: &std::path::Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn ensure_absent(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(_) => Err(VaultError::ExistingDocument),
    }
}

async fn remove_regular_directory_if_present(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(path).await?;
            Ok(())
        }
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn remove_file_if_present(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn sync_directory_if_present(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            sync_directory(path).await
        }
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn sync_directory(path: &std::path::Path) -> Result<(), VaultError> {
    #[cfg(unix)]
    {
        let directory = fs::File::open(path).await?;
        directory.sync_all().await?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, io};

    use tempfile::TempDir;
    use uuid::Uuid;

    use super::super::{Vault, VaultError};
    use super::{WORKSPACE_DELETION_OPERATION, WorkspaceDeletion, WorkspaceDeletionManifest};

    fn workspace_file(data_dir: &TempDir, workspace_id: Uuid) -> std::path::PathBuf {
        data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Todo")
            .join("task.md")
    }

    fn export_artifact(data_dir: &TempDir, staging_key: Uuid) -> std::path::PathBuf {
        data_dir
            .path()
            .join("operations")
            .join(format!("{staging_key}.kanleaf.zip"))
    }

    fn stage_workspace_operations(
        data_dir: &TempDir,
        workspace_id: Uuid,
    ) -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        Vec<std::path::PathBuf>,
        std::path::PathBuf,
    ) {
        let operations = data_dir.path().join("operations");
        fs::create_dir_all(&operations).unwrap();
        let task_manifest = operations.join(format!("{}.task.json", Uuid::new_v4()));
        fs::write(
            &task_manifest,
            serde_json::to_vec(&serde_json::json!({
                "operation": "task_move",
                "workspace_id": workspace_id,
                "task_id": Uuid::new_v4(),
                "source": "Todo/source--a1b2c3.md",
                "destination": "Todo/destination--d4e5f6.md"
            }))
            .unwrap(),
        )
        .unwrap();

        let task_trash_directory = data_dir.path().join("trash/tasks");
        fs::create_dir_all(&task_trash_directory).unwrap();
        let task_trash = task_trash_directory.join(format!(
            "{workspace_id}.{}.{}",
            Uuid::new_v4(),
            Uuid::new_v4()
        ));
        fs::write(&task_trash, "pending Task delete").unwrap();
        let other_workspace_task_trash = task_trash_directory.join(format!(
            "{}.{}.{}",
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4()
        ));
        fs::write(&other_workspace_task_trash, "keep unrelated trash").unwrap();

        let trash_id = Uuid::new_v4();
        let library_manifest = operations.join(format!("{}.json", Uuid::new_v4()));
        fs::write(
            &library_manifest,
            serde_json::to_vec(&serde_json::json!({
                "operation": "delete",
                "workspace_id": workspace_id,
                "document_id": Uuid::new_v4(),
                "path": ["note"],
                "trash_id": trash_id
            }))
            .unwrap(),
        )
        .unwrap();
        let library_move_manifest = operations.join(format!("{}.json", Uuid::new_v4()));
        fs::write(
            &library_move_manifest,
            serde_json::to_vec(&serde_json::json!({
                "operation": "move",
                "workspace_id": workspace_id,
                "document_id": Uuid::new_v4(),
                "source": ["source"],
                "destination": ["destination"]
            }))
            .unwrap(),
        )
        .unwrap();
        let library_trash = data_dir
            .path()
            .join("trash/library")
            .join(format!("{workspace_id}.{trash_id}"));
        fs::create_dir_all(&library_trash).unwrap();
        fs::write(library_trash.join("document.md"), "pending delete").unwrap();

        (
            task_manifest,
            task_trash,
            other_workspace_task_trash,
            vec![library_manifest, library_move_manifest],
            library_trash,
        )
    }

    #[tokio::test]
    async fn rollback_restores_a_live_workspace_without_removing_exports() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let staging_key = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        let export = export_artifact(&data_dir, staging_key);
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "recover me").unwrap();
        fs::create_dir_all(export.parent().unwrap()).unwrap();
        fs::write(&export, "archive").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, vec![staging_key])
            .await
            .unwrap();
        assert!(!markdown.exists());
        assert_eq!(vault.pending_workspace_deletions().await.unwrap().len(), 1);

        vault.rollback_workspace_deletion(&deletion).await.unwrap();

        assert_eq!(fs::read_to_string(markdown).unwrap(), "recover me");
        assert!(export.exists());
        assert!(
            vault
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_post_rename_sync_failure_restores_the_live_workspace() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let trash_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "keep after sync failure").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        vault.ensure_workspace_deletion_directories().await.unwrap();
        let manifest = vault
            .write_workspace_deletion_manifest(&WorkspaceDeletionManifest {
                operation: WORKSPACE_DELETION_OPERATION.to_owned(),
                workspace_id,
                trash_id,
                vault_present: true,
                export_staging_keys: Vec::new(),
            })
            .await
            .unwrap();
        let deletion = WorkspaceDeletion {
            workspace_id,
            trash_id,
            vault_present: true,
            export_staging_keys: Vec::new(),
            manifest,
        };

        let result = vault
            .stage_workspace_vault(&deletion, async {
                Err(VaultError::Io(io::Error::other("injected sync failure")))
            })
            .await;

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(markdown).unwrap(),
            "keep after sync failure"
        );
        assert!(
            vault
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn finish_purges_the_workspace_and_its_export_artifacts() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let staging_key = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        let export = export_artifact(&data_dir, staging_key);
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "delete me").unwrap();
        fs::create_dir_all(export.parent().unwrap()).unwrap();
        fs::write(&export, "archive").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, vec![staging_key, staging_key])
            .await
            .unwrap();
        let pending = vault.pending_workspace_deletions().await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].workspace_id(), workspace_id);

        vault.finish_workspace_deletion(&deletion).await.unwrap();

        assert!(!markdown.exists());
        assert!(!export.exists());
        assert!(
            vault
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn finish_purges_workspace_layout_copies_without_touching_unrelated_vaults() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let other_workspace_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        let vaults = data_dir.path().join("vaults");
        let legacy = vaults.join(format!("{workspace_id}.legacy-20260831T153000Z-a1b2c3"));
        let second_legacy = vaults.join(format!("{workspace_id}.legacy-20260831T154500Z-d4e5f6"));
        let staging = vaults.join(format!(
            ".{workspace_id}.v2-staging.0123456789abcdef0123456789abcdef"
        ));
        let second_staging = vaults.join(format!(
            ".{workspace_id}.v2-staging.fedcba9876543210fedcba9876543210"
        ));
        let other_workspace_legacy = vaults.join(format!(
            "{other_workspace_id}.legacy-20260831T153000Z-a1b2c3"
        ));
        let unrelated = vaults.join(format!("{workspace_id}.legacy"));

        for directory in [
            legacy.as_path(),
            second_legacy.as_path(),
            staging.as_path(),
            second_staging.as_path(),
            other_workspace_legacy.as_path(),
            unrelated.as_path(),
        ] {
            fs::create_dir_all(directory.join("Todo")).unwrap();
            fs::write(directory.join("Todo/task.md"), "Markdown copy").unwrap();
        }
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "live Markdown").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        vault.finish_workspace_deletion(&deletion).await.unwrap();

        assert!(!legacy.exists());
        assert!(!second_legacy.exists());
        assert!(!staging.exists());
        assert!(!second_staging.exists());
        assert!(other_workspace_legacy.exists());
        assert!(unrelated.exists());
        assert!(
            vault
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn finish_rejects_a_layout_copy_symlink_without_retiring_the_manifest() {
        use std::os::unix::fs::symlink;

        let data_dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        let legacy = data_dir
            .path()
            .join("vaults")
            .join(format!("{workspace_id}.legacy-20260831T153000Z-a1b2c3"));
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "live Markdown").unwrap();
        fs::write(outside.path().join("keep.md"), "outside Markdown").unwrap();
        symlink(outside.path(), &legacy).unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        let result = vault.finish_workspace_deletion(&deletion).await;

        assert!(matches!(result, Err(VaultError::InvalidManagedPath)));
        assert!(
            fs::symlink_metadata(&legacy)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("keep.md")).unwrap(),
            "outside Markdown"
        );
        assert_eq!(vault.pending_workspace_deletions().await.unwrap().len(), 1);

        fs::remove_file(&legacy).unwrap();
        let restarted = Vault::new(data_dir.path().to_owned());
        let pending = restarted.pending_workspace_deletions().await.unwrap();
        restarted
            .finish_workspace_deletion(&pending[0])
            .await
            .unwrap();

        assert!(
            restarted
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn finish_rejects_a_non_directory_layout_copy_without_retiring_the_manifest() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        let staging = data_dir.path().join("vaults").join(format!(
            ".{workspace_id}.v2-staging.0123456789abcdef0123456789abcdef"
        ));
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "live Markdown").unwrap();
        fs::write(&staging, "not a managed directory").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        let result = vault.finish_workspace_deletion(&deletion).await;

        assert!(matches!(result, Err(VaultError::InvalidManagedPath)));
        assert_eq!(
            fs::read_to_string(&staging).unwrap(),
            "not a managed directory"
        );
        assert_eq!(vault.pending_workspace_deletions().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn finish_discards_structural_operations_owned_by_the_deleted_workspace() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "delete with pending moves").unwrap();
        let (
            task_manifest,
            task_trash,
            other_workspace_task_trash,
            library_manifests,
            library_trash,
        ) = stage_workspace_operations(&data_dir, workspace_id);
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        vault.finish_workspace_deletion(&deletion).await.unwrap();

        assert!(!task_manifest.exists());
        assert!(!task_trash.exists());
        assert!(other_workspace_task_trash.exists());
        assert!(library_manifests.iter().all(|manifest| !manifest.exists()));
        assert!(!library_trash.exists());
        assert!(vault.pending_task_moves().await.unwrap().is_empty());
        assert!(vault.pending_library_operations().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn pending_manifest_can_finish_after_a_process_restart() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let markdown = workspace_file(&data_dir, workspace_id);
        fs::create_dir_all(markdown.parent().unwrap()).unwrap();
        fs::write(&markdown, "delete after restart").unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();

        let restarted = Vault::new(data_dir.path().to_owned());
        let pending = restarted.pending_workspace_deletions().await.unwrap();
        assert_eq!(pending.len(), 1);
        restarted
            .finish_workspace_deletion(&pending[0])
            .await
            .unwrap();

        assert!(!markdown.exists());
        assert!(
            restarted
                .pending_workspace_deletions()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_workspace_without_a_vault_is_still_recoverable() {
        let data_dir = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        let vault = Vault::new(data_dir.path().to_owned());

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        vault.rollback_workspace_deletion(&deletion).await.unwrap();

        let deletion = vault
            .begin_workspace_deletion(workspace_id, Vec::new())
            .await
            .unwrap();
        vault.finish_workspace_deletion(&deletion).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_a_symlink_instead_of_following_it() {
        use std::os::unix::fs::symlink;

        let data_dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let workspace_id = Uuid::new_v4();
        fs::write(outside.path().join("keep.md"), "safe").unwrap();
        let workspace = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string());
        fs::create_dir_all(workspace.parent().unwrap()).unwrap();
        symlink(outside.path(), workspace).unwrap();
        let vault = Vault::new(data_dir.path().to_owned());

        assert!(
            vault
                .begin_workspace_deletion(workspace_id, Vec::new())
                .await
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("keep.md")).unwrap(),
            "safe"
        );
    }
}
