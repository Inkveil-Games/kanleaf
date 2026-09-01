#![cfg(feature = "postgres-tests")]

use kanleaf_server::domain::VaultStorageName;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
async fn instance_access_defaults_open_and_constrains_allowed_emails(pool: PgPool) {
    let settings: (i16, bool) =
        sqlx::query_as("SELECT id, restricted_access FROM instance_settings")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(settings, (1, false));

    let second_settings = sqlx::query("INSERT INTO instance_settings (id) VALUES (2)")
        .execute(&pool)
        .await;
    assert!(second_settings.is_err());

    sqlx::query("INSERT INTO instance_allowed_emails (email) VALUES ($1)")
        .bind("member@example.com")
        .execute(&pool)
        .await
        .unwrap();
    let unnormalized = sqlx::query("INSERT INTO instance_allowed_emails (email) VALUES ($1)")
        .bind(" Member@Example.com ")
        .execute(&pool)
        .await;
    assert!(unnormalized.is_err());
    let duplicate = sqlx::query("INSERT INTO instance_allowed_emails (email) VALUES ($1)")
        .bind("member@example.com")
        .execute(&pool)
        .await;
    assert!(duplicate.is_err());
}

#[sqlx::test(migrations = false)]
async fn account_setup_and_workspace_identifier_migration_backfills_existing_rows(pool: PgPool) {
    sqlx::raw_sql(include_str!("../migrations/0001_initial_schema.sql"))
        .execute(&pool)
        .await
        .unwrap();

    let user_id = Uuid::parse_str("aaaaaaaa-1111-4222-8333-123456789abc").unwrap();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')")
        .bind(user_id)
        .bind("existing@example.com")
        .execute(&pool)
        .await
        .unwrap();
    let first_workspace = Uuid::parse_str("b7c8d9e4-f120-44ea-8fd1-74948a86ccf1").unwrap();
    let second_workspace = Uuid::parse_str("d4e5f6a1-1111-4222-8333-123456789abc").unwrap();
    for workspace_id in [first_workspace, second_workspace] {
        sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, 'Kanleaf Core')")
            .bind(workspace_id)
            .execute(&pool)
            .await
            .unwrap();
    }

    sqlx::raw_sql(include_str!(
        "../migrations/0018_account_setup_workspace_identifiers.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let existing_stage: String = sqlx::query_scalar("SELECT setup_stage FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(existing_stage, "complete");
    let identifiers: Vec<String> =
        sqlx::query_scalar("SELECT identifier FROM workspaces ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        identifiers,
        [
            "kanleaf-core-b7c8d9e4f12044ea8fd174948a86ccf1",
            "kanleaf-core-d4e5f6a1111142228333123456789abc",
        ]
    );

    let new_user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')")
        .bind(new_user_id)
        .bind("new@example.com")
        .execute(&pool)
        .await
        .unwrap();
    let new_stage: String = sqlx::query_scalar("SELECT setup_stage FROM users WHERE id = $1")
        .bind(new_user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(new_stage, "account");
}

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
        let identifier = format!("workspace-{}", id.simple());
        sqlx::query(
            "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ($1, $2)",
        )
        .bind(&identifier)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO workspaces (id, name, identifier, default_inbox_state_id, default_task_type_id) VALUES ($1, $2, $3, $4, $5)",
        )
            .bind(id)
            .bind(name)
            .bind(identifier)
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

    let project_storage = VaultStorageName::from_initial_name("Kanleaf", project);
    sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, storage_name, identifier, default_state_id, default_task_type_id) VALUES ($1, $2, $3, $4, 'KAN', $5, $6)",
    )
        .bind(project)
        .bind(first_workspace)
        .bind("Kanleaf")
        .bind(project_storage.as_str())
        .bind(defaults[0].0)
        .bind(defaults[0].1)
        .execute(&pool)
        .await
        .unwrap();

    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version) VALUES ($1, $2, 'Note', 'note', 1)",
    )
    .bind(document_id)
    .bind(first_workspace)
    .execute(&pool)
    .await
    .unwrap();
    let duplicate_library_name = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version) VALUES ($1, $2, 'Duplicate', 'note', 1)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(duplicate_library_name.is_err());
    let unsafe_library_name = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version) VALUES ($1, $2, 'Unsafe', '../escape', 1)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(unsafe_library_name.is_err());

    let cross_workspace_task_id = Uuid::new_v4();
    let cross_workspace_storage =
        VaultStorageName::from_initial_name("Escaped task", cross_workspace_task_id);
    let cross_workspace_task = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, project_id, title, storage_name, state_id, task_type_id, task_number, position) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1024)",
    )
    .bind(cross_workspace_task_id)
    .bind(second_workspace)
    .bind(project)
    .bind("Escaped task")
    .bind(cross_workspace_storage.as_str())
    .bind(defaults[1].0)
    .bind(defaults[1].1)
    .execute(&pool)
    .await;
    assert!(cross_workspace_task.is_err());

    let invalid_priority_id = Uuid::new_v4();
    let invalid_priority_storage =
        VaultStorageName::from_initial_name("Invalid task", invalid_priority_id);
    let invalid_priority = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, title, storage_name, state_id, task_type_id, priority, task_number, position) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1024)",
    )
    .bind(invalid_priority_id)
    .bind(first_workspace)
    .bind("Invalid task")
    .bind(invalid_priority_storage.as_str())
    .bind(defaults[0].0)
    .bind(defaults[0].1)
    .bind("critical")
    .execute(&pool)
    .await;
    assert!(invalid_priority.is_err());
}

#[sqlx::test(migrations = false)]
async fn portable_vault_identity_migration_backfills_existing_rows(pool: PgPool) {
    for migration in [
        include_str!("../migrations/0001_initial_schema.sql"),
        include_str!("../migrations/0002_account_settings.sql"),
        include_str!("../migrations/0003_workspace_access.sql"),
        include_str!("../migrations/0004_task_configuration.sql"),
        include_str!("../migrations/0005_project_access.sql"),
        include_str!("../migrations/0006_task_workflow.sql"),
        include_str!("../migrations/0007_project_planning.sql"),
        include_str!("../migrations/0008_saved_views.sql"),
        include_str!("../migrations/0009_collaboration_notifications.sql"),
        include_str!("../migrations/0010_documents.sql"),
        include_str!("../migrations/0011_library_storage.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }

    let workspace_id = Uuid::new_v4();
    let state_id = Uuid::new_v4();
    let task_type_id = Uuid::new_v4();
    let project_id = Uuid::parse_str("d4e5f6a1-1111-4222-8333-123456789abc").unwrap();
    let task_id = Uuid::parse_str("b7c8d9e4-2222-4333-8444-123456789abc").unwrap();
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO workspaces (id, name, default_inbox_state_id, default_task_type_id) VALUES ($1, 'Existing', $2, $3)",
    )
    .bind(workspace_id)
    .bind(state_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO task_states (id, workspace_id, name, color, state_group, position) VALUES ($1, $2, 'Todo', '#64748B', 'todo', 0)",
    )
    .bind(state_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO task_types (id, workspace_id, name, icon, color, position, is_protected) VALUES ($1, $2, 'Task', 'check-square', '#64748B', 0, true)",
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, identifier, default_state_id, default_task_type_id) VALUES ($1, $2, 'Kanleaf Core', 'KAN', $3, $4)",
    )
    .bind(project_id)
    .bind(workspace_id)
    .bind(state_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO tasks (id, workspace_id, project_id, title, state_id, task_type_id, task_number, position) VALUES ($1, $2, $3, 'Triển khai export', $4, $5, 1, 1024)",
    )
    .bind(task_id)
    .bind(workspace_id)
    .bind(project_id)
    .bind(state_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    sqlx::raw_sql(include_str!(
        "../migrations/0012_portable_vault_identity.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let project_storage: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let task_storage: String = sqlx::query_scalar("SELECT storage_name FROM tasks WHERE id = $1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let layout_version: i16 =
        sqlx::query_scalar("SELECT vault_layout_version FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(project_storage, "kanleaf-core--d4e5f6");
    assert_eq!(task_storage, "triển-khai-export--b7c8d9");
    assert_eq!(layout_version, 0);

    sqlx::query("UPDATE projects SET name = 'Renamed' WHERE id = $1")
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        project_storage
    );

    let duplicate_storage = sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, storage_name, identifier, default_state_id, default_task_type_id) VALUES ($1, $2, 'Another', $3, 'ALT', $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(&project_storage)
    .bind(state_id)
    .bind(task_type_id)
    .execute(&pool)
    .await;
    assert!(duplicate_storage.is_err());
    let unsafe_storage =
        sqlx::query("UPDATE tasks SET storage_name = '../escape--abcdef' WHERE id = $1")
            .bind(task_id)
            .execute(&pool)
            .await;
    assert!(unsafe_storage.is_err());
    let unsupported_layout =
        sqlx::query("UPDATE workspaces SET vault_layout_version = 1 WHERE id = $1")
            .bind(workspace_id)
            .execute(&pool)
            .await;
    assert!(unsupported_layout.is_err());

    sqlx::raw_sql(include_str!("../migrations/0013_vault_projection.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let projection: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT tasks.metadata_version, tasks.projected_metadata_version,
               jobs.metadata_version
        FROM tasks
        JOIN task_projection_jobs AS jobs
          ON jobs.workspace_id = tasks.workspace_id AND jobs.task_id = tasks.id
        WHERE tasks.id = $1
        "#,
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(projection, (1, 0, 1));
    let invalid_projection =
        sqlx::query("UPDATE tasks SET projected_metadata_version = 2 WHERE id = $1")
            .bind(task_id)
            .execute(&pool)
            .await;
    assert!(invalid_projection.is_err());
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

    for migration in [
        include_str!("../migrations/0005_project_access.sql"),
        include_str!("../migrations/0006_task_workflow.sql"),
        include_str!("../migrations/0007_project_planning.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }
    let task_numbers: Vec<i64> = sqlx::query_scalar(
        "SELECT task_number FROM tasks WHERE workspace_id = $1 ORDER BY task_number",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(task_numbers, [1, 2, 3]);
    let next_task_number: i64 =
        sqlx::query_scalar("SELECT next_task_number FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(next_task_number, 4);
}
