use std::{
    collections::HashSet,
    io,
    path::{Component, Path, PathBuf},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::domain::{LibraryStorageName, VaultStorageName};

use super::{LibraryPath, ProjectPath, TaskPath, Vault, VaultError, WorkspacePath};

pub struct TaskMigrationFile {
    pub destination: TaskPath,
    pub content: String,
}

pub struct WikiMigrationFile {
    pub source_project_storage_name: Option<String>,
    pub source_segments: Vec<String>,
    pub destination: LibraryPath,
}

pub struct StagedWorkspaceLayout {
    workspace_id: Uuid,
    workspace_identifier: String,
    source_layout_version: i16,
    source: PathBuf,
    canonical: PathBuf,
    staging: PathBuf,
}

pub struct WorkspaceLayoutMigration {
    source: PathBuf,
    canonical: PathBuf,
    staging: PathBuf,
    legacy: Option<PathBuf>,
    manifest: PathBuf,
}

pub struct PendingWorkspaceLayoutMigration {
    pub workspace_id: Uuid,
    pub target_layout_version: i16,
    source: PathBuf,
    canonical: PathBuf,
    staging: PathBuf,
    legacy: Option<PathBuf>,
    manifest: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct WorkspaceMigrationManifest {
    workspace_id: Uuid,
    #[serde(default)]
    workspace_identifier: Option<String>,
    #[serde(default)]
    source_layout_version: i16,
    #[serde(default = "legacy_target_layout_version")]
    target_layout_version: i16,
    #[serde(default)]
    source: Option<String>,
    canonical: String,
    staging: String,
    legacy: Option<String>,
}

fn legacy_target_layout_version() -> i16 {
    2
}

impl Vault {
    pub async fn initialize_workspace_layout(
        &self,
        workspace: &WorkspacePath,
    ) -> Result<(), VaultError> {
        let root = self.workspace_directory_path(workspace);
        self.verify_directory_ancestors(&self.data_dir.join("vaults"), true)
            .await?;
        ensure_optional_regular_directory(&root).await?;
        if regular_directory_exists(&root).await? {
            return Err(VaultError::ExistingDocument);
        }
        fs::create_dir(&root).await?;
        if let Err(error) = create_canonical_directories(&root, &[]).await {
            let _ = fs::remove_dir_all(&root).await;
            return Err(error);
        }
        Ok(())
    }

    pub async fn remove_unattached_workspace_layout(
        &self,
        workspace: &WorkspacePath,
    ) -> Result<(), VaultError> {
        self.remove_unattached_layout(&self.workspace_directory_path(workspace))
            .await
    }

    pub async fn initialize_project_layout(
        &self,
        workspace_id: Uuid,
        project: &ProjectPath,
    ) -> Result<(), VaultError> {
        let directory = self
            .workspace_directory(workspace_id)
            .join(project.relative_directory());
        self.verify_managed_ancestors(workspace_id, &directory, true)
            .await?;
        ensure_optional_regular_directory(&directory).await?;
        if regular_directory_exists(&directory).await? {
            return Err(VaultError::ExistingDocument);
        }
        fs::create_dir(&directory).await?;
        fs::create_dir(directory.join("library")).await?;
        Ok(())
    }

    pub async fn remove_unattached_project_layout(
        &self,
        workspace_id: Uuid,
        project: &ProjectPath,
    ) -> Result<(), VaultError> {
        self.remove_unattached_layout(
            &self
                .workspace_directory(workspace_id)
                .join(project.relative_directory()),
        )
        .await
    }

    async fn remove_unattached_layout(&self, directory: &Path) -> Result<(), VaultError> {
        match self.verify_directory_ancestors(directory, false).await {
            Ok(()) => remove_directory_if_present(directory).await,
            Err(VaultError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub async fn read_legacy_task_body(
        &self,
        workspace_id: Uuid,
        task_id: Uuid,
    ) -> Result<String, VaultError> {
        let workspace = self.legacy_workspace_directory(workspace_id);
        let relative = PathBuf::from("Tasks").join(format!("{task_id}.md"));
        ensure_regular_path_beneath(&workspace, &relative).await?;
        Ok(fs::read_to_string(workspace.join(relative)).await?)
    }

    pub async fn read_layout_v2_task(
        &self,
        workspace_id: Uuid,
        project_storage_name: Option<&str>,
        storage_name: &str,
    ) -> Result<String, VaultError> {
        let storage_name =
            VaultStorageName::parse(storage_name).map_err(|_| VaultError::InvalidManagedPath)?;
        let mut relative = PathBuf::new();
        if let Some(project) = project_storage_name {
            let project =
                VaultStorageName::parse(project).map_err(|_| VaultError::InvalidManagedPath)?;
            relative.push("Projects");
            relative.push(project.as_str());
        }
        relative.push("Todo");
        relative.push(format!("{}.md", storage_name.as_str()));
        let workspace = self.legacy_workspace_directory(workspace_id);
        ensure_regular_path_beneath(&workspace, &relative).await?;
        Ok(fs::read_to_string(workspace.join(relative)).await?)
    }

    pub async fn stage_workspace_layout_v3(
        &self,
        workspace: &WorkspacePath,
        source_layout_version: i16,
        tasks: &[TaskMigrationFile],
        library: &[WikiMigrationFile],
        projects: &[ProjectPath],
    ) -> Result<StagedWorkspaceLayout, VaultError> {
        if !matches!(source_layout_version, 0 | 2) {
            return Err(VaultError::InvalidManagedPath);
        }
        self.verify_directory_ancestors(&self.data_dir.join("vaults"), true)
            .await?;
        let source = self.legacy_workspace_directory(workspace.workspace_id());
        ensure_optional_regular_directory(&source).await?;
        let canonical = self.workspace_directory_path(workspace);
        if regular_directory_exists(&canonical).await? {
            return Err(VaultError::ExistingDocument);
        }
        let staging = self.data_dir.join("vaults").join(format!(
            ".{}.v3-staging.{}.{}",
            workspace.identifier(),
            workspace.workspace_id(),
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&staging).await?;

        let result = async {
            create_canonical_directories(&staging, projects).await?;
            let mut destinations = HashSet::with_capacity(tasks.len() + library.len());
            for task in tasks {
                let relative = task.destination.relative_file();
                if !destinations.insert(relative.clone()) {
                    return Err(VaultError::ExistingDocument);
                }
                create_staged_file(&staging, &relative, task.content.as_bytes()).await?;
            }
            for document in library {
                let relative = document.destination.relative_file();
                if !destinations.insert(relative.clone()) {
                    return Err(VaultError::ExistingDocument);
                }
                let source_file = legacy_library_source(&source, document).await?;
                let content = fs::read(source_file).await?;
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
            workspace_id: workspace.workspace_id(),
            workspace_identifier: workspace.identifier().to_owned(),
            source_layout_version,
            source,
            canonical,
            staging,
        })
    }

    pub async fn activate_workspace_layout_v3(
        &self,
        staged: StagedWorkspaceLayout,
    ) -> Result<WorkspaceLayoutMigration, VaultError> {
        self.verify_directory_ancestors(&self.data_dir.join("vaults"), false)
            .await?;
        ensure_optional_regular_directory(&staged.canonical).await?;
        if regular_directory_exists(&staged.canonical).await? {
            return Err(VaultError::ExistingDocument);
        }
        let legacy = match fs::symlink_metadata(&staged.source).await {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
                Some(self.data_dir.join("vaults").join(format!(
                    "{}.legacy-v{}-{timestamp}-{}",
                    staged.workspace_id,
                    staged.source_layout_version,
                    &Uuid::new_v4().simple().to_string()[..6]
                )))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Ok(_) => return Err(VaultError::InvalidManagedPath),
            Err(error) => return Err(error.into()),
        };
        let manifest = self
            .write_workspace_migration_manifest(&staged, legacy.as_deref())
            .await?;
        if let Some(legacy) = &legacy
            && let Err(error) = fs::rename(&staged.source, legacy).await
        {
            let _ = fs::remove_file(&manifest).await;
            return Err(error.into());
        }
        if let Err(error) = fs::rename(&staged.staging, &staged.canonical).await {
            if let Some(legacy) = &legacy {
                let _ = fs::rename(legacy, &staged.source).await;
            }
            let _ = fs::remove_file(&manifest).await;
            return Err(error.into());
        }
        Ok(WorkspaceLayoutMigration {
            source: staged.source,
            canonical: staged.canonical,
            staging: staged.staging,
            legacy,
            manifest,
        })
    }

    pub async fn rollback_workspace_layout_v3(
        &self,
        migration: &WorkspaceLayoutMigration,
    ) -> Result<(), VaultError> {
        fs::rename(&migration.canonical, &migration.staging).await?;
        if let Some(legacy) = &migration.legacy {
            fs::rename(legacy, &migration.source).await?;
        }
        remove_directory_if_present(&migration.staging).await?;
        remove_file_if_present(&migration.manifest).await
    }

    pub async fn finish_workspace_layout_v3(
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
            let source_name = manifest
                .source
                .clone()
                .unwrap_or_else(|| manifest.workspace_id.to_string());
            operations.push(PendingWorkspaceLayoutMigration {
                workspace_id: manifest.workspace_id,
                target_layout_version: manifest.target_layout_version,
                source: vaults.join(source_name),
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
        self.verify_directory_ancestors(&self.data_dir.join("vaults"), false)
            .await?;
        if committed {
            ensure_regular_directory(&operation.canonical).await?;
            remove_directory_if_present(&operation.staging).await?;
            return remove_file_if_present(&operation.manifest).await;
        }
        if let Some(legacy) = &operation.legacy {
            if !regular_directory_exists(legacy).await? {
                // Before the first rename, or after rollback restored the source,
                // the source root is authoritative (v3 canonical uses another name).
                ensure_regular_directory(&operation.source).await?;
                remove_directory_if_present(&operation.staging).await?;
                return remove_file_if_present(&operation.manifest).await;
            }
            if regular_directory_exists(&operation.canonical).await? {
                remove_directory_if_present(&operation.staging).await?;
                fs::rename(&operation.canonical, &operation.staging).await?;
            }
            fs::rename(legacy, &operation.source).await?;
            remove_directory_if_present(&operation.staging).await?;
        } else {
            remove_directory_if_present(&operation.canonical).await?;
            remove_directory_if_present(&operation.staging).await?;
        }
        remove_file_if_present(&operation.manifest).await
    }

    async fn write_workspace_migration_manifest(
        &self,
        staged: &StagedWorkspaceLayout,
        legacy: Option<&Path>,
    ) -> Result<PathBuf, VaultError> {
        let manifest = WorkspaceMigrationManifest {
            workspace_id: staged.workspace_id,
            workspace_identifier: Some(staged.workspace_identifier.clone()),
            source_layout_version: staged.source_layout_version,
            target_layout_version: 3,
            source: Some(file_name(&staged.source)?),
            canonical: file_name(&staged.canonical)?,
            staging: file_name(&staged.staging)?,
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

pub(super) async fn create_canonical_directories(
    staging: &Path,
    projects: &[ProjectPath],
) -> Result<(), VaultError> {
    for relative in [
        "projects",
        "tasks",
        "library",
        "assets/images",
        "assets/files",
        ".trash/library",
        ".trash/tasks",
        ".trash/projects",
        ".trash/assets",
    ] {
        fs::create_dir_all(staging.join(relative)).await?;
    }
    let mut project_names = HashSet::with_capacity(projects.len());
    for project in projects {
        if !project_names.insert(project.identifier()) {
            return Err(VaultError::ExistingDocument);
        }
        fs::create_dir_all(staging.join(project.relative_directory()).join("library")).await?;
    }
    Ok(())
}

async fn legacy_library_source(
    workspace: &Path,
    document: &WikiMigrationFile,
) -> Result<PathBuf, VaultError> {
    let segments = document
        .source_segments
        .iter()
        .map(|segment| LibraryStorageName::parse(segment))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| VaultError::InvalidLibraryPath)?;
    if segments.is_empty() {
        return Err(VaultError::InvalidLibraryPath);
    }
    let project = document
        .source_project_storage_name
        .as_deref()
        .map(VaultStorageName::parse)
        .transpose()
        .map_err(|_| VaultError::InvalidManagedPath)?;
    for root in ["Wiki", "Library", "library"] {
        let mut base = PathBuf::new();
        if let Some(project) = &project {
            base.push("Projects");
            base.push(project.as_str());
        }
        base.push(root);
        let relative = library_relative_file(base, &segments);
        match ensure_regular_path_beneath(workspace, &relative).await {
            Ok(()) => return Ok(workspace.join(relative)),
            Err(VaultError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "legacy Library document is missing",
    )
    .into())
}

fn library_relative_file(mut root: PathBuf, segments: &[LibraryStorageName]) -> PathBuf {
    let mut segments = segments.iter();
    let Some(mut leaf) = segments.next() else {
        return root;
    };
    for segment in segments {
        root.push(leaf.as_str());
        leaf = segment;
    }
    root.join(format!("{}.md", leaf.as_str()))
}

async fn ensure_regular_path_beneath(root: &Path, relative: &Path) -> Result<(), VaultError> {
    let mut current = root.to_owned();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(VaultError::InvalidManagedPath);
        };
        current.push(component);
        let metadata = fs::symlink_metadata(&current).await?;
        if metadata.file_type().is_symlink() {
            return Err(VaultError::InvalidManagedPath);
        }
    }
    ensure_regular_file(&current).await
}

fn file_name(path: &Path) -> Result<String, VaultError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or(VaultError::InvalidManagedPath)
}

fn validate_migration_names(manifest: &WorkspaceMigrationManifest) -> Result<(), VaultError> {
    let workspace_id = manifest.workspace_id.to_string();
    let valid = if manifest.target_layout_version == 3 {
        let Some(identifier) = manifest.workspace_identifier.as_deref() else {
            return Err(VaultError::InvalidManagedPath);
        };
        WorkspacePath::parse(manifest.workspace_id, identifier)?;
        manifest.source.as_deref() == Some(workspace_id.as_str())
            && manifest.canonical == identifier
            && manifest
                .staging
                .starts_with(&format!(".{identifier}.v3-staging."))
            && manifest
                .legacy
                .as_ref()
                .is_none_or(|legacy| legacy.starts_with(&format!("{workspace_id}.legacy-v")))
    } else if manifest.target_layout_version == 2 {
        manifest.canonical == workspace_id
            && manifest
                .staging
                .starts_with(&format!(".{workspace_id}.v2-staging."))
            && manifest
                .legacy
                .as_ref()
                .is_none_or(|legacy| legacy.starts_with(&format!("{workspace_id}.legacy-")))
    } else {
        false
    };
    let names_are_components = single_component(&manifest.canonical)
        && single_component(&manifest.staging)
        && manifest
            .source
            .as_ref()
            .is_none_or(|value| single_component(value))
        && manifest
            .legacy
            .as_ref()
            .is_none_or(|value| single_component(value));
    if valid && names_are_components {
        Ok(())
    } else {
        Err(VaultError::InvalidManagedPath)
    }
}

fn single_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

async fn create_staged_file(
    staging: &Path,
    relative: &Path,
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
    staging: &Path,
    destinations: &HashSet<PathBuf>,
) -> Result<(), VaultError> {
    for relative in destinations {
        ensure_regular_path_beneath(staging, relative).await?;
    }
    Ok(())
}

async fn ensure_regular_file(path: &Path) -> Result<(), VaultError> {
    let metadata = fs::symlink_metadata(path).await?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(VaultError::InvalidManagedPath);
    }
    Ok(())
}

async fn ensure_optional_regular_directory(path: &Path) -> Result<(), VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn ensure_regular_directory(path: &Path) -> Result<(), VaultError> {
    if regular_directory_exists(path).await? {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::NotFound, "managed directory is missing").into())
    }
}

async fn regular_directory_exists(path: &Path) -> Result<bool, VaultError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(VaultError::InvalidManagedPath),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

async fn remove_directory_if_present(path: &Path) -> Result<(), VaultError> {
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

async fn remove_file_if_present(path: &Path) -> Result<(), VaultError> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn recovery_preserves_source_before_activation_and_after_interrupted_rollback() {
        for restored_after_activation in [false, true] {
            let data = TempDir::new().unwrap();
            let workspace = WorkspacePath::parse(Uuid::new_v4(), "kanleaf").unwrap();
            let vault = Vault::new(data.path().to_owned());
            let source = vault.legacy_workspace_directory(workspace.workspace_id());
            fs::create_dir_all(source.join("Wiki")).await.unwrap();
            fs::write(source.join("Wiki/notes.md"), "Thiết kế, externally edited")
                .await
                .unwrap();
            let staged = vault
                .stage_workspace_layout_v3(&workspace, 2, &[], &[], &[])
                .await
                .unwrap();
            if restored_after_activation {
                let migration = vault.activate_workspace_layout_v3(staged).await.unwrap();
                fs::rename(&migration.canonical, &migration.staging)
                    .await
                    .unwrap();
                fs::rename(migration.legacy.as_ref().unwrap(), &migration.source)
                    .await
                    .unwrap();
            } else {
                let legacy = data.path().join("vaults").join(format!(
                    "{}.legacy-v2-interrupted",
                    workspace.workspace_id()
                ));
                vault
                    .write_workspace_migration_manifest(&staged, Some(&legacy))
                    .await
                    .unwrap();
            }
            let restarted = Vault::new(data.path().to_owned());
            let pending = restarted
                .pending_workspace_layout_migrations()
                .await
                .unwrap();
            assert_eq!(pending.len(), 1);
            restarted
                .recover_workspace_layout_migration(&pending[0], false)
                .await
                .unwrap();
            assert_eq!(
                fs::read_to_string(source.join("Wiki/notes.md"))
                    .await
                    .unwrap(),
                "Thiết kế, externally edited"
            );
            assert!(!data.path().join("vaults/kanleaf").exists());
            assert!(!pending[0].staging.exists());
            assert!(
                restarted
                    .pending_workspace_layout_migrations()
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn workspace_initialization_and_cleanup_reject_symlinked_ancestors() {
        let data = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), data.path().join("vaults")).unwrap();
        let vault = Vault::new(data.path().to_owned());
        let workspace = WorkspacePath::parse(Uuid::new_v4(), "kanleaf").unwrap();
        assert!(matches!(
            vault
                .stage_workspace_layout_v3(&workspace, 2, &[], &[], &[])
                .await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert!(matches!(
            vault.initialize_workspace_layout(&workspace).await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert!(!outside.path().join("kanleaf").exists());
        fs::create_dir(outside.path().join("kanleaf"))
            .await
            .unwrap();
        fs::write(outside.path().join("kanleaf/keep.md"), "safe")
            .await
            .unwrap();
        assert!(matches!(
            vault.remove_unattached_workspace_layout(&workspace).await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert_eq!(
            fs::read_to_string(outside.path().join("kanleaf/keep.md"))
                .await
                .unwrap(),
            "safe"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn project_initialization_and_cleanup_reject_symlinked_ancestors() {
        let data = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let vault = Vault::new(data.path().to_owned());
        let workspace = WorkspacePath::parse(Uuid::new_v4(), "kanleaf").unwrap();
        vault.register_workspace_path(&workspace);
        fs::create_dir_all(data.path().join("vaults/kanleaf"))
            .await
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), data.path().join("vaults/kanleaf/projects"))
            .unwrap();
        let project = ProjectPath::parse("astro-clash").unwrap();
        assert!(matches!(
            vault
                .initialize_project_layout(workspace.workspace_id(), &project)
                .await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert!(!outside.path().join("astro-clash").exists());
        fs::create_dir(outside.path().join("astro-clash"))
            .await
            .unwrap();
        fs::write(outside.path().join("astro-clash/keep.md"), "safe")
            .await
            .unwrap();
        assert!(matches!(
            vault
                .remove_unattached_project_layout(workspace.workspace_id(), &project)
                .await,
            Err(VaultError::InvalidManagedPath)
        ));
        assert_eq!(
            fs::read_to_string(outside.path().join("astro-clash/keep.md"))
                .await
                .unwrap(),
            "safe"
        );
    }
}
