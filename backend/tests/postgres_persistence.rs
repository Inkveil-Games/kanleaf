#![cfg(feature = "postgres-tests")]

use std::time::{Duration, UNIX_EPOCH};

use kanleaf_backend::{
    domain::{
        user::UserId,
        workspace::{Workspace, WorkspaceRole},
    },
    persistence::{user, workspace},
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
