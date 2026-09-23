use std::{
    collections::{HashMap, HashSet},
    fmt::Write as _,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Component, Path},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    custom_property::{PropertyType, is_reserved_property_name, validate_value_shape},
    domain::{
        ConfigurationDescription, DocumentTitle, HexColor, LibraryStorageName, ProjectDescription,
        ProjectIcon, ProjectIdentifier, ResourceName, SelectOptionIcon, TaskTitle,
        VaultStorageName,
    },
    task::{
        CustomProperty, TaskProperties, TaskQuery, TaskQueryScope, read_task_properties,
        read_undefined_properties,
    },
    vault::TaskPath,
};

use super::config::{
    CustomPropertyConfig, CustomPropertyOptionConfig, DocumentIdentity, LegacyProjectConfigV2,
    LegacyTaskConfigV2, LegacyWorkspaceConfigV1, LiveManifest, ProjectConfig, TaskConfig,
    TaskIdentity, TaskLabelConfig, TaskStateConfig, ViewsConfig, WorkspaceConfig,
};

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;
const MAX_PATH_BYTES: usize = 512;
const MAX_PATH_DEPTH: usize = 16;
const MAX_SEGMENT_BYTES: usize = 120;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ImportManifest {
    pub format_version: u16,
    pub source: LiveManifest,
    pub files: Vec<ManifestFile>,
    pub relations: Vec<ManifestRelation>,
    exclusions: Vec<ManifestExclusion>,
    omitted: ManifestOmissions,
    exported_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ManifestFile {
    pub path: String,
    pub size: u64,
    pub media_type: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ManifestRelation {
    pub task_a_id: Uuid,
    pub task_b_id: Uuid,
    pub relation_type: String,
    pub task_a_blocks: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestExclusion {
    path: String,
    reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestOmissions {
    authentication: bool,
    invitations: bool,
    account_preferences: bool,
    notifications: bool,
    comments_and_activity: bool,
}

pub(super) struct ValidatedImport {
    pub manifest: ImportManifest,
    pub workspace: WorkspaceConfig,
    pub task_config: TaskConfig,
    pub views: ViewsConfig,
    pub projects: Vec<ProjectConfig>,
    pub tasks: HashMap<Uuid, ValidatedTask>,
    pub summary: ImportSummary,
}

pub(super) struct ValidatedTask {
    pub identity: TaskIdentity,
    pub properties: TaskProperties,
    pub path: TaskPath,
    pub cleanup_property_names: Vec<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub(super) struct ImportSummary {
    pub workspace_name: String,
    pub projects: usize,
    pub tasks: usize,
    pub documents: usize,
    pub states: usize,
    pub labels: usize,
    pub shared_views: usize,
    pub cycles: usize,
    pub modules: usize,
    pub excluded_member_references: usize,
    pub excluded_assignee_references: usize,
    pub history_included: bool,
}

#[derive(Debug, Error)]
pub(super) enum ImportArchiveError {
    #[error("The upload is not a valid Kanleaf archive")]
    InvalidArchive,
    #[error("The archive uses a newer or unsupported Kanleaf format")]
    UnsupportedSchema,
    #[error("An archive payload does not match its manifest checksum")]
    ChecksumMismatch,
    #[error("The archive exceeds Kanleaf import limits")]
    LimitExceeded,
    #[error("The archive contains an unsafe path or file type")]
    UnsafeEntry,
    #[error("The archive contains inconsistent Workspace metadata")]
    InvalidMetadata,
    #[error("Import staging storage is unavailable")]
    Storage,
}

impl ImportArchiveError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidArchive => "invalid_archive",
            Self::UnsupportedSchema => "unsupported_schema",
            Self::ChecksumMismatch => "checksum_mismatch",
            Self::LimitExceeded => "archive_limit_exceeded",
            Self::UnsafeEntry => "unsafe_archive_entry",
            Self::InvalidMetadata => "invalid_metadata",
            Self::Storage => "vault_unavailable",
        }
    }
}

struct EntryMetadata {
    index: usize,
    path: String,
    size: u64,
}

pub(super) fn extract_and_validate(
    upload: &Path,
    staging_vault: &Path,
) -> Result<ValidatedImport, ImportArchiveError> {
    let source = std::fs::File::open(upload).map_err(|_| ImportArchiveError::Storage)?;
    let mut archive = ZipArchive::new(source).map_err(|_| ImportArchiveError::InvalidArchive)?;
    if archive.is_empty() || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(ImportArchiveError::LimitExceeded);
    }

    let mut normalized = HashSet::new();
    let mut entries = Vec::with_capacity(archive.len());
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| ImportArchiveError::InvalidArchive)?;
        if entry.is_dir() {
            return Err(ImportArchiveError::UnsafeEntry);
        }
        let path = validate_path(entry.name())?;
        if !normalized.insert(path.to_lowercase()) {
            return Err(ImportArchiveError::UnsafeEntry);
        }
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 {
                return Err(ImportArchiveError::UnsafeEntry);
            }
        }
        if entry.size() > MAX_ARCHIVE_FILE_BYTES {
            return Err(ImportArchiveError::LimitExceeded);
        }
        if entry.size()
            > entry
                .compressed_size()
                .saturating_mul(MAX_COMPRESSION_RATIO)
                + 1024 * 1024
        {
            return Err(ImportArchiveError::LimitExceeded);
        }
        total_size = total_size
            .checked_add(entry.size())
            .filter(|size| *size <= MAX_ARCHIVE_TOTAL_BYTES)
            .ok_or(ImportArchiveError::LimitExceeded)?;
        entries.push(EntryMetadata {
            index,
            path,
            size: entry.size(),
        });
    }

    let manifest_entry = entries
        .iter()
        .find(|entry| entry.path == ".kanleaf/manifest.json")
        .ok_or(ImportArchiveError::InvalidArchive)?;
    let manifest_source = read_zip_entry(&mut archive, manifest_entry.index)?;
    let manifest: ImportManifest =
        serde_json::from_slice(&manifest_source).map_err(|_| ImportArchiveError::InvalidArchive)?;
    validate_manifest_shape(&manifest)?;
    let inventory = manifest_inventory(&manifest)?;
    if entries.len() != inventory.len() + 1 {
        return Err(ImportArchiveError::InvalidArchive);
    }

    for metadata in entries {
        if metadata.path == ".kanleaf/manifest.json" {
            write_extracted(staging_vault, &metadata.path, &manifest_source)?;
            continue;
        }
        let expected = inventory
            .get(&metadata.path)
            .ok_or(ImportArchiveError::InvalidArchive)?;
        if metadata.size != expected.size {
            return Err(ImportArchiveError::ChecksumMismatch);
        }
        let content = read_zip_entry(&mut archive, metadata.index)?;
        if sha256(&content) != expected.sha256 {
            return Err(ImportArchiveError::ChecksumMismatch);
        }
        write_extracted(staging_vault, &metadata.path, &content)?;
    }
    validate_staging(staging_vault)
}

pub(super) fn validate_staging(
    staging_vault: &Path,
) -> Result<ValidatedImport, ImportArchiveError> {
    let mut manifest: ImportManifest = load_json(staging_vault, ".kanleaf/manifest.json")?;
    validate_manifest_shape(&manifest)?;
    normalize_document_numbers(&mut manifest.source)?;
    let inventory = manifest_inventory(&manifest)?;
    for expected in inventory.values() {
        let path = staging_vault.join(&expected.path);
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| ImportArchiveError::ChecksumMismatch)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() != expected.size
            || file_sha256(&path)? != expected.sha256
        {
            return Err(ImportArchiveError::ChecksumMismatch);
        }
    }

    let workspace_source: serde_json::Value = load_json(staging_vault, ".kanleaf/workspace.json")?;
    let task_config_source: serde_json::Value =
        load_json(staging_vault, ".kanleaf/task-config.json")?;
    let mut views: ViewsConfig = load_json(staging_vault, ".kanleaf/views.json")?;
    let workspace_version = json_format_version(&workspace_source)?;
    let task_config_version = json_format_version(&task_config_source)?;
    let (workspace, task_config, legacy_type_ids, legacy_configuration) =
        match (workspace_version, task_config_version) {
            (2, 3) => (
                serde_json::from_value(workspace_source)
                    .map_err(|_| ImportArchiveError::InvalidMetadata)?,
                serde_json::from_value(task_config_source)
                    .map_err(|_| ImportArchiveError::InvalidMetadata)?,
                None,
                false,
            ),
            (1, 2) => {
                let legacy_workspace: LegacyWorkspaceConfigV1 =
                    serde_json::from_value(workspace_source)
                        .map_err(|_| ImportArchiveError::InvalidMetadata)?;
                let legacy_task_config: LegacyTaskConfigV2 =
                    serde_json::from_value(task_config_source)
                        .map_err(|_| ImportArchiveError::InvalidMetadata)?;
                normalize_legacy_views(&mut views, &legacy_task_config)?;
                let (workspace, task_config, active_type_ids) =
                    normalize_legacy_configuration(legacy_workspace, legacy_task_config)?;
                (workspace, task_config, Some(active_type_ids), true)
            }
            _ => return Err(ImportArchiveError::UnsupportedSchema),
        };
    if views.format_version != 1
        || workspace.workspace_id != manifest.source.workspace_id
        || ResourceName::new(&workspace.name).is_err()
        || !matches!(
            workspace.accent.as_str(),
            "sage" | "blue" | "amber" | "rose" | "violet" | "slate"
        )
    {
        return Err(ImportArchiveError::UnsupportedSchema);
    }
    validate_task_config(&workspace, &task_config)?;

    let project_identities = manifest
        .source
        .projects
        .iter()
        .map(|project| (project.id, project))
        .collect::<HashMap<_, _>>();
    if project_identities.len() != manifest.source.projects.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    unique_storage_names(
        manifest
            .source
            .projects
            .iter()
            .map(|project| &project.storage_name),
    )?;
    let mut projects = Vec::with_capacity(project_identities.len());
    let mut project_identifiers = HashSet::new();
    for identity in &manifest.source.projects {
        let project_source: serde_json::Value = load_json(
            staging_vault,
            &format!(".kanleaf/projects/{}.json", identity.id),
        )?;
        let project = if legacy_configuration {
            let legacy: LegacyProjectConfigV2 = serde_json::from_value(project_source)
                .map_err(|_| ImportArchiveError::InvalidMetadata)?;
            validate_legacy_project_types(
                &legacy,
                legacy_type_ids
                    .as_ref()
                    .ok_or(ImportArchiveError::InvalidMetadata)?,
            )?;
            normalize_legacy_project(legacy)?
        } else {
            let current: ProjectConfig = serde_json::from_value(project_source)
                .map_err(|_| ImportArchiveError::InvalidMetadata)?;
            if current.format_version != 3 {
                return Err(ImportArchiveError::UnsupportedSchema);
            }
            current
        };
        if project.format_version != 3
            || project.id != identity.id
            || project.storage_name != identity.storage_name
            || project.archived != identity.archived
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        validate_project(&project, &task_config)?;
        if !project_identifiers.insert(project.identifier.clone()) {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        projects.push(project);
    }
    let project_map = projects
        .iter()
        .map(|project| (project.id, project))
        .collect::<HashMap<_, _>>();
    if project_map.len() != projects.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let cycle_count = projects.iter().map(|project| project.cycles.len()).sum();
    let module_count = projects.iter().map(|project| project.modules.len()).sum();
    let cycle_ids = projects
        .iter()
        .flat_map(|project| project.cycles.iter().map(|cycle| cycle.id))
        .collect::<HashSet<_>>();
    let module_ids = projects
        .iter()
        .flat_map(|project| project.modules.iter().map(|module| module.id))
        .collect::<HashSet<_>>();
    if cycle_ids.len() != cycle_count || module_ids.len() != module_count {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let task_ids = manifest
        .source
        .tasks
        .iter()
        .map(|task| task.id)
        .collect::<HashSet<_>>();
    if task_ids.len() != manifest.source.tasks.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let task_numbers = manifest
        .source
        .tasks
        .iter()
        .map(|task| task.number)
        .collect::<HashSet<_>>();
    if task_numbers.len() != manifest.source.tasks.len()
        || task_numbers.iter().any(|number| *number <= 0)
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    unique_storage_names(manifest.source.tasks.iter().map(|task| &task.storage_name))?;
    let mut tasks = HashMap::with_capacity(task_ids.len());
    let mut references = HashMap::new();
    let mut excluded_assignees = 0;
    for identity in &manifest.source.tasks {
        let (path, project) = task_path(identity, &project_map)?;
        let source = std::fs::read_to_string(staging_vault.join(path.display()))
            .map_err(|_| ImportArchiveError::InvalidMetadata)?;
        let mut properties =
            read_task_properties(&source).map_err(|_| ImportArchiveError::InvalidMetadata)?;
        let raw_custom = read_undefined_properties(&source, &[])
            .map_err(|_| ImportArchiveError::InvalidMetadata)?;
        properties.custom =
            task_config
                .properties
                .iter()
                .filter_map(|definition| {
                    let matches = raw_custom
                        .iter()
                        .filter(|value| value.name.eq_ignore_ascii_case(&definition.name))
                        .collect::<Vec<_>>();
                    match matches.as_slice() {
                        [] => None,
                        [value] => {
                            let normalized = if legacy_configuration
                                && definition.name.eq_ignore_ascii_case("Type")
                            {
                                normalize_legacy_type_value(&value.value)
                            } else {
                                Ok(value.value.clone())
                            };
                            Some(normalized.and_then(|value| {
                                validate_imported_custom_value(definition, &value)
                            }))
                        }
                        _ => Some(Err(ImportArchiveError::InvalidMetadata)),
                    }
                })
                .collect::<Result<Vec<_>, _>>()?;
        if properties.kanleaf_id != identity.id
            || TaskTitle::new(&properties.title).is_err()
            || !reference_matches(&properties.reference, identity, project)
            || properties.project.as_deref() != project.map(|project| project.name.as_str())
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        validate_task_properties(&properties, project, &task_config)?;
        if references
            .insert(properties.reference.clone(), identity.id)
            .is_some()
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        excluded_assignees += properties.assignees.len();
        tasks.insert(
            identity.id,
            ValidatedTask {
                identity: identity.clone(),
                properties,
                path,
                cleanup_property_names: if legacy_configuration {
                    vec!["Type".to_owned()]
                } else {
                    Vec::new()
                },
            },
        );
    }
    validate_task_hierarchy(&tasks, &references)?;
    validate_relations(&manifest.relations, &task_ids)?;

    let document_ids = manifest
        .source
        .documents
        .iter()
        .map(|document| document.id)
        .collect::<HashSet<_>>();
    if document_ids.len() != manifest.source.documents.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let document_numbers = manifest
        .source
        .documents
        .iter()
        .filter_map(|document| document.number)
        .collect::<HashSet<_>>();
    if document_numbers.len() != manifest.source.documents.len()
        || document_numbers.iter().any(|number| *number <= 0)
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let document_paths = document_paths(&manifest.source.documents, &project_map)?;
    let mut expected_payloads = HashSet::new();
    expected_payloads.extend(tasks.values().map(|task| task.path.display()));
    expected_payloads.extend(document_paths.values().cloned());
    expected_payloads.extend([
        ".kanleaf/workspace.json".to_owned(),
        ".kanleaf/task-config.json".to_owned(),
        ".kanleaf/views.json".to_owned(),
    ]);
    expected_payloads.extend(
        projects
            .iter()
            .map(|project| format!(".kanleaf/projects/{}.json", project.id)),
    );
    let inventory_paths = inventory.keys().cloned().collect::<HashSet<_>>();
    if expected_payloads != inventory_paths {
        return Err(ImportArchiveError::InvalidMetadata);
    }

    unique_ids(views.views.iter().map(|view| view.id))?;
    let state_ids = task_config
        .states
        .iter()
        .map(|state| state.id)
        .collect::<HashSet<_>>();
    let label_ids = task_config
        .labels
        .iter()
        .map(|label| label.id)
        .collect::<HashSet<_>>();
    let project_ids = project_identities.keys().copied().collect::<HashSet<_>>();
    let cycle_projects = projects
        .iter()
        .flat_map(|project| {
            project
                .cycles
                .iter()
                .map(move |cycle| (cycle.id, project.id))
        })
        .collect::<HashMap<_, _>>();
    let module_projects = projects
        .iter()
        .flat_map(|project| {
            project
                .modules
                .iter()
                .map(move |module| (module.id, project.id))
        })
        .collect::<HashMap<_, _>>();
    let mut view_names = HashSet::new();
    for view in &views.views {
        let query = serde_json::from_value::<TaskQuery>(view.query.clone())
            .map_err(|_| ImportArchiveError::InvalidMetadata)?
            .validate()
            .map_err(|_| ImportArchiveError::InvalidMetadata)?;
        if view.query_version != 2
            || ResourceName::new(&view.name).is_err()
            || !matches!(
                view.layout.as_str(),
                "list" | "board" | "calendar" | "table" | "timeline"
            )
            || view
                .project_id
                .is_some_and(|id| !project_map.contains_key(&id))
            || !view_names.insert((view.project_id, view.name.trim().to_lowercase()))
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        validate_view_query(
            &query,
            view.project_id,
            &state_ids,
            &label_ids,
            &project_ids,
            &cycle_projects,
            &module_projects,
        )?;
    }
    let summary = ImportSummary {
        workspace_name: workspace.name.clone(),
        projects: projects.len(),
        tasks: tasks.len(),
        documents: manifest.source.documents.len(),
        states: task_config.states.len(),
        labels: task_config.labels.len(),
        shared_views: views.views.len(),
        cycles: cycle_count,
        modules: module_count,
        excluded_member_references: workspace.members.len()
            + projects
                .iter()
                .map(|project| project.members.len())
                .sum::<usize>(),
        excluded_assignee_references: excluded_assignees,
        history_included: false,
    };
    Ok(ValidatedImport {
        manifest,
        workspace,
        task_config,
        views,
        projects,
        tasks,
        summary,
    })
}

fn validate_manifest_shape(manifest: &ImportManifest) -> Result<(), ImportArchiveError> {
    if manifest.format_version != 1
        || !matches!(manifest.source.format_version, 1 | 2)
        || manifest.source.layout_version != 2
    {
        return Err(ImportArchiveError::UnsupportedSchema);
    }
    if !(manifest.omitted.authentication
        && manifest.omitted.invitations
        && manifest.omitted.account_preferences
        && manifest.omitted.notifications
        && manifest.omitted.comments_and_activity)
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let _ = manifest.exported_at;
    for exclusion in &manifest.exclusions {
        if exclusion.path.is_empty() || exclusion.reason.is_empty() {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    let inventory = manifest_inventory(manifest)?;
    let expected_config = manifest
        .source
        .config_files
        .iter()
        .map(|file| (file.path.as_str(), (file.size, file.sha256.as_str())))
        .collect::<HashMap<_, _>>();
    let mut required_config = HashSet::from([
        ".kanleaf/workspace.json".to_owned(),
        ".kanleaf/task-config.json".to_owned(),
        ".kanleaf/views.json".to_owned(),
    ]);
    required_config.extend(
        manifest
            .source
            .projects
            .iter()
            .map(|project| format!(".kanleaf/projects/{}.json", project.id)),
    );
    if expected_config.len() != manifest.source.config_files.len()
        || expected_config.keys().copied().collect::<HashSet<_>>()
            != required_config.iter().map(String::as_str).collect()
        || expected_config.iter().any(|(path, (size, checksum))| {
            inventory
                .get(*path)
                .is_none_or(|file| file.size != *size || file.sha256 != *checksum)
        })
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(())
}

fn normalize_document_numbers(manifest: &mut LiveManifest) -> Result<(), ImportArchiveError> {
    match manifest.format_version {
        1 => {
            let mut ordered_ids = manifest
                .documents
                .iter()
                .map(|document| document.id)
                .collect::<Vec<_>>();
            ordered_ids.sort_unstable();
            let numbers = ordered_ids
                .into_iter()
                .enumerate()
                .map(|(index, id)| (id, index as i64 + 1))
                .collect::<HashMap<_, _>>();
            for document in &mut manifest.documents {
                document.number = numbers.get(&document.id).copied();
            }
            manifest.format_version = 2;
            Ok(())
        }
        2 => Ok(()),
        _ => Err(ImportArchiveError::UnsupportedSchema),
    }
}

fn manifest_inventory(
    manifest: &ImportManifest,
) -> Result<HashMap<String, ManifestFile>, ImportArchiveError> {
    if manifest.files.is_empty() || manifest.files.len() + 1 > MAX_ARCHIVE_ENTRIES {
        return Err(ImportArchiveError::InvalidArchive);
    }
    let mut inventory = HashMap::with_capacity(manifest.files.len());
    let mut normalized = HashSet::new();
    let mut total = 0_u64;
    for file in &manifest.files {
        let path = validate_path(&file.path)?;
        if path == ".kanleaf/manifest.json"
            || !is_managed_payload(&path)
            || !normalized.insert(path.to_lowercase())
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || file.size > MAX_ARCHIVE_FILE_BYTES
            || file.media_type != media_type(&path)
        {
            return Err(ImportArchiveError::InvalidArchive);
        }
        total = total
            .checked_add(file.size)
            .filter(|size| *size <= MAX_ARCHIVE_TOTAL_BYTES)
            .ok_or(ImportArchiveError::LimitExceeded)?;
        inventory.insert(path, file.clone());
    }
    Ok(inventory)
}

fn json_format_version(value: &serde_json::Value) -> Result<u16, ImportArchiveError> {
    value
        .get("format_version")
        .and_then(serde_json::Value::as_u64)
        .and_then(|version| u16::try_from(version).ok())
        .ok_or(ImportArchiveError::InvalidMetadata)
}

fn normalize_legacy_views(
    views: &mut ViewsConfig,
    task_config: &LegacyTaskConfigV2,
) -> Result<(), ImportArchiveError> {
    for view in &mut views.views {
        if view.query_version == 2 {
            continue;
        }
        if view.query_version != 1 {
            return Err(ImportArchiveError::UnsupportedSchema);
        }
        let query = view
            .query
            .as_object_mut()
            .ok_or(ImportArchiveError::InvalidMetadata)?;
        if query.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        let filters = query
            .entry("filters")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or(ImportArchiveError::InvalidMetadata)?;
        let mut state_ids = filters
            .get("states")
            .and_then(|states| states.get("values"))
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .map(|value| {
                value
                    .as_str()
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or(ImportArchiveError::InvalidMetadata)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let groups = filters
            .remove("state_groups")
            .map(|groups| {
                groups
                    .as_array()
                    .ok_or(ImportArchiveError::InvalidMetadata)?
                    .iter()
                    .map(|group| {
                        group
                            .as_str()
                            .map(str::to_owned)
                            .ok_or(ImportArchiveError::InvalidMetadata)
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        for state in &task_config.states {
            if groups.iter().any(|group| group == &state.group) {
                state_ids.push(state.id);
            }
        }
        state_ids.sort_unstable();
        state_ids.dedup();
        filters.remove("task_types");
        filters.insert(
            "states".to_owned(),
            serde_json::json!({"values": state_ids, "include_none": false}),
        );

        let grouping = query
            .entry("grouping")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or(ImportArchiveError::InvalidMetadata)?;
        let primary = normalize_legacy_grouping(grouping.get("primary"))?;
        let secondary = normalize_legacy_grouping(grouping.get("secondary"))?;
        let normalized_primary = primary.clone().or_else(|| secondary.clone());
        let normalized_secondary = if primary.is_some() && secondary != primary {
            secondary
        } else {
            None
        };
        grouping.insert(
            "primary".to_owned(),
            normalized_primary
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        grouping.insert(
            "secondary".to_owned(),
            normalized_secondary
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );

        let mut display = Vec::new();
        for value in query
            .get("display")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let value = value.as_str().ok_or(ImportArchiveError::InvalidMetadata)?;
            let Some(mapped) = normalize_legacy_query_field(value) else {
                continue;
            };
            if !display.iter().any(|existing| existing == mapped) {
                display.push(mapped.to_owned());
            }
        }
        query.insert("display".to_owned(), serde_json::json!(display));
        query.insert("version".to_owned(), serde_json::json!(2));
        view.query_version = 2;
    }
    Ok(())
}

fn normalize_legacy_grouping(
    value: Option<&serde_json::Value>,
) -> Result<Option<String>, ImportArchiveError> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .ok_or(ImportArchiveError::InvalidMetadata)
            .map(normalize_legacy_query_field)
            .map(|value| value.map(str::to_owned)),
    }
}

fn normalize_legacy_query_field(value: &str) -> Option<&str> {
    match value {
        "task_type" => None,
        "state_group" => Some("state"),
        value => Some(value),
    }
}

fn normalize_legacy_configuration(
    workspace: LegacyWorkspaceConfigV1,
    mut legacy: LegacyTaskConfigV2,
) -> Result<(WorkspaceConfig, TaskConfig, HashSet<Uuid>), ImportArchiveError> {
    if workspace.format_version != 1 || legacy.format_version != 2 {
        return Err(ImportArchiveError::UnsupportedSchema);
    }
    unique_ids(legacy.states.iter().map(|state| state.id))?;
    unique_ids(legacy.types.iter().map(|task_type| task_type.id))?;
    unique_ids(legacy.labels.iter().map(|label| label.id))?;
    unique_active_names(
        legacy
            .states
            .iter()
            .filter(|state| !state.archived)
            .map(|state| &state.name),
    )?;
    unique_active_names(
        legacy
            .types
            .iter()
            .filter(|task_type| !task_type.archived)
            .map(|task_type| &task_type.name),
    )?;
    unique_active_names(
        legacy
            .labels
            .iter()
            .filter(|label| !label.archived)
            .map(|label| &label.name),
    )?;
    let active_state_ids = legacy
        .states
        .iter()
        .filter(|state| !state.archived)
        .map(|state| state.id)
        .collect::<HashSet<_>>();
    let active_type_ids = legacy
        .types
        .iter()
        .filter(|task_type| !task_type.archived)
        .map(|task_type| task_type.id)
        .collect::<HashSet<_>>();
    if !active_state_ids.contains(&workspace.default_state_id)
        || !active_type_ids.contains(&workspace.default_task_type_id)
        || active_state_ids.is_empty()
        || active_type_ids.is_empty()
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let mut active_state_positions = HashSet::new();
    for state in &legacy.states {
        if ResourceName::new(&state.name).is_err()
            || HexColor::new(&state.color).is_err()
            || !matches!(
                state.group.as_str(),
                "backlog" | "todo" | "in_progress" | "done" | "canceled"
            )
            || state.position < 0
            || (!state.archived && !active_state_positions.insert(state.position))
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    let mut active_type_positions = HashSet::new();
    let mut protected_types = 0;
    for task_type in &legacy.types {
        if ResourceName::new(&task_type.name).is_err()
            || SelectOptionIcon::new_supported(&task_type.icon).is_err()
            || HexColor::new(&task_type.color).is_err()
            || ConfigurationDescription::new(&task_type.description).is_err()
            || task_type.position < 0
            || (task_type.protected && task_type.archived)
            || (!task_type.archived && !active_type_positions.insert(task_type.position))
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        protected_types += usize::from(task_type.protected);
    }
    if protected_types > 1 {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    for label in &legacy.labels {
        if ResourceName::new(&label.name).is_err()
            || HexColor::new(&label.color).is_err()
            || ConfigurationDescription::new(&label.description).is_err()
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    if legacy
        .properties
        .iter()
        .any(|property| property.name.eq_ignore_ascii_case("Type"))
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }

    let mut states = legacy
        .states
        .iter()
        .map(|state| TaskStateConfig {
            id: state.id,
            name: state.name.clone(),
            icon: Some(legacy_state_icon(&state.group).to_owned()),
            color: state.color.clone(),
            description: String::new(),
            system_role: None,
            position: state.position,
            archived: state.archived,
        })
        .collect::<Vec<_>>();
    let mut next_position = states
        .iter()
        .map(|state| state.position)
        .max()
        .unwrap_or(-1)
        + 1;
    for (role, canonical_name, icon, color) in [
        ("todo", "Todo", "circle", "#64748B"),
        ("in_progress", "In Progress", "loader-circle", "#3B82F6"),
        ("done", "Done", "circle-check", "#22A06B"),
    ] {
        let candidate = legacy
            .states
            .iter()
            .enumerate()
            .filter(|(_, state)| !state.archived && state.group == role)
            .min_by_key(|(_, state)| {
                (
                    !state.name.eq_ignore_ascii_case(canonical_name),
                    state.position,
                    state.id,
                )
            })
            .map(|(index, _)| index);
        let core_index = candidate.unwrap_or_else(|| {
            states.push(TaskStateConfig {
                id: legacy_core_state_id(workspace.workspace_id, role),
                name: canonical_name.to_owned(),
                icon: Some(icon.to_owned()),
                color: color.to_owned(),
                description: String::new(),
                system_role: None,
                position: next_position,
                archived: false,
            });
            next_position += 1;
            states.len() - 1
        });
        for (index, state) in states.iter_mut().enumerate() {
            if index != core_index
                && !state.archived
                && state.name.eq_ignore_ascii_case(canonical_name)
            {
                state.name = legacy_suffixed_name(&state.name, "legacy", state.id);
            }
        }
        let core = &mut states[core_index];
        core.name = canonical_name.to_owned();
        core.icon = Some(icon.to_owned());
        core.color = color.to_owned();
        core.system_role = Some(role.to_owned());
        core.archived = false;
    }

    legacy
        .labels
        .sort_by_key(|label| (label.name.to_lowercase(), label.id));
    let labels = legacy
        .labels
        .into_iter()
        .enumerate()
        .map(|(position, label)| TaskLabelConfig {
            id: label.id,
            name: label.name,
            icon: None,
            color: label.color,
            description: label.description,
            position: position as i32,
            archived: label.archived,
        })
        .collect();
    let mut properties = legacy
        .properties
        .into_iter()
        .map(|property| CustomPropertyConfig {
            id: property.id,
            name: property.name,
            property_type: property.property_type,
            description: property.description,
            position: property.position,
            configuration: property.configuration,
            default_option_id: None,
            archived: property.archived,
            options: property
                .options
                .into_iter()
                .map(|option| CustomPropertyOptionConfig {
                    id: option.id,
                    property_id: option.property_id,
                    name: option.name,
                    icon: None,
                    color: option.color,
                    description: String::new(),
                    position: option.position,
                    archived: option.archived,
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    let meaningful_types = legacy
        .types
        .iter()
        .any(|task_type| !(task_type.protected && task_type.name == "Task" && !task_type.archived));
    if meaningful_types {
        legacy
            .types
            .sort_by_key(|task_type| (task_type.position, task_type.id));
        let options = legacy
            .types
            .iter()
            .map(|task_type| {
                let mut duplicates = legacy
                    .types
                    .iter()
                    .filter(|candidate| candidate.name.eq_ignore_ascii_case(&task_type.name))
                    .collect::<Vec<_>>();
                duplicates.sort_by_key(|candidate| {
                    (candidate.archived, candidate.position, candidate.id)
                });
                let ordinal = duplicates
                    .iter()
                    .position(|candidate| candidate.id == task_type.id)
                    .unwrap_or_default();
                CustomPropertyOptionConfig {
                    id: task_type.id,
                    property_id: workspace.default_task_type_id,
                    name: if ordinal == 0 {
                        task_type.name.clone()
                    } else {
                        legacy_suffixed_name(&task_type.name, "archived", task_type.id)
                    },
                    icon: Some(task_type.icon.clone()),
                    color: task_type.color.clone(),
                    description: task_type.description.clone(),
                    position: task_type.position,
                    archived: task_type.archived,
                }
            })
            .collect();
        let position = properties
            .iter()
            .filter(|property| !property.archived)
            .map(|property| property.position)
            .max()
            .unwrap_or(-1)
            + 1;
        properties.push(CustomPropertyConfig {
            id: workspace.default_task_type_id,
            name: "Type".to_owned(),
            property_type: "single_select".to_owned(),
            description: "The kind of work this task represents.".to_owned(),
            position,
            configuration: serde_json::json!({}),
            default_option_id: Some(workspace.default_task_type_id),
            archived: false,
            options,
        });
    }

    Ok((
        WorkspaceConfig {
            format_version: 2,
            workspace_id: workspace.workspace_id,
            name: workspace.name,
            accent: workspace.accent,
            default_state_id: workspace.default_state_id,
            state_property_description: "The current step of work.".to_owned(),
            label_property_description: "Shared tags used to organize work.".to_owned(),
            members: workspace.members,
        },
        TaskConfig {
            format_version: 3,
            states,
            labels,
            properties,
        },
        active_type_ids,
    ))
}

fn legacy_state_icon(group: &str) -> &'static str {
    match group {
        "backlog" => "circle-dashed",
        "todo" => "circle",
        "in_progress" => "loader-circle",
        "done" => "circle-check",
        "canceled" => "circle-x",
        _ => unreachable!("legacy State groups are validated before normalization"),
    }
}

fn legacy_core_state_id(workspace_id: Uuid, role: &str) -> Uuid {
    let mut digest = Sha256::new();
    digest.update(workspace_id.as_bytes());
    digest.update(b":core-state:");
    digest.update(role.as_bytes());
    let digest = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn legacy_suffixed_name(name: &str, kind: &str, id: Uuid) -> String {
    let suffix = format!(" ({kind} {})", &id.simple().to_string()[..8]);
    let prefix = name
        .chars()
        .take(120 - suffix.chars().count())
        .collect::<String>();
    format!("{prefix}{suffix}")
}

fn validate_legacy_project_types(
    project: &LegacyProjectConfigV2,
    active_type_ids: &HashSet<Uuid>,
) -> Result<(), ImportArchiveError> {
    if project.format_version != 2
        || !active_type_ids.contains(&project.default_task_type_id)
        || !project
            .enabled_task_type_ids
            .contains(&project.default_task_type_id)
        || project
            .enabled_task_type_ids
            .iter()
            .any(|id| !active_type_ids.contains(id))
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    unique_ids(project.enabled_task_type_ids.iter().copied())?;
    Ok(())
}

fn normalize_legacy_project(
    project: LegacyProjectConfigV2,
) -> Result<ProjectConfig, ImportArchiveError> {
    Ok(ProjectConfig {
        format_version: 3,
        id: project.id,
        name: project.name,
        storage_name: project.storage_name,
        identifier: project.identifier,
        description: project.description,
        icon: project.icon,
        visibility: project.visibility,
        lead_email: project.lead_email,
        default_assignee_email: project.default_assignee_email,
        default_state_id: project.default_state_id,
        features: project.features,
        members: project.members,
        cycles: project.cycles,
        modules: project.modules,
        archived: project.archived,
        legacy_identifier: None,
    })
}

fn normalize_legacy_type_value(
    value: &serde_json::Value,
) -> Result<serde_json::Value, ImportArchiveError> {
    let values = value
        .as_array()
        .filter(|values| values.len() == 1)
        .ok_or(ImportArchiveError::InvalidMetadata)?;
    values[0]
        .as_str()
        .map(|value| serde_json::Value::String(value.to_owned()))
        .ok_or(ImportArchiveError::InvalidMetadata)
}

fn validate_task_config(
    workspace: &WorkspaceConfig,
    config: &TaskConfig,
) -> Result<(), ImportArchiveError> {
    unique_ids(config.states.iter().map(|state| state.id))?;
    let active_state_ids = config
        .states
        .iter()
        .filter(|state| !state.archived)
        .map(|state| state.id)
        .collect::<HashSet<_>>();
    unique_ids(config.labels.iter().map(|label| label.id))?;
    unique_active_names(
        config
            .states
            .iter()
            .filter(|state| !state.archived)
            .map(|state| &state.name),
    )?;
    unique_active_names(
        config
            .labels
            .iter()
            .filter(|label| !label.archived)
            .map(|label| &label.name),
    )?;
    if !active_state_ids.contains(&workspace.default_state_id)
        || active_state_ids.is_empty()
        || ConfigurationDescription::new(&workspace.state_property_description).is_err()
        || ConfigurationDescription::new(&workspace.label_property_description).is_err()
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let mut state_positions = HashSet::new();
    let mut core_roles = HashSet::new();
    for state in &config.states {
        if ResourceName::new(&state.name).is_err()
            || state
                .icon
                .as_deref()
                .is_some_and(|icon| SelectOptionIcon::new_supported(icon).is_err())
            || HexColor::new(&state.color).is_err()
            || ConfigurationDescription::new(&state.description).is_err()
            || state.position < 0
            || (!state.archived && !state_positions.insert(state.position))
            || (state.archived && state.system_role.is_some())
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        if let Some(role) = state.system_role.as_deref() {
            let expected = match role {
                "todo" => ("Todo", "circle", "#64748B"),
                "in_progress" => ("In Progress", "loader-circle", "#3B82F6"),
                "done" => ("Done", "circle-check", "#22A06B"),
                _ => return Err(ImportArchiveError::InvalidMetadata),
            };
            if state.archived
                || !core_roles.insert(role)
                || state.name != expected.0
                || state.icon.as_deref() != Some(expected.1)
                || state.color != expected.2
            {
                return Err(ImportArchiveError::InvalidMetadata);
            }
        }
    }
    if core_roles != HashSet::from(["todo", "in_progress", "done"]) {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let mut label_positions = HashSet::new();
    for label in &config.labels {
        if ResourceName::new(&label.name).is_err()
            || label
                .icon
                .as_deref()
                .is_some_and(|icon| SelectOptionIcon::new_supported(icon).is_err())
            || HexColor::new(&label.color).is_err()
            || ConfigurationDescription::new(&label.description).is_err()
            || label.position < 0
            || (!label.archived && !label_positions.insert(label.position))
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    unique_ids(config.properties.iter().map(|property| property.id))?;
    let mut property_names = HashSet::new();
    let mut property_positions = HashSet::new();
    let mut option_ids = HashSet::new();
    for property in &config.properties {
        if ResourceName::new(&property.name).is_err()
            || is_reserved_property_name(&property.name)
            || !property_names.insert(property.name.trim().to_lowercase())
            || ConfigurationDescription::new(&property.description).is_err()
            || !property
                .configuration
                .as_object()
                .is_some_and(|value| value.is_empty())
            || property.position < 0
            || (!property.archived && !property_positions.insert(property.position))
            || !matches!(
                property.property_type.as_str(),
                "text" | "number" | "date" | "single_select" | "multi_select" | "checkbox" | "url"
            )
            || (!matches!(
                property.property_type.as_str(),
                "single_select" | "multi_select"
            ) && !property.options.is_empty())
            || property.default_option_id.is_some_and(|default_id| {
                property.property_type != "single_select"
                    || !property
                        .options
                        .iter()
                        .any(|option| option.id == default_id && !option.archived)
            })
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        let mut names = HashSet::new();
        let mut positions = HashSet::new();
        for option in &property.options {
            if option.property_id != property.id
                || !option_ids.insert(option.id)
                || ResourceName::new(&option.name).is_err()
                || !names.insert(option.name.trim().to_lowercase())
                || option
                    .icon
                    .as_deref()
                    .is_some_and(|icon| SelectOptionIcon::new_supported(icon).is_err())
                || HexColor::new(&option.color).is_err()
                || ConfigurationDescription::new(&option.description).is_err()
                || option.position < 0
                || (!option.archived && !positions.insert(option.position))
            {
                return Err(ImportArchiveError::InvalidMetadata);
            }
        }
    }
    Ok(())
}

fn validate_imported_custom_value(
    definition: &super::config::CustomPropertyConfig,
    raw: &serde_json::Value,
) -> Result<CustomProperty, ImportArchiveError> {
    let property_type = PropertyType::parse(&definition.property_type)
        .map_err(|_| ImportArchiveError::InvalidMetadata)?;
    let value = match property_type {
        PropertyType::Text
        | PropertyType::Number
        | PropertyType::Date
        | PropertyType::Checkbox
        | PropertyType::Url => raw.clone(),
        PropertyType::SingleSelect => raw
            .as_str()
            .and_then(|name| {
                definition
                    .options
                    .iter()
                    .find(|option| option.name == name)
                    .map(|option| serde_json::Value::String(option.id.to_string()))
            })
            .ok_or(ImportArchiveError::InvalidMetadata)?,
        PropertyType::MultiSelect => {
            let names = raw.as_array().ok_or(ImportArchiveError::InvalidMetadata)?;
            serde_json::Value::Array(
                names
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .and_then(|name| {
                                definition
                                    .options
                                    .iter()
                                    .find(|option| option.name == name)
                                    .map(|option| serde_json::Value::String(option.id.to_string()))
                            })
                            .ok_or(ImportArchiveError::InvalidMetadata)
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };
    validate_value_shape(property_type, value).map_err(|_| ImportArchiveError::InvalidMetadata)?;
    Ok(CustomProperty {
        name: definition.name.clone(),
        property_type: definition.property_type.clone(),
        value: raw.clone(),
    })
}

fn validate_project(
    project: &ProjectConfig,
    task_config: &TaskConfig,
) -> Result<(), ImportArchiveError> {
    let states = task_config
        .states
        .iter()
        .filter(|state| !state.archived)
        .map(|state| state.id)
        .collect::<HashSet<_>>();
    if !states.contains(&project.default_state_id) {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let identifier = ProjectIdentifier::new(&project.identifier)
        .map_err(|_| ImportArchiveError::InvalidMetadata)?;
    if ResourceName::new(&project.name).is_err()
        || VaultStorageName::parse(&project.storage_name).is_err()
        || identifier.as_str() != project.identifier
        || ProjectDescription::new(&project.description).is_err()
        || ProjectIcon::new(&project.icon).is_err()
        || !matches!(project.visibility.as_str(), "private" | "public")
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    unique_ids(project.cycles.iter().map(|cycle| cycle.id))?;
    unique_ids(project.modules.iter().map(|module| module.id))?;
    unique_active_names(
        project
            .cycles
            .iter()
            .filter(|cycle| !cycle.archived)
            .map(|cycle| &cycle.name),
    )?;
    unique_active_names(
        project
            .modules
            .iter()
            .filter(|module| !module.archived)
            .map(|module| &module.name),
    )?;
    for cycle in &project.cycles {
        if ResourceName::new(&cycle.name).is_err()
            || ProjectDescription::new(&cycle.description).is_err()
            || cycle.start_date > cycle.due_date
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    let mut active_cycles = project
        .cycles
        .iter()
        .filter(|cycle| !cycle.archived)
        .collect::<Vec<_>>();
    active_cycles.sort_by_key(|cycle| cycle.start_date);
    if active_cycles
        .windows(2)
        .any(|pair| pair[1].start_date <= pair[0].due_date)
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    for module in &project.modules {
        if ResourceName::new(&module.name).is_err()
            || ProjectDescription::new(&module.description).is_err()
            || !matches!(
                module.status.as_str(),
                "backlog" | "planned" | "in_progress" | "paused" | "completed" | "canceled"
            )
            || module
                .start_date
                .zip(module.due_date)
                .is_some_and(|(start, due)| start > due)
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    Ok(())
}

fn validate_task_properties(
    properties: &TaskProperties,
    project: Option<&ProjectConfig>,
    config: &TaskConfig,
) -> Result<(), ImportArchiveError> {
    if properties.estimate.is_some_and(|estimate| estimate < 0)
        || properties
            .start_date
            .zip(properties.due_date)
            .is_some_and(|(start, due)| start > due)
        || !matches!(
            properties
                .priority
                .as_deref()
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .as_deref(),
            None | Some("none" | "low" | "medium" | "high" | "critical" | "urgent")
        )
        || has_duplicate_names(&properties.labels)
        || has_duplicate_names(&properties.modules)
        || has_duplicate_names(&properties.assignees)
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    config
        .states
        .iter()
        .find(|state| !state.archived && name_eq(&state.name, &properties.state))
        .ok_or(ImportArchiveError::InvalidMetadata)?;
    if let Some(project) = project {
        match properties.cycle.as_deref() {
            Some(name)
                if !project
                    .cycles
                    .iter()
                    .any(|cycle| !cycle.archived && name_eq(&cycle.name, name)) =>
            {
                return Err(ImportArchiveError::InvalidMetadata);
            }
            _ => {}
        }
        if properties.modules.iter().any(|name| {
            !project
                .modules
                .iter()
                .any(|module| !module.archived && name_eq(&module.name, name))
        }) {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    } else if properties.cycle.is_some() || !properties.modules.is_empty() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    if properties.labels.iter().any(|name| {
        !config
            .labels
            .iter()
            .any(|label| !label.archived && name_eq(&label.name, name))
    }) {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(())
}

fn task_path<'a>(
    task: &TaskIdentity,
    projects: &'a HashMap<Uuid, &ProjectConfig>,
) -> Result<(TaskPath, Option<&'a ProjectConfig>), ImportArchiveError> {
    let project = task
        .project_id
        .map(|project_id| {
            projects
                .get(&project_id)
                .copied()
                .ok_or(ImportArchiveError::InvalidMetadata)
        })
        .transpose()?;
    let path = TaskPath::parse(
        project.map(|project| project.storage_name.as_str()),
        &task.storage_name,
    )
    .map_err(|_| ImportArchiveError::InvalidMetadata)?;
    Ok((path, project))
}

fn reference_matches(
    reference: &str,
    task: &TaskIdentity,
    project: Option<&ProjectConfig>,
) -> bool {
    reference == format!("#{}", task.number)
        || project
            .and_then(|project| project.legacy_identifier.as_deref())
            .is_some_and(|identifier| reference == format!("{identifier}-{}", task.number))
}

fn document_paths(
    documents: &[DocumentIdentity],
    projects: &HashMap<Uuid, &ProjectConfig>,
) -> Result<HashMap<Uuid, String>, ImportArchiveError> {
    let by_id = documents
        .iter()
        .map(|document| (document.id, document))
        .collect::<HashMap<_, _>>();
    if by_id.len() != documents.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    let mut paths = HashMap::with_capacity(documents.len());
    let mut siblings = HashSet::new();
    for document in documents {
        if DocumentTitle::new(&document.title).is_err()
            || LibraryStorageName::parse(&document.storage_name).is_err()
            || document.position < 0
            || !siblings.insert((
                document.project_id,
                document.parent_id,
                document.storage_name.clone(),
            ))
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
        let mut current = document;
        let mut segments = vec![document.storage_name.as_str()];
        let mut visited = HashSet::from([document.id]);
        while let Some(parent_id) = current.parent_id {
            let parent = by_id
                .get(&parent_id)
                .copied()
                .ok_or(ImportArchiveError::InvalidMetadata)?;
            if parent.project_id != document.project_id || !visited.insert(parent.id) {
                return Err(ImportArchiveError::InvalidMetadata);
            }
            segments.push(parent.storage_name.as_str());
            current = parent;
        }
        segments.reverse();
        let relative = match document.project_id {
            Some(project_id) => {
                let project = projects
                    .get(&project_id)
                    .ok_or(ImportArchiveError::InvalidMetadata)?;
                format!(
                    "Projects/{}/Wiki/{}.md",
                    project.storage_name,
                    segments.join("/")
                )
            }
            None => format!("Wiki/{}.md", segments.join("/")),
        };
        validate_path(&relative)?;
        paths.insert(document.id, relative);
    }
    Ok(paths)
}

fn validate_relations(
    relations: &[ManifestRelation],
    task_ids: &HashSet<Uuid>,
) -> Result<(), ImportArchiveError> {
    let mut pairs = HashSet::new();
    for relation in relations {
        if relation.task_a_id >= relation.task_b_id
            || !task_ids.contains(&relation.task_a_id)
            || !task_ids.contains(&relation.task_b_id)
            || !pairs.insert((relation.task_a_id, relation.task_b_id))
            || !matches!(
                relation.relation_type.as_str(),
                "blocks" | "relates_to" | "duplicate"
            )
            || (relation.relation_type == "blocks") != relation.task_a_blocks.is_some()
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    Ok(())
}

fn validate_task_hierarchy(
    tasks: &HashMap<Uuid, ValidatedTask>,
    references: &HashMap<String, Uuid>,
) -> Result<(), ImportArchiveError> {
    for task in tasks.values() {
        let Some(parent_reference) = &task.properties.parent else {
            continue;
        };
        let parent_id = references
            .get(parent_reference)
            .copied()
            .ok_or(ImportArchiveError::InvalidMetadata)?;
        let parent = tasks
            .get(&parent_id)
            .ok_or(ImportArchiveError::InvalidMetadata)?;
        if parent.identity.archived
            || parent.identity.project_id != task.identity.project_id
            || parent_id == task.identity.id
        {
            return Err(ImportArchiveError::InvalidMetadata);
        }

        let mut current = parent;
        let mut visited = HashSet::from([task.identity.id]);
        while let Some(reference) = &current.properties.parent {
            if !visited.insert(current.identity.id) {
                return Err(ImportArchiveError::InvalidMetadata);
            }
            let id = references
                .get(reference)
                .copied()
                .ok_or(ImportArchiveError::InvalidMetadata)?;
            current = tasks.get(&id).ok_or(ImportArchiveError::InvalidMetadata)?;
        }
        if !visited.insert(current.identity.id) {
            return Err(ImportArchiveError::InvalidMetadata);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_view_query(
    query: &TaskQuery,
    view_project_id: Option<Uuid>,
    state_ids: &HashSet<Uuid>,
    label_ids: &HashSet<Uuid>,
    project_ids: &HashSet<Uuid>,
    cycle_projects: &HashMap<Uuid, Uuid>,
    module_projects: &HashMap<Uuid, Uuid>,
) -> Result<(), ImportArchiveError> {
    let scope_project_id = match query.scope {
        TaskQueryScope::Workspace | TaskQueryScope::Inbox | TaskQueryScope::MyWork => None,
        TaskQueryScope::Project { project_id } if project_ids.contains(&project_id) => {
            Some(project_id)
        }
        TaskQueryScope::Cycle { cycle_id } if cycle_projects.contains_key(&cycle_id) => {
            cycle_projects.get(&cycle_id).copied()
        }
        TaskQueryScope::Module { module_id } if module_projects.contains_key(&module_id) => {
            module_projects.get(&module_id).copied()
        }
        _ => return Err(ImportArchiveError::InvalidMetadata),
    };
    if scope_project_id != view_project_id
        || !query
            .filters
            .states
            .values
            .iter()
            .all(|id| state_ids.contains(id))
        || !query
            .filters
            .labels
            .values
            .iter()
            .all(|id| label_ids.contains(id))
        || !query
            .filters
            .projects
            .values
            .iter()
            .all(|id| project_ids.contains(id))
        || !query
            .filters
            .cycles
            .values
            .iter()
            .all(|id| cycle_projects.contains_key(id))
        || !query
            .filters
            .modules
            .values
            .iter()
            .all(|id| module_projects.contains_key(id))
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(())
}

fn unique_ids(ids: impl Iterator<Item = Uuid>) -> Result<HashSet<Uuid>, ImportArchiveError> {
    let ids = ids.collect::<Vec<_>>();
    let unique = ids.iter().copied().collect::<HashSet<_>>();
    if unique.len() != ids.len() {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(unique)
}

fn unique_active_names<'a>(
    names: impl Iterator<Item = &'a String>,
) -> Result<(), ImportArchiveError> {
    let names = names
        .map(|name| name.trim().to_lowercase())
        .collect::<Vec<_>>();
    if names.iter().any(String::is_empty)
        || names.iter().collect::<HashSet<_>>().len() != names.len()
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(())
}

fn unique_storage_names<'a>(
    names: impl Iterator<Item = &'a String>,
) -> Result<(), ImportArchiveError> {
    let names = names.collect::<Vec<_>>();
    if names
        .iter()
        .any(|name| VaultStorageName::parse(name).is_err())
        || names.iter().copied().collect::<HashSet<_>>().len() != names.len()
    {
        return Err(ImportArchiveError::InvalidMetadata);
    }
    Ok(())
}

fn has_duplicate_names(names: &[String]) -> bool {
    let normalized = names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect::<Vec<_>>();
    normalized.iter().any(String::is_empty)
        || normalized.iter().collect::<HashSet<_>>().len() != normalized.len()
}

fn validate_path(value: &str) -> Result<String, ImportArchiveError> {
    if value.is_empty()
        || value.len() > MAX_PATH_BYTES
        || value.contains('\\')
        || value.contains('\0')
    {
        return Err(ImportArchiveError::UnsafeEntry);
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(ImportArchiveError::UnsafeEntry);
    }
    let segments = path
        .components()
        .map(|component| match component {
            Component::Normal(segment) => segment
                .to_str()
                .filter(|segment| !segment.is_empty() && segment.len() <= MAX_SEGMENT_BYTES)
                .ok_or(ImportArchiveError::UnsafeEntry),
            _ => Err(ImportArchiveError::UnsafeEntry),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if segments.is_empty() || segments.len() > MAX_PATH_DEPTH {
        return Err(ImportArchiveError::UnsafeEntry);
    }
    Ok(segments.join("/"))
}

fn is_managed_payload(path: &str) -> bool {
    if matches!(
        path,
        ".kanleaf/workspace.json" | ".kanleaf/task-config.json" | ".kanleaf/views.json"
    ) {
        return true;
    }
    if let Some(project) = path
        .strip_prefix(".kanleaf/projects/")
        .and_then(|value| value.strip_suffix(".json"))
    {
        return Uuid::parse_str(project).is_ok();
    }
    path.ends_with(".md")
        && (path.starts_with("Todo/") || path.starts_with("Wiki/") || path.starts_with("Projects/"))
}

fn media_type(path: &str) -> &'static str {
    if path.ends_with(".md") {
        "text/markdown"
    } else {
        "application/json"
    }
}

fn read_zip_entry(
    archive: &mut ZipArchive<std::fs::File>,
    index: usize,
) -> Result<Vec<u8>, ImportArchiveError> {
    let mut entry = archive
        .by_index(index)
        .map_err(|_| ImportArchiveError::InvalidArchive)?;
    let capacity = usize::try_from(entry.size()).map_err(|_| ImportArchiveError::LimitExceeded)?;
    let mut content = Vec::with_capacity(capacity);
    entry
        .read_to_end(&mut content)
        .map_err(|_| ImportArchiveError::InvalidArchive)?;
    if content.len() != capacity {
        return Err(ImportArchiveError::InvalidArchive);
    }
    Ok(content)
}

fn write_extracted(root: &Path, relative: &str, content: &[u8]) -> Result<(), ImportArchiveError> {
    let destination = root.join(relative);
    let parent = destination
        .parent()
        .ok_or(ImportArchiveError::UnsafeEntry)?;
    std::fs::create_dir_all(parent).map_err(|_| ImportArchiveError::Storage)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| ImportArchiveError::Storage)?;
    file.write_all(content)
        .map_err(|_| ImportArchiveError::Storage)?;
    file.sync_all().map_err(|_| ImportArchiveError::Storage)
}

fn load_json<T: serde::de::DeserializeOwned>(
    root: &Path,
    relative: &str,
) -> Result<T, ImportArchiveError> {
    let bytes =
        std::fs::read(root.join(relative)).map_err(|_| ImportArchiveError::InvalidMetadata)?;
    serde_json::from_slice(&bytes).map_err(|_| ImportArchiveError::InvalidMetadata)
}

fn file_sha256(path: &Path) -> Result<String, ImportArchiveError> {
    let mut file = std::fs::File::open(path).map_err(|_| ImportArchiveError::Storage)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| ImportArchiveError::Storage)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex_digest(digest.finalize()))
}

fn sha256(content: &[u8]) -> String {
    hex_digest(Sha256::digest(content))
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut revision = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut revision, "{byte:02x}").expect("writing to String cannot fail");
    }
    revision
}

fn name_eq(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_views_drop_type_and_expand_state_groups() {
        let todo_id = Uuid::new_v4();
        let done_id = Uuid::new_v4();
        let mut views = ViewsConfig {
            format_version: 1,
            views: vec![super::super::config::ViewConfig {
                id: Uuid::new_v4(),
                project_id: None,
                owner_email: "owner@example.com".to_owned(),
                name: "Legacy".to_owned(),
                query_version: 1,
                query: serde_json::json!({
                    "version": 1,
                    "scope": {"kind": "workspace"},
                    "filters": {
                        "states": {"values": [todo_id], "include_none": true},
                        "state_groups": ["done"],
                        "task_types": {"values": [Uuid::new_v4()], "include_none": false}
                    },
                    "grouping": {"primary": "task_type", "secondary": "state_group"},
                    "display": ["task_type", "state_group", "state", "priority"],
                    "include_completed": false
                }),
                layout: "list".to_owned(),
            }],
        };
        let task_config = LegacyTaskConfigV2 {
            format_version: 2,
            states: vec![
                super::super::config::LegacyTaskStateConfigV2 {
                    id: todo_id,
                    name: "Todo".to_owned(),
                    color: "#64748B".to_owned(),
                    group: "todo".to_owned(),
                    position: 0,
                    archived: false,
                },
                super::super::config::LegacyTaskStateConfigV2 {
                    id: done_id,
                    name: "Done".to_owned(),
                    color: "#22A06B".to_owned(),
                    group: "done".to_owned(),
                    position: 1,
                    archived: false,
                },
            ],
            types: Vec::new(),
            labels: Vec::new(),
            properties: Vec::new(),
        };

        normalize_legacy_views(&mut views, &task_config).unwrap();

        let view = &views.views[0];
        assert_eq!(view.query_version, 2);
        assert_eq!(view.query["version"], 2);
        assert!(view.query["filters"].get("state_groups").is_none());
        assert!(view.query["filters"].get("task_types").is_none());
        let state_ids = view.query["filters"]["states"]["values"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| Uuid::parse_str(value.as_str().unwrap()).unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(state_ids, HashSet::from([todo_id, done_id]));
        assert_eq!(
            view.query["grouping"],
            serde_json::json!({"primary": "state", "secondary": null})
        );
        assert_eq!(
            view.query["display"],
            serde_json::json!(["state", "priority"])
        );
    }
}
