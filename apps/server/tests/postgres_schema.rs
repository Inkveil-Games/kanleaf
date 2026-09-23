#![cfg(feature = "postgres-tests")]

use std::borrow::Cow;

use kanleaf_server::{domain::VaultStorageName, migration::run_database_migrations};
use sqlx::{PgPool, migrate::Migrator};
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
async fn migration_runner_restores_an_interrupted_saved_view_trigger(pool: PgPool) {
    sqlx::query("ALTER TABLE saved_views DISABLE TRIGGER saved_views_config_projection_dirty")
        .execute(&pool)
        .await
        .unwrap();

    run_database_migrations(&pool).await.unwrap();

    let trigger_enabled: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM pg_trigger
            JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
            WHERE pg_class.relname = 'saved_views'
              AND pg_trigger.tgname = 'saved_views_config_projection_dirty'
              AND pg_trigger.tgenabled = 'O'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(trigger_enabled);
}

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

    sqlx::query(
        "UPDATE workspace_identifier_registry SET retired_at = now() WHERE workspace_id = $1",
    )
    .bind(first_workspace)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(first_workspace)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::raw_sql(include_str!(
        "../migrations/0020_release_deleted_workspace_identifiers.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let retired_identifier_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_identifier_registry WHERE workspace_id = $1",
    )
    .bind(first_workspace)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retired_identifier_count, 0);
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
            "INSERT INTO workspaces (id, name, identifier, default_inbox_state_id) VALUES ($1, $2, $3, $4)",
        )
            .bind(id)
            .bind(name)
            .bind(identifier)
            .bind(state_id)
            .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO task_states (id, workspace_id, name, color, description, system_role, position) VALUES ($1, $2, 'Todo', '#7A4DD1', 'Ready to be worked on.', 'todo', 1)",
        )
        .bind(state_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        defaults.push(state_id);
    }

    let project_storage = VaultStorageName::from_initial_name("Kanleaf", project);
    sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, storage_name, identifier, default_state_id) VALUES ($1, $2, $3, $4, 'kanleaf', $5)",
    )
        .bind(project)
        .bind(first_workspace)
        .bind("Kanleaf")
        .bind(project_storage.as_str())
        .bind(defaults[0])
        .execute(&pool)
        .await
        .unwrap();

    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version, document_number) VALUES ($1, $2, 'Note', 'note', 1, 1)",
    )
    .bind(document_id)
    .bind(first_workspace)
    .execute(&pool)
    .await
    .unwrap();
    let duplicate_library_name = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version, document_number) VALUES ($1, $2, 'Duplicate', 'note', 1, 2)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(duplicate_library_name.is_err());
    let unsafe_library_name = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version, document_number) VALUES ($1, $2, 'Unsafe', '../escape', 1, 2)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(unsafe_library_name.is_err());
    let duplicate_document_number = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version, document_number) VALUES ($1, $2, 'Duplicate number', 'duplicate_number', 1, 1)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(duplicate_document_number.is_err());
    let invalid_document_number = sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, storage_name, storage_layout_version, document_number) VALUES ($1, $2, 'Invalid number', 'invalid_number', 1, 0)",
    )
    .bind(Uuid::new_v4())
    .bind(first_workspace)
    .execute(&pool)
    .await;
    assert!(invalid_document_number.is_err());

    let cross_workspace_task_id = Uuid::new_v4();
    let cross_workspace_storage =
        VaultStorageName::from_initial_name("Escaped task", cross_workspace_task_id);
    let cross_workspace_task = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, project_id, title, storage_name, state_id, task_number, position) VALUES ($1, $2, $3, $4, $5, $6, 1, 1024)",
    )
    .bind(cross_workspace_task_id)
    .bind(second_workspace)
    .bind(project)
    .bind("Escaped task")
    .bind(cross_workspace_storage.as_str())
    .bind(defaults[1])
    .execute(&pool)
    .await;
    assert!(cross_workspace_task.is_err());

    let invalid_priority_id = Uuid::new_v4();
    let invalid_priority_storage =
        VaultStorageName::from_initial_name("Invalid task", invalid_priority_id);
    let invalid_priority = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, title, storage_name, state_id, priority, task_number, position) VALUES ($1, $2, $3, $4, $5, $6, 1, 1024)",
    )
    .bind(invalid_priority_id)
    .bind(first_workspace)
    .bind("Invalid task")
    .bind(invalid_priority_storage.as_str())
    .bind(defaults[0])
    .bind("urgent")
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

#[sqlx::test(migrations = false)]
async fn unified_select_expand_migration_preserves_identity_and_promotes_meaningful_types(
    pool: PgPool,
) {
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
        include_str!("../migrations/0012_portable_vault_identity.sql"),
        include_str!("../migrations/0013_vault_projection.sql"),
        include_str!("../migrations/0014_workspace_operations.sql"),
        include_str!("../migrations/0015_workspace_config_projection.sql"),
        include_str!("../migrations/0016_workspace_archive_restore_map.sql"),
        include_str!("../migrations/0017_instance_access.sql"),
        include_str!("../migrations/0018_account_setup_workspace_identifiers.sql"),
        include_str!("../migrations/0019_project_public_identity.sql"),
        include_str!("../migrations/0020_release_deleted_workspace_identifiers.sql"),
        include_str!("../migrations/0021_workspace_custom_properties.sql"),
        include_str!("../migrations/0022_document_numbers.sql"),
        include_str!("../migrations/0023_password_reset_tokens.sql"),
        include_str!("../migrations/0024_developer_console_namespace.sql"),
        include_str!("../migrations/0025_workspace_webhooks.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }

    let owner_id = Uuid::new_v4();
    let workspace_plain = Uuid::new_v4();
    let workspace_meaningful = Uuid::new_v4();
    let plain_states = [
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
    ];
    let plain_task_type = Uuid::new_v4();
    let meaningful_backlog = Uuid::new_v4();
    let meaningful_todo = Uuid::new_v4();
    let meaningful_in_progress = Uuid::new_v4();
    let meaningful_extra_in_progress = Uuid::new_v4();
    let meaningful_archived_done = Uuid::new_v4();
    let meaningful_done = Uuid::new_v4();
    let meaningful_canceled = Uuid::new_v4();
    let meaningful_task_type = Uuid::new_v4();
    let meaningful_bug_type = Uuid::new_v4();
    let meaningful_archived_bug_type = Uuid::new_v4();
    let meaningful_project = Uuid::new_v4();
    let plain_task = Uuid::new_v4();
    let meaningful_task = Uuid::new_v4();
    let meaningful_bug_task = Uuid::new_v4();

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, 'owner@example.com', 'Owner', 'hash')",
    )
    .bind(owner_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    for (workspace_id, name, default_state_id, default_type_id) in [
        (
            workspace_plain,
            "Plain legacy",
            plain_states[1],
            plain_task_type,
        ),
        (
            workspace_meaningful,
            "Meaningful legacy",
            meaningful_todo,
            meaningful_task_type,
        ),
    ] {
        let identifier = format!("workspace-{}", workspace_id.simple());
        sqlx::query(
            "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ($1, $2)",
        )
        .bind(&identifier)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            r#"
            INSERT INTO workspaces (
                id, name, identifier, default_inbox_state_id, default_task_type_id
            ) VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(workspace_id)
        .bind(name)
        .bind(identifier)
        .bind(default_state_id)
        .bind(default_type_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(workspace_id)
        .bind(owner_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    for (position, (name, color, state_group)) in [
        ("Backlog", "#6B7280", "backlog"),
        ("Todo", "#64748B", "todo"),
        ("In Progress", "#3B82F6", "in_progress"),
        ("Done", "#22A06B", "done"),
        ("Canceled", "#A1A1AA", "canceled"),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            r#"
            INSERT INTO task_states (id, workspace_id, name, color, state_group, position)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(plain_states[position])
        .bind(workspace_plain)
        .bind(name)
        .bind(color)
        .bind(state_group)
        .bind(position as i32)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }
    sqlx::query(
        r#"
        INSERT INTO task_types (
            id, workspace_id, name, icon, color, description, position, is_protected
        ) VALUES ($1, $2, 'Task', 'check-square', '#64748B', 'General work item', 0, true)
        "#,
    )
    .bind(plain_task_type)
    .bind(workspace_plain)
    .execute(&mut *transaction)
    .await
    .unwrap();

    for (id, name, color, state_group, position, archived) in [
        (
            meaningful_backlog,
            "Backlog",
            "#6B7280",
            "backlog",
            0,
            false,
        ),
        (meaningful_todo, "Ready", "#F97316", "todo", 1, false),
        (
            meaningful_in_progress,
            "In Progress",
            "#8B5CF6",
            "in_progress",
            2,
            false,
        ),
        (meaningful_archived_done, "Done", "#16A34A", "done", 3, true),
        (
            meaningful_canceled,
            "Canceled",
            "#A1A1AA",
            "canceled",
            4,
            false,
        ),
        (
            meaningful_extra_in_progress,
            "Review",
            "#0EA5E9",
            "in_progress",
            5,
            false,
        ),
        (meaningful_done, "Completed", "#15803D", "done", 6, false),
    ] {
        sqlx::query(
            r#"
            INSERT INTO task_states (
                id, workspace_id, name, color, state_group, position, archived_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END)
            "#,
        )
        .bind(id)
        .bind(workspace_meaningful)
        .bind(name)
        .bind(color)
        .bind(state_group)
        .bind(position)
        .bind(archived)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    for (id, name, icon, color, description, position, protected, archived) in [
        (
            meaningful_task_type,
            "Task",
            "check-square",
            "#64748B",
            "General work item",
            0,
            true,
            false,
        ),
        (
            meaningful_bug_type,
            "Bug",
            "bug",
            "#EF4444",
            "Needs a fix",
            1,
            false,
            false,
        ),
        (
            meaningful_archived_bug_type,
            "Bug",
            "bug",
            "#F97316",
            "Old bug type",
            2,
            false,
            true,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO task_types (
                id, workspace_id, name, icon, color, description, position,
                is_protected, archived_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                CASE WHEN $9 THEN now() ELSE NULL END
            )
            "#,
        )
        .bind(id)
        .bind(workspace_meaningful)
        .bind(name)
        .bind(icon)
        .bind(color)
        .bind(description)
        .bind(position)
        .bind(protected)
        .bind(archived)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    let project_storage = format!(
        "meaningful--{}",
        &meaningful_project.simple().to_string()[..6]
    );
    sqlx::query(
        r#"
        INSERT INTO projects (
            id, workspace_id, name, storage_name, identifier,
            default_state_id, default_task_type_id
        ) VALUES ($1, $2, 'Meaningful project', $3, 'meaningful-project', $4, $5)
        "#,
    )
    .bind(meaningful_project)
    .bind(workspace_meaningful)
    .bind(project_storage)
    .bind(meaningful_todo)
    .bind(meaningful_bug_type)
    .execute(&mut *transaction)
    .await
    .unwrap();
    for task_type_id in [meaningful_task_type, meaningful_bug_type] {
        sqlx::query(
            "INSERT INTO project_task_types (workspace_id, project_id, task_type_id) VALUES ($1, $2, $3)",
        )
        .bind(workspace_meaningful)
        .bind(meaningful_project)
        .bind(task_type_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    for (id, workspace_id, project_id, state_id, task_type_id, task_number, title) in [
        (
            plain_task,
            workspace_plain,
            None,
            plain_states[1],
            plain_task_type,
            1_i64,
            "Plain task",
        ),
        (
            meaningful_task,
            workspace_meaningful,
            Some(meaningful_project),
            meaningful_todo,
            meaningful_task_type,
            1,
            "Meaningful task",
        ),
        (
            meaningful_bug_task,
            workspace_meaningful,
            Some(meaningful_project),
            meaningful_in_progress,
            meaningful_bug_type,
            2,
            "Bug task",
        ),
    ] {
        let storage_name = format!("task--{}", &id.simple().to_string()[..6]);
        sqlx::query(
            r#"
            INSERT INTO tasks (
                id, workspace_id, project_id, title, storage_name, state_id,
                task_type_id, task_number, position
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8 * 1024)
            "#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(project_id)
        .bind(title)
        .bind(storage_name)
        .bind(state_id)
        .bind(task_type_id)
        .bind(task_number)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            r#"
            INSERT INTO task_projection_jobs (workspace_id, task_id, metadata_version)
            VALUES ($1, $2, 1)
            "#,
        )
        .bind(workspace_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    for (name, color) in [("Zulu", "#64748B"), ("alpha", "#3B82F6")] {
        sqlx::query(
            "INSERT INTO task_labels (id, workspace_id, name, color) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4())
        .bind(workspace_meaningful)
        .bind(name)
        .bind(color)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    sqlx::query(
        r#"
        INSERT INTO saved_views (
            id, workspace_id, project_id, owner_id, name, visibility,
            query_version, query, layout
        ) VALUES (
            $1, $2, $3, $4, 'Legacy grouped view', 'personal', 1,
            jsonb_build_object(
                'filters', jsonb_build_array(
                    jsonb_build_object('field', 'state_groups', 'value', jsonb_build_array('todo')),
                    jsonb_build_object('field', 'task_types', 'value', jsonb_build_array($5::text))
                ),
                'group_by', jsonb_build_array('state_groups', 'task_types')
            ),
            'list'
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_meaningful)
    .bind(meaningful_project)
    .bind(owner_id)
    .bind(meaningful_bug_type)
    .execute(&mut *transaction)
    .await
    .unwrap();

    transaction.commit().await.unwrap();

    sqlx::raw_sql(include_str!(
        "../migrations/0026_unified_select_properties_expand.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let meaningful_core: Vec<(Uuid, String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT id, system_role, name, icon, color
        FROM task_states
        WHERE workspace_id = $1 AND system_role IS NOT NULL
        ORDER BY system_role
        "#,
    )
    .bind(workspace_meaningful)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        meaningful_core,
        [
            (
                meaningful_done,
                "done".into(),
                "Done".into(),
                "circle-check".into(),
                "#22A06B".into(),
            ),
            (
                meaningful_in_progress,
                "in_progress".into(),
                "In Progress".into(),
                "loader-circle".into(),
                "#3B82F6".into(),
            ),
            (
                meaningful_todo,
                "todo".into(),
                "Todo".into(),
                "circle".into(),
                "#64748B".into(),
            ),
        ]
    );
    let plain_core_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_states WHERE workspace_id = $1 AND system_role IS NOT NULL",
    )
    .bind(workspace_plain)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(plain_core_count, 3);

    let migrated_property: (Uuid, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT id, default_option_id
        FROM custom_property_definitions
        WHERE workspace_id = $1 AND name = 'Type'
        "#,
    )
    .bind(workspace_meaningful)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(migrated_property.1, Some(meaningful_task_type));
    let plain_property_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM custom_property_definitions WHERE workspace_id = $1 AND name = 'Type'",
    )
    .bind(workspace_plain)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(plain_property_count, 0);

    let migrated_options: Vec<(Uuid, String, Option<String>, String, bool)> = sqlx::query_as(
        r#"
        SELECT id, name, icon, description, archived_at IS NOT NULL
        FROM custom_property_options
        WHERE property_id = $1
        ORDER BY archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(migrated_property.0)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(migrated_options.len(), 3);
    assert!(migrated_options.iter().any(|option| {
        option
            == &(
                meaningful_task_type,
                "Task".into(),
                Some("check-square".into()),
                "General work item".into(),
                false,
            )
    }));
    assert!(migrated_options.iter().any(|option| {
        option
            == &(
                meaningful_bug_type,
                "Bug".into(),
                Some("bug".into()),
                "Needs a fix".into(),
                false,
            )
    }));
    let archived_bug = migrated_options
        .iter()
        .find(|option| option.0 == meaningful_archived_bug_type)
        .unwrap();
    assert!(archived_bug.1.starts_with("Bug (archived "));
    assert_ne!(archived_bug.1, "Bug");

    let values: Vec<(Uuid, serde_json::Value)> = sqlx::query_as(
        r#"
        SELECT task_id, value
        FROM task_custom_property_values
        WHERE property_id = $1
        ORDER BY task_id
        "#,
    )
    .bind(migrated_property.0)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(values.len(), 2);
    assert!(values.contains(&(
        meaningful_task,
        serde_json::Value::String(meaningful_task_type.to_string()),
    )));
    assert!(values.contains(&(
        meaningful_bug_task,
        serde_json::Value::String(meaningful_bug_type.to_string()),
    )));

    let cleanup_jobs: Vec<(Uuid, Vec<String>)> = sqlx::query_as(
        r#"
        SELECT task_id, cleanup_property_names
        FROM task_projection_jobs
        ORDER BY task_id
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(cleanup_jobs.len(), 3);
    assert!(
        cleanup_jobs
            .iter()
            .all(|(_, cleanup_names)| cleanup_names == &["Type"])
    );

    let label_positions: Vec<(String, i32)> = sqlx::query_as(
        "SELECT name, position FROM task_labels WHERE workspace_id = $1 ORDER BY position",
    )
    .bind(workspace_meaningful)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(label_positions, [("alpha".into(), 0), ("Zulu".into(), 1)]);

    let legacy_columns: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
              ('task_states', 'state_group'),
              ('tasks', 'task_type_id'),
              ('workspaces', 'default_task_type_id')
          )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legacy_columns, 3);
}

#[sqlx::test(migrations = false)]
async fn unified_select_contract_migration_rewrites_views_and_drops_legacy_schema(pool: PgPool) {
    let all_migrations = sqlx::migrate!();
    let migrations_through_expand = Migrator {
        migrations: Cow::Owned(
            all_migrations
                .iter()
                .filter(|migration| migration.version <= 26)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    migrations_through_expand.run(&pool).await.unwrap();

    let owner_id = Uuid::parse_str("10000000-0000-4000-8000-000000000001").unwrap();
    let workspace_id = Uuid::parse_str("20000000-0000-4000-8000-000000000001").unwrap();
    let todo_id = Uuid::parse_str("30000000-0000-4000-8000-000000000001").unwrap();
    let in_progress_id = Uuid::parse_str("30000000-0000-4000-8000-000000000002").unwrap();
    let done_id = Uuid::parse_str("30000000-0000-4000-8000-000000000003").unwrap();
    let task_type_id = Uuid::parse_str("40000000-0000-4000-8000-000000000001").unwrap();
    let view_id = Uuid::parse_str("50000000-0000-4000-8000-000000000001").unwrap();
    let project_id = Uuid::parse_str("60000000-0000-4000-8000-000000000001").unwrap();

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, 'owner@example.com', 'Owner', 'hash')",
    )
    .bind(owner_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ('migration-test', $1)",
    )
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workspaces (
            id, name, identifier, default_inbox_state_id, default_task_type_id
        ) VALUES ($1, 'Migration test', 'migration-test', $2, $3)
        "#,
    )
    .bind(workspace_id)
    .bind(todo_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(owner_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    for (id, name, icon, color, role, position) in [
        (todo_id, "Todo", "circle", "#64748B", "todo", 0_i32),
        (
            in_progress_id,
            "In Progress",
            "loader-circle",
            "#3B82F6",
            "in_progress",
            1,
        ),
        (done_id, "Done", "circle-check", "#22A06B", "done", 2),
    ] {
        sqlx::query(
            r#"
            INSERT INTO task_states (
                id, workspace_id, name, icon, color, state_group, system_role, position
            ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
            "#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(name)
        .bind(icon)
        .bind(color)
        .bind(role)
        .bind(position)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }
    sqlx::query(
        r#"
        INSERT INTO task_types (
            id, workspace_id, name, icon, color, position, is_protected
        ) VALUES ($1, $2, 'Task', 'check-square', '#64748B', 0, true)
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO projects (
            id, workspace_id, name, storage_name, identifier,
            default_state_id, default_task_type_id
        ) VALUES (
            $1, $2, 'Migration project', 'migration-project--600000',
            'migration-project', $3, $4
        )
        "#,
    )
    .bind(project_id)
    .bind(workspace_id)
    .bind(todo_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO project_task_types (workspace_id, project_id, task_type_id) VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO saved_views (
            id, workspace_id, owner_id, name, visibility, query_version, query, layout
        ) VALUES (
            $1, $2, $3, 'Legacy select view', 'personal', 1,
            jsonb_build_object(
                'version', 1,
                'scope', jsonb_build_object('kind', 'workspace'),
                'filters', jsonb_build_object(
                    'states', jsonb_build_object(
                        'values', jsonb_build_array($4::text),
                        'include_none', false
                    ),
                    'state_groups', jsonb_build_array('todo', 'done'),
                    'task_types', jsonb_build_object(
                        'values', jsonb_build_array($5::text),
                        'include_none', false
                    )
                ),
                'grouping', jsonb_build_object(
                    'primary', 'task_type',
                    'secondary', 'state_group'
                ),
                'display', jsonb_build_array('task_type', 'state', 'priority'),
                'include_completed', false
            ),
            'list'
        )
        "#,
    )
    .bind(view_id)
    .bind(workspace_id)
    .bind(owner_id)
    .bind(todo_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    let config_version_before_migration: i64 =
        sqlx::query_scalar("SELECT config_version FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    run_database_migrations(&pool).await.unwrap();

    let (config_version_after_migration, saved_view_trigger_enabled): (i64, bool) = sqlx::query_as(
        r#"
            SELECT workspaces.config_version,
                   EXISTS (
                       SELECT 1
                       FROM pg_trigger
                       JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
                       WHERE pg_class.relname = 'saved_views'
                         AND pg_trigger.tgname = 'saved_views_config_projection_dirty'
                         AND pg_trigger.tgenabled = 'O'
                   )
            FROM workspaces
            WHERE workspaces.id = $1
            "#,
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(config_version_after_migration > config_version_before_migration);
    assert!(saved_view_trigger_enabled);

    let migrated: (i16, serde_json::Value) =
        sqlx::query_as("SELECT query_version, query FROM saved_views WHERE id = $1")
            .bind(view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(migrated.0, 2);
    assert_eq!(
        migrated.1,
        serde_json::json!({
            "version": 2,
            "scope": {"kind": "workspace"},
            "filters": {
                "states": {
                    "values": [todo_id, done_id],
                    "include_none": false
                }
            },
            "grouping": {"primary": "state", "secondary": null},
            "display": ["state", "priority"],
            "include_completed": false
        })
    );

    let legacy_columns: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (
              ('task_states', 'state_group'),
              ('tasks', 'task_type_id'),
              ('projects', 'default_task_type_id'),
              ('workspaces', 'default_task_type_id')
          )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legacy_columns, 0);
    let legacy_tables: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT to_regclass('task_types')::text, to_regclass('project_task_types')::text",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legacy_tables, (None, None));
}

#[sqlx::test(migrations = false)]
async fn document_number_migration_backfills_existing_pages_per_workspace(pool: PgPool) {
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
        include_str!("../migrations/0012_portable_vault_identity.sql"),
        include_str!("../migrations/0013_vault_projection.sql"),
        include_str!("../migrations/0014_workspace_operations.sql"),
        include_str!("../migrations/0015_workspace_config_projection.sql"),
        include_str!("../migrations/0016_workspace_archive_restore_map.sql"),
        include_str!("../migrations/0017_instance_access.sql"),
        include_str!("../migrations/0018_account_setup_workspace_identifiers.sql"),
        include_str!("../migrations/0019_project_public_identity.sql"),
        include_str!("../migrations/0020_release_deleted_workspace_identifiers.sql"),
        include_str!("../migrations/0021_workspace_custom_properties.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }

    let workspace_id = Uuid::new_v4();
    let state_id = Uuid::new_v4();
    let task_type_id = Uuid::new_v4();
    let identifier = format!("workspace-{}", workspace_id.simple());
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ($1, $2)",
    )
    .bind(&identifier)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workspaces (
            id, name, identifier, default_inbox_state_id, default_task_type_id
        ) VALUES ($1, 'Existing Library', $2, $3, $4)
        "#,
    )
    .bind(workspace_id)
    .bind(identifier)
    .bind(state_id)
    .bind(task_type_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO task_states (
            id, workspace_id, name, color, state_group, position
        ) VALUES ($1, $2, 'Todo', '#64748B', 'todo', 0)
        "#,
    )
    .bind(state_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO task_types (
            id, workspace_id, name, icon, color, position, is_protected
        ) VALUES ($1, $2, 'Task', 'check-square', '#64748B', 0, true)
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    let older_id = Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
    let first_tied_id = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();
    let second_tied_id = Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap();
    for (id, title, created_at) in [
        (first_tied_id, "Tie one", "2026-01-02T00:00:00Z"),
        (older_id, "Older", "2026-01-01T00:00:00Z"),
        (second_tied_id, "Tie two", "2026-01-02T00:00:00Z"),
    ] {
        sqlx::query(
            r#"
            INSERT INTO documents (
                id, workspace_id, title, storage_name, storage_layout_version,
                position, created_at
            ) VALUES ($1, $2, $3, $4, 1, 0, $5::timestamptz)
            "#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(title)
        .bind(id.simple().to_string())
        .bind(created_at)
        .execute(&pool)
        .await
        .unwrap();
    }

    sqlx::raw_sql(include_str!("../migrations/0022_document_numbers.sql"))
        .execute(&pool)
        .await
        .unwrap();

    let numbered: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT id, document_number FROM documents WHERE workspace_id = $1 ORDER BY document_number",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        numbered,
        [(older_id, 1), (first_tied_id, 2), (second_tied_id, 3)]
    );
    let next_number: i64 =
        sqlx::query_scalar("SELECT next_document_number FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(next_number, 4);
}

#[sqlx::test(migrations = false)]
async fn fixed_task_properties_migration_normalizes_states_priority_and_icons(pool: PgPool) {
    let all_migrations = sqlx::migrate!();
    let migrations_through_configurable_states = Migrator {
        migrations: Cow::Owned(
            all_migrations
                .iter()
                .filter(|migration| migration.version <= 27)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    migrations_through_configurable_states
        .run(&pool)
        .await
        .unwrap();

    let owner_id = Uuid::parse_str("10000000-0000-4000-8000-000000000028").unwrap();
    let workspace_id = Uuid::parse_str("20000000-0000-4000-8000-000000000028").unwrap();
    let project_id = Uuid::parse_str("60000000-0000-4000-8000-000000000028").unwrap();
    let view_id = Uuid::parse_str("50000000-0000-4000-8000-000000000028").unwrap();
    let todo_id = Uuid::parse_str("30000000-0000-4000-8000-000000000021").unwrap();
    let in_progress_id = Uuid::parse_str("30000000-0000-4000-8000-000000000022").unwrap();
    let done_id = Uuid::parse_str("30000000-0000-4000-8000-000000000023").unwrap();
    let backlog_id = Uuid::parse_str("30000000-0000-4000-8000-000000000024").unwrap();
    let archived_backlog_id = Uuid::parse_str("30000000-0000-4000-8000-000000000025").unwrap();
    let cancelled_id = Uuid::parse_str("30000000-0000-4000-8000-000000000026").unwrap();
    let custom_id = Uuid::parse_str("30000000-0000-4000-8000-000000000027").unwrap();
    let archived_id = Uuid::parse_str("30000000-0000-4000-8000-000000000028").unwrap();
    let label_id = Uuid::parse_str("70000000-0000-4000-8000-000000000028").unwrap();
    let property_id = Uuid::parse_str("80000000-0000-4000-8000-000000000028").unwrap();
    let option_id = Uuid::parse_str("90000000-0000-4000-8000-000000000028").unwrap();

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, 'fixed-properties@example.com', 'Owner', 'hash')",
    )
    .bind(owner_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ('fixed-properties', $1)",
    )
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workspaces (id, name, identifier, default_inbox_state_id)
        VALUES ($1, 'Fixed properties', 'fixed-properties', $2)
        "#,
    )
    .bind(workspace_id)
    .bind(custom_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(owner_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    for (id, name, icon, color, description, role, position, archived) in [
        (
            todo_id,
            "Todo",
            "circle",
            "#64748B",
            "Old todo",
            Some("todo"),
            0_i32,
            false,
        ),
        (
            in_progress_id,
            "In Progress",
            "loader-circle",
            "#3B82F6",
            "Old in progress",
            Some("in_progress"),
            1,
            false,
        ),
        (
            done_id,
            "Done",
            "circle-check",
            "#22A06B",
            "Old done",
            Some("done"),
            2,
            false,
        ),
        (
            backlog_id,
            "BACKLOG",
            "circle-dashed",
            "#111111",
            "Old backlog",
            None,
            3,
            false,
        ),
        (
            archived_backlog_id,
            "backlog",
            "circle-dashed",
            "#222222",
            "Archived duplicate",
            None,
            6,
            true,
        ),
        (
            cancelled_id,
            "Cancelled",
            "circle-x",
            "#333333",
            "Old cancelled",
            None,
            4,
            false,
        ),
        (
            custom_id,
            "Review",
            "eye",
            "#444444",
            "Custom active",
            None,
            5,
            false,
        ),
        (
            archived_id,
            "Icebox",
            "archive",
            "#555555",
            "Custom archived",
            None,
            7,
            true,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO task_states (
                id, workspace_id, name, icon, color, description,
                system_role, position, archived_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                CASE WHEN $9 THEN now() ELSE NULL END
            )
            "#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(name)
        .bind(icon)
        .bind(color)
        .bind(description)
        .bind(role)
        .bind(position)
        .bind(archived)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    let project_storage = VaultStorageName::from_initial_name("Fixed project", project_id);
    sqlx::query(
        r#"
        INSERT INTO projects (
            id, workspace_id, name, storage_name, identifier, default_state_id
        ) VALUES ($1, $2, 'Fixed project', $3, 'fixed-project', $4)
        "#,
    )
    .bind(project_id)
    .bind(workspace_id)
    .bind(project_storage.as_str())
    .bind(archived_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    let task_inputs = [
        (
            Uuid::parse_str("40000000-0000-4000-8000-000000000021").unwrap(),
            "Custom task",
            custom_id,
            "urgent",
            1_i64,
        ),
        (
            Uuid::parse_str("40000000-0000-4000-8000-000000000022").unwrap(),
            "Archived task",
            archived_id,
            "high",
            2_i64,
        ),
        (
            Uuid::parse_str("40000000-0000-4000-8000-000000000023").unwrap(),
            "Canonical task",
            todo_id,
            "none",
            3_i64,
        ),
    ];
    for (task_id, title, state_id, priority, task_number) in task_inputs {
        let storage_name = VaultStorageName::from_initial_name(title, task_id);
        sqlx::query(
            r#"
            INSERT INTO tasks (
                id, workspace_id, project_id, title, storage_name, state_id,
                priority, task_number, position
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8 * 1024)
            "#,
        )
        .bind(task_id)
        .bind(workspace_id)
        .bind(project_id)
        .bind(title)
        .bind(storage_name.as_str())
        .bind(state_id)
        .bind(priority)
        .bind(task_number)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    sqlx::query(
        r#"
        INSERT INTO saved_views (
            id, workspace_id, owner_id, name, visibility, query_version, query, layout
        ) VALUES (
            $1, $2, $3, 'Fixed properties view', 'personal', 2,
            jsonb_build_object(
                'version', 2,
                'scope', jsonb_build_object('kind', 'workspace'),
                'filters', jsonb_build_object(
                    'states', jsonb_build_object(
                        'values', jsonb_build_array(
                            $4::text, $5::text, $6::text, $7::text, $4::text
                        ),
                        'include_none', false
                    ),
                    'priorities', jsonb_build_array('urgent', 'high', 'urgent')
                ),
                'grouping', jsonb_build_object('primary', 'state', 'secondary', null),
                'display', jsonb_build_array('state', 'priority'),
                'include_completed', false
            ),
            'list'
        )
        "#,
    )
    .bind(view_id)
    .bind(workspace_id)
    .bind(owner_id)
    .bind(custom_id)
    .bind(todo_id)
    .bind(backlog_id)
    .bind(archived_backlog_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO task_labels (
            id, workspace_id, name, icon, color, description, position
        ) VALUES ($1, $2, 'Migration label', 'tag', '#AABBCC', 'Label', 0)
        "#,
    )
    .bind(label_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO custom_property_definitions (
            id, workspace_id, name, property_type, position
        ) VALUES ($1, $2, 'Migration select', 'single_select', 0)
        "#,
    )
    .bind(property_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO custom_property_options (
            id, workspace_id, property_id, name, icon, color, description, position
        ) VALUES ($1, $2, $3, 'Migration option', 'star', '#AABBCC', 'Option', 0)
        "#,
    )
    .bind(option_id)
    .bind(workspace_id)
    .bind(property_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    sqlx::query("DELETE FROM task_projection_jobs WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM workspace_config_projection_jobs WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();

    run_database_migrations(&pool).await.unwrap();

    let states: Vec<(String, String, String, String, i32)> = sqlx::query_as(
        r#"
        SELECT system_role, name, color, description, position
        FROM task_states
        WHERE workspace_id = $1
        ORDER BY position
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        states,
        vec![
            (
                "backlog".into(),
                "Backlog".into(),
                "#727480".into(),
                "Ideas and unprioritized work.".into(),
                0,
            ),
            (
                "todo".into(),
                "Todo".into(),
                "#7A4DD1".into(),
                "Ready to be worked on.".into(),
                1,
            ),
            (
                "in_progress".into(),
                "In Progress".into(),
                "#296DD6".into(),
                "Currently being worked on.".into(),
                2,
            ),
            (
                "done".into(),
                "Done".into(),
                "#2F945C".into(),
                "Completed and ready to close.".into(),
                3,
            ),
            (
                "cancelled".into(),
                "Cancelled".into(),
                "#D63D3C".into(),
                "Won't be completed.".into(),
                4,
            ),
        ]
    );

    let migrated_task_states: Vec<(String, Uuid)> = sqlx::query_as(
        "SELECT title, state_id FROM tasks WHERE workspace_id = $1 ORDER BY task_number",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        migrated_task_states,
        vec![
            ("Custom task".into(), backlog_id),
            ("Archived task".into(), backlog_id),
            ("Canonical task".into(), todo_id),
        ]
    );

    let workspace_default: Uuid =
        sqlx::query_scalar("SELECT default_inbox_state_id FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_default: Uuid =
        sqlx::query_scalar("SELECT default_state_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(workspace_default, todo_id);
    assert_eq!(project_default, todo_id);

    let migrated_view: serde_json::Value =
        sqlx::query_scalar("SELECT query FROM saved_views WHERE id = $1")
            .bind(view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        migrated_view["filters"]["states"]["values"],
        serde_json::json!([backlog_id, todo_id])
    );
    assert_eq!(
        migrated_view["filters"]["priorities"],
        serde_json::json!(["critical", "high"])
    );

    let migrated_priority: String =
        sqlx::query_scalar("SELECT priority FROM tasks WHERE title = 'Custom task'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(migrated_priority, "critical");

    let task_count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1")
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let queued_task_projection_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM task_projection_jobs WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(queued_task_projection_count, task_count);
    let queued_config_projection_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_config_projection_jobs WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(queued_config_projection_count, 1);

    let property_icon_column_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name = 'icon'
          AND table_name IN ('task_states', 'task_labels', 'custom_property_options')
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(property_icon_column_count, 0);

    let urgent_task_id = Uuid::new_v4();
    let urgent_storage = VaultStorageName::from_initial_name("Legacy priority", urgent_task_id);
    let urgent_insert = sqlx::query(
        r#"
        INSERT INTO tasks (
            id, workspace_id, title, storage_name, state_id,
            priority, task_number, position
        ) VALUES ($1, $2, 'Legacy priority', $3, $4, 'urgent', 4, 4096)
        "#,
    )
    .bind(urgent_task_id)
    .bind(workspace_id)
    .bind(urgent_storage.as_str())
    .bind(todo_id)
    .execute(&pool)
    .await;
    assert!(urgent_insert.is_err());

    let sixth_state_insert = sqlx::query(
        r#"
        INSERT INTO task_states (
            id, workspace_id, name, color, description, system_role, position
        ) VALUES (
            $1, $2, 'Review', '#123456', 'Reviewing work.', 'review', 5
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .execute(&pool)
    .await;
    assert!(sixth_state_insert.is_err());

    let mutate_canonical_state =
        sqlx::query("UPDATE task_states SET name = 'Queued' WHERE id = $1")
            .bind(todo_id)
            .execute(&pool)
            .await;
    assert!(mutate_canonical_state.is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn password_reset_tokens_enforce_hash_shape_indexes_and_user_cascade(pool: PgPool) {
    let identifier_constraints_validated: bool = sqlx::query_scalar(
        r#"
        SELECT bool_and(convalidated)
        FROM pg_constraint
        WHERE conname IN (
            'workspace_identifier_registry_format',
            'workspaces_identifier_format'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(identifier_constraints_validated);

    for identifier in ["developer", "forgot-password", "reset-password"] {
        let rejected = sqlx::query(
            "INSERT INTO workspace_identifier_registry (identifier, workspace_id) VALUES ($1, $2)",
        )
        .bind(identifier)
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await;
        assert!(rejected.is_err(), "accepted reserved route {identifier}");
    }

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, 'reset@example.com', 'Reset', 'hash')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '30 minutes')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(vec![7_u8; 32])
    .execute(&pool)
    .await
    .unwrap();
    let short_hash = sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '30 minutes')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(vec![7_u8; 31])
    .execute(&pool)
    .await;
    assert!(short_hash.is_err());

    let indexes: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'password_reset_tokens'
        ORDER BY indexname
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        indexes
            .iter()
            .any(|name| name == "password_reset_tokens_user_idx")
    );
    assert!(
        indexes
            .iter()
            .any(|name| name == "password_reset_tokens_expiry_idx")
    );

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}
