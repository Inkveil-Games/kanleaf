use std::{collections::HashSet, io, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use crate::domain::VaultStorageName;

use super::workspace_deletion::{
    ensure_absent, ensure_regular_directory, regular_directory_exists, remove_file_if_present,
    remove_regular_directory_if_present, sync_directory, sync_directory_if_present,
};
use super::{ProjectPath, TaskPath, Vault, VaultError};

const PROJECT_DELETION_OPERATION: &str = "project_delete";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProjectTaskDeletion {
    task_id: Uuid,
    task_number: i64,
    vault_present: bool,
}

#[derive(Debug)]
pub(crate) struct ProjectDeletion {
    workspace_id: Uuid,
    project_id: Uuid,
    project_identifier: Option<String>,
    legacy_storage_name: Option<String>,
    trash_id: Uuid,
    project_present: bool,
    tasks: Vec<ProjectTaskDeletion>,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct ProjectDeletionManifest {
    operation: String,
    workspace_id: Uuid,
    project_id: Uuid,
    #[serde(default)]
    project_identifier: Option<String>,
    #[serde(default)]
    storage_name: Option<String>,
    trash_id: Uuid,
    #[serde(default, alias = "vault_present")]
    project_present: bool,
    #[serde(default)]
    tasks: Vec<ProjectTaskDeletion>,
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
        project_identifier: &str,
        tasks: &[(Uuid, i64)],
    ) -> Result<ProjectDeletion, VaultError> {
        let project_path = ProjectPath::parse(project_identifier)?;
        let original_project = self
            .workspace_directory(workspace_id)
            .join(project_path.relative_directory());
        let project_present = regular_directory_exists(&original_project).await?;
        let mut seen_numbers = HashSet::new();
        let mut task_deletions = Vec::with_capacity(tasks.len());
        for &(task_id, task_number) in tasks {
            if !seen_numbers.insert(task_number) {
                return Err(VaultError::InvalidManagedPath);
            }
            let path = TaskPath::parse(task_number)?;
            let vault_present = regular_file_exists(&self.task_file(workspace_id, &path)).await?;
            task_deletions.push(ProjectTaskDeletion {
                task_id,
                task_number,
                vault_present,
            });
        }

        let trash_id = Uuid::new_v4();
        let trash = self.project_deletion_trash(workspace_id, project_id, trash_id, true);
        ensure_absent(&trash).await?;
        self.ensure_project_deletion_directories(workspace_id)
            .await?;
        let manifest = self
            .write_project_deletion_manifest(&ProjectDeletionManifest {
                operation: PROJECT_DELETION_OPERATION.to_owned(),
                workspace_id,
                project_id,
                project_identifier: Some(project_identifier.to_owned()),
                storage_name: None,
                trash_id,
                project_present,
                tasks: task_deletions.clone(),
            })
            .await?;
        let deletion = ProjectDeletion {
            workspace_id,
            project_id,
            project_identifier: Some(project_identifier.to_owned()),
            legacy_storage_name: None,
            trash_id,
            project_present,
            tasks: task_deletions,
            manifest,
        };

        if let Err(error) = self.stage_project_deletion(&deletion).await {
            return match self.rollback_project_deletion(&deletion).await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(io::Error::other(format!(
                    "failed to stage Project deletion ({error}); rollback failed ({rollback_error})"
                ))
                .into()),
            };
        }
        Ok(deletion)
    }

    async fn stage_project_deletion(&self, deletion: &ProjectDeletion) -> Result<(), VaultError> {
        let trash = self.project_trash_root(deletion);
        ensure_regular_directory(&trash).await?;
        ensure_regular_directory(&trash.join("tasks")).await?;
        if deletion.project_present {
            fs::rename(
                self.project_live_directory(deletion)?,
                trash.join("project"),
            )
            .await?;
        }
        for task in deletion.tasks.iter().filter(|task| task.vault_present) {
            let source = self.task_file(deletion.workspace_id, &TaskPath::parse(task.task_number)?);
            fs::rename(
                source,
                trash.join("tasks").join(format!("{}.md", task.task_number)),
            )
            .await?;
        }
        self.sync_project_deletion_parents(deletion).await
    }

    pub(crate) async fn rollback_project_deletion(
        &self,
        deletion: &ProjectDeletion,
    ) -> Result<(), VaultError> {
        let trash = self.project_trash_root(deletion);
        if deletion.project_present {
            let trashed_project = if deletion.project_identifier.is_some() {
                trash.join("project")
            } else {
                trash.clone()
            };
            restore_directory(&self.project_live_directory(deletion)?, &trashed_project).await?;
        }
        for task in deletion.tasks.iter().filter(|task| task.vault_present) {
            let original =
                self.task_file(deletion.workspace_id, &TaskPath::parse(task.task_number)?);
            restore_file(
                &original,
                &trash.join("tasks").join(format!("{}.md", task.task_number)),
            )
            .await?;
        }
        remove_regular_directory_if_present(&trash).await?;
        self.sync_project_deletion_parents(deletion).await?;
        remove_file_if_present(&deletion.manifest).await?;
        sync_directory(&self.project_deletion_manifest_directory()).await
    }

    pub(crate) async fn finish_project_deletion(
        &self,
        deletion: &ProjectDeletion,
    ) -> Result<(), VaultError> {
        // Identifiers may be reused as soon as SQL commits. Only this
        // operation's staged payload is still owned by the deleted Project.
        remove_regular_directory_if_present(&self.project_trash_root(deletion)).await?;
        self.sync_project_deletion_parents(deletion).await?;
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
            let valid_project = manifest
                .project_identifier
                .as_deref()
                .is_some_and(|value| ProjectPath::parse(value).is_ok());
            let valid_legacy = manifest
                .storage_name
                .as_deref()
                .is_some_and(|value| VaultStorageName::parse(value).is_ok());
            if manifest.operation != PROJECT_DELETION_OPERATION
                || valid_project == valid_legacy
                || manifest
                    .tasks
                    .iter()
                    .any(|task| TaskPath::parse(task.task_number).is_err())
            {
                return Err(VaultError::InvalidManagedPath);
            }
            deletions.push(ProjectDeletion {
                workspace_id: manifest.workspace_id,
                project_id: manifest.project_id,
                project_identifier: manifest.project_identifier,
                legacy_storage_name: manifest.storage_name,
                trash_id: manifest.trash_id,
                project_present: manifest.project_present,
                tasks: manifest.tasks,
                manifest: entry.path(),
            });
        }
        deletions.sort_by_key(ProjectDeletion::project_id);
        Ok(deletions)
    }

    fn project_live_directory(&self, deletion: &ProjectDeletion) -> Result<PathBuf, VaultError> {
        if let Some(identifier) = deletion.project_identifier.as_deref() {
            return Ok(self
                .workspace_directory(deletion.workspace_id)
                .join(ProjectPath::parse(identifier)?.relative_directory()));
        }
        let storage_name = deletion
            .legacy_storage_name
            .as_deref()
            .ok_or(VaultError::InvalidManagedPath)?;
        VaultStorageName::parse(storage_name).map_err(|_| VaultError::InvalidManagedPath)?;
        Ok(self
            .legacy_workspace_directory(deletion.workspace_id)
            .join("Projects")
            .join(storage_name))
    }

    fn project_trash_root(&self, deletion: &ProjectDeletion) -> PathBuf {
        self.project_deletion_trash(
            deletion.workspace_id,
            deletion.project_id,
            deletion.trash_id,
            deletion.project_identifier.is_some(),
        )
    }

    async fn ensure_project_deletion_directories(
        &self,
        workspace_id: Uuid,
    ) -> Result<(), VaultError> {
        let vaults = self.data_dir.join("vaults");
        let global_trash = vaults.join(".trash");
        let workspace_trash = self.workspace_directory(workspace_id).join(".trash");
        ensure_regular_directory(&vaults).await?;
        ensure_regular_directory(&global_trash).await?;
        ensure_regular_directory(&global_trash.join("project-deletions")).await?;
        ensure_regular_directory(&workspace_trash).await?;
        ensure_regular_directory(&workspace_trash.join("projects")).await?;
        sync_directory(&workspace_trash).await?;
        sync_directory(&global_trash.join("project-deletions")).await
    }

    fn project_deletion_trash(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        trash_id: Uuid,
        workspace_local: bool,
    ) -> PathBuf {
        if workspace_local {
            self.workspace_directory(workspace_id)
                .join(".trash/projects")
                .join(format!("{project_id}.{trash_id}"))
        } else {
            self.data_dir
                .join("vaults/.trash/projects")
                .join(format!("{workspace_id}.{project_id}.{trash_id}"))
        }
    }

    fn project_deletion_manifest_directory(&self) -> PathBuf {
        self.data_dir.join("vaults/.trash/project-deletions")
    }

    async fn sync_project_deletion_parents(
        &self,
        deletion: &ProjectDeletion,
    ) -> Result<(), VaultError> {
        if deletion.project_identifier.is_some() {
            sync_directory_if_present(
                &self
                    .workspace_directory(deletion.workspace_id)
                    .join("projects"),
            )
            .await?;
            sync_directory_if_present(
                &self
                    .workspace_directory(deletion.workspace_id)
                    .join("tasks"),
            )
            .await?;
            sync_directory_if_present(
                &self
                    .workspace_directory(deletion.workspace_id)
                    .join(".trash/projects"),
            )
            .await
        } else {
            sync_directory_if_present(
                &self
                    .legacy_workspace_directory(deletion.workspace_id)
                    .join("Projects"),
            )
            .await?;
            sync_directory_if_present(&self.data_dir.join("vaults/.trash/projects")).await
        }
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

async fn regular_file_exists(path: &std::path::Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn restore_file(
    original: &std::path::Path,
    trashed: &std::path::Path,
) -> Result<(), VaultError> {
    match (
        regular_file_exists(original).await?,
        regular_file_exists(trashed).await?,
    ) {
        (true, false) => Ok(()),
        (false, true) => {
            if let Some(parent) = original.parent() {
                ensure_regular_directory(parent).await?;
            }
            fs::rename(trashed, original).await?;
            Ok(())
        }
        (true, true) => Err(VaultError::ExistingDocument),
        (false, false) => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Project deletion lost both a live and trashed Task document",
        )
        .into()),
    }
}

async fn restore_directory(
    original: &std::path::Path,
    trashed: &std::path::Path,
) -> Result<(), VaultError> {
    match (
        regular_directory_exists(original).await?,
        regular_directory_exists(trashed).await?,
    ) {
        (true, false) => Ok(()),
        (false, true) => {
            if let Some(parent) = original.parent() {
                ensure_regular_directory(parent).await?;
            }
            fs::rename(trashed, original).await?;
            Ok(())
        }
        (true, true) => Err(VaultError::ExistingDocument),
        (false, false) => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Project deletion lost both the live and trashed Project directory",
        )
        .into()),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;
    use uuid::Uuid;

    use super::super::{Vault, WorkspacePath};

    #[tokio::test]
    async fn committed_project_cleanup_preserves_reused_identifier_and_live_tasks() {
        let data_dir = TempDir::new().unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        let workspace_id = Uuid::new_v4();
        vault.register_workspace_path(&WorkspacePath::parse(workspace_id, "kanleaf").unwrap());
        let project = data_dir.path().join("vaults/kanleaf/projects/astro-clash");
        let task = data_dir.path().join("vaults/kanleaf/tasks/42.md");
        fs::create_dir_all(project.join("library")).unwrap();
        fs::create_dir_all(task.parent().unwrap()).unwrap();
        fs::write(project.join("library/design.md"), "old Project").unwrap();
        fs::write(&task, "old Task").unwrap();
        let deletion = vault
            .begin_project_deletion(
                workspace_id,
                Uuid::new_v4(),
                "astro-clash",
                &[(Uuid::new_v4(), 42)],
            )
            .await
            .unwrap();
        fs::create_dir_all(project.join("library")).unwrap();
        fs::write(
            project.join("library/replacement.md"),
            "replacement Project",
        )
        .unwrap();
        fs::write(&task, "live Task must not be purged").unwrap();
        vault.finish_project_deletion(&deletion).await.unwrap();
        assert_eq!(
            fs::read_to_string(project.join("library/replacement.md")).unwrap(),
            "replacement Project"
        );
        assert_eq!(
            fs::read_to_string(&task).unwrap(),
            "live Task must not be purged"
        );
        assert!(vault.pending_project_deletions().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn legacy_project_deletion_restores_direct_trash_payload() {
        let data_dir = TempDir::new().unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        let workspace_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let trash_id = Uuid::new_v4();
        let storage = "astro-clash--abcdef";
        fs::create_dir_all(
            data_dir
                .path()
                .join("vaults")
                .join(workspace_id.to_string())
                .join("Projects"),
        )
        .unwrap();
        let trash = data_dir
            .path()
            .join("vaults/.trash/projects")
            .join(format!("{workspace_id}.{project_id}.{trash_id}"));
        fs::create_dir_all(trash.join("Wiki/design")).unwrap();
        fs::write(trash.join("Wiki/design.md"), "legacy parent").unwrap();
        fs::write(trash.join("Wiki/design/child.md"), "legacy child").unwrap();
        let manifest_directory = data_dir.path().join("vaults/.trash/project-deletions");
        fs::create_dir_all(&manifest_directory).unwrap();
        fs::write(manifest_directory.join("legacy.project-deletion.json"), serde_json::to_vec(&serde_json::json!({
            "operation": "project_delete", "workspace_id": workspace_id, "project_id": project_id,
            "storage_name": storage, "trash_id": trash_id, "vault_present": true
        })).unwrap()).unwrap();
        let deletion = vault.pending_project_deletions().await.unwrap().remove(0);
        vault.rollback_project_deletion(&deletion).await.unwrap();
        let live = data_dir
            .path()
            .join("vaults")
            .join(workspace_id.to_string())
            .join("Projects")
            .join(storage);
        assert_eq!(
            fs::read_to_string(live.join("Wiki/design.md")).unwrap(),
            "legacy parent"
        );
        assert_eq!(
            fs::read_to_string(live.join("Wiki/design/child.md")).unwrap(),
            "legacy child"
        );
        assert!(!trash.exists());
        assert!(vault.pending_project_deletions().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn project_directory_and_flat_tasks_are_recovered_on_either_side_of_commit() {
        let data_dir = TempDir::new().unwrap();
        let vault = Vault::new(data_dir.path().to_owned());
        let workspace_id = Uuid::new_v4();
        let workspace = WorkspacePath::parse(workspace_id, "kanleaf").unwrap();
        vault.register_workspace_path(&workspace);
        let project_id = Uuid::new_v4();
        let project_directory = data_dir.path().join("vaults/kanleaf/projects/astro-clash");
        let task_file = data_dir.path().join("vaults/kanleaf/tasks/42.md");
        fs::create_dir_all(project_directory.join("library")).unwrap();
        fs::create_dir_all(task_file.parent().unwrap()).unwrap();
        fs::create_dir_all(data_dir.path().join("vaults/kanleaf/.trash")).unwrap();
        fs::write(project_directory.join("library/design.md"), "# Design\n").unwrap();
        fs::write(&task_file, "# Keep me\n").unwrap();

        let deletion = vault
            .begin_project_deletion(
                workspace_id,
                project_id,
                "astro-clash",
                &[(Uuid::new_v4(), 42)],
            )
            .await
            .unwrap();
        assert!(!project_directory.exists());
        assert!(!task_file.exists());
        vault.rollback_project_deletion(&deletion).await.unwrap();
        assert!(project_directory.join("library/design.md").exists());
        assert!(task_file.exists());

        let deletion = vault
            .begin_project_deletion(
                workspace_id,
                project_id,
                "astro-clash",
                &[(Uuid::new_v4(), 42)],
            )
            .await
            .unwrap();
        vault.finish_project_deletion(&deletion).await.unwrap();
        assert!(!project_directory.exists());
        assert!(!task_file.exists());
        assert!(vault.pending_project_deletions().await.unwrap().is_empty());
    }
}
