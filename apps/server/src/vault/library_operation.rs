use std::{
    io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use super::workspace_deletion::{
    ensure_regular_directory, remove_regular_directory_if_present, sync_directory,
};
use super::{LibraryPath, Vault, VaultError};

#[derive(Debug)]
pub struct LibraryMove {
    source_file: PathBuf,
    destination_file: PathBuf,
    source_directory: PathBuf,
    destination_directory: PathBuf,
    library_root: PathBuf,
    manifest: PathBuf,
}

#[derive(Debug)]
pub struct LibraryTrash {
    workspace_id: Uuid,
    original_file: PathBuf,
    original_directory: PathBuf,
    library_root: PathBuf,
    trash_root: PathBuf,
    manifest: PathBuf,
}

#[derive(Debug)]
pub struct LegacyLibraryMove {
    document_id: Uuid,
    source_file: PathBuf,
    destination_file: PathBuf,
    library_root: PathBuf,
    manifest: PathBuf,
}

impl LegacyLibraryMove {
    pub(crate) const fn document_id(&self) -> Uuid {
        self.document_id
    }
}

#[derive(Clone, Debug)]
pub struct PendingLibraryOperation {
    pub workspace_id: Uuid,
    pub document_id: Uuid,
    pub kind: PendingLibraryOperationKind,
    manifest: PathBuf,
    layout: LibraryOperationLayout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LibraryOperationLayout {
    PersistedVault,
    LegacyDataRoot,
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

impl LibraryOperationManifest {
    const fn identity(&self) -> (Uuid, Uuid) {
        match self {
            Self::Move {
                workspace_id,
                document_id,
                ..
            }
            | Self::Delete {
                workspace_id,
                document_id,
                ..
            }
            | Self::Legacy {
                workspace_id,
                document_id,
                ..
            } => (*workspace_id, *document_id),
        }
    }
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

        let movement = LibraryMove {
            source_file,
            destination_file,
            source_directory,
            destination_directory,
            library_root: self.workspace_directory(workspace_id),
            manifest,
        };

        if moved_directory
            && let Err(error) =
                fs::rename(&movement.source_directory, &movement.destination_directory).await
        {
            return match self.rollback_library_move(&movement).await {
                Ok(()) => Err(error.into()),
                Err(rollback_error) => Err(compensation_error(
                    "failed to stage Library directory move",
                    error,
                    rollback_error,
                )),
            };
        }
        if let Err(error) = fs::rename(&movement.source_file, &movement.destination_file).await {
            return match self.rollback_library_move(&movement).await {
                Ok(()) => Err(error.into()),
                Err(rollback_error) => Err(compensation_error(
                    "failed to stage Library file move",
                    error,
                    rollback_error,
                )),
            };
        }
        if let Err(error) = self
            .sync_library_rename_parents(&movement.source_file, &movement.destination_file)
            .await
        {
            return match self.rollback_library_move(&movement).await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(compensation_error(
                    "failed to make the staged Library move durable",
                    error,
                    rollback_error,
                )),
            };
        }

        Ok(Some(movement))
    }

    pub async fn rollback_library_move(&self, movement: &LibraryMove) -> Result<(), VaultError> {
        reconcile_required_file(&movement.source_file, &movement.destination_file, false).await?;
        reconcile_optional_directory(
            &movement.source_directory,
            &movement.destination_directory,
            false,
        )
        .await?;
        self.sync_library_rename_parents(&movement.source_file, &movement.destination_file)
            .await?;
        self.remove_operation_manifest(&movement.manifest).await?;
        remove_empty_ancestors(movement.destination_file.parent(), &movement.library_root).await?;
        Ok(())
    }

    pub async fn finish_library_move(&self, movement: &LibraryMove) -> Result<(), VaultError> {
        self.remove_operation_manifest(&movement.manifest).await?;
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
            .library_trash_directory()
            .join(format!("{workspace_id}.{trash_id}"));
        self.ensure_library_operation_directories().await?;
        ensure_absent(&trash_root).await?;
        ensure_regular_directory(&trash_root).await?;
        sync_directory(&self.library_trash_directory()).await?;
        sync_directory(&trash_root).await?;
        let manifest = self
            .write_operation_manifest(&LibraryOperationManifest::Delete {
                workspace_id,
                document_id,
                project: path.project_storage_name().map(str::to_owned),
                path: path.storage_segments(),
                trash_id,
            })
            .await;
        let manifest = match manifest {
            Ok(manifest) => manifest,
            Err(error) => {
                return match self.remove_library_trash_root(&trash_root).await {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(compensation_error(
                        "failed to write the Library deletion manifest",
                        error,
                        rollback_error,
                    )),
                };
            }
        };
        let trash = LibraryTrash {
            workspace_id,
            original_file,
            original_directory,
            library_root: self.workspace_directory(workspace_id),
            trash_root,
            manifest,
        };

        if moved_directory
            && let Err(error) =
                fs::rename(&trash.original_directory, trash.trash_root.join("children")).await
        {
            return match self.restore_library_trash(&trash).await {
                Ok(()) => Err(error.into()),
                Err(rollback_error) => Err(compensation_error(
                    "failed to stage the Library subtree for deletion",
                    error,
                    rollback_error,
                )),
            };
        }
        if let Err(error) =
            fs::rename(&trash.original_file, trash.trash_root.join("document.md")).await
        {
            return match self.restore_library_trash(&trash).await {
                Ok(()) => Err(error.into()),
                Err(rollback_error) => Err(compensation_error(
                    "failed to stage the Library document for deletion",
                    error,
                    rollback_error,
                )),
            };
        }
        if let Err(error) = self
            .sync_library_rename_parents(
                &trash.original_file,
                &trash.trash_root.join("document.md"),
            )
            .await
        {
            return match self.restore_library_trash(&trash).await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(compensation_error(
                    "failed to make the staged Library deletion durable",
                    error,
                    rollback_error,
                )),
            };
        }

        Ok(trash)
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
        let movement = LegacyLibraryMove {
            document_id,
            source_file,
            destination_file,
            library_root: self.workspace_directory(workspace_id),
            manifest,
        };
        if source_exists
            && let Err(error) = fs::rename(&movement.source_file, &movement.destination_file).await
        {
            return match self.rollback_legacy_library_move(&movement).await {
                Ok(()) => Err(error.into()),
                Err(rollback_error) => Err(compensation_error(
                    "failed to stage legacy Library migration",
                    error,
                    rollback_error,
                )),
            };
        }
        if source_exists
            && let Err(error) = self
                .sync_library_rename_parents(&movement.source_file, &movement.destination_file)
                .await
        {
            return match self.rollback_legacy_library_move(&movement).await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(compensation_error(
                    "failed to make legacy Library migration durable",
                    error,
                    rollback_error,
                )),
            };
        }

        Ok(movement)
    }

    pub async fn rollback_legacy_library_move(
        &self,
        movement: &LegacyLibraryMove,
    ) -> Result<(), VaultError> {
        reconcile_required_file(&movement.source_file, &movement.destination_file, false).await?;
        self.sync_library_rename_parents(&movement.source_file, &movement.destination_file)
            .await?;
        self.remove_operation_manifest(&movement.manifest).await?;
        remove_empty_ancestors(movement.destination_file.parent(), &movement.library_root).await?;
        Ok(())
    }

    pub async fn finish_legacy_library_move(
        &self,
        movement: &LegacyLibraryMove,
    ) -> Result<(), VaultError> {
        self.remove_operation_manifest(&movement.manifest).await?;
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
        self.validate_library_trash_directory(LibraryOperationLayout::PersistedVault)
            .await?;
        ensure_optional_regular_directory(&trash.trash_root).await?;
        self.ensure_safe_library_parent(trash.workspace_id, &trash.original_file)
            .await?;
        reconcile_required_file(
            &trash.original_file,
            &trash.trash_root.join("document.md"),
            false,
        )
        .await?;
        reconcile_optional_directory(
            &trash.original_directory,
            &trash.trash_root.join("children"),
            false,
        )
        .await?;
        self.sync_library_rename_parents(
            &trash.original_file,
            &trash.trash_root.join("document.md"),
        )
        .await?;
        self.remove_library_trash_root(&trash.trash_root).await?;
        self.remove_operation_manifest(&trash.manifest).await?;
        Ok(())
    }

    pub async fn purge_library_trash(&self, trash: &LibraryTrash) -> Result<(), VaultError> {
        self.validate_library_trash_directory(LibraryOperationLayout::PersistedVault)
            .await?;
        ensure_optional_regular_directory(&trash.trash_root).await?;
        self.remove_library_trash_root(&trash.trash_root).await?;
        self.remove_operation_manifest(&trash.manifest).await?;
        remove_empty_ancestors(trash.original_file.parent(), &trash.library_root).await?;
        Ok(())
    }

    pub async fn pending_library_operations(
        &self,
    ) -> Result<Vec<PendingLibraryOperation>, VaultError> {
        let mut operations = Vec::new();
        for (directory, layout) in [
            (
                self.library_operation_directory(),
                LibraryOperationLayout::PersistedVault,
            ),
            (
                self.data_dir.join("operations"),
                LibraryOperationLayout::LegacyDataRoot,
            ),
        ] {
            if !self.validate_library_operation_directory(layout).await?
                || !ensure_optional_regular_directory(&directory).await?
            {
                continue;
            }
            let mut entries = fs::read_dir(&directory).await?;
            while let Some(entry) = entries.next_entry().await? {
                if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                if entry.file_name().to_str().is_some_and(|name| {
                    name.ends_with(".task.json") || name.ends_with(".workspace.json")
                }) {
                    continue;
                }
                let metadata = fs::symlink_metadata(entry.path()).await?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(VaultError::InvalidManagedPath);
                }
                let bytes = fs::read(entry.path()).await?;
                let manifest: LibraryOperationManifest = serde_json::from_slice(&bytes)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                operations.push(PendingLibraryOperation::from_manifest(
                    entry.path(),
                    manifest,
                    layout,
                )?);
            }
        }
        operations.sort_by(|left, right| left.manifest.cmp(&right.manifest));
        Ok(operations)
    }

    pub(crate) async fn discard_workspace_library_operations(
        &self,
        workspace_id: Uuid,
    ) -> Result<(), VaultError> {
        for operation in self.pending_library_operations().await? {
            if operation.workspace_id != workspace_id {
                continue;
            }
            if matches!(operation.kind, PendingLibraryOperationKind::Delete { .. }) {
                self.recover_library_delete(&operation, false).await?;
            } else {
                self.remove_operation_manifest(&operation.manifest).await?;
            }
        }
        Ok(())
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
        self.sync_library_rename_parents(&source_file, &destination_file)
            .await?;
        self.remove_operation_manifest(&operation.manifest).await?;
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
        self.validate_library_trash_directory(operation.layout)
            .await?;
        let trash_root = match operation.layout {
            LibraryOperationLayout::PersistedVault => self.library_trash_directory(),
            LibraryOperationLayout::LegacyDataRoot => self.data_dir.join("trash/library"),
        }
        .join(format!("{}.{}", operation.workspace_id, trash_id));
        ensure_optional_regular_directory(&trash_root).await?;

        if document_exists {
            self.ensure_safe_library_parent(operation.workspace_id, &original_file)
                .await?;
            if operation.layout == LibraryOperationLayout::LegacyDataRoot {
                restore_legacy_file(&original_file, &trash_root.join("document.md"), *trash_id)
                    .await?;
                restore_legacy_directory(
                    &original_directory,
                    &trash_root.join("children"),
                    *trash_id,
                )
                .await?;
            } else {
                reconcile_required_file(&original_file, &trash_root.join("document.md"), false)
                    .await?;
                reconcile_optional_directory(
                    &original_directory,
                    &trash_root.join("children"),
                    false,
                )
                .await?;
            }
            self.sync_library_rename_parents(&original_file, &trash_root.join("document.md"))
                .await?;
            self.remove_library_trash_root(&trash_root).await?;
        } else {
            self.remove_library_trash_root(&trash_root).await?;
            let library_root = self.workspace_directory(operation.workspace_id);
            remove_empty_ancestors(original_file.parent(), &library_root).await?;
        }
        self.remove_operation_manifest(&operation.manifest).await?;
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
        self.sync_library_rename_parents(&source_file, &destination_file)
            .await?;
        self.remove_operation_manifest(&operation.manifest).await?;
        Ok(())
    }

    pub async fn retire_superseded_library_operation(
        &self,
        operation: &PendingLibraryOperation,
    ) -> Result<bool, VaultError> {
        let paths = match &operation.kind {
            PendingLibraryOperationKind::Move {
                source,
                destination,
            } => vec![
                (
                    self.library_file(operation.workspace_id, source),
                    ManagedEntryKind::File,
                ),
                (
                    self.library_companion_directory(operation.workspace_id, source),
                    ManagedEntryKind::Directory,
                ),
                (
                    self.library_file(operation.workspace_id, destination),
                    ManagedEntryKind::File,
                ),
                (
                    self.library_companion_directory(operation.workspace_id, destination),
                    ManagedEntryKind::Directory,
                ),
            ],
            PendingLibraryOperationKind::Legacy { destination } => vec![
                (
                    self.workspace_directory(operation.workspace_id)
                        .join("Pages")
                        .join(format!("{}.md", operation.document_id)),
                    ManagedEntryKind::File,
                ),
                (
                    self.library_file(operation.workspace_id, destination),
                    ManagedEntryKind::File,
                ),
            ],
            PendingLibraryOperationKind::Delete { .. } => {
                return Err(VaultError::InvalidLibraryPath);
            }
        };
        for (path, kind) in paths {
            if self
                .managed_library_entry_exists(operation.workspace_id, &path, kind)
                .await?
            {
                return Ok(false);
            }
        }
        self.remove_operation_manifest(&operation.manifest).await?;
        Ok(true)
    }

    async fn write_operation_manifest(
        &self,
        operation: &LibraryOperationManifest,
    ) -> Result<PathBuf, VaultError> {
        self.ensure_library_operation_directories().await?;
        let (workspace_id, document_id) = operation.identity();
        if self
            .pending_library_operations()
            .await?
            .iter()
            .any(|pending| {
                pending.workspace_id == workspace_id && pending.document_id == document_id
            })
        {
            return Err(VaultError::PendingLibraryOperation);
        }
        let directory = self.library_operation_directory();
        let path = directory.join(format!("{workspace_id}.{document_id}.library.json"));
        let temporary = directory.join(format!(".{}.library-manifest.tmp", Uuid::new_v4()));
        let bytes = serde_json::to_vec(operation)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        let write_result = async {
            file.write_all(&bytes).await?;
            file.flush().await?;
            file.sync_all().await
        }
        .await;
        drop(file);
        if let Err(error) = write_result {
            let _ = remove_file_if_present(&temporary).await;
            return Err(error.into());
        }
        if let Err(error) = fs::hard_link(&temporary, &path).await {
            let _ = remove_file_if_present(&temporary).await;
            return if error.kind() == io::ErrorKind::AlreadyExists {
                Err(VaultError::PendingLibraryOperation)
            } else {
                Err(error.into())
            };
        }
        sync_directory(&directory).await?;
        remove_file_if_present(&temporary).await?;
        sync_directory(&directory).await?;
        Ok(path)
    }

    async fn ensure_library_operation_directories(&self) -> Result<(), VaultError> {
        let vaults = self.data_dir.join("vaults");
        let trash = vaults.join(".trash");
        ensure_regular_directory(&vaults).await?;
        ensure_regular_directory(&trash).await?;
        ensure_regular_directory(&trash.join("library")).await?;
        ensure_regular_directory(&trash.join("library-operations")).await?;
        sync_directory(self.data_dir.as_path()).await?;
        sync_directory(&vaults).await?;
        sync_directory(&trash).await?;
        sync_directory(&trash.join("library")).await?;
        sync_directory(&trash.join("library-operations")).await
    }

    fn library_trash_directory(&self) -> PathBuf {
        self.data_dir.join("vaults/.trash/library")
    }

    fn library_operation_directory(&self) -> PathBuf {
        self.data_dir.join("vaults/.trash/library-operations")
    }

    async fn sync_library_rename_parents(
        &self,
        source_file: &std::path::Path,
        destination_file: &std::path::Path,
    ) -> Result<(), VaultError> {
        if let Some(source_parent) = source_file.parent() {
            sync_directory_if_present(source_parent).await?;
        }
        if let Some(destination_parent) = destination_file.parent()
            && source_file.parent() != Some(destination_parent)
        {
            sync_directory_if_present(destination_parent).await?;
        }
        Ok(())
    }

    async fn remove_library_trash_root(
        &self,
        trash_root: &std::path::Path,
    ) -> Result<(), VaultError> {
        let parent = trash_root.parent().map(std::path::Path::to_path_buf);
        match parent.as_deref() {
            Some(parent) if parent == self.library_trash_directory() => {
                self.validate_library_trash_directory(LibraryOperationLayout::PersistedVault)
                    .await?;
            }
            Some(parent) if parent == self.data_dir.join("trash/library") => {
                self.validate_library_trash_directory(LibraryOperationLayout::LegacyDataRoot)
                    .await?;
            }
            _ => return Err(VaultError::InvalidManagedPath),
        }
        let parent_exists = match parent.as_deref() {
            Some(parent) => ensure_optional_regular_directory(parent).await?,
            None => false,
        };
        remove_regular_directory_if_present(trash_root).await?;
        if parent_exists && let Some(parent) = parent {
            sync_directory(&parent).await?;
        }
        Ok(())
    }

    async fn remove_operation_manifest(
        &self,
        manifest: &std::path::Path,
    ) -> Result<(), VaultError> {
        let layout = match manifest.parent() {
            Some(parent) if parent == self.library_operation_directory() => {
                LibraryOperationLayout::PersistedVault
            }
            Some(parent) if parent == self.data_dir.join("operations") => {
                LibraryOperationLayout::LegacyDataRoot
            }
            _ => return Err(VaultError::InvalidManagedPath),
        };
        self.validate_library_operation_directory(layout).await?;
        remove_file_if_present(manifest).await?;
        if let Some(parent) = manifest.parent() {
            sync_directory_if_present(parent).await?;
        }
        Ok(())
    }

    async fn validate_library_operation_directory(
        &self,
        layout: LibraryOperationLayout,
    ) -> Result<bool, VaultError> {
        match layout {
            LibraryOperationLayout::PersistedVault => {
                validate_optional_directory_chain(&[
                    self.data_dir.join("vaults"),
                    self.data_dir.join("vaults/.trash"),
                    self.library_operation_directory(),
                ])
                .await
            }
            LibraryOperationLayout::LegacyDataRoot => {
                validate_optional_directory_chain(&[self.data_dir.join("operations")]).await
            }
        }
    }

    async fn validate_library_trash_directory(
        &self,
        layout: LibraryOperationLayout,
    ) -> Result<bool, VaultError> {
        match layout {
            LibraryOperationLayout::PersistedVault => {
                validate_optional_directory_chain(&[
                    self.data_dir.join("vaults"),
                    self.data_dir.join("vaults/.trash"),
                    self.library_trash_directory(),
                ])
                .await
            }
            LibraryOperationLayout::LegacyDataRoot => {
                validate_optional_directory_chain(&[
                    self.data_dir.join("trash"),
                    self.data_dir.join("trash/library"),
                ])
                .await
            }
        }
    }

    async fn managed_library_entry_exists(
        &self,
        workspace_id: Uuid,
        path: &Path,
        kind: ManagedEntryKind,
    ) -> Result<bool, VaultError> {
        let workspace = self.workspace_directory(workspace_id);
        let relative = path
            .strip_prefix(&workspace)
            .map_err(|_| VaultError::InvalidManagedPath)?;
        let components = Path::new("vaults")
            .join(workspace_id.to_string())
            .join(relative)
            .components()
            .map(|component| component.as_os_str().to_owned())
            .collect::<Vec<_>>();
        let mut current = self.data_dir.as_ref().clone();
        for (index, component) in components.iter().enumerate() {
            current.push(component);
            let metadata = match fs::symlink_metadata(&current).await {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error.into()),
            };
            if metadata.file_type().is_symlink() {
                return Err(VaultError::InvalidManagedPath);
            }
            let final_component = index + 1 == components.len();
            if !final_component && !metadata.is_dir() {
                return Err(VaultError::InvalidManagedPath);
            }
            if final_component {
                return match kind {
                    ManagedEntryKind::File if metadata.is_file() => Ok(true),
                    ManagedEntryKind::Directory if metadata.is_dir() => Ok(true),
                    _ => Err(VaultError::InvalidManagedPath),
                };
            }
        }
        Err(VaultError::InvalidManagedPath)
    }
}

#[derive(Clone, Copy)]
enum ManagedEntryKind {
    File,
    Directory,
}

impl PendingLibraryOperation {
    fn from_manifest(
        manifest: PathBuf,
        operation: LibraryOperationManifest,
        layout: LibraryOperationLayout,
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
            layout,
        })
    }
}

fn compensation_error(
    context: &str,
    primary: impl std::fmt::Display,
    rollback: impl std::fmt::Display,
) -> VaultError {
    io::Error::other(format!(
        "{context} ({primary}); compensation failed ({rollback})"
    ))
    .into()
}

fn parse_segments(
    project_storage_name: Option<&str>,
    segments: &[String],
) -> Result<LibraryPath, VaultError> {
    LibraryPath::parse_scoped(project_storage_name, segments.iter().map(String::as_str))
}

async fn ensure_absent(path: &std::path::Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(_) => Err(VaultError::ExistingDocument),
    }
}

async fn ensure_optional_regular_directory(path: &std::path::Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidLibraryPath),
    }
}

async fn validate_optional_directory_chain(paths: &[PathBuf]) -> Result<bool, VaultError> {
    for path in paths {
        if !ensure_optional_regular_directory(path).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn reconcile_required_file(
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
            "Library operation lost both copies of a document",
        )
        .into()),
    }
}

async fn reconcile_optional_directory(
    source: &std::path::Path,
    destination: &std::path::Path,
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

async fn regular_file_exists(path: &std::path::Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidLibraryPath),
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

async fn restore_legacy_file(
    live: &Path,
    trashed: &Path,
    trash_id: Uuid,
) -> Result<(), VaultError> {
    let live_exists = regular_file_exists(live).await?;
    let trashed_exists = regular_file_exists(trashed).await?;
    match (live_exists, trashed_exists) {
        (true, false) => return Ok(()),
        (true, true) => {
            if !regular_files_equal(live, trashed).await? {
                return Err(VaultError::ExistingDocument);
            }
            remove_file_if_present(trashed).await?;
            if let Some(parent) = trashed.parent() {
                sync_directory_if_present(parent).await?;
            }
            return Ok(());
        }
        (false, false) => {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "legacy Library deletion lost both copies of a document",
            )
            .into());
        }
        (false, true) => {}
    }

    match fs::rename(trashed, live).await {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }

    let temporary = legacy_recovery_path(live, trash_id, "file")?;
    if regular_file_exists(&temporary).await? && !regular_files_equal(&temporary, trashed).await? {
        remove_file_if_present(&temporary).await?;
    }
    if !regular_file_exists(&temporary).await? {
        let mut source = fs::File::open(trashed).await?;
        let mut destination = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        if let Err(error) = async {
            tokio::io::copy(&mut source, &mut destination).await?;
            destination.flush().await?;
            destination.sync_all().await
        }
        .await
        {
            let _ = remove_file_if_present(&temporary).await;
            return Err(error.into());
        }
        if let Some(parent) = temporary.parent() {
            sync_directory(parent).await?;
        }
    }
    if !regular_files_equal(&temporary, trashed).await? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "legacy Library document changed during recovery",
        )
        .into());
    }
    fs::rename(&temporary, live).await?;
    if let Some(parent) = live.parent() {
        sync_directory(parent).await?;
    }
    remove_file_if_present(trashed).await?;
    if let Some(parent) = trashed.parent() {
        sync_directory_if_present(parent).await?;
    }
    Ok(())
}

async fn restore_legacy_directory(
    live: &Path,
    trashed: &Path,
    trash_id: Uuid,
) -> Result<(), VaultError> {
    let live_exists = ensure_optional_regular_directory(live).await?;
    let trashed_exists = ensure_optional_regular_directory(trashed).await?;
    if trashed_exists {
        validate_regular_directory(trashed).await?;
    }
    match (live_exists, trashed_exists) {
        (true, false) | (false, false) => return Ok(()),
        (true, true) => {
            if !regular_directories_equal(live, trashed).await? {
                return Err(VaultError::ExistingDocument);
            }
            remove_regular_directory_if_present(trashed).await?;
            if let Some(parent) = trashed.parent() {
                sync_directory_if_present(parent).await?;
            }
            return Ok(());
        }
        (false, true) => {}
    }

    match fs::rename(trashed, live).await {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }

    let temporary = legacy_recovery_path(live, trash_id, "tree")?;
    if ensure_optional_regular_directory(&temporary).await?
        && !regular_directories_equal(&temporary, trashed).await?
    {
        remove_regular_directory_if_present(&temporary).await?;
    }
    if !ensure_optional_regular_directory(&temporary).await? {
        copy_regular_directory(trashed, &temporary).await?;
        if let Some(parent) = temporary.parent() {
            sync_directory(parent).await?;
        }
    }
    if !regular_directories_equal(&temporary, trashed).await? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "legacy Library subtree changed during recovery",
        )
        .into());
    }
    fs::rename(&temporary, live).await?;
    if let Some(parent) = live.parent() {
        sync_directory(parent).await?;
    }
    remove_regular_directory_if_present(trashed).await?;
    if let Some(parent) = trashed.parent() {
        sync_directory_if_present(parent).await?;
    }
    Ok(())
}

fn legacy_recovery_path(live: &Path, trash_id: Uuid, kind: &str) -> Result<PathBuf, VaultError> {
    let name = live
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(VaultError::InvalidLibraryPath)?;
    Ok(live.with_file_name(format!(".{name}.{trash_id}.library-recovery-{kind}")))
}

async fn regular_files_equal(left: &Path, right: &Path) -> Result<bool, VaultError> {
    let left = left.to_owned();
    let right = right.to_owned();
    tokio::task::spawn_blocking(move || regular_files_equal_blocking(&left, &right))
        .await
        .map_err(|error| io::Error::other(format!("Library recovery comparison failed: {error}")))?
}

async fn copy_regular_directory(source: &Path, destination: &Path) -> Result<(), VaultError> {
    let source = source.to_owned();
    let destination = destination.to_owned();
    tokio::task::spawn_blocking(move || copy_regular_directory_blocking(&source, &destination))
        .await
        .map_err(|error| {
            io::Error::other(format!("Library recovery copy task failed: {error}"))
        })??;
    Ok(())
}

async fn regular_directories_equal(left: &Path, right: &Path) -> Result<bool, VaultError> {
    let left = left.to_owned();
    let right = right.to_owned();
    tokio::task::spawn_blocking(move || regular_directories_equal_blocking(&left, &right))
        .await
        .map_err(|error| io::Error::other(format!("Library recovery comparison failed: {error}")))?
}

async fn validate_regular_directory(path: &Path) -> Result<(), VaultError> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || validate_regular_directory_blocking(&path))
        .await
        .map_err(|error| io::Error::other(format!("Library recovery validation failed: {error}")))?
}

fn copy_regular_directory_blocking(source: &Path, destination: &Path) -> Result<(), VaultError> {
    let metadata = std::fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(VaultError::InvalidManagedPath);
    }
    std::fs::create_dir(destination)?;
    let copy_result = (|| {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let metadata = std::fs::symlink_metadata(entry.path())?;
            let destination_entry = destination.join(entry.file_name());
            if metadata.file_type().is_symlink() {
                return Err(VaultError::InvalidManagedPath);
            }
            if metadata.is_dir() {
                copy_regular_directory_blocking(&entry.path(), &destination_entry)?;
            } else if metadata.is_file() {
                let mut input = std::fs::File::open(entry.path())?;
                let mut output = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(destination_entry)?;
                std::io::copy(&mut input, &mut output)?;
                output.sync_all()?;
            } else {
                return Err(VaultError::InvalidManagedPath);
            }
        }
        sync_directory_blocking(destination)
    })();
    if let Err(error) = copy_result {
        let cleanup = std::fs::remove_dir_all(destination);
        return match cleanup {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(compensation_error(
                "failed to copy legacy Library subtree",
                error,
                cleanup_error,
            )),
        };
    }
    Ok(())
}

fn regular_directories_equal_blocking(left: &Path, right: &Path) -> Result<bool, VaultError> {
    for path in [left, right] {
        let metadata = std::fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(VaultError::InvalidManagedPath);
        }
    }
    let mut left_entries = std::fs::read_dir(left)?
        .map(|entry| entry.map(|entry| (entry.file_name(), entry.path())))
        .collect::<Result<std::collections::BTreeMap<_, _>, _>>()?;
    for entry in std::fs::read_dir(right)? {
        let entry = entry?;
        let Some(left_path) = left_entries.remove(&entry.file_name()) else {
            return Ok(false);
        };
        let left_metadata = std::fs::symlink_metadata(&left_path)?;
        let right_metadata = std::fs::symlink_metadata(entry.path())?;
        if left_metadata.file_type().is_symlink() || right_metadata.file_type().is_symlink() {
            return Err(VaultError::InvalidManagedPath);
        }
        if (!left_metadata.is_file() && !left_metadata.is_dir())
            || (!right_metadata.is_file() && !right_metadata.is_dir())
        {
            return Err(VaultError::InvalidManagedPath);
        }
        let equal = if left_metadata.is_dir() && right_metadata.is_dir() {
            regular_directories_equal_blocking(&left_path, &entry.path())?
        } else if left_metadata.is_file() && right_metadata.is_file() {
            regular_files_equal_blocking(&left_path, &entry.path())?
        } else {
            false
        };
        if !equal {
            return Ok(false);
        }
    }
    Ok(left_entries.is_empty())
}

fn validate_regular_directory_blocking(path: &Path) -> Result<(), VaultError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(VaultError::InvalidManagedPath);
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(VaultError::InvalidManagedPath);
        }
        if metadata.is_dir() {
            validate_regular_directory_blocking(&entry.path())?;
        } else if !metadata.is_file() {
            return Err(VaultError::InvalidManagedPath);
        }
    }
    Ok(())
}

fn regular_files_equal_blocking(left: &Path, right: &Path) -> Result<bool, VaultError> {
    let left_metadata = std::fs::symlink_metadata(left)?;
    let right_metadata = std::fs::symlink_metadata(right)?;
    if left_metadata.file_type().is_symlink()
        || right_metadata.file_type().is_symlink()
        || !left_metadata.is_file()
        || !right_metadata.is_file()
    {
        return Err(VaultError::InvalidManagedPath);
    }
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }
    let mut left_file = std::fs::File::open(left)?;
    let mut right_file = std::fs::File::open(right)?;
    let mut left_buffer = [0_u8; 8192];
    let mut right_buffer = [0_u8; 8192];
    loop {
        let left_read = std::io::Read::read(&mut left_file, &mut left_buffer)?;
        let right_read = std::io::Read::read(&mut right_file, &mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn sync_directory_blocking(path: &Path) -> Result<(), VaultError> {
    #[cfg(unix)]
    std::fs::File::open(path)?.sync_all()?;
    Ok(())
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::os::unix::fs::MetadataExt;

    use tempfile::{Builder, TempDir};

    use super::{VaultError, restore_legacy_directory, restore_legacy_file};

    #[tokio::test]
    async fn legacy_recovery_copies_files_and_subtrees_across_filesystems() {
        let live_root = TempDir::new().unwrap();
        let trash_root = Builder::new()
            .prefix("kanleaf-library-legacy-")
            .tempdir_in("/dev/shm")
            .unwrap();
        assert_ne!(
            std::fs::metadata(live_root.path()).unwrap().dev(),
            std::fs::metadata(trash_root.path()).unwrap().dev(),
            "cross-filesystem recovery test requires /dev/shm on a separate device"
        );

        let trash_id = uuid::Uuid::new_v4();
        let trashed_file = trash_root.path().join("document.md");
        let trashed_tree = trash_root.path().join("children");
        std::fs::write(&trashed_file, "# Restored across mounts\n").unwrap();
        std::fs::create_dir(&trashed_tree).unwrap();
        std::fs::write(trashed_tree.join("child.md"), "nested body").unwrap();
        std::fs::create_dir(trashed_tree.join("child")).unwrap();
        std::fs::write(trashed_tree.join("child/grandchild.md"), "deep body").unwrap();
        let live_file = live_root.path().join("note.md");
        let live_tree = live_root.path().join("note");

        restore_legacy_file(&live_file, &trashed_file, trash_id)
            .await
            .unwrap();
        restore_legacy_directory(&live_tree, &trashed_tree, trash_id)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&live_file).unwrap(),
            "# Restored across mounts\n"
        );
        assert_eq!(
            std::fs::read_to_string(live_tree.join("child.md")).unwrap(),
            "nested body"
        );
        assert_eq!(
            std::fs::read_to_string(live_tree.join("child/grandchild.md")).unwrap(),
            "deep body"
        );
        assert!(!trashed_file.exists());
        assert!(!trashed_tree.exists());
        assert!(std::fs::read_dir(live_root.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("recovery")
        }));
    }

    #[tokio::test]
    async fn legacy_recovery_rejects_a_symlink_inside_the_trashed_subtree() {
        let root = TempDir::new().unwrap();
        let trashed_tree = root.path().join("trash/children");
        let live_tree = root.path().join("vault/note");
        let outside = root.path().join("outside.md");
        std::fs::create_dir_all(&trashed_tree).unwrap();
        std::fs::create_dir_all(live_tree.parent().unwrap()).unwrap();
        std::fs::write(&outside, "outside").unwrap();
        std::os::unix::fs::symlink(&outside, trashed_tree.join("child.md")).unwrap();

        let result =
            restore_legacy_directory(&live_tree, &trashed_tree, uuid::Uuid::new_v4()).await;

        assert!(matches!(result, Err(VaultError::InvalidManagedPath)));
        assert!(!live_tree.exists());
        assert!(std::fs::symlink_metadata(trashed_tree.join("child.md")).is_ok());
    }
}
