use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    domain::events::{CommentSnapshot, Event, EventData, EventType, Identity, TaskSnapshot},
    error::AppError,
};

pub(crate) async fn store(
    transaction: &mut Transaction<'_, Postgres>,
    event: &Event,
    consumer: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO domain_events(id, workspace_id, project_id, event_type, occurred_at, raw_body) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event.id).bind(event.workspace.id).bind(event.project.as_ref().map(|project| project.id))
        .bind(event.kind.as_str()).bind(event.occurred_at).bind(serde_json::to_string(event).map_err(AppError::internal)?)
        .execute(&mut **transaction).await?;
    if let Some(consumer) = consumer {
        sqlx::query("INSERT INTO domain_event_outbox(event_id, consumer) VALUES ($1,$2)")
            .bind(event.id)
            .bind(consumer)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn scope(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Option<(Identity, Identity)>, AppError> {
    let row: Option<(Uuid, String, Uuid, String)> = sqlx::query_as(
        "SELECT w.id,w.identifier,p.id,p.identifier FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN projects p ON p.workspace_id=t.workspace_id AND p.id=t.project_id WHERE t.workspace_id=$1 AND t.id=$2"
    ).bind(workspace_id).bind(task_id).fetch_optional(&mut **transaction).await?;
    Ok(row.map(|(wid, wi, pid, pi)| {
        (
            Identity {
                id: wid,
                identifier: wi,
            },
            Identity {
                id: pid,
                identifier: pi,
            },
        )
    }))
}

#[derive(FromRow)]
struct TaskEventRow {
    id: Uuid,
    task_number: i64,
    title: String,
    state_id: Uuid,
    task_type_id: Uuid,
    priority: String,
    archived_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

pub(crate) async fn task_event(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    task: Uuid,
    actor: Uuid,
    kind: EventType,
    fields: &[&str],
) -> Result<(), AppError> {
    let Some((workspace, project)) = scope(transaction, workspace, task).await? else {
        return Ok(());
    };
    let row: TaskEventRow = sqlx::query_as(
        "SELECT id,task_number,title,state_id,task_type_id,priority,archived_at,updated_at FROM tasks WHERE workspace_id=$1 AND id=$2"
    ).bind(workspace.id).bind(task).fetch_one(&mut **transaction).await?;
    let snapshot = TaskSnapshot {
        id: row.id,
        reference: format!("#{}", row.task_number),
        task_number: row.task_number,
        title: row.title,
        state_id: row.state_id,
        task_type_id: row.task_type_id,
        priority: row.priority,
        archived_at: row.archived_at,
        updated_at: row.updated_at,
    };
    let event = Event::new(
        kind,
        workspace,
        Some(project),
        Some(actor),
        EventData::Task {
            task: snapshot,
            changed_fields: fields.iter().map(|field| (*field).to_owned()).collect(),
        },
    );
    store(transaction, &event, Some("webhooks")).await
}

pub(crate) async fn comment_event(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    task: Uuid,
    comment: Uuid,
    actor: Uuid,
    kind: EventType,
) -> Result<(), AppError> {
    let Some((workspace, project)) = scope(transaction, workspace, task).await? else {
        return Ok(());
    };
    let row: (Uuid, Uuid, Option<Uuid>, String, DateTime<Utc>) = sqlx::query_as("SELECT id,task_id,parent_id,body,updated_at FROM task_comments WHERE workspace_id=$1 AND id=$2")
        .bind(workspace.id).bind(comment).fetch_one(&mut **transaction).await?;
    let snapshot = CommentSnapshot {
        id: row.0,
        task_id: row.1,
        parent_id: row.2,
        body: (kind != EventType::CommentDeleted).then_some(row.3),
        updated_at: row.4,
    };
    store(
        transaction,
        &Event::new(
            kind,
            workspace,
            Some(project),
            Some(actor),
            EventData::Comment { comment: snapshot },
        ),
        Some("webhooks"),
    )
    .await
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Catalog {
    pub event_types: Vec<EventType>,
    pub examples: std::collections::BTreeMap<String, Event>,
    pub allow_http: bool,
}
