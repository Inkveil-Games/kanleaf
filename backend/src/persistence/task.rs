use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::{
    project::ProjectId,
    task::{Task, TaskId, TaskStatus},
    user::UserId,
    workspace::WorkspaceId,
};

#[derive(Debug, FromRow)]
struct TaskRow {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    status: String,
    created_by: Uuid,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

const TASK_COLUMNS: &str = "t.id, t.workspace_id, t.project_id, t.title, t.status, t.created_by, t.created_at, t.updated_at";

pub async fn create_for_user(
    pool: &PgPool,
    user_id: UserId,
    task: &Task,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO tasks \
            (id, workspace_id, project_id, title, status, created_by, created_at, updated_at) \
         SELECT $1, $2, $3, $4, $5, $6, $7, $8 \
         WHERE EXISTS (\
             SELECT 1 FROM workspace_memberships \
             WHERE workspace_id = $2 AND user_id = $9\
         ) \
         AND $6 = $9 \
         AND (\
             $3::UUID IS NULL OR EXISTS (\
                 SELECT 1 FROM projects WHERE id = $3 AND workspace_id = $2\
             )\
         )",
    )
    .bind(Uuid::from(task.id()))
    .bind(Uuid::from(task.workspace_id()))
    .bind(task.project_id().map(Uuid::from))
    .bind(task.title())
    .bind(task.status().as_str())
    .bind(Uuid::from(task.created_by()))
    .bind(OffsetDateTime::from(task.created_at()))
    .bind(OffsetDateTime::from(task.updated_at()))
    .bind(Uuid::from(user_id))
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

pub async fn list_inbox_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Vec<Task>, sqlx::Error> {
    list_for_user(pool, user_id, workspace_id, None).await
}

pub async fn list_project_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
    project_id: ProjectId,
) -> Result<Vec<Task>, sqlx::Error> {
    list_for_user(pool, user_id, workspace_id, Some(project_id)).await
}

async fn list_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
    project_id: Option<ProjectId>,
) -> Result<Vec<Task>, sqlx::Error> {
    let query = format!(
        "SELECT {TASK_COLUMNS} \
         FROM tasks t \
         JOIN workspace_memberships m ON m.workspace_id = t.workspace_id \
         WHERE t.workspace_id = $1 AND m.user_id = $2 \
           AND t.project_id IS NOT DISTINCT FROM $3 \
         ORDER BY t.created_at, t.id"
    );
    let rows = sqlx::query_as::<_, TaskRow>(&query)
        .bind(Uuid::from(workspace_id))
        .bind(Uuid::from(user_id))
        .bind(project_id.map(Uuid::from))
        .fetch_all(pool)
        .await?;

    rows.into_iter().map(restore).collect()
}

pub async fn find_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
    task_id: TaskId,
) -> Result<Option<Task>, sqlx::Error> {
    let query = format!(
        "SELECT {TASK_COLUMNS} \
         FROM tasks t \
         JOIN workspace_memberships m ON m.workspace_id = t.workspace_id \
         WHERE t.id = $1 AND t.workspace_id = $2 AND m.user_id = $3"
    );
    let row = sqlx::query_as::<_, TaskRow>(&query)
        .bind(Uuid::from(task_id))
        .bind(Uuid::from(workspace_id))
        .bind(Uuid::from(user_id))
        .fetch_optional(pool)
        .await?;

    row.map(restore).transpose()
}

pub async fn update_for_user(
    pool: &PgPool,
    user_id: UserId,
    task: &Task,
) -> Result<Option<Task>, sqlx::Error> {
    let query = format!(
        "UPDATE tasks t \
         SET project_id = $4, title = $5, status = $6, updated_at = $7 \
         FROM workspace_memberships m \
         WHERE t.id = $1 AND t.workspace_id = $2 \
           AND m.workspace_id = t.workspace_id AND m.user_id = $3 \
           AND (\
               $4::UUID IS NULL OR EXISTS (\
                   SELECT 1 FROM projects p \
                   WHERE p.id = $4 AND p.workspace_id = t.workspace_id\
               )\
           ) \
         RETURNING {TASK_COLUMNS}"
    );
    let row = sqlx::query_as::<_, TaskRow>(&query)
        .bind(Uuid::from(task.id()))
        .bind(Uuid::from(task.workspace_id()))
        .bind(Uuid::from(user_id))
        .bind(task.project_id().map(Uuid::from))
        .bind(task.title())
        .bind(task.status().as_str())
        .bind(OffsetDateTime::from(task.updated_at()))
        .fetch_optional(pool)
        .await?;

    row.map(restore).transpose()
}

fn restore(row: TaskRow) -> Result<Task, sqlx::Error> {
    let status = row
        .status
        .parse::<TaskStatus>()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    Task::restore(
        row.id.into(),
        row.workspace_id.into(),
        row.project_id.map(Into::into),
        row.title,
        status,
        row.created_by.into(),
        row.created_at.into(),
        row.updated_at.into(),
    )
    .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}
