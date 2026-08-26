#![cfg(feature = "postgres-tests")]

use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
async fn migration_enforces_workspace_project_and_task_constraints(pool: PgPool) {
    let first_workspace = Uuid::new_v4();
    let second_workspace = Uuid::new_v4();
    let project = Uuid::new_v4();

    for (id, name) in [
        (first_workspace, "First workspace"),
        (second_workspace, "Second workspace"),
    ] {
        sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, $2)")
            .bind(id)
            .bind(name)
            .execute(&pool)
            .await
            .unwrap();
    }

    sqlx::query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)")
        .bind(project)
        .bind(first_workspace)
        .bind("Kanleaf")
        .execute(&pool)
        .await
        .unwrap();

    let cross_workspace_task = sqlx::query(
        "INSERT INTO tasks (id, workspace_id, project_id, title) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(second_workspace)
    .bind(project)
    .bind("Escaped task")
    .execute(&pool)
    .await;
    assert!(cross_workspace_task.is_err());

    let invalid_status =
        sqlx::query("INSERT INTO tasks (id, workspace_id, title, status) VALUES ($1, $2, $3, $4)")
            .bind(Uuid::new_v4())
            .bind(first_workspace)
            .bind("Invalid task")
            .bind("unknown")
            .execute(&pool)
            .await;
    assert!(invalid_status.is_err());
}
