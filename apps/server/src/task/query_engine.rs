use std::{collections::HashSet, hash::Hash};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    domain::{TaskPriority, TaskStateGroup},
    error::AppError,
    project::require_project_access,
    workspace::WorkspaceRole,
};

use super::{
    TaskFilters,
    model::{TaskResponse, TaskRow, hydrate_tasks},
    search_pattern,
};

pub(crate) const QUERY_VERSION: u16 = 1;
const MAX_FILTER_VALUES: usize = 100;
const MAX_SORT_FIELDS: usize = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskQuery {
    pub(crate) version: u16,
    pub(crate) scope: TaskQueryScope,
    #[serde(default)]
    pub(crate) search: Option<String>,
    #[serde(default)]
    pub(crate) filters: TaskQueryFilters,
    #[serde(default)]
    pub(crate) grouping: TaskGrouping,
    #[serde(default)]
    pub(crate) sort: Vec<TaskSort>,
    #[serde(default)]
    pub(crate) display: Vec<TaskDisplayProperty>,
    #[serde(default)]
    pub(crate) include_completed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum TaskQueryScope {
    Workspace,
    Inbox,
    MyWork,
    Project { project_id: Uuid },
    Cycle { cycle_id: Uuid },
    Module { module_id: Uuid },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskQueryFilters {
    #[serde(default)]
    pub(crate) states: IdFilter,
    #[serde(default)]
    pub(crate) state_groups: Vec<TaskStateGroup>,
    #[serde(default)]
    pub(crate) task_types: IdFilter,
    #[serde(default)]
    pub(crate) priorities: Vec<TaskPriority>,
    #[serde(default)]
    pub(crate) assignees: IdFilter,
    #[serde(default)]
    pub(crate) labels: IdFilter,
    #[serde(default)]
    pub(crate) projects: IdFilter,
    #[serde(default)]
    pub(crate) cycles: IdFilter,
    #[serde(default)]
    pub(crate) modules: IdFilter,
    #[serde(default)]
    pub(crate) start_date: DateFilter,
    #[serde(default)]
    pub(crate) due_date: DateFilter,
    #[serde(default)]
    pub(crate) estimate: EstimateFilter,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IdFilter {
    #[serde(default)]
    pub(crate) values: Vec<Uuid>,
    #[serde(default)]
    pub(crate) include_none: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DateFilter {
    #[serde(default)]
    pub(crate) from: Option<NaiveDate>,
    #[serde(default)]
    pub(crate) to: Option<NaiveDate>,
    #[serde(default)]
    pub(crate) include_none: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EstimateFilter {
    #[serde(default)]
    pub(crate) minimum: Option<i32>,
    #[serde(default)]
    pub(crate) maximum: Option<i32>,
    #[serde(default)]
    pub(crate) include_none: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskGrouping {
    #[serde(default)]
    pub(crate) primary: Option<TaskGroupField>,
    #[serde(default)]
    pub(crate) secondary: Option<TaskGroupField>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskGroupField {
    State,
    StateGroup,
    Priority,
    TaskType,
    Assignee,
    Label,
    Project,
    Cycle,
    Module,
    DueDate,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskSortField {
    Manual,
    Title,
    Priority,
    StartDate,
    DueDate,
    Estimate,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskSort {
    pub(crate) field: TaskSortField,
    pub(crate) direction: SortDirection,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskDisplayProperty {
    State,
    Priority,
    TaskType,
    Assignees,
    Labels,
    Project,
    Cycle,
    Modules,
    StartDate,
    DueDate,
    Estimate,
    UpdatedAt,
}

impl TaskQuery {
    pub(super) fn from_legacy(filters: TaskFilters) -> Self {
        let scope = if filters.inbox {
            TaskQueryScope::Inbox
        } else if let Some(project_id) = filters.project_id {
            TaskQueryScope::Project { project_id }
        } else if filters.my_work {
            TaskQueryScope::MyWork
        } else if let Some(cycle_id) = filters.cycle_id {
            TaskQueryScope::Cycle { cycle_id }
        } else if let Some(module_id) = filters.module_id {
            TaskQueryScope::Module { module_id }
        } else {
            TaskQueryScope::Workspace
        };
        Self {
            version: QUERY_VERSION,
            scope,
            search: filters.query,
            filters: TaskQueryFilters {
                states: id_filter(filters.state_id),
                task_types: id_filter(filters.task_type_id),
                priorities: filters.priority.into_iter().collect(),
                assignees: id_filter(filters.assignee_id),
                labels: id_filter(filters.label_id),
                due_date: DateFilter {
                    from: filters.due_after,
                    to: filters.due_before,
                    include_none: false,
                },
                ..TaskQueryFilters::default()
            },
            grouping: TaskGrouping::default(),
            sort: Vec::new(),
            display: Vec::new(),
            include_completed: true,
        }
    }

    pub(crate) fn validate(mut self) -> Result<Self, AppError> {
        if self.version != QUERY_VERSION {
            return Err(AppError::Validation(format!(
                "Task query version {} is not supported",
                self.version
            )));
        }
        if let Some(search) = self.search.take() {
            let search = search.trim();
            if !search.is_empty() {
                search_pattern(search)?;
                self.search = Some(search.to_owned());
            }
        }
        for (name, values) in [
            ("states", &self.filters.states.values),
            ("task types", &self.filters.task_types.values),
            ("assignees", &self.filters.assignees.values),
            ("labels", &self.filters.labels.values),
            ("projects", &self.filters.projects.values),
            ("cycles", &self.filters.cycles.values),
            ("modules", &self.filters.modules.values),
        ] {
            validate_values(name, values)?;
        }
        if self.filters.states.include_none || self.filters.task_types.include_none {
            return Err(AppError::Validation(
                "State and Task Type filters cannot include unassigned values".to_owned(),
            ));
        }
        validate_values("state groups", &self.filters.state_groups)?;
        validate_values("priorities", &self.filters.priorities)?;
        validate_range(
            "start date",
            self.filters.start_date.from,
            self.filters.start_date.to,
        )?;
        validate_range(
            "due date",
            self.filters.due_date.from,
            self.filters.due_date.to,
        )?;
        if self.filters.estimate.minimum.is_some_and(|value| value < 0)
            || self.filters.estimate.maximum.is_some_and(|value| value < 0)
        {
            return Err(AppError::Validation(
                "Estimate filters cannot be negative".to_owned(),
            ));
        }
        validate_range(
            "estimate",
            self.filters.estimate.minimum,
            self.filters.estimate.maximum,
        )?;
        if self.grouping.primary.is_some() && self.grouping.primary == self.grouping.secondary {
            return Err(AppError::Validation(
                "Primary and secondary grouping must differ".to_owned(),
            ));
        }
        if self.sort.len() > MAX_SORT_FIELDS {
            return Err(AppError::Validation(
                "A Task query supports at most two sort fields".to_owned(),
            ));
        }
        validate_values(
            "sort fields",
            &self.sort.iter().map(|sort| sort.field).collect::<Vec<_>>(),
        )?;
        validate_values("display properties", &self.display)?;
        Ok(self)
    }

    pub(crate) async fn authorize_scope(
        &self,
        pool: &PgPool,
        user_id: Uuid,
        workspace_id: Uuid,
        role: WorkspaceRole,
    ) -> Result<Option<Uuid>, AppError> {
        match self.scope {
            TaskQueryScope::Workspace | TaskQueryScope::MyWork => Ok(None),
            TaskQueryScope::Inbox => {
                if !role.can_access_content() {
                    return Err(AppError::Forbidden);
                }
                Ok(None)
            }
            TaskQueryScope::Project { project_id } => {
                require_project_access(pool, user_id, workspace_id, project_id).await?;
                Ok(Some(project_id))
            }
            TaskQueryScope::Cycle { cycle_id } => {
                scope_project(pool, user_id, workspace_id, ScopeResource::Cycle, cycle_id).await
            }
            TaskQueryScope::Module { module_id } => {
                scope_project(
                    pool,
                    user_id,
                    workspace_id,
                    ScopeResource::Module,
                    module_id,
                )
                .await
            }
        }
    }
}

pub(super) async fn run(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    role: WorkspaceRole,
    query: TaskQuery,
) -> Result<Vec<TaskResponse>, AppError> {
    let query = query.validate()?;
    query
        .authorize_scope(pool, user_id, workspace_id, role)
        .await?;
    let mut sql = QueryBuilder::<Postgres>::new(
        r#"
        SELECT tasks.id, tasks.workspace_id, tasks.project_id, tasks.title, tasks.storage_name,
               projects.identifier AS project_identifier, tasks.task_number,
               states.id AS state_id, states.name AS state_name,
               states.color AS state_color, states.state_group,
               task_types.id AS task_type_id, task_types.name AS task_type_name,
               task_types.icon AS task_type_icon, task_types.color AS task_type_color,
               tasks.priority, tasks.start_date, tasks.due_date, tasks.estimate,
               tasks.position, tasks.archived_at, tasks.created_at, tasks.updated_at
        FROM tasks
        LEFT JOIN projects ON projects.id = tasks.project_id
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        JOIN task_types
          ON task_types.workspace_id = tasks.workspace_id
         AND task_types.id = tasks.task_type_id
        WHERE tasks.workspace_id = "#,
    );
    sql.push_bind(workspace_id)
        .push(" AND tasks.archived_at IS NULL");
    push_scope(&mut sql, &query.scope, user_id);
    if let Some(search) = query.search.as_deref() {
        sql.push(" AND tasks.title ILIKE ")
            .push_bind(search_pattern(search)?)
            .push(" ESCAPE '\\'");
    }
    push_simple_id_filter(&mut sql, "tasks.state_id", &query.filters.states);
    push_simple_id_filter(&mut sql, "tasks.task_type_id", &query.filters.task_types);
    push_text_values(
        &mut sql,
        "states.state_group",
        query
            .filters
            .state_groups
            .iter()
            .map(|value| value.as_str().to_owned())
            .collect(),
    );
    push_text_values(
        &mut sql,
        "tasks.priority",
        query
            .filters
            .priorities
            .iter()
            .map(|value| value.as_str().to_owned())
            .collect(),
    );
    push_simple_id_filter(&mut sql, "tasks.project_id", &query.filters.projects);
    push_join_filter(
        &mut sql,
        "task_assignees",
        "user_id",
        &query.filters.assignees,
    );
    push_join_filter(
        &mut sql,
        "task_label_assignments",
        "label_id",
        &query.filters.labels,
    );
    push_join_filter(
        &mut sql,
        "task_cycle_assignments",
        "cycle_id",
        &query.filters.cycles,
    );
    push_join_filter(
        &mut sql,
        "task_module_assignments",
        "module_id",
        &query.filters.modules,
    );
    push_date_filter(&mut sql, "tasks.start_date", &query.filters.start_date);
    push_date_filter(&mut sql, "tasks.due_date", &query.filters.due_date);
    push_estimate_filter(&mut sql, &query.filters.estimate);
    if !query.include_completed {
        sql.push(" AND states.state_group NOT IN ('done', 'canceled')");
    }
    push_visibility(&mut sql, user_id, role);
    push_sort(&mut sql, &query.sort);

    let rows = sql.build_query_as::<TaskRow>().fetch_all(pool).await?;
    let mut tasks = rows.into_iter().map(TaskResponse::from).collect::<Vec<_>>();
    hydrate_tasks(pool, workspace_id, &mut tasks).await?;
    Ok(tasks)
}

fn push_scope(sql: &mut QueryBuilder<'_, Postgres>, scope: &TaskQueryScope, user_id: Uuid) {
    match scope {
        TaskQueryScope::Workspace => {}
        TaskQueryScope::Inbox => {
            sql.push(" AND tasks.project_id IS NULL");
        }
        TaskQueryScope::MyWork => {
            sql.push(
                " AND EXISTS (SELECT 1 FROM task_assignees scope_assignees WHERE scope_assignees.workspace_id = tasks.workspace_id AND scope_assignees.task_id = tasks.id AND scope_assignees.user_id = ",
            )
            .push_bind(user_id)
            .push(")");
        }
        TaskQueryScope::Project { project_id } => {
            sql.push(" AND tasks.project_id = ").push_bind(*project_id);
        }
        TaskQueryScope::Cycle { cycle_id } => {
            push_scope_join(sql, "task_cycle_assignments", "cycle_id", *cycle_id);
        }
        TaskQueryScope::Module { module_id } => {
            push_scope_join(sql, "task_module_assignments", "module_id", *module_id);
        }
    }
}

fn push_scope_join(sql: &mut QueryBuilder<'_, Postgres>, table: &str, field: &str, value: Uuid) {
    sql.push(" AND EXISTS (SELECT 1 FROM ")
        .push(table)
        .push(" scope_assignment WHERE scope_assignment.workspace_id = tasks.workspace_id AND scope_assignment.task_id = tasks.id AND scope_assignment.")
        .push(field)
        .push(" = ")
        .push_bind(value)
        .push(")");
}

fn push_simple_id_filter(sql: &mut QueryBuilder<'_, Postgres>, field: &str, filter: &IdFilter) {
    if filter.values.is_empty() && !filter.include_none {
        return;
    }
    sql.push(" AND (");
    if !filter.values.is_empty() {
        sql.push(field)
            .push(" = ANY(")
            .push_bind(filter.values.clone())
            .push(")");
        if filter.include_none {
            sql.push(" OR ");
        }
    }
    if filter.include_none {
        sql.push(field).push(" IS NULL");
    }
    sql.push(")");
}

fn push_text_values(sql: &mut QueryBuilder<'_, Postgres>, field: &str, values: Vec<String>) {
    if values.is_empty() {
        return;
    }
    sql.push(" AND ")
        .push(field)
        .push(" = ANY(")
        .push_bind(values)
        .push(")");
}

fn push_join_filter(
    sql: &mut QueryBuilder<'_, Postgres>,
    table: &str,
    field: &str,
    filter: &IdFilter,
) {
    if filter.values.is_empty() && !filter.include_none {
        return;
    }
    sql.push(" AND (");
    if !filter.values.is_empty() {
        sql.push("EXISTS (SELECT 1 FROM ")
            .push(table)
            .push(" filter_assignment WHERE filter_assignment.workspace_id = tasks.workspace_id AND filter_assignment.task_id = tasks.id AND filter_assignment.")
            .push(field)
            .push(" = ANY(")
            .push_bind(filter.values.clone())
            .push("))");
        if filter.include_none {
            sql.push(" OR ");
        }
    }
    if filter.include_none {
        sql.push("NOT EXISTS (SELECT 1 FROM ")
            .push(table)
            .push(" empty_assignment WHERE empty_assignment.workspace_id = tasks.workspace_id AND empty_assignment.task_id = tasks.id)");
    }
    sql.push(")");
}

fn push_date_filter(sql: &mut QueryBuilder<'_, Postgres>, field: &str, filter: &DateFilter) {
    if filter.from.is_none() && filter.to.is_none() && !filter.include_none {
        return;
    }
    sql.push(" AND (");
    if filter.from.is_some() || filter.to.is_some() {
        sql.push("(");
        let mut has_condition = false;
        if let Some(from) = filter.from {
            sql.push(field).push(" >= ").push_bind(from);
            has_condition = true;
        }
        if let Some(to) = filter.to {
            if has_condition {
                sql.push(" AND ");
            }
            sql.push(field).push(" <= ").push_bind(to);
        }
        sql.push(")");
        if filter.include_none {
            sql.push(" OR ");
        }
    }
    if filter.include_none {
        sql.push(field).push(" IS NULL");
    }
    sql.push(")");
}

fn push_estimate_filter(sql: &mut QueryBuilder<'_, Postgres>, filter: &EstimateFilter) {
    if filter.minimum.is_none() && filter.maximum.is_none() && !filter.include_none {
        return;
    }
    sql.push(" AND (");
    if filter.minimum.is_some() || filter.maximum.is_some() {
        sql.push("(");
        let mut has_condition = false;
        if let Some(minimum) = filter.minimum {
            sql.push("tasks.estimate >= ").push_bind(minimum);
            has_condition = true;
        }
        if let Some(maximum) = filter.maximum {
            if has_condition {
                sql.push(" AND ");
            }
            sql.push("tasks.estimate <= ").push_bind(maximum);
        }
        sql.push(")");
        if filter.include_none {
            sql.push(" OR ");
        }
    }
    if filter.include_none {
        sql.push("tasks.estimate IS NULL");
    }
    sql.push(")");
}

fn push_visibility(sql: &mut QueryBuilder<'_, Postgres>, user_id: Uuid, role: WorkspaceRole) {
    if role.can_manage() {
        return;
    }
    sql.push(" AND (");
    if role.can_access_content() {
        sql.push("tasks.project_id IS NULL OR ");
    }
    sql.push("EXISTS (SELECT 1 FROM project_memberships visible_projects WHERE visible_projects.workspace_id = tasks.workspace_id AND visible_projects.project_id = tasks.project_id AND visible_projects.user_id = ")
        .push_bind(user_id)
        .push("))");
}

fn push_sort(sql: &mut QueryBuilder<'_, Postgres>, sort: &[TaskSort]) {
    sql.push(" ORDER BY ");
    if sort.is_empty() {
        sql.push("tasks.position ASC, tasks.task_number ASC");
        return;
    }
    for (index, item) in sort.iter().enumerate() {
        if index > 0 {
            sql.push(", ");
        }
        sql.push(match item.field {
            TaskSortField::Manual => "tasks.position",
            TaskSortField::Title => "lower(tasks.title)",
            TaskSortField::Priority => {
                "CASE tasks.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END"
            }
            TaskSortField::StartDate => "tasks.start_date",
            TaskSortField::DueDate => "tasks.due_date",
            TaskSortField::Estimate => "tasks.estimate",
            TaskSortField::CreatedAt => "tasks.created_at",
            TaskSortField::UpdatedAt => "tasks.updated_at",
        });
        sql.push(match item.direction {
            SortDirection::Ascending => " ASC",
            SortDirection::Descending => " DESC",
        });
        if matches!(
            item.field,
            TaskSortField::StartDate | TaskSortField::DueDate | TaskSortField::Estimate
        ) {
            sql.push(" NULLS LAST");
        }
    }
    sql.push(", tasks.task_number ASC");
}

async fn scope_project(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    resource: ScopeResource,
    id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let statement = match resource {
        ScopeResource::Cycle => {
            "SELECT project_id FROM project_cycles WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL"
        }
        ScopeResource::Module => {
            "SELECT project_id FROM project_modules WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL"
        }
    };
    let project_id: Uuid = sqlx::query_scalar(statement)
        .bind(workspace_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Planning scope not found".to_owned()))?;
    require_project_access(pool, user_id, workspace_id, project_id).await?;
    Ok(Some(project_id))
}

#[derive(Clone, Copy)]
enum ScopeResource {
    Cycle,
    Module,
}

fn id_filter(value: Option<Uuid>) -> IdFilter {
    IdFilter {
        values: value.into_iter().collect(),
        include_none: false,
    }
}

fn validate_values<T>(name: &str, values: &[T]) -> Result<(), AppError>
where
    T: Copy + Eq + Hash,
{
    if values.len() > MAX_FILTER_VALUES {
        return Err(AppError::Validation(format!(
            "Task query {name} cannot contain more than {MAX_FILTER_VALUES} values"
        )));
    }
    let mut unique = HashSet::with_capacity(values.len());
    if values.iter().any(|value| !unique.insert(*value)) {
        return Err(AppError::Validation(format!(
            "Task query {name} cannot contain duplicates"
        )));
    }
    Ok(())
}

fn validate_range<T>(name: &str, from: Option<T>, to: Option<T>) -> Result<(), AppError>
where
    T: Ord,
{
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(AppError::Validation(format!(
            "Task query {name} range is invalid"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::TaskQuery;

    #[test]
    fn rejects_unknown_versions_and_duplicate_configuration() {
        let unsupported: TaskQuery = serde_json::from_value(json!({
            "version": 2,
            "scope": {"kind": "workspace"}
        }))
        .unwrap();
        assert!(unsupported.validate().is_err());

        let duplicate: TaskQuery = serde_json::from_value(json!({
            "version": 1,
            "scope": {"kind": "workspace"},
            "grouping": {"primary": "state", "secondary": "state"}
        }))
        .unwrap();
        assert!(duplicate.validate().is_err());
    }

    #[test]
    fn rejects_unknown_query_fields() {
        let result = serde_json::from_value::<TaskQuery>(json!({
            "version": 1,
            "scope": {"kind": "workspace"},
            "sort": [{"field": "drop_table", "direction": "ascending"}]
        }));
        assert!(result.is_err());

        let result = serde_json::from_value::<TaskQuery>(json!({
            "version": 1,
            "scope": {"kind": "workspace"},
            "sql": "DROP TABLE tasks"
        }));
        assert!(result.is_err());
    }
}
