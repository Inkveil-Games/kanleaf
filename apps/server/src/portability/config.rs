use std::{fmt::Write as _, time::Duration};

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use thiserror::Error;
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    vault::{PortableConfigSnapshot, VaultError},
};

const CONFIG_FORMAT_VERSION: u16 = 1;
const PROJECT_CONFIG_FORMAT_VERSION: u16 = 2;
const PROJECTION_BATCH_SIZE: i64 = 20;
const RETRY_DELAY_SECONDS: f64 = 30.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WorkspaceConfig {
    pub format_version: u16,
    pub workspace_id: Uuid,
    pub name: String,
    pub accent: String,
    pub default_state_id: Uuid,
    pub default_task_type_id: Uuid,
    pub members: Vec<MemberReference>,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct MemberReference {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskConfig {
    pub format_version: u16,
    pub states: Vec<TaskStateConfig>,
    pub types: Vec<TaskTypeConfig>,
    pub labels: Vec<TaskLabelConfig>,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskStateConfig {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub group: String,
    pub position: i32,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskTypeConfig {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub description: String,
    pub position: i32,
    pub protected: bool,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskLabelConfig {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub description: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ViewsConfig {
    pub format_version: u16,
    pub views: Vec<ViewConfig>,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct ViewConfig {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub owner_email: String,
    pub name: String,
    pub query_version: i16,
    pub query: Value,
    pub layout: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProjectConfig {
    pub format_version: u16,
    pub id: Uuid,
    pub name: String,
    pub storage_name: String,
    pub identifier: String,
    pub description: String,
    #[serde(default = "default_project_icon")]
    pub icon: String,
    pub visibility: String,
    pub lead_email: Option<String>,
    pub default_assignee_email: Option<String>,
    pub default_state_id: Uuid,
    pub default_task_type_id: Uuid,
    pub enabled_task_type_ids: Vec<Uuid>,
    pub features: ProjectFeatures,
    pub members: Vec<ProjectMemberReference>,
    pub cycles: Vec<CycleConfig>,
    pub modules: Vec<ModuleConfig>,
    pub archived: bool,
    #[serde(skip)]
    pub legacy_identifier: Option<String>,
}

fn default_project_icon() -> String {
    "folder".to_owned()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProjectFeatures {
    pub cycles: bool,
    pub modules: bool,
    pub wiki: bool,
    pub views: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct ProjectMemberReference {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct CycleConfig {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub start_date: NaiveDate,
    pub due_date: NaiveDate,
    pub completed: bool,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct ModuleConfig {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub lead_email: Option<String>,
    pub status: String,
    pub start_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LiveManifest {
    pub format_version: u16,
    pub layout_version: i16,
    pub config_version: i64,
    pub generated_at: DateTime<Utc>,
    pub workspace_id: Uuid,
    pub config_files: Vec<ConfigFileRevision>,
    pub projects: Vec<ProjectIdentity>,
    pub tasks: Vec<TaskIdentity>,
    pub documents: Vec<DocumentIdentity>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ConfigFileRevision {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

pub(super) struct ConfigDrift {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct ProjectIdentity {
    pub id: Uuid,
    pub storage_name: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskIdentity {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub storage_name: String,
    pub number: i64,
    pub position: i64,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct DocumentIdentity {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub storage_name: String,
    pub position: i64,
    pub archived: bool,
}

#[derive(FromRow)]
struct WorkspaceRow {
    id: Uuid,
    name: String,
    accent: String,
    default_inbox_state_id: Uuid,
    default_task_type_id: Uuid,
    vault_layout_version: i16,
    config_version: i64,
}

#[derive(FromRow)]
struct ProjectRow {
    id: Uuid,
    name: String,
    storage_name: String,
    identifier: String,
    description: String,
    icon: String,
    visibility: String,
    lead_email: Option<String>,
    default_assignee_email: Option<String>,
    default_state_id: Uuid,
    default_task_type_id: Uuid,
    cycles_enabled: bool,
    modules_enabled: bool,
    pages_enabled: bool,
    views_enabled: bool,
    archived: bool,
}

#[derive(Debug, Error)]
enum ConfigProjectionFailure {
    #[error("Workspace config storage is unavailable")]
    Storage,
    #[error("Workspace config serialization failed")]
    Serialization(#[from] serde_json::Error),
    #[error("Workspace config query failed")]
    Database(#[from] sqlx::Error),
}

impl ConfigProjectionFailure {
    const fn code(&self) -> &'static str {
        match self {
            Self::Storage => "storage_unavailable",
            Self::Serialization(_) => "serialization_failed",
            Self::Database(_) => "database_unavailable",
        }
    }
}

pub(super) async fn project_now(state: &AppState, workspace_id: Uuid) {
    if let Err(error) = apply(state, workspace_id).await
        && let Err(record_error) = record_failure(state, workspace_id, &error).await
    {
        warn!(%workspace_id, %record_error, "failed to record Workspace config projection failure");
    }
}

async fn apply(state: &AppState, workspace_id: Uuid) -> Result<(), ConfigProjectionFailure> {
    let mut transaction = state.pool.begin().await?;
    let Some((workspace, snapshot)) = build_snapshot(&mut transaction, workspace_id).await? else {
        transaction.commit().await?;
        return Ok(());
    };
    state
        .vault
        .write_portable_config(workspace_id, &snapshot)
        .await
        .map_err(map_storage_error)?;
    sqlx::query(
        r#"
        UPDATE workspaces
        SET projected_config_version = $2, config_projection_error = NULL,
            config_projection_attempted_at = now()
        WHERE id = $1 AND config_version = $2
        "#,
    )
    .bind(workspace_id)
    .bind(workspace.config_version)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM workspace_config_projection_jobs WHERE workspace_id = $1 AND config_version <= $2",
    )
    .bind(workspace_id)
    .bind(workspace.config_version)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn build_snapshot(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<Option<(WorkspaceRow, PortableConfigSnapshot)>, ConfigProjectionFailure> {
    let workspace = sqlx::query_as::<_, WorkspaceRow>(
        r#"
        SELECT id, name, accent, default_inbox_state_id, default_task_type_id,
               vault_layout_version, config_version
        FROM workspaces WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let Some(workspace) = workspace else {
        return Ok(None);
    };

    let members = sqlx::query_as::<_, MemberReference>(
        r#"
        SELECT users.id AS user_id, users.email, users.display_name, memberships.role
        FROM workspace_memberships AS memberships
        JOIN users ON users.id = memberships.user_id
        WHERE memberships.workspace_id = $1
        ORDER BY users.email, users.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let workspace_config = WorkspaceConfig {
        format_version: CONFIG_FORMAT_VERSION,
        workspace_id,
        name: workspace.name.clone(),
        accent: workspace.accent.clone(),
        default_state_id: workspace.default_inbox_state_id,
        default_task_type_id: workspace.default_task_type_id,
        members,
    };

    let states = sqlx::query_as::<_, TaskStateConfig>(
        r#"
        SELECT id, name, color, state_group AS group, position,
               archived_at IS NOT NULL AS archived
        FROM task_states WHERE workspace_id = $1 ORDER BY position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let types = sqlx::query_as::<_, TaskTypeConfig>(
        r#"
        SELECT id, name, icon, color, description, position,
               is_protected AS protected, archived_at IS NOT NULL AS archived
        FROM task_types WHERE workspace_id = $1 ORDER BY position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let labels = sqlx::query_as::<_, TaskLabelConfig>(
        r#"
        SELECT id, name, color, description, archived_at IS NOT NULL AS archived
        FROM task_labels WHERE workspace_id = $1 ORDER BY lower(name), id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let task_config = TaskConfig {
        format_version: CONFIG_FORMAT_VERSION,
        states,
        types,
        labels,
    };

    let views = sqlx::query_as::<_, ViewConfig>(
        r#"
        SELECT views.id, views.project_id, users.email AS owner_email,
               views.name, views.query_version, views.query, views.layout
        FROM saved_views AS views
        JOIN users ON users.id = views.owner_id
        WHERE views.workspace_id = $1 AND views.visibility = 'shared'
        ORDER BY views.project_id NULLS FIRST, lower(views.name), views.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let views_config = ViewsConfig {
        format_version: CONFIG_FORMAT_VERSION,
        views,
    };

    let project_rows = sqlx::query_as::<_, ProjectRow>(
        r#"
        SELECT projects.id, projects.name, projects.storage_name,
               projects.identifier, projects.description, projects.icon, projects.visibility,
               leads.email AS lead_email, assignees.email AS default_assignee_email,
               projects.default_state_id, projects.default_task_type_id,
               projects.cycles_enabled, projects.modules_enabled,
               projects.pages_enabled, projects.views_enabled,
               projects.archived_at IS NOT NULL AS archived
        FROM projects
        LEFT JOIN users AS leads ON leads.id = projects.lead_user_id
        LEFT JOIN users AS assignees ON assignees.id = projects.default_assignee_id
        WHERE projects.workspace_id = $1
        ORDER BY projects.created_at, projects.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let mut project_configs = Vec::with_capacity(project_rows.len());
    for project in project_rows {
        project_configs.push((
            project.id,
            load_project_config(transaction, workspace_id, project).await?,
        ));
    }

    let projects = sqlx::query_as::<_, ProjectIdentity>(
        r#"
        SELECT id, storage_name, archived_at IS NOT NULL AS archived
        FROM projects WHERE workspace_id = $1 ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let tasks = sqlx::query_as::<_, TaskIdentity>(
        r#"
        SELECT id, project_id, storage_name, task_number AS number, position,
               archived_at IS NOT NULL AS archived
        FROM tasks WHERE workspace_id = $1 ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let documents = sqlx::query_as::<_, DocumentIdentity>(
        r#"
        SELECT id, project_id, parent_id, title, storage_name, position,
               archived_at IS NOT NULL AS archived
        FROM documents WHERE workspace_id = $1 ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    let workspace_json = pretty_json(&workspace_config)?;
    let task_config_json = pretty_json(&task_config)?;
    let views_json = pretty_json(&views_config)?;
    let project_json = project_configs
        .into_iter()
        .map(|(project_id, config)| Ok((project_id, pretty_json(&config)?)))
        .collect::<Result<Vec<_>, serde_json::Error>>()?;
    let mut config_files = vec![
        config_revision(".kanleaf/workspace.json", &workspace_json),
        config_revision(".kanleaf/task-config.json", &task_config_json),
        config_revision(".kanleaf/views.json", &views_json),
    ];
    config_files.extend(project_json.iter().map(|(project_id, content)| {
        config_revision(&format!(".kanleaf/projects/{project_id}.json"), content)
    }));
    config_files.sort_by(|left, right| left.path.cmp(&right.path));
    let manifest = LiveManifest {
        format_version: CONFIG_FORMAT_VERSION,
        layout_version: workspace.vault_layout_version,
        config_version: workspace.config_version,
        generated_at: Utc::now(),
        workspace_id: workspace.id,
        config_files,
        projects,
        tasks,
        documents,
    };

    Ok(Some((
        workspace,
        PortableConfigSnapshot {
            workspace: workspace_json,
            task_config: task_config_json,
            views: views_json,
            projects: project_json,
            manifest: pretty_json(&manifest)?,
        },
    )))
}

async fn load_project_config(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project: ProjectRow,
) -> Result<ProjectConfig, sqlx::Error> {
    let enabled_task_type_ids = sqlx::query_scalar(
        r#"
        SELECT task_type_id FROM project_task_types
        WHERE workspace_id = $1 AND project_id = $2 ORDER BY task_type_id
        "#,
    )
    .bind(workspace_id)
    .bind(project.id)
    .fetch_all(&mut **transaction)
    .await?;
    let members = sqlx::query_as::<_, ProjectMemberReference>(
        r#"
        SELECT users.id AS user_id, users.email, users.display_name, memberships.role
        FROM project_memberships AS memberships
        JOIN users ON users.id = memberships.user_id
        WHERE memberships.workspace_id = $1 AND memberships.project_id = $2
        ORDER BY users.email, users.id
        "#,
    )
    .bind(workspace_id)
    .bind(project.id)
    .fetch_all(&mut **transaction)
    .await?;
    let cycles = sqlx::query_as::<_, CycleConfig>(
        r#"
        SELECT id, name, description, start_date, due_date,
               completed_at IS NOT NULL AS completed,
               archived_at IS NOT NULL AS archived
        FROM project_cycles
        WHERE workspace_id = $1 AND project_id = $2
        ORDER BY start_date, id
        "#,
    )
    .bind(workspace_id)
    .bind(project.id)
    .fetch_all(&mut **transaction)
    .await?;
    let modules = sqlx::query_as::<_, ModuleConfig>(
        r#"
        SELECT modules.id, modules.name, modules.description,
               users.email AS lead_email, modules.status,
               modules.start_date, modules.due_date,
               modules.archived_at IS NOT NULL AS archived
        FROM project_modules AS modules
        LEFT JOIN users ON users.id = modules.lead_user_id
        WHERE modules.workspace_id = $1 AND modules.project_id = $2
        ORDER BY modules.created_at, modules.id
        "#,
    )
    .bind(workspace_id)
    .bind(project.id)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(ProjectConfig {
        format_version: PROJECT_CONFIG_FORMAT_VERSION,
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
        default_task_type_id: project.default_task_type_id,
        enabled_task_type_ids,
        features: ProjectFeatures {
            cycles: project.cycles_enabled,
            modules: project.modules_enabled,
            wiki: project.pages_enabled,
            views: project.views_enabled,
        },
        members,
        cycles,
        modules,
        archived: project.archived,
        legacy_identifier: None,
    })
}

fn pretty_json(value: &impl Serialize) -> Result<String, serde_json::Error> {
    let mut content = serde_json::to_string_pretty(value)?;
    content.push('\n');
    Ok(content)
}

fn config_revision(path: &str, content: &str) -> ConfigFileRevision {
    let digest = Sha256::digest(content.as_bytes());
    let mut sha256 = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut sha256, "{byte:02x}").expect("writing to String cannot fail");
    }
    ConfigFileRevision {
        path: path.to_owned(),
        size: content.len() as u64,
        sha256,
    }
}

pub(super) async fn detect_drift(state: &AppState, workspace_id: Uuid) -> Vec<ConfigDrift> {
    let manifest_source = match state.vault.read_live_manifest(workspace_id).await {
        Ok(source) => source,
        Err(_) => {
            return vec![ConfigDrift {
                path: ".kanleaf/manifest.json".to_owned(),
                message: "Portable configuration has not been projected".to_owned(),
            }];
        }
    };
    let manifest: LiveManifest = match serde_json::from_str::<LiveManifest>(&manifest_source) {
        Ok(manifest) if manifest.workspace_id == workspace_id => manifest,
        _ => {
            return vec![ConfigDrift {
                path: ".kanleaf/manifest.json".to_owned(),
                message: "Portable configuration manifest is invalid".to_owned(),
            }];
        }
    };
    let current: Option<(i64, i64)> = sqlx::query_as(
        "SELECT config_version, projected_config_version FROM workspaces WHERE id = $1",
    )
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    if current != Some((manifest.config_version, manifest.config_version)) {
        return vec![ConfigDrift {
            path: ".kanleaf/manifest.json".to_owned(),
            message: "Portable configuration is waiting for canonical projection".to_owned(),
        }];
    }
    let mut drift = Vec::new();
    for expected in manifest.config_files {
        match state
            .vault
            .read_portable_config_file(workspace_id, &expected.path)
            .await
        {
            Ok(content)
                if content.len() as u64 == expected.size
                    && config_revision(&expected.path, &content).sha256 == expected.sha256 => {}
            Ok(_) => drift.push(ConfigDrift {
                path: expected.path,
                message: "Portable configuration differs from PostgreSQL".to_owned(),
            }),
            Err(_) => drift.push(ConfigDrift {
                path: expected.path,
                message: "Portable configuration file is missing or unsafe".to_owned(),
            }),
        }
    }
    drift
}

fn map_storage_error(_: VaultError) -> ConfigProjectionFailure {
    ConfigProjectionFailure::Storage
}

async fn record_failure(
    state: &AppState,
    workspace_id: Uuid,
    error: &ConfigProjectionFailure,
) -> Result<(), sqlx::Error> {
    let code = error.code();
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE workspaces
        SET config_projection_error = $2, config_projection_attempted_at = now()
        WHERE id = $1 AND EXISTS (
            SELECT 1 FROM workspace_config_projection_jobs WHERE workspace_id = $1
        )
        "#,
    )
    .bind(workspace_id)
    .bind(code)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE workspace_config_projection_jobs
        SET attempts = attempts + 1,
            next_attempt_at = now() + make_interval(secs => $2),
            last_error = $3, updated_at = now()
        WHERE workspace_id = $1
        "#,
    )
    .bind(workspace_id)
    .bind(RETRY_DELAY_SECONDS)
    .bind(code)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn recover_projection_jobs(state: &AppState) -> Result<(), sqlx::Error> {
    let workspace_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT workspace_id FROM workspace_config_projection_jobs ORDER BY next_attempt_at, updated_at",
    )
    .fetch_all(&state.pool)
    .await?;
    for workspace_id in workspace_ids {
        project_now(state, workspace_id).await;
    }
    Ok(())
}

async fn drain_due(state: &AppState) -> Result<(), sqlx::Error> {
    let workspace_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT workspace_id FROM workspace_config_projection_jobs
        WHERE next_attempt_at <= now()
        ORDER BY next_attempt_at, updated_at LIMIT $1
        "#,
    )
    .bind(PROJECTION_BATCH_SIZE)
    .fetch_all(&state.pool)
    .await?;
    for workspace_id in workspace_ids {
        project_now(state, workspace_id).await;
    }
    Ok(())
}

pub fn spawn_projection_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = drain_due(&state).await {
                warn!(%error, "Workspace config projection worker could not load pending jobs");
            }
        }
    });
}
