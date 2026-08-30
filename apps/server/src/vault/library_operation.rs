use std::{io, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use super::{LibraryPath, Vault, VaultError};

#[derive(Debug)]
pub struct LibraryMove {
    source_file: PathBuf,
    destination_file: PathBuf,
    source_directory: PathBuf,
    destination_directory: PathBuf,
    library_root: PathBuf,
    manifest: PathBuf,
    moved_directory: bool,
}

#[derive(Debug)]
pub struct LibraryTrash {
    workspace_id: Uuid,
    original_file: PathBuf,
    original_directory: PathBuf,
    library_root: PathBuf,
    trash_root: PathBuf,
    manifest: PathBuf,
    moved_directory: bool,
}

#[derive(Debug)]
pub struct LegacyLibraryMove {
    source_file: PathBuf,
    destination_file: PathBuf,
    library_root: PathBuf,
    manifest: PathBuf,
}

#[derive(Clone, Debug)]
pub struct PendingLibraryOperation {
    pub workspace_id: Uuid,
    pub document_id: Uuid,
    pub kind: PendingLibraryOperationKind,
    manifest: PathBuf,
}

#[derive(Clone, Debug)]
pub enum PendingLibraryOperationKind {
    Move {
        source: LibraryPath,
        destination: LibraryPath,
    },
    Delete {
        path: LibraryPath,
        trash_id: Uuid,
    },
    Legacy {
        destination: LibraryPath,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum LibraryOperationManifest {
    Move {
        workspace_id: Uuid,
        document_id: Uuid,
        #[serde(default)]
        source_project: Option<String>,
        source: Vec<String>,
        #[serde(default)]
        destination_project: Option<String>,
        destination: Vec<String>,
    },
    Delete {
        workspace_id: Uuid,
        document_id: Uuid,
        #[serde(default)]
        project: Option<String>,
        path: Vec<String>,
        trash_id: Uuid,
    },
    Legacy {
        workspace_id: Uuid,
        document_id: Uuid,
        destination: Vec<String>,
    },
}

impl Vault {
    pub async fn move_library_tree(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
        source: &LibraryPath,
        destination: &LibraryPath,
    ) -> Result<Option<LibraryMove>, VaultError> {
        if source == destination {
            return Ok(None);
        }

        let source_file = self.library_file(workspace_id, source);
        let destination_file = self.library_file(workspace_id, destination);
        let source_directory = self.library_companion_directory(workspace_id, source);
        let destination_directory = self.library_companion_directory(workspace_id, destination);
        self.ensure_regular_library_file(workspace_id, &source_file)
            .await?;
        self.ensure_safe_library_parent(workspace_id, &destination_file)
            .await?;
        ensure_absent(&destination_file).await?;
        ensure_absent(&destination_directory).await?;
        let moved_directory = ensure_optional_regular_directory(&source_directory).await?;

        let manifest = self
            .write_operation_manifest(&LibraryOperationManifest::Move {
                workspace_id,
                document_id,
                source_project: source.project_storage_name().map(str::to_owned),
                source: source.storage_segments(),
                destination_project: destination.project_storage_name().map(str::to_owned),
                destination: destination.storage_segments(),
            })
            .await?;

        if moved_directory
            && let Err(error) = fs::rename(&source_directory, &destination_directory).await
        {
            remove_file_if_present(&manifest).await?;
            return Err(error.into());
        }
        if let Err(error) = fs::rename(&source_file, &destination_file).await {
            if moved_directory {
                let _ = fs::rename(&destination_directory, &source_directory).await;
            }
            let _ = remove_file_if_present(&manifest).await;
            return Err(error.into());
        }

        Ok(Some(LibraryMove {
            source_file,
            destination_file,
            source_directory,
            destination_directory,
            library_root: self.workspace_directory(workspace_id),
            manifest,
            moved_directory,
        }))
    }

    pub async fn rollback_library_move(&self, movement: &LibraryMove) -> Result<(), VaultError> {
        fs::rename(&movement.destination_file, &movement.source_file).await?;
        if movement.moved_directory {
            fs::rename(&movement.destination_directory, &movement.source_directory).await?;
        }
        remove_file_if_present(&movement.manifest).await?;
        remove_empty_ancestors(movement.destination_file.parent(), &movement.library_root).await?;
        Ok(())
    }

    pub async fn finish_library_move(&self, movement: &LibraryMove) -> Result<(), VaultError> {
        remove_file_if_present(&movement.manifest).await?;
        remove_empty_ancestors(movement.source_file.parent(), &movement.library_root).await?;
        Ok(())
    }

    pub async fn trash_library_tree(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
        path: &LibraryPath,
    ) -> Result<LibraryTrash, VaultError> {
        let original_file = self.library_file(workspace_id, path);
        let original_directory = self.library_companion_directory(workspace_id, path);
        self.ensure_regular_library_file(workspace_id, &original_file)
            .await?;
        let moved_directory = ensure_optional_regular_directory(&original_directory).await?;

        let trash_id = Uuid::new_v4();
        let trash_root = self
            .data_dir
            .join("trash")
            .join("library")
            .join(format!("{workspace_id}.{trash_id}"));
        fs::create_dir_all(&trash_root).await?;
        let manifest = self
            .write_operation_manifest(&LibraryOperationManifest::Delete {
                workspace_id,
                document_id,
                project: path.project_storage_name().map(str::to_owned),
                path: path.storage_segments(),
                trash_id,
            })
            .await?;

        if moved_directory
            && let Err(error) = fs::rename(&original_directory, trash_root.join("children")).await
        {
            let _ = fs::remove_dir(&trash_root).await;
            let _ = remove_file_if_present(&manifest).await;
            return Err(error.into());
        }
        if let Err(error) = fs::rename(&original_file, trash_root.join("document.md")).await {
            if moved_directory {
                let _ = fs::rename(trash_root.join("children"), &original_directory).await;
            }
            let _ = fs::remove_dir(&trash_root).await;
            let _ = remove_file_if_present(&manifest).await;
            return Err(error.into());
        }

        Ok(LibraryTrash {
            workspace_id,
            original_file,
            original_directory,
            library_root: self.workspace_directory(workspace_id),
            trash_root,
            manifest,
            moved_directory,
        })
    }

    pub async fn migrate_legacy_page(
        &self,
        workspace_id: Uuid,
        document_id: Uuid,
        destination: &LibraryPath,
    ) -> Result<LegacyLibraryMove, VaultError> {
        let source_file = self
            .workspace_directory(workspace_id)
            .join("Pages")
            .join(format!("{document_id}.md"));
        let destination_file = self.library_file(workspace_id, destination);
        self.ensure_safe_library_parent(workspace_id, &destination_file)
            .await?;
        let source_exists = regular_file_exists(&source_file).await?;
        let destination_exists = regular_file_exists(&destination_file).await?;
        match (source_exists, destination_exists) {
            (true, true) => return Err(VaultError::ExistingDocument),
            (false, false) => {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "legacy Page has no source or destination Markdown file",
                )
                .into());
            }
            _ => {}
        }

        let manifest = self
            .write_operation_manifest(&LibraryOperationManifest::Legacy {
                workspace_id,
                document_id,
                destination: destination.storage_segments(),
            })
            .await?;
        if source_exists && let Err(error) = fs::rename(&source_file, &destination_file).await {
            let _ = remove_file_if_present(&manifest).await;
            return Err(error.into());
        }

        Ok(LegacyLibraryMove {
            source_file,
            destination_file,
            library_root: self.workspace_directory(workspace_id),
            manifest,
        })
    }

    pub async fn rollback_legacy_library_move(
        &self,
        movement: &LegacyLibraryMove,
    ) -> Result<(), VaultError> {
        reconcile_required_file(&movement.source_file, &movement.destination_file, false).await?;
        remove_file_if_present(&movement.manifest).await?;
        remove_empty_ancestors(movement.destination_file.parent(), &movement.library_root).await?;
        Ok(())
    }

    pub async fn finish_legacy_library_move(
        &self,
        movement: &LegacyLibraryMove,
    ) -> Result<(), VaultError> {
        remove_file_if_present(&movement.manifest).await?;
        if let Some(pages) = movement.source_file.parent() {
            match fs::remove_dir(pages).await {
                Ok(()) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::NotFound | io::ErrorKind::DirectoryNotEmpty
                    ) => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    pub async fn restore_library_trash(&self, trash: &LibraryTrash) -> Result<(), VaultError> {
        self.ensure_safe_library_parent(trash.workspace_id, &trash.original_file)
            .await?;
        fs::rename(trash.trash_root.join("document.md"), &trash.original_file).await?;
        if trash.moved_directory {
            fs::rename(trash.trash_root.join("children"), &trash.original_directory).await?;
        }
        fs::remove_dir(&trash.trash_root).await?;
        remove_file_if_present(&trash.manifest).await?;
        Ok(())
    }

    pub async fn purge_library_trash(&self, trash: &LibraryTrash) -> Result<(), VaultError> {
        remove_directory_if_present(&trash.trash_root).await?;
        remove_file_if_present(&trash.manifest).await?;
        remove_empty_ancestors(trash.original_file.parent(), &trash.library_root).await?;
        Ok(())
    }

    pub async fn pending_library_operations(
        &self,
    ) -> Result<Vec<PendingLibraryOperation>, VaultError> {
        let directory = self.data_dir.join("operations");
        let mut entries = match fs::read_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut operations = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if entry.file_name().to_str().is_some_and(|name| {
                name.ends_with(".task.json") || name.ends_with(".workspace.json")
            }) {
                continue;
            }
            let bytes = fs::read(entry.path()).await?;
            let manifest: LibraryOperationManifest = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            operations.push(PendingLibraryOperation::from_manifest(
                entry.path(),
                manifest,
            )?);
        }
        Ok(operations)
    }

    pub async fn recover_library_move(
        &self,
        operation: &PendingLibraryOperation,
        keep_destination: bool,
    ) -> Result<(), VaultError> {
        let PendingLibraryOperationKind::Move {
            source,
            destination,
        } = &operation.kind
        else {
            return Err(VaultError::InvalidLibraryPath);
        };
        let source_file = self.library_file(operation.workspace_id, source);
        let destination_file = self.library_file(operation.workspace_id, destination);
        let source_directory = self.library_companion_directory(operation.workspace_id, source);
        let destination_directory =
            self.library_companion_directory(operation.workspace_id, destination);

        if keep_destination {
            self.ensure_safe_library_parent(operation.workspace_id, &destination_file)
                .await?;
            reconcile_optional_directory(&source_directory, &destination_directory, true).await?;
            reconcile_required_file(&source_file, &destination_file, true).await?;
        } else {
            self.ensure_safe_library_parent(operation.workspace_id, &source_file)
                .await?;
            reconcile_required_file(&source_file, &destination_file, false).await?;
            reconcile_optional_directory(&source_directory, &destination_directory, false).await?;
        }
        remove_file_if_present(&operation.manifest).await?;
        let library_root = self.workspace_directory(operation.workspace_id);
        let obsolete_parent = if keep_destination {
            source_file.parent()
        } else {
            destination_file.parent()
        };
        remove_empty_ancestors(obsolete_parent, &library_root).await?;
        Ok(())
    }

    pub async fn recover_library_delete(
        &self,
        operation: &PendingLibraryOperation,
        document_exists: bool,
    ) -> Result<(), VaultError> {
        let PendingLibraryOperationKind::Delete { path, trash_id } = &operation.kind else {
            return Err(VaultError::InvalidLibraryPath);
        };
        let original_file = self.library_file(operation.workspace_id, path);
        let original_directory = self.library_companion_directory(operation.workspace_id, path);
        let trash_root = self
            .data_dir
            .join("trash")
            .join("library")
            .join(format!("{}.{}", operation.workspace_id, trash_id));

        if document_exists {
            self.ensure_safe_library_parent(operation.workspace_id, &original_file)
                .await?;
            reconcile_required_file(&original_file, &trash_root.join("document.md"), false).await?;
            reconcile_optional_directory(&original_directory, &trash_root.join("children"), false)
                .await?;
            remove_directory_if_present(&trash_root).await?;
        } else {
            remove_directory_if_present(&trash_root).await?;
            let library_root = self.workspace_directory(operation.workspace_id);
            remove_empty_ancestors(original_file.parent(), &library_root).await?;
        }
        remove_file_if_present(&operation.manifest).await?;
        Ok(())
    }

    pub async fn recover_legacy_library_move(
        &self,
        operation: &PendingLibraryOperation,
    ) -> Result<(), VaultError> {
        let PendingLibraryOperationKind::Legacy { destination } = &operation.kind else {
            return Err(VaultError::InvalidLibraryPath);
        };
        let source_file = self
            .workspace_directory(operation.workspace_id)
            .join("Pages")
            .join(format!("{}.md", operation.document_id));
        let destination_file = self.library_file(operation.workspace_id, destination);
        self.ensure_safe_library_parent(operation.workspace_id, &destination_file)
            .await?;
        reconcile_required_file(&source_file, &destination_file, true).await?;
        remove_file_if_present(&operation.manifest).await?;
        Ok(())
    }

    async fn write_operation_manifest(
        &self,
        operation: &LibraryOperationManifest,
    ) -> Result<PathBuf, VaultError> {
        let directory = self.data_dir.join("operations");
        fs::create_dir_all(&directory).await?;
        let path = directory.join(format!("{}.json", Uuid::new_v4()));
        let bytes = serde_json::to_vec(operation)
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

impl PendingLibraryOperation {
    fn from_manifest(
        manifest: PathBuf,
        operation: LibraryOperationManifest,
    ) -> Result<Self, VaultError> {
        let (workspace_id, document_id, kind) = match operation {
            LibraryOperationManifest::Move {
                workspace_id,
                document_id,
                source_project,
                source,
                destination_project,
                destination,
            } => (
                workspace_id,
                document_id,
                PendingLibraryOperationKind::Move {
                    source: parse_segments(source_project.as_deref(), &source)?,
                    destination: parse_segments(destination_project.as_deref(), &destination)?,
                },
            ),
            LibraryOperationManifest::Delete {
                workspace_id,
                document_id,
                project,
                path,
                trash_id,
            } => (
                workspace_id,
                document_id,
                PendingLibraryOperationKind::Delete {
                    path: parse_segments(project.as_deref(), &path)?,
                    trash_id,
                },
            ),
            LibraryOperationManifest::Legacy {
                workspace_id,
                document_id,
                destination,
            } => (
                workspace_id,
                document_id,
                PendingLibraryOperationKind::Legacy {
                    destination: parse_segments(None, &destination)?,
                },
            ),
        };
        Ok(Self {
            workspace_id,
            document_id,
            kind,
            manifest,
        })
    }
}

fn parse_segments(
    project_storage_name: Option<&str>,
    segments: &[String],
) -> Result<LibraryPath, VaultError> {
    LibraryPath::parse_scoped(project_storage_name, segments.iter().map(String::as_str))
}

async fn ensure_absent(path: &PathBuf) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(_) => Err(VaultError::ExistingDocument),
    }
}

async fn ensure_optional_regular_directory(path: &PathBuf) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidLibraryPath),
    }
}

async fn reconcile_required_file(
    source: &PathBuf,
    destination: &PathBuf,
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
            "Library operation lost both copies of a document",
        )
        .into()),
    }
}

async fn reconcile_optional_directory(
    source: &PathBuf,
    destination: &PathBuf,
    keep_destination: bool,
) -> Result<(), VaultError> {
    let source_exists = ensure_optional_regular_directory(source).await?;
    let destination_exists = ensure_optional_regular_directory(destination).await?;
    match (source_exists, destination_exists, keep_destination) {
        (true, false, true) => fs::rename(source, destination).await.map_err(Into::into),
        (false, true, false) => fs::rename(destination, source).await.map_err(Into::into),
        (true, false, false) | (false, true, true) | (false, false, _) => Ok(()),
        (true, true, _) => Err(VaultError::ExistingDocument),
    }
}

async fn regular_file_exists(path: &PathBuf) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidLibraryPath),
    }
}

async fn remove_file_if_present(path: &PathBuf) -> Result<(), VaultError> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn remove_directory_if_present(path: &PathBuf) -> Result<(), VaultError> {
    match fs::remove_dir_all(path).await {
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
                    io::ErrorKind::NotFound | io::ErrorKind::DirectoryNotEmpty
                ) =>
            {
                break;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
