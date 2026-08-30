use std::{collections::HashSet, io, path::PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use super::{LibraryPath, TaskPath, Vault, VaultError};

pub struct TaskMigrationFile {
    pub destination: TaskPath,
    pub content: String,
}

pub struct WikiMigrationFile {
    pub source: LibraryPath,
    pub destination: LibraryPath,
}

pub struct StagedWorkspaceLayout {
    workspace_id: Uuid,
    canonical: PathBuf,
    staging: PathBuf,
}

pub struct WorkspaceLayoutMigration {
    canonical: PathBuf,
    staging: PathBuf,
    legacy: Option<PathBuf>,
    manifest: PathBuf,
}

pub struct PendingWorkspaceLayoutMigration {
    pub workspace_id: Uuid,
    canonical: PathBuf,
    staging: PathBuf,
    legacy: Option<PathBuf>,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct WorkspaceMigrationManifest {
    workspace_id: Uuid,
    canonical: String,
    staging: String,
    legacy: Option<String>,
}

impl Vault {
    pub async fn read_legacy_task_body(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
    ) -> Result<String, VaultError> {
        let path = self
            .workspace_directory(workspace_id)
            .join("Tasks")
            .join(format!("{task_id}.md"));
        ensure_regular_file(&path).await?;
        Ok(fs::read_to_string(path).await?)
    }

    pub async fn stage_workspace_layout_v2(
        &self,
        workspace_id: Uuid,
        tasks: &[TaskMigrationFile],
        wiki: &[WikiMigrationFile],
    ) -> Result<StagedWorkspaceLayout, VaultError> {
        let canonical = self.workspace_directory(workspace_id);
        ensure_optional_regular_directory(&canonical).await?;
        let staging = self.data_dir.join("vaults").join(format!(
            ".{workspace_id}.v2-staging.{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&staging).await?;

        let result = async {
            let mut destinations = HashSet::with_capacity(tasks.len() + wiki.len());
            for task in tasks {
                let relative = task.destination.relative_file();
                if !destinations.insert(relative.clone()) {
                    return Err(VaultError::ExistingDocument);
                }
                create_staged_file(&staging, &relative, task.content.as_bytes()).await?;
            }
            for document in wiki {
                let relative = document.destination.relative_file();
                if !destinations.insert(relative.clone()) {
                    return Err(VaultError::ExistingDocument);
                }
                let source = legacy_wiki_source(&canonical, &document.source).await?;
                let content = fs::read(&source).await?;
                create_staged_file(&staging, &relative, &content).await?;
            }
            verify_staged_files(&staging, &destinations).await
        }
        .await;
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&staging).await;
            return Err(error);
        }
        Ok(StagedWorkspaceLayout {
            workspace_id,
            canonical,
            staging,
        })
    }

    pub async fn activate_workspace_layout_v2(
        &self,
        staged: StagedWorkspaceLayout,
    ) -> Result<WorkspaceLayoutMigration, VaultError> {
        let legacy = match fs::symlink_metadata(&staged.canonical).await {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
                let path = self.data_dir.join("vaults").join(format!(
                    "{}.legacy-{timestamp}-{}",
                    staged.workspace_id,
                    &Uuid::new_v4().simple().to_string()[..6]
                ));
                Some(path)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Ok(_) => return Err(VaultError::InvalidManagedPath),
            Err(error) => return Err(error.into()),
        };
        let manifest = self
            .write_workspace_migration_manifest(
                staged.workspace_id,
                &staged.canonical,
                &staged.staging,
                legacy.as_deref(),
            )
            .await?;
        if let Some(legacy) = &legacy
            && let Err(error) = fs::rename(&staged.canonical, legacy).await
        {
            let _ = fs::remove_file(&manifest).await;
            return Err(error.into());
        }
        if let Err(error) = fs::rename(&staged.staging, &staged.canonical).await {
            if let Some(legacy) = &legacy {
                let _ = fs::rename(legacy, &staged.canonical).await;
            }
            let _ = fs::remove_file(&manifest).await;
            return Err(error.into());
        }
        Ok(WorkspaceLayoutMigration {
            canonical: staged.canonical,
            staging: staged.staging,
            legacy,
            manifest,
        })
    }

    pub async fn rollback_workspace_layout_v2(
        &self,
        migration: &WorkspaceLayoutMigration,
    ) -> Result<(), VaultError> {
        fs::rename(&migration.canonical, &migration.staging).await?;
        if let Some(legacy) = &migration.legacy {
            fs::rename(legacy, &migration.canonical).await?;
        }
        fs::remove_dir_all(&migration.staging).await?;
        remove_file_if_present(&migration.manifest).await?;
        Ok(())
    }

    pub async fn finish_workspace_layout_v2(
        &self,
        migration: &WorkspaceLayoutMigration,
    ) -> Result<(), VaultError> {
        remove_file_if_present(&migration.manifest).await
    }

    pub async fn pending_workspace_layout_migrations(
        &self,
    ) -> Result<Vec<PendingWorkspaceLayoutMigration>, VaultError> {
        let directory = self.data_dir.join("operations");
        let mut entries = match fs::read_dir(directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut operations = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if !entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(".workspace.json"))
            {
                continue;
            }
            let bytes = fs::read(entry.path()).await?;
            let manifest: WorkspaceMigrationManifest = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            validate_migration_names(&manifest)?;
            let vaults = self.data_dir.join("vaults");
            operations.push(PendingWorkspaceLayoutMigration {
                workspace_id: manifest.workspace_id,
                canonical: vaults.join(manifest.canonical),
                staging: vaults.join(manifest.staging),
                legacy: manifest.legacy.map(|name| vaults.join(name)),
                manifest: entry.path(),
            });
        }
        Ok(operations)
    }

    pub async fn recover_workspace_layout_migration(
        &self,
        operation: &PendingWorkspaceLayoutMigration,
        committed: bool,
    ) -> Result<(), VaultError> {
        if committed {
            ensure_regular_directory(&operation.canonical).await?;
            remove_directory_if_present(&operation.staging).await?;
            return remove_file_if_present(&operation.manifest).await;
        }

        if let Some(legacy) = &operation.legacy {
            if !regular_directory_exists(legacy).await? {
                ensure_regular_directory(&operation.canonical).await?;
                remove_directory_if_present(&operation.staging).await?;
                return remove_file_if_present(&operation.manifest).await;
            }
            if regular_directory_exists(&operation.canonical).await? {
                remove_directory_if_present(&operation.staging).await?;
                fs::rename(&operation.canonical, &operation.staging).await?;
            }
            fs::rename(legacy, &operation.canonical).await?;
            remove_directory_if_present(&operation.staging).await?;
        } else {
            remove_directory_if_present(&operation.canonical).await?;
            remove_directory_if_present(&operation.staging).await?;
        }
        remove_file_if_present(&operation.manifest).await
    }

    async fn write_workspace_migration_manifest(
        &self,
        workspace_id: Uuid,
        canonical: &std::path::Path,
        staging: &std::path::Path,
        legacy: Option<&std::path::Path>,
    ) -> Result<PathBuf, VaultError> {
        let manifest = WorkspaceMigrationManifest {
            workspace_id,
            canonical: file_name(canonical)?,
            staging: file_name(staging)?,
            legacy: legacy.map(file_name).transpose()?,
        };
        validate_migration_names(&manifest)?;
        let directory = self.data_dir.join("operations");
        fs::create_dir_all(&directory).await?;
        let path = directory.join(format!("{}.workspace.json", Uuid::new_v4()));
        let bytes = serde_json::to_vec(&manifest)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await?;
        file.write_all(&bytes).await?;
        file.flush().await?;
        file.sync_all().await?;
        Ok(path)
    }
}

fn file_name(path: &std::path::Path) -> Result<String, VaultError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or(VaultError::InvalidManagedPath)
}

fn validate_migration_names(manifest: &WorkspaceMigrationManifest) -> Result<(), VaultError> {
    let id = manifest.workspace_id.to_string();
    let valid = manifest.canonical == id
        && manifest.staging.starts_with(&format!(".{id}.v2-staging."))
        && single_component(&manifest.staging)
        && manifest.legacy.as_ref().is_none_or(|legacy| {
            legacy.starts_with(&format!("{id}.legacy-")) && single_component(legacy)
        });
    if valid {
        Ok(())
    } else {
        Err(VaultError::InvalidManagedPath)
    }
}

fn single_component(value: &str) -> bool {
    let mut components = std::path::Path::new(value).components();
    components.next().is_some() && components.next().is_none()
}

async fn legacy_wiki_source(
    canonical: &std::path::Path,
    source: &LibraryPath,
) -> Result<PathBuf, VaultError> {
    for root in ["Library", "Wiki"] {
        let candidate = canonical.join(source.legacy_relative_file(root));
        match fs::symlink_metadata(&candidate).await {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                return Ok(candidate);
            }
            Ok(_) => return Err(VaultError::InvalidManagedPath),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "legacy Wiki document is missing").into())
}

async fn create_staged_file(
    staging: &std::path::Path,
    relative: &std::path::Path,
    content: &[u8],
) -> Result<(), VaultError> {
    let destination = staging.join(relative);
    let parent = destination.parent().ok_or(VaultError::InvalidManagedPath)?;
    fs::create_dir_all(parent).await?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await?;
    file.write_all(content).await?;
    file.flush().await?;
    file.sync_all().await?;
    Ok(())
}

async fn verify_staged_files(
    staging: &std::path::Path,
    destinations: &HashSet<PathBuf>,
) -> Result<(), VaultError> {
    for relative in destinations {
        ensure_regular_file(&staging.join(relative)).await?;
    }
    Ok(())
}

async fn ensure_regular_file(path: &std::path::Path) -> Result<(), VaultError> {
    let metadata = fs::symlink_metadata(path).await?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(VaultError::InvalidManagedPath);
    }
    Ok(())
}

async fn ensure_optional_regular_directory(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn ensure_regular_directory(path: &std::path::Path) -> Result<(), VaultError> {
    if regular_directory_exists(path).await? {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::NotFound, "managed directory is missing").into())
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

async fn remove_directory_if_present(path: &std::path::Path) -> Result<(), VaultError> {
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
