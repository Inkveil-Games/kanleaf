use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub(crate) struct TaskStateSummary {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub state_group: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TaskTypeSummary {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize, FromRow)]
pub(crate) struct TaskAssigneeSummary {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, FromRow)]
pub(crate) struct TaskLabelSummary {
    pub id: Uuid,
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct TaskLink {
    pub id: Uuid,
    pub reference: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct TaskRelationSummary {
    pub task: TaskLink,
    pub relation_type: String,
}

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub task_number: i64,
    pub reference: String,
    pub title: String,
    pub state: TaskStateSummary,
    pub task_type: TaskTypeSummary,
    pub priority: String,
    pub start_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    pub estimate: Option<i32>,
    pub position: i64,
    pub parent: Option<TaskLink>,
    pub assignees: Vec<TaskAssigneeSummary>,
    pub labels: Vec<TaskLabelSummary>,
    pub subtasks: Vec<TaskLink>,
    pub relations: Vec<TaskRelationSummary>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
pub(super) struct TaskRow {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    project_identifier: Option<String>,
    task_number: i64,
    title: String,
    state_id: Uuid,
    state_name: String,
    state_color: String,
    state_group: String,
    task_type_id: Uuid,
    task_type_name: String,
    task_type_icon: String,
    task_type_color: String,
    priority: String,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    estimate: Option<i32>,
    position: i64,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<TaskRow> for TaskResponse {
    fn from(row: TaskRow) -> Self {
        Self {
            id: row.id,
            workspace_id: row.workspace_id,
            project_id: row.project_id,
            task_number: row.task_number,
            reference: task_reference(row.project_identifier.as_deref(), row.task_number),
            title: row.title,
            state: TaskStateSummary {
                id: row.state_id,
                name: row.state_name,
                color: row.state_color,
                state_group: row.state_group,
            },
            task_type: TaskTypeSummary {
                id: row.task_type_id,
                name: row.task_type_name,
                icon: row.task_type_icon,
                color: row.task_type_color,
            },
            priority: row.priority,
            start_date: row.start_date,
            due_date: row.due_date,
            estimate: row.estimate,
            position: row.position,
            parent: None,
            assignees: Vec::new(),
            labels: Vec::new(),
            subtasks: Vec::new(),
            relations: Vec::new(),
            archived_at: row.archived_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

pub(super) async fn hydrate_tasks(
    pool: &PgPool,
    workspace_id: Uuid,
    tasks: &mut [TaskResponse],
) -> Result<(), AppError> {
    if tasks.is_empty() {
        return Ok(());
    }
    let ids = tasks.iter().map(|task| task.id).collect::<Vec<_>>();
    let indexes = tasks
        .iter()
        .enumerate()
        .map(|(index, task)| (task.id, index))
        .collect::<HashMap<_, _>>();

    let assignees = sqlx::query_as::<_, TaskAssigneeRow>(
        r#"
        SELECT task_assignees.task_id, users.id AS user_id,
               users.email, users.display_name
        FROM task_assignees
        JOIN users ON users.id = task_assignees.user_id
        WHERE task_assignees.workspace_id = $1
          AND task_assignees.task_id = ANY($2)
        ORDER BY lower(users.display_name), users.id
        "#,
    )
    .bind(workspace_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in assignees {
        tasks[indexes[&row.task_id]]
            .assignees
            .push(TaskAssigneeSummary {
                user_id: row.user_id,
                email: row.email,
                display_name: row.display_name,
            });
    }

    let labels = sqlx::query_as::<_, TaskLabelRow>(
        r#"
        SELECT assignments.task_id, labels.id, labels.name, labels.color
        FROM task_label_assignments AS assignments
        JOIN task_labels AS labels
          ON labels.workspace_id = assignments.workspace_id
         AND labels.id = assignments.label_id
        WHERE assignments.workspace_id = $1
          AND assignments.task_id = ANY($2)
        ORDER BY lower(labels.name), labels.id
        "#,
    )
    .bind(workspace_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in labels {
        tasks[indexes[&row.task_id]].labels.push(TaskLabelSummary {
            id: row.id,
            name: row.name,
            color: row.color,
        });
    }

    let parents = sqlx::query_as::<_, RelatedTaskRow>(
        r#"
        SELECT child.id AS owner_id, parent.id, parent.task_number,
               parent.title, projects.identifier AS project_identifier
        FROM tasks AS child
        JOIN tasks AS parent
          ON parent.workspace_id = child.workspace_id
         AND parent.id = child.parent_id
        LEFT JOIN projects ON projects.id = parent.project_id
        WHERE child.workspace_id = $1 AND child.id = ANY($2)
        "#,
    )
    .bind(workspace_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in parents {
        let owner_id = row.owner_id;
        tasks[indexes[&owner_id]].parent = Some(row.into_link());
    }

    let subtasks = sqlx::query_as::<_, RelatedTaskRow>(
        r#"
        SELECT child.parent_id AS owner_id, child.id, child.task_number,
               child.title, projects.identifier AS project_identifier
        FROM tasks AS child
        LEFT JOIN projects ON projects.id = child.project_id
        WHERE child.workspace_id = $1
          AND child.parent_id = ANY($2)
          AND child.archived_at IS NULL
        ORDER BY child.position, child.task_number
        "#,
    )
    .bind(workspace_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in subtasks {
        tasks[indexes[&row.owner_id]].subtasks.push(row.into_link());
    }

    let relations = sqlx::query_as::<_, RelationRow>(
        r#"
        SELECT relations.task_a_id, relations.task_b_id,
               relations.relation_type, relations.task_a_blocks,
               task_a.task_number AS task_a_number,
               task_a.title AS task_a_title,
               project_a.identifier AS task_a_project_identifier,
               task_b.task_number AS task_b_number,
               task_b.title AS task_b_title,
               project_b.identifier AS task_b_project_identifier
        FROM task_relations AS relations
        JOIN tasks AS task_a ON task_a.id = relations.task_a_id
        JOIN tasks AS task_b ON task_b.id = relations.task_b_id
        LEFT JOIN projects AS project_a ON project_a.id = task_a.project_id
        LEFT JOIN projects AS project_b ON project_b.id = task_b.project_id
        WHERE relations.workspace_id = $1
          AND (relations.task_a_id = ANY($2) OR relations.task_b_id = ANY($2))
          AND task_a.archived_at IS NULL
          AND task_b.archived_at IS NULL
        ORDER BY relations.created_at, relations.task_a_id, relations.task_b_id
        "#,
    )
    .bind(workspace_id)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for row in relations {
        if let Some(&index) = indexes.get(&row.task_a_id) {
            tasks[index].relations.push(TaskRelationSummary {
                task: TaskLink {
                    id: row.task_b_id,
                    reference: task_reference(
                        row.task_b_project_identifier.as_deref(),
                        row.task_b_number,
                    ),
                    title: row.task_b_title.clone(),
                },
                relation_type: row.relation_for_a(),
            });
        }
        if let Some(&index) = indexes.get(&row.task_b_id) {
            let relation_type = row.relation_for_b();
            tasks[index].relations.push(TaskRelationSummary {
                task: TaskLink {
                    id: row.task_a_id,
                    reference: task_reference(
                        row.task_a_project_identifier.as_deref(),
                        row.task_a_number,
                    ),
                    title: row.task_a_title,
                },
                relation_type,
            });
        }
    }
    Ok(())
}

pub(super) fn task_reference(project_identifier: Option<&str>, number: i64) -> String {
    project_identifier.map_or_else(|| format!("#{number}"), |value| format!("{value}-{number}"))
}

#[derive(FromRow)]
struct TaskAssigneeRow {
    task_id: Uuid,
    user_id: Uuid,
    email: String,
    display_name: String,
}

#[derive(FromRow)]
struct TaskLabelRow {
    task_id: Uuid,
    id: Uuid,
    name: String,
    color: String,
}

#[derive(FromRow)]
struct RelatedTaskRow {
    owner_id: Uuid,
    id: Uuid,
    task_number: i64,
    title: String,
    project_identifier: Option<String>,
}

impl RelatedTaskRow {
    fn into_link(self) -> TaskLink {
        TaskLink {
            id: self.id,
            reference: task_reference(self.project_identifier.as_deref(), self.task_number),
            title: self.title,
        }
    }
}

#[derive(FromRow)]
struct RelationRow {
    task_a_id: Uuid,
    task_b_id: Uuid,
    relation_type: String,
    task_a_blocks: Option<bool>,
    task_a_number: i64,
    task_a_title: String,
    task_a_project_identifier: Option<String>,
    task_b_number: i64,
    task_b_title: String,
    task_b_project_identifier: Option<String>,
}

impl RelationRow {
    fn relation_for_a(&self) -> String {
        if self.relation_type != "blocks" {
            return self.relation_type.clone();
        }
        if self.task_a_blocks == Some(true) {
            "blocking".to_owned()
        } else {
            "blocked_by".to_owned()
        }
    }

    fn relation_for_b(&self) -> String {
        if self.relation_type != "blocks" {
            return self.relation_type.clone();
        }
        if self.task_a_blocks == Some(true) {
            "blocked_by".to_owned()
        } else {
            "blocking".to_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::task_reference;

    #[test]
    fn task_reference_uses_the_current_location_without_changing_the_number() {
        assert_eq!(task_reference(None, 42), "#42");
        assert_eq!(task_reference(Some("KAN"), 42), "KAN-42");
    }
}
