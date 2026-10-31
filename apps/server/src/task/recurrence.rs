use std::{borrow::Cow, time::Duration};

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    collaboration::record_activity,
    domain::{
        RecurrenceAction, RecurrenceFrequency, RecurrenceMode, RecurrenceRule, TaskTitle,
        events::EventType, recurrence_local_date,
    },
    domain_event::task_event,
    error::AppError,
    realtime::RealtimeEvent,
    task_config::{lock_workspace_for_assignment, resolve_task_default},
};

use super::{
    NewTask, NewTaskValues, authorize_task_location, enqueue_projection, frontmatter, insert_task,
    map_vault_write_error, model::TaskRecurrenceSummary, project_now, task_assignee_ids,
    task_vault_row, valid_assignees, validate_parent, validate_schedule,
};

const WORKER_INTERVAL: Duration = Duration::from_secs(60);
const WORKER_BATCH_SIZE: i64 = 20;

#[derive(FromRow)]
struct RecurrenceRow {
    task_id: Uuid,
    frequency: String,
    weekdays: Vec<i16>,
    month_day: Option<i16>,
    time_of_day: NaiveTime,
    timezone: String,
    mode: String,
    action: String,
    anchor_date: NaiveDate,
    next_run_at: DateTime<Utc>,
    owner_id: Uuid,
    paused_at: Option<DateTime<Utc>>,
}

impl RecurrenceRow {
    fn rule(&self) -> Result<RecurrenceRule, AppError> {
        let invalid = |_| AppError::internal(anyhow::anyhow!("stored repeat rule is invalid"));
        Ok(RecurrenceRule {
            frequency: RecurrenceFrequency::parse(&self.frequency).map_err(invalid)?,
            weekdays: self
                .weekdays
                .iter()
                .map(|day| u8::try_from(*day))
                .collect::<Result<_, _>>()
                .map_err(|_| AppError::internal(anyhow::anyhow!("stored weekday is invalid")))?,
            month_day: self
                .month_day
                .map(u8::try_from)
                .transpose()
                .map_err(|_| AppError::internal(anyhow::anyhow!("stored month day is invalid")))?,
            time: self.time_of_day,
            mode: RecurrenceMode::parse(&self.mode).map_err(invalid)?,
            action: RecurrenceAction::parse(&self.action).map_err(invalid)?,
        })
    }
}

const SELECT_RECURRENCE: &str = r#"
    SELECT task_id, frequency, weekdays, month_day, time_of_day, timezone, mode,
           action, anchor_date, next_run_at, owner_id, paused_at
    FROM task_recurrences
"#;

pub(super) async fn load_summaries(
    pool: &PgPool,
    workspace_id: Uuid,
    task_ids: &[Uuid],
) -> Result<Vec<(Uuid, TaskRecurrenceSummary)>, AppError> {
    let rows = sqlx::query_as::<_, RecurrenceRow>(&format!(
        "{SELECT_RECURRENCE} WHERE workspace_id = $1 AND task_id = ANY($2)"
    ))
    .bind(workspace_id)
    .bind(task_ids)
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok((
                row.task_id,
                TaskRecurrenceSummary {
                    rule: row.rule()?,
                    timezone: row.timezone,
                    next_run_at: row.next_run_at,
                    paused_at: row.paused_at,
                },
            ))
        })
        .collect()
}

/// Sets or clears a Task's repeat rule inside the caller's update transaction.
/// The editor becomes the owner whose access and timezone later spawns use.
pub(super) async fn apply_rule(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    actor_id: Uuid,
    rule: Option<RecurrenceRule>,
    scheduled_date: Option<NaiveDate>,
) -> Result<bool, AppError> {
    let current = sqlx::query_as::<_, RecurrenceRow>(&format!(
        "{SELECT_RECURRENCE} WHERE workspace_id = $1 AND task_id = $2 FOR UPDATE"
    ))
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let Some(rule) = rule else {
        if current.is_none() {
            return Ok(false);
        }
        sqlx::query("DELETE FROM task_recurrences WHERE workspace_id = $1 AND task_id = $2")
            .bind(workspace_id)
            .bind(task_id)
            .execute(&mut **transaction)
            .await?;
        return Ok(true);
    };
    let rule = rule
        .normalized()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let timezone: String = sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(&mut **transaction)
        .await?;
    if let Some(current) = &current
        && current.paused_at.is_none()
        && current.timezone == timezone
        && current.rule()? == rule
    {
        return Ok(false);
    }
    let now = Utc::now();
    let validation =
        |error: crate::domain::ValidationError| AppError::Validation(error.to_string());
    let anchor = match (scheduled_date, &current) {
        (Some(date), _) => date,
        (None, Some(current)) => current.anchor_date,
        (None, None) => recurrence_local_date(&timezone, now).map_err(validation)?,
    };
    let next = rule
        .next_after(&timezone, anchor, now)
        .map_err(validation)?;
    let weekdays = rule
        .weekdays
        .iter()
        .map(|day| i16::from(*day))
        .collect::<Vec<_>>();
    sqlx::query(
        r#"
        INSERT INTO task_recurrences
            (task_id, workspace_id, frequency, weekdays, month_day, time_of_day,
             timezone, mode, action, anchor_date, next_run_at, owner_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (task_id) DO UPDATE
        SET frequency = EXCLUDED.frequency,
            weekdays = EXCLUDED.weekdays,
            month_day = EXCLUDED.month_day,
            time_of_day = EXCLUDED.time_of_day,
            timezone = EXCLUDED.timezone,
            mode = EXCLUDED.mode,
            action = EXCLUDED.action,
            anchor_date = EXCLUDED.anchor_date,
            next_run_at = EXCLUDED.next_run_at,
            owner_id = EXCLUDED.owner_id,
            paused_at = NULL,
            updated_at = now()
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .bind(rule.frequency.as_str())
    .bind(&weekdays)
    .bind(rule.month_day.map(i16::from))
    .bind(rule.time)
    .bind(&timezone)
    .bind(rule.mode.as_str())
    .bind(rule.action.as_str())
    .bind(anchor)
    .bind(next.at)
    .bind(actor_id)
    .execute(&mut **transaction)
    .await?;
    Ok(true)
}

pub fn spawn_recurrence_worker(state: AppState) {
    tokio::spawn(async move {
        // The first tick is immediate, so occurrences missed while the server
        // was stopped are handled at startup.
        let mut interval = tokio::time::interval(WORKER_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = run_due(&state).await {
                warn!(%error, "Task repeat worker could not load due repeats");
            }
        }
    });
}

async fn run_due(state: &AppState) -> Result<(), sqlx::Error> {
    let due: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        SELECT recurrences.workspace_id, recurrences.task_id
        FROM task_recurrences AS recurrences
        JOIN tasks
          ON tasks.workspace_id = recurrences.workspace_id
         AND tasks.id = recurrences.task_id
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        WHERE recurrences.paused_at IS NULL
          AND tasks.archived_at IS NULL
          AND (
              (recurrences.mode = 'schedule' AND recurrences.next_run_at <= now())
              OR (recurrences.mode = 'after_completion'
                  AND states.system_role IN ('done', 'cancelled'))
          )
        ORDER BY recurrences.next_run_at
        LIMIT $1
        "#,
    )
    .bind(WORKER_BATCH_SIZE)
    .fetch_all(&state.pool)
    .await?;
    for (workspace_id, task_id) in due {
        if let Err(error) = spawn_next(state, workspace_id, task_id, Utc::now()).await {
            warn!(%task_id, %error, "Task repeat could not create the next Task");
        }
    }
    Ok(())
}

#[derive(FromRow)]
struct TemplateTask {
    title: String,
    project_id: Option<Uuid>,
    priority: String,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    estimate: Option<i32>,
    parent_id: Option<Uuid>,
    system_role: String,
}

/// Runs a due repeat. `duplicate` creates the next Task from the latest one and
/// moves the rule onto it; `reset` reopens the same Task for the occurrence.
/// Returns the Task that now carries the rule, or `None` when nothing was due.
pub async fn spawn_next(
    state: &AppState,
    workspace_id: Uuid,
    template_id: Uuid,
    now: DateTime<Utc>,
) -> Result<Option<Uuid>, AppError> {
    let mut transaction = state.pool.begin().await?;
    // Same lock order as Task updates: Workspace, Task row, then repeat row.
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let Some(template) = sqlx::query_as::<_, TemplateTask>(
        r#"
        SELECT tasks.title, tasks.project_id, tasks.priority, tasks.start_date,
               tasks.due_date, tasks.estimate, tasks.parent_id, states.system_role
        FROM tasks
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        WHERE tasks.workspace_id = $1 AND tasks.id = $2 AND tasks.archived_at IS NULL
        FOR UPDATE OF tasks
        "#,
    )
    .bind(workspace_id)
    .bind(template_id)
    .fetch_optional(&mut *transaction)
    .await?
    else {
        return Ok(None);
    };
    let Some(recurrence) = sqlx::query_as::<_, RecurrenceRow>(&format!(
        "{SELECT_RECURRENCE} WHERE workspace_id = $1 AND task_id = $2 AND paused_at IS NULL FOR UPDATE"
    ))
    .bind(workspace_id)
    .bind(template_id)
    .fetch_optional(&mut *transaction)
    .await?
    else {
        return Ok(None);
    };
    let rule = recurrence.rule()?;
    let timezone = recurrence.timezone.as_str();
    let invalid = |error: crate::domain::ValidationError| AppError::Validation(error.to_string());

    let occurrence = match rule.mode {
        RecurrenceMode::Schedule => {
            if recurrence.next_run_at > now {
                return Ok(None);
            }
            match rule
                .latest_due(timezone, recurrence.anchor_date, now)
                .map_err(invalid)
            {
                Ok(Some(occurrence)) => occurrence,
                Ok(None) => {
                    let next = rule
                        .next_after(timezone, recurrence.anchor_date, now)
                        .map_err(invalid);
                    match next {
                        Ok(next) => {
                            sqlx::query(
                                "UPDATE task_recurrences SET next_run_at = $3, updated_at = now() WHERE workspace_id = $1 AND task_id = $2",
                            )
                            .bind(workspace_id)
                            .bind(template_id)
                            .bind(next.at)
                            .execute(&mut *transaction)
                            .await?;
                            transaction.commit().await?;
                            return Ok(None);
                        }
                        Err(error) => {
                            return pause(transaction, workspace_id, template_id, error).await;
                        }
                    }
                }
                Err(error) => return pause(transaction, workspace_id, template_id, error).await,
            }
        }
        RecurrenceMode::AfterCompletion => {
            if !matches!(template.system_role.as_str(), "done" | "cancelled") {
                return Ok(None);
            }
            let today = match recurrence_local_date(timezone, now).map_err(invalid) {
                Ok(today) => today,
                Err(error) => return pause(transaction, workspace_id, template_id, error).await,
            };
            match rule
                .occurrence_after(timezone, recurrence.anchor_date.max(today))
                .map_err(invalid)
            {
                Ok(occurrence) => occurrence,
                Err(error) => return pause(transaction, workspace_id, template_id, error).await,
            }
        }
    };

    // Spawning acts for the owner, so it needs their current edit access.
    match authorize_task_location(
        &state.pool,
        recurrence.owner_id,
        workspace_id,
        template.project_id,
        true,
    )
    .await
    {
        Ok(()) => {}
        Err(error @ (AppError::Forbidden | AppError::NotFound(_))) => {
            return pause(transaction, workspace_id, template_id, error).await;
        }
        Err(error) => return Err(error),
    }

    let offset = occurrence
        .date
        .signed_duration_since(recurrence.anchor_date);
    let shift = |date: Option<NaiveDate>| date.and_then(|date| date.checked_add_signed(offset));
    let start_date = shift(template.start_date);
    let due_date = shift(template.due_date);
    validate_schedule(start_date, due_date, template.estimate)?;
    let state_id = open_state(&mut transaction, workspace_id, template.project_id).await?;
    let next = rule
        .next_after(timezone, occurrence.date, now)
        .map_err(invalid)?;
    if rule.action == RecurrenceAction::Reset {
        return reset_in_place(
            state,
            transaction,
            workspace_id,
            template_id,
            recurrence.owner_id,
            Reset {
                state_id,
                start_date,
                due_date,
                occurrence_date: occurrence.date,
                next_run_at: next.at,
            },
        )
        .await;
    }
    let title = TaskTitle::new(&template.title).map_err(invalid)?;
    let current_assignees = task_assignee_ids(&mut transaction, workspace_id, template_id).await?;
    let assignee_ids = valid_assignees(
        &mut transaction,
        workspace_id,
        template.project_id,
        &current_assignees,
    )
    .await?;
    let label_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT assignments.label_id
        FROM task_label_assignments AS assignments
        JOIN task_labels AS labels
          ON labels.workspace_id = assignments.workspace_id
         AND labels.id = assignments.label_id
        WHERE assignments.workspace_id = $1 AND assignments.task_id = $2
          AND labels.archived_at IS NULL
        ORDER BY assignments.label_id
        "#,
    )
    .bind(workspace_id)
    .bind(template_id)
    .fetch_all(&mut *transaction)
    .await?;
    let parent_id = match validate_parent(
        &mut transaction,
        workspace_id,
        template.project_id,
        None,
        template.parent_id,
    )
    .await
    {
        Ok(()) => template.parent_id,
        Err(AppError::Validation(_)) => None,
        Err(error) => return Err(error),
    };

    let template_path = task_vault_row(&mut transaction, workspace_id, template_id, false)
        .await?
        .path()?;
    let template_document = state
        .vault
        .read_task_document(workspace_id, &template_path)
        .await
        .map_err(AppError::internal)?;
    let body = frontmatter::body(&template_document.content)
        .map_err(|_| AppError::internal(anyhow::anyhow!("Task frontmatter is invalid")))?;
    let body = uncheck_task_items(body);

    let vault_row = insert_task(
        &mut transaction,
        workspace_id,
        recurrence.owner_id,
        NewTask {
            project_id: template.project_id,
            title: &title,
            state_id,
            priority: &template.priority,
            start_date,
            due_date,
            estimate: template.estimate,
            parent_id,
            assignee_ids: &assignee_ids,
            label_ids: &label_ids,
            cycle_id: None,
            module_ids: &[],
        },
        NewTaskValues::CopyFrom(template_id),
    )
    .await?;
    let task_id = vault_row.kanleaf_id;
    sqlx::query(
        r#"
        UPDATE task_recurrences
        SET task_id = $3, anchor_date = $4, next_run_at = $5, updated_at = now()
        WHERE workspace_id = $1 AND task_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(template_id)
    .bind(task_id)
    .bind(occurrence.date)
    .bind(next.at)
    .execute(&mut *transaction)
    .await?;

    let task_path = vault_row.path()?;
    let source = frontmatter::render_new(&vault_row.properties(), &body);
    state
        .vault
        .create_task_document(workspace_id, &task_path, &source)
        .await
        .map_err(AppError::internal)?;
    if let Err(error) = transaction.commit().await {
        if let Err(cleanup_error) = state
            .vault
            .remove_unattached_task_file(workspace_id, &task_path)
            .await
        {
            warn!(%task_id, %cleanup_error, "failed to clean up unattached repeated Task document");
        }
        return Err(error.into());
    }
    for changed in [template_id, task_id] {
        state
            .realtime
            .publish(RealtimeEvent::task_activity_changed(workspace_id, changed));
    }
    project_now(state, workspace_id, task_id).await;
    Ok(Some(task_id))
}

struct Reset {
    state_id: Uuid,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    occurrence_date: NaiveDate,
    next_run_at: DateTime<Utc>,
}

async fn reset_in_place(
    state: &AppState,
    mut transaction: Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    owner_id: Uuid,
    reset: Reset,
) -> Result<Option<Uuid>, AppError> {
    sqlx::query(
        r#"
        UPDATE tasks
        SET state_id = $3, start_date = $4, due_date = $5, updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(reset.state_id)
    .bind(reset.start_date)
    .bind(reset.due_date)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE task_recurrences
        SET anchor_date = $3, next_run_at = $4, updated_at = now()
        WHERE workspace_id = $1 AND task_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(reset.occurrence_date)
    .bind(reset.next_run_at)
    .execute(&mut *transaction)
    .await?;

    let task_path = task_vault_row(&mut transaction, workspace_id, task_id, false)
        .await?
        .path()?;
    let document = state
        .vault
        .read_task_document(workspace_id, &task_path)
        .await
        .map_err(AppError::internal)?;
    let body = frontmatter::body(&document.content)
        .map_err(|_| AppError::internal(anyhow::anyhow!("Task frontmatter is invalid")))?;
    let unchecked = uncheck_task_items(body);
    let mut fields = vec!["state", "start_date", "due_date"];
    if unchecked != body {
        fields.push("checklist");
    }
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        owner_id,
        "task_repeat_reset",
        serde_json::json!({ "fields": fields }),
    )
    .await?;
    task_event(
        &mut transaction,
        workspace_id,
        task_id,
        owner_id,
        EventType::TaskUpdated,
        &fields,
    )
    .await?;
    enqueue_projection(&mut transaction, workspace_id, &[task_id]).await?;
    // Like a body save, the revision-checked write precedes the commit; a failed
    // commit leaves an unchecked body that the retried reset writes again.
    if unchecked != body {
        let source = frontmatter::replace_body(&document.content, &unchecked)
            .map_err(|_| AppError::internal(anyhow::anyhow!("Task frontmatter is invalid")))?;
        state
            .vault
            .write_task_document(workspace_id, &task_path, &source, &document.revision)
            .await
            .map_err(map_vault_write_error)?;
    }
    transaction.commit().await?;
    state
        .realtime
        .publish(RealtimeEvent::task_activity_changed(workspace_id, task_id));
    project_now(state, workspace_id, task_id).await;
    Ok(Some(task_id))
}

/// The Project's default State, unless that State is terminal: an
/// after-completion repeat would otherwise fire again at once.
async fn open_state(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Uuid, AppError> {
    let default_id = resolve_task_default(transaction, workspace_id, project_id).await?;
    let open: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT CASE
            WHEN defaults.system_role IN ('done', 'cancelled') THEN todo.id
            ELSE defaults.id
        END
        FROM task_states AS defaults
        JOIN task_states AS todo
          ON todo.workspace_id = defaults.workspace_id AND todo.system_role = 'todo'
        WHERE defaults.workspace_id = $1 AND defaults.id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(default_id)
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(open.unwrap_or(default_id))
}

async fn pause(
    mut transaction: Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    reason: AppError,
) -> Result<Option<Uuid>, AppError> {
    warn!(%task_id, error = %reason, "pausing Task repeat");
    sqlx::query(
        "UPDATE task_recurrences SET paused_at = now(), updated_at = now() WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(None)
}

/// Clears checked GFM task-list items outside fenced code, changing only the
/// marker character so the rest of the Markdown stays byte-for-byte intact.
pub(crate) fn uncheck_task_items(markdown: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut fence: Option<(char, usize)> = None;
    for line in markdown.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some((marker, length)) = fence {
            let run = trimmed.chars().take_while(|ch| *ch == marker).count();
            if run >= length && trimmed[run..].trim().is_empty() {
                fence = None;
            }
            output.push_str(line);
            continue;
        }
        if let Some(marker) = trimmed.chars().next().filter(|ch| matches!(ch, '`' | '~')) {
            let run = trimmed.chars().take_while(|ch| *ch == marker).count();
            if run >= 3 {
                fence = Some((marker, run));
                output.push_str(line);
                continue;
            }
        }
        output.push_str(&uncheck_line(line));
    }
    output
}

fn uncheck_line(line: &str) -> Cow<'_, str> {
    let indent = line.len() - line.trim_start().len();
    let rest = &line[indent..];
    let marker = if rest.starts_with(['-', '*', '+']) {
        1
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if (1..=9).contains(&digits) && rest[digits..].starts_with(['.', ')']) {
            digits + 1
        } else {
            return Cow::Borrowed(line);
        }
    };
    let after_marker = &rest[marker..];
    let spaces = after_marker.len() - after_marker.trim_start_matches([' ', '\t']).len();
    if spaces == 0 {
        return Cow::Borrowed(line);
    }
    let box_start = indent + marker + spaces;
    let checkbox = &line[box_start..];
    let closed = checkbox
        .get(3..)
        .is_none_or(|tail| tail.is_empty() || tail.starts_with([' ', '\t', '\r', '\n']));
    if !(checkbox.starts_with("[x]") || checkbox.starts_with("[X]")) || !closed {
        return Cow::Borrowed(line);
    }
    let mut unchecked = String::with_capacity(line.len());
    unchecked.push_str(&line[..box_start + 1]);
    unchecked.push(' ');
    unchecked.push_str(&line[box_start + 2..]);
    Cow::Owned(unchecked)
}

#[cfg(test)]
mod tests {
    use super::uncheck_task_items;

    #[test]
    fn unchecks_bullet_and_ordered_task_items() {
        let source =
            "# Plan\n\n- [x] Warm up\n- [ ] Squat\n1. [X] Bench\n2) [x] Row\n  - [x] Nested\n";
        assert_eq!(
            uncheck_task_items(source),
            "# Plan\n\n- [ ] Warm up\n- [ ] Squat\n1. [ ] Bench\n2) [ ] Row\n  - [ ] Nested\n"
        );
    }

    #[test]
    fn leaves_code_and_non_list_text_untouched() {
        let source = "Not a task [x]\n```md\n- [x] example\n```\n~~~~\n- [x] still code\n~~~~\n-[x] no space\n- [x]tight\n- [x] done\r\n- [x]";
        assert_eq!(
            uncheck_task_items(source),
            "Not a task [x]\n```md\n- [x] example\n```\n~~~~\n- [x] still code\n~~~~\n-[x] no space\n- [x]tight\n- [ ] done\r\n- [ ]"
        );
    }
}
