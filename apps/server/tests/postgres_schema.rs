#![cfg(feature = "postgres-tests")]

use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
async fn migration_enforces_workspace_project_and_task_constraints(pool: PgPool) {
    let first_workspace = Uuid::new_v4();
    let second_workspace = Uuid::new_v4();
    let project = Uuid::new_v4();
    let mut defaults = Vec::new();

    for (id, name) in [
        (first_workspace, "First workspace"),
        (second_workspace, "Second workspace"),
    ] {
        let state_id = Uuid::new_v4();
        let task_type_id = Uuid::new_v4();
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query(
            "INSERT INTO workspaces (id, name, default_inbox_state_id, default_task_type_id) VALUES ($1, $2, $3, $4)",
        )
            .bind(id)
            .bind(name)
            .bind(state_id)
            .bind(task_type_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO task_states (id, workspace_id, name, color, state_group, position) VALUES ($1, $2, 'Todo', '#64748B', 'todo', 0)",
        )
        .bind(state_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO task_types (id, workspace_id, name, icon, color, position, is_protected) VALUES ($1, $2, 'Task', 'check-square', '#64748B', 0, true)",
        )
        .bind(task_type_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        defaults.push((state_id, task_type_id));
    }

    sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, default_state_id, default_task_type_id) VALUES ($1, $2, $3, $4, $5)",
    )
        .bind(project)
        .bind(first_workspace)
        .bind("Kanleaf")
        .bind(defaults[0].0)
        .bind(defaults[0].1)
        .execute(&pool)
        .await
        .unwrap();

    let cross_workspace_task = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, project_id, title, state_id, task_type_id) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(second_workspace)
    .bind(project)
    .bind("Escaped task")
    .bind(defaults[1].0)
    .bind(defaults[1].1)
    .execute(&pool)
    .await;
    assert!(cross_workspace_task.is_err());

    let invalid_priority = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, title, state_id, task_type_id, priority) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .bind("Invalid task")
    .bind(defaults[0].0)
    .bind(defaults[0].1)
    .bind("critical")
    .execute(&pool)
    .await;
    assert!(invalid_priority.is_err());
}

#[sqlx::test(migrations = false)]
async fn task_configuration_migration_preserves_and_maps_existing_tasks(pool: PgPool) {
    for migration in [
        include_str!("../migrations/0001_initial_schema.sql"),
        include_str!("../migrations/0002_account_settings.sql"),
        include_str!("../migrations/0003_workspace_access.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }

    let workspace_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, 'Existing')")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();
    let task_ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    for (task_id, status) in task_ids.into_iter().zip(["todo", "in_progress", "done"]) {
        sqlx::query(
            "INSERT INTO tasks (id, workspace_id, title, status, priority) VALUES ($1, $2, $3, $4, 'high')",
        )
        .bind(task_id)
        .bind(workspace_id)
        .bind(format!("Existing {status}"))
        .bind(status)
        .execute(&pool)
        .await
        .unwrap();
    }

    sqlx::raw_sql(include_str!("../migrations/0004_task_configuration.sql"))
        .execute(&pool)
        .await
        .unwrap();

    let mapped: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        r#"
        SELECT tasks.id, states.state_group, task_types.name, tasks.priority
        FROM tasks
        JOIN task_states AS states ON states.id = tasks.state_id
        JOIN task_types ON task_types.id = tasks.task_type_id
        ORDER BY tasks.title
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        mapped
            .iter()
            .map(|(_, group, task_type, priority)| {
                (group.as_str(), task_type.as_str(), priority.as_str())
            })
            .collect::<Vec<_>>(),
        [
            ("done", "Task", "high"),
            ("in_progress", "Task", "high"),
            ("todo", "Task", "high"),
        ]
    );
}
