#![cfg(feature = "postgres-tests")]

use std::time::{Duration, UNIX_EPOCH};

use kanleaf_backend::{
    domain::{
        project::Project,
        task::{Task, TaskStatus},
        user::UserId,
        workspace::{Workspace, WorkspaceRole},
    },
    persistence::{project, session, task, user, workspace},
};
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn registration_is_transactional_and_personal_workspaces_are_isolated(pool: PgPool) {
    let first_user = UserId::new();
    let first_workspace = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        first_user,
        "person@example.com",
        "hash-a",
        &first_workspace,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();

    let second_user = UserId::new();
    let second_workspace = Workspace::new("Personal", UNIX_EPOCH + Duration::from_secs(1)).unwrap();
    user::register_with_personal_workspace(
        &pool,
        second_user,
        "second@example.com",
        "hash-b",
        &second_workspace,
        WorkspaceRole::Owner,
        UNIX_EPOCH + Duration::from_secs(1),
    )
    .await
    .unwrap();

    let duplicate = user::register_with_personal_workspace(
        &pool,
        UserId::new(),
        "person@example.com",
        "hash-c",
        &Workspace::new("Personal", UNIX_EPOCH).unwrap(),
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await;

    assert!(matches!(
        duplicate,
        Err(user::RegistrationError::DuplicateEmail)
    ));
    assert_eq!(
        workspace::list_for_user(&pool, first_user).await.unwrap(),
        vec![first_workspace.clone()]
    );
    assert_eq!(
        workspace::list_for_user(&pool, second_user).await.unwrap(),
        vec![second_workspace.clone()]
    );
    assert_eq!(
        workspace::active_workspace_id(&pool, first_user)
            .await
            .unwrap(),
        Some(first_workspace.id())
    );
    assert_eq!(
        workspace::active_workspace_id(&pool, second_user)
            .await
            .unwrap(),
        Some(second_workspace.id())
    );

    let first_role: String = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(uuid::Uuid::from(first_workspace.id()))
    .bind(uuid::Uuid::from(first_user))
    .fetch_one(&pool)
    .await
    .unwrap();
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    let workspace_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    let membership_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspace_memberships")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(first_role, "owner");
    assert_eq!(user_count, 2);
    assert_eq!(workspace_count, 2);
    assert_eq!(membership_count, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn workspace_operations_persist_and_require_membership(pool: PgPool) {
    let owner = UserId::new();
    let personal = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        owner,
        "owner@example.com",
        "hash-a",
        &personal,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();
    let outsider = UserId::new();
    let outsider_personal = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        outsider,
        "outsider@example.com",
        "hash-b",
        &outsider_personal,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();

    let kanleaf = Workspace::new("Kanleaf", UNIX_EPOCH + Duration::from_secs(2)).unwrap();
    workspace::create_for_user(&pool, owner, &kanleaf)
        .await
        .unwrap();

    assert!(
        workspace::has_membership(&pool, owner, kanleaf.id())
            .await
            .unwrap()
    );
    assert!(
        !workspace::has_membership(&pool, outsider, kanleaf.id())
            .await
            .unwrap()
    );
    assert!(
        workspace::rename_for_user(&pool, outsider, kanleaf.id(), "Stolen", UNIX_EPOCH,)
            .await
            .unwrap()
            .is_none()
    );

    let renamed = workspace::rename_for_user(
        &pool,
        owner,
        kanleaf.id(),
        "Kanleaf Core",
        UNIX_EPOCH + Duration::from_secs(3),
    )
    .await
    .unwrap()
    .unwrap();
    let owner_workspaces = workspace::list_for_user(&pool, owner).await.unwrap();
    let outsider_workspaces = workspace::list_for_user(&pool, outsider).await.unwrap();

    assert_eq!(renamed.name(), "Kanleaf Core");
    assert_eq!(owner_workspaces.len(), 2);
    assert!(
        owner_workspaces
            .iter()
            .any(|workspace| workspace.id() == kanleaf.id())
    );
    assert_eq!(outsider_workspaces, vec![outsider_personal]);
    assert_eq!(
        workspace::active_workspace_id(&pool, owner).await.unwrap(),
        Some(kanleaf.id())
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn sessions_store_only_token_digests_and_can_be_invalidated(pool: PgPool) {
    let user_id = UserId::new();
    let personal = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        user_id,
        "session@example.com",
        "hash",
        &personal,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();

    let token = "single-use-raw-bearer-token";
    session::create(&pool, user_id, token, UNIX_EPOCH)
        .await
        .unwrap();

    assert_eq!(
        session::user_for_token(&pool, token).await.unwrap(),
        Some(user_id)
    );
    assert_eq!(
        session::user_for_token(&pool, "invalid-token")
            .await
            .unwrap(),
        None
    );

    let stored_hash: Vec<u8> = sqlx::query_scalar("SELECT token_hash FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_hash.len(), 32);
    assert_ne!(stored_hash, token.as_bytes());

    session::delete(&pool, token).await.unwrap();
    assert_eq!(session::user_for_token(&pool, token).await.unwrap(), None);
}

#[sqlx::test(migrations = "./migrations")]
async fn projects_persist_with_workspace_and_membership_isolation(pool: PgPool) {
    let user_a = UserId::new();
    let workspace_a = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        user_a,
        "project-a@example.com",
        "hash-a",
        &workspace_a,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();
    let user_b = UserId::new();
    let workspace_b = Workspace::new("Personal", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        user_b,
        "project-b@example.com",
        "hash-b",
        &workspace_b,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();

    let project_a = Project::new(workspace_a.id(), "Project A", UNIX_EPOCH).unwrap();
    let project_b = Project::new(workspace_b.id(), "Project B", UNIX_EPOCH).unwrap();
    assert!(
        project::create_for_user(&pool, user_a, &project_a)
            .await
            .unwrap()
    );
    assert!(
        project::create_for_user(&pool, user_b, &project_b)
            .await
            .unwrap()
    );

    let guessed_project = Project::new(workspace_a.id(), "Guessed", UNIX_EPOCH).unwrap();
    assert!(
        !project::create_for_user(&pool, user_b, &guessed_project)
            .await
            .unwrap()
    );
    assert_eq!(
        project::list_for_user(&pool, user_a, workspace_a.id())
            .await
            .unwrap(),
        vec![project_a.clone()]
    );
    assert_eq!(
        project::list_for_user(&pool, user_b, workspace_b.id())
            .await
            .unwrap(),
        vec![project_b.clone()]
    );
    assert!(
        project::list_for_user(&pool, user_b, workspace_a.id())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        project::rename_for_user(
            &pool,
            user_b,
            workspace_a.id(),
            project_a.id(),
            "Stolen",
            UNIX_EPOCH,
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        project::rename_for_user(
            &pool,
            user_a,
            workspace_a.id(),
            project_b.id(),
            "Crossed",
            UNIX_EPOCH,
        )
        .await
        .unwrap()
        .is_none()
    );

    let renamed = project::rename_for_user(
        &pool,
        user_a,
        workspace_a.id(),
        project_a.id(),
        "Project A Renamed",
        UNIX_EPOCH + Duration::from_secs(1),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(renamed.name(), "Project A Renamed");

    let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(project_count, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn tasks_persist_with_inbox_project_and_workspace_isolation(pool: PgPool) {
    let user_a = UserId::new();
    let workspace_a = Workspace::new("Workspace A", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        user_a,
        "task-a@example.com",
        "hash-a",
        &workspace_a,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();
    let user_b = UserId::new();
    let workspace_b = Workspace::new("Workspace B", UNIX_EPOCH).unwrap();
    user::register_with_personal_workspace(
        &pool,
        user_b,
        "task-b@example.com",
        "hash-b",
        &workspace_b,
        WorkspaceRole::Owner,
        UNIX_EPOCH,
    )
    .await
    .unwrap();

    let project_a = Project::new(workspace_a.id(), "Project A", UNIX_EPOCH).unwrap();
    let project_b = Project::new(workspace_b.id(), "Project B", UNIX_EPOCH).unwrap();
    project::create_for_user(&pool, user_a, &project_a)
        .await
        .unwrap();
    project::create_for_user(&pool, user_b, &project_b)
        .await
        .unwrap();

    let mut inbox_task =
        Task::new(workspace_a.id(), None, "Inbox task", user_a, UNIX_EPOCH).unwrap();
    let mut project_task = Task::new(
        workspace_a.id(),
        Some(project_a.id()),
        "Project task",
        user_a,
        UNIX_EPOCH + Duration::from_secs(1),
    )
    .unwrap();
    assert!(
        task::create_for_user(&pool, user_a, &inbox_task)
            .await
            .unwrap()
    );
    assert!(
        task::create_for_user(&pool, user_a, &project_task)
            .await
            .unwrap()
    );

    let outsider_task =
        Task::new(workspace_a.id(), None, "Outsider task", user_b, UNIX_EPOCH).unwrap();
    let crossed_task = Task::new(
        workspace_a.id(),
        Some(project_b.id()),
        "Crossed task",
        user_a,
        UNIX_EPOCH,
    )
    .unwrap();
    assert!(
        !task::create_for_user(&pool, user_b, &outsider_task)
            .await
            .unwrap()
    );
    assert!(
        !task::create_for_user(&pool, user_a, &crossed_task)
            .await
            .unwrap()
    );

    assert_eq!(
        task::list_inbox_for_user(&pool, user_a, workspace_a.id())
            .await
            .unwrap(),
        vec![inbox_task.clone()]
    );
    assert_eq!(
        task::list_project_for_user(&pool, user_a, workspace_a.id(), project_a.id())
            .await
            .unwrap(),
        vec![project_task.clone()]
    );
    assert!(
        task::list_inbox_for_user(&pool, user_b, workspace_a.id())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        task::find_for_user(&pool, user_b, workspace_a.id(), inbox_task.id())
            .await
            .unwrap()
            .is_none()
    );

    let updated_at = UNIX_EPOCH + Duration::from_secs(2);
    inbox_task.rename("Inbox task renamed", updated_at).unwrap();
    inbox_task.set_status(TaskStatus::InProgress, updated_at);
    inbox_task.move_to_project(Some(project_a.id()), updated_at);
    assert_eq!(
        task::update_for_user(&pool, user_a, &inbox_task)
            .await
            .unwrap(),
        Some(inbox_task.clone())
    );
    assert!(
        task::list_inbox_for_user(&pool, user_a, workspace_a.id())
            .await
            .unwrap()
            .is_empty()
    );

    project_task.set_status(TaskStatus::Done, updated_at);
    project_task.move_to_project(None, updated_at);
    task::update_for_user(&pool, user_a, &project_task)
        .await
        .unwrap();
    assert_eq!(
        task::list_inbox_for_user(&pool, user_a, workspace_a.id())
            .await
            .unwrap(),
        vec![project_task.clone()]
    );
    assert_eq!(
        task::find_for_user(&pool, user_a, workspace_a.id(), project_task.id())
            .await
            .unwrap()
            .unwrap()
            .status(),
        TaskStatus::Done
    );

    let database_rejected_crossed_project = sqlx::query(
        "INSERT INTO tasks \
            (id, workspace_id, project_id, title, status, created_by, created_at, updated_at) \
         VALUES ($1, $2, $3, 'Invalid', 'todo', $4, NOW(), NOW())",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::from(workspace_a.id()))
    .bind(uuid::Uuid::from(project_b.id()))
    .bind(uuid::Uuid::from(user_a))
    .execute(&pool)
    .await;
    assert!(database_rejected_crossed_project.is_err());
}
