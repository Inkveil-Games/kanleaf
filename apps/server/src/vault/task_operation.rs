use std::{io, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use super::{TaskPath, Vault, VaultError};

pub struct TaskMove {
    source: PathBuf,
    destination: PathBuf,
    manifest: PathBuf,
}

pub struct PendingTaskMove {
    pub workspace_id: Uuid,
    pub task_id: Uuid,
    pub source: TaskPath,
    pub destination: TaskPath,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct TaskMoveManifest {
    operation: String,
    workspace_id: Uuid,
    task_id: Uuid,
    source: String,
    destination: String,
}

impl Vault {
    pub async fn move_task(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
        source: &TaskPath,
        destination: &TaskPath,
    ) -> Result<Option<TaskMove>, VaultError> {
        if source == destination {
            return Ok(None);
        }
        let source_relative = source.relative_file();
        let destination_relative = destination.relative_file();
        let source = self.task_file(workspace_id, source);
        let destination = self.task_file(workspace_id, destination);
        self.ensure_regular_managed_file(workspace_id, &source)
            .await?;
        self.ensure_safe_managed_parent(workspace_id, &destination)
            .await?;
        match fs::symlink_metadata(&destination).await {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Ok(_) => return Err(VaultError::ExistingDocument),
            Err(error) => return Err(error.into()),
        }

        let manifest = self
            .write_task_move_manifest(TaskMoveManifest {
                operation: "task_move".to_owned(),
                workspace_id,
                task_id,
                source: source_relative
                    .to_str()
                    .ok_or(VaultError::InvalidManagedPath)?
                    .to_owned(),
                destination: destination_relative
                    .to_str()
                    .ok_or(VaultError::InvalidManagedPath)?
                    .to_owned(),
            })
            .await?;
        if let Err(error) = fs::rename(&source, &destination).await {
            let _ = fs::remove_file(&manifest).await;
            return Err(error.into());
        }
        Ok(Some(TaskMove {
            source,
            destination,
            manifest,
        }))
    }

    pub async fn rollback_task_move(&self, movement: &TaskMove) -> Result<(), VaultError> {
        if let Some(parent) = movement.source.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(&movement.destination, &movement.source).await?;
        remove_file_if_present(&movement.manifest).await?;
        remove_empty_ancestors(
            movement.destination.parent(),
            &self.workspace_root_for(&movement.destination)?,
        )
        .await
    }

    pub async fn finish_task_move(&self, movement: &TaskMove) -> Result<(), VaultError> {
        remove_file_if_present(&movement.manifest).await?;
        remove_empty_ancestors(
            movement.source.parent(),
            &self.workspace_root_for(&movement.source)?,
        )
        .await
    }

    pub async fn pending_task_moves(&self) -> Result<Vec<PendingTaskMove>, VaultError> {
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
                .is_some_and(|name| name.ends_with(".task.json"))
            {
                continue;
            }
            let bytes = fs::read(entry.path()).await?;
            let manifest: TaskMoveManifest = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if manifest.operation != "task_move" {
                return Err(VaultError::InvalidManagedPath);
            }
            operations.push(PendingTaskMove {
                workspace_id: manifest.workspace_id,
                task_id: manifest.task_id,
                source: parse_relative_task_path(&manifest.source)?,
                destination: parse_relative_task_path(&manifest.destination)?,
                manifest: entry.path(),
            });
        }
        Ok(operations)
    }

    pub(crate) async fn discard_workspace_task_moves(
        &self,
        workspace_id: Uuid,
    ) -> Result<(), VaultError> {
        for operation in self.pending_task_moves().await? {
            if operation.workspace_id == workspace_id {
                remove_file_if_present(&operation.manifest).await?;
            }
        }
        Ok(())
    }

    pub async fn recover_task_move(
        &self,
        operation: &PendingTaskMove,
        keep_destination: bool,
    ) -> Result<(), VaultError> {
        let source = self.task_file(operation.workspace_id, &operation.source);
        let destination = self.task_file(operation.workspace_id, &operation.destination);
        let kept = if keep_destination {
            &destination
        } else {
            &source
        };
        self.ensure_safe_managed_parent(operation.workspace_id, kept)
            .await?;
        reconcile_task_file(&source, &destination, keep_destination).await?;
        remove_file_if_present(&operation.manifest).await?;
        let obsolete = if keep_destination {
            &source
        } else {
            &destination
        };
        remove_empty_ancestors(
            obsolete.parent(),
            &self.workspace_directory(operation.workspace_id),
        )
        .await
    }

    async fn write_task_move_manifest(
        &self,
        operation: TaskMoveManifest,
    ) -> Result<PathBuf, VaultError> {
        let directory = self.data_dir.join("operations");
        fs::create_dir_all(&directory).await?;
        let path = directory.join(format!("{}.task.json", Uuid::new_v4()));
        let bytes = serde_json::to_vec(&operation)
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

    fn workspace_root_for(&self, path: &std::path::Path) -> Result<PathBuf, VaultError> {
        let relative = path
            .strip_prefix(self.data_dir.join("vaults"))
            .map_err(|_| VaultError::InvalidManagedPath)?;
        let workspace = relative
            .components()
            .next()
            .ok_or(VaultError::InvalidManagedPath)?;
        Ok(self.data_dir.join("vaults").join(workspace))
    }
}

fn parse_relative_task_path(value: &str) -> Result<TaskPath, VaultError> {
    let path = std::path::Path::new(value);
    let components = path
        .components()
        .map(|component| component.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()
        .ok_or(VaultError::InvalidManagedPath)?;
    let (project, file) = match components.as_slice() {
        ["Todo", file] => (None, *file),
        ["Projects", project, "Todo", file] => (Some(*project), *file),
        _ => return Err(VaultError::InvalidManagedPath),
    };
    let storage_name = file
        .strip_suffix(".md")
        .ok_or(VaultError::InvalidManagedPath)?;
    TaskPath::parse(project, storage_name)
}

async fn reconcile_task_file(
    source: &std::path::Path,
    destination: &std::path::Path,
    keep_destination: bool,
) -> Result<(), VaultError> {
    let source_exists = regular_file_exists(source).await?;
    let destination_exists = regular_file_exists(destination).await?;
    match (source_exists, destination_exists, keep_destination) {
        (true, false, true) => fs::rename(source, destination).await.map_err(Into::into),
        (false, true, false) => fs::rename(destination, source).await.map_err(Into::into),
        (true, false, false) | (false, true, true) => Ok(()),
        (true, true, _) => Err(VaultError::ExistingDocument),
        (false, false, _) => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Task move lost both copies of a document",
        )
        .into()),
    }
}

async fn regular_file_exists(path: &std::path::Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidManagedPath),
    }
}

async fn remove_file_if_present(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn remove_empty_ancestors(
    start: Option<&std::path::Path>,
    stop: &std::path::Path,
) -> Result<(), VaultError> {
    let mut current = start.map(std::path::Path::to_path_buf);
    while let Some(path) = current {
        if path == stop || !path.starts_with(stop) {
            break;
        }
        match fs::remove_dir(&path).await {
            Ok(()) => current = path.parent().map(std::path::Path::to_path_buf),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::DirectoryNotEmpty | io::ErrorKind::NotFound
                ) =>
            {
                break;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
