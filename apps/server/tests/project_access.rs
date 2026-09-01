#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{AppState, domain::VaultStorageName, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_app(pool: PgPool, data_dir: &TempDir) -> Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn json_request(method: &str, uri: &str, body: Value, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    request.body(Body::from(body.to_string())).unwrap()
}

fn empty_request(method: &str, uri: &str, token: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": email, "password": "correct horse battery"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": email.split('@').next().unwrap()}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Personal"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace_id = response_json(workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (token, user_id, workspace_id)
}

async fn add_workspace_member(pool: &PgPool, workspace_id: Uuid, user_id: Uuid, role: &str) {
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
}

async fn create_project(app: &Router, token: &str, workspace_id: Uuid, name: &str) -> Value {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({"name": name}),
            Some(token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn add_project_member(
    app: &Router,
    token: &str,
    workspace_id: Uuid,
    project_id: &str,
    user_id: Uuid,
    role: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members"),
            json!({"user_id": user_id, "role": role}),
            Some(token),
        ))
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn project_creation_uses_public_identity_and_allows_duplicate_names(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (_, member_id, _) = register(&app, "lead@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;

    let first = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({
                "name": "Product launch",
                "identifier": "product-launch",
                "description": "Coordinate the public launch",
                "icon": "rocket",
                "visibility": "public",
                "lead_user_id": member_id
            }),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);
    let first = response_json(first).await;
    assert_eq!(first["identifier"], "product-launch");
    assert_eq!(first["description"], "Coordinate the public launch");
    assert_eq!(first["icon"], "rocket");
    assert_eq!(first["visibility"], "public");
    assert_eq!(first["lead_user_id"], member_id.to_string());

    let lead_role: String = sqlx::query_scalar(
        "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
    )
    .bind(Uuid::parse_str(first["id"].as_str().unwrap()).unwrap())
    .bind(member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(lead_role, "admin");

    let duplicate_name = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({
                "name": "Product launch",
                "identifier": "second-launch",
                "description": "",
                "icon": "folder",
                "visibility": "private",
                "lead_user_id": null
            }),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate_name.status(), StatusCode::CREATED);

    let duplicate_identifier = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({
                "name": "Another name",
                "identifier": "product-launch",
                "description": "",
                "icon": "folder",
                "visibility": "private",
                "lead_user_id": null
            }),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate_identifier.status(), StatusCode::CONFLICT);

    let identifier_update = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!(
                "/api/workspaces/{workspace_id}/projects/{}",
                first["id"].as_str().unwrap()
            ),
            json!({"identifier": "renamed-project"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(identifier_update.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn project_archive_restores_data_and_delete_frees_the_identifier(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (guest_token, guest_id, _) = register(&app, "guest@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;
    add_workspace_member(&pool, workspace_id, guest_id, "guest").await;

    let project = create_project(&app, &owner_token, workspace_id, "Lifecycle").await;
    let project_id = project["id"].as_str().unwrap();
    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            member_id,
            "admin",
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Keep in Project", "project_id": project_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task = response_json(task).await;
    let by_number = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/by-number/{}",
                task["task_number"]
            ),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(by_number.status(), StatusCode::OK);
    assert_eq!(response_json(by_number).await["id"], task["id"]);
    let outside_task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Keep outside Project"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(outside_task.status(), StatusCode::CREATED);
    let outside_task = response_json(outside_task).await;
    let outside_task_id = Uuid::parse_str(outside_task["id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE tasks SET parent_id = $1 WHERE workspace_id = $2 AND id = $3")
        .bind(Uuid::parse_str(task["id"].as_str().unwrap()).unwrap())
        .bind(workspace_id)
        .bind(outside_task_id)
        .execute(&pool)
        .await
        .unwrap();
    let document = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents"),
            json!({"title": "Keep in Project", "project_id": project_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(document.status(), StatusCode::CREATED);
    let document = response_json(document).await;
    let project_directory = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Projects")
        .join(project["storage_name"].as_str().unwrap());
    assert!(project_directory.exists());

    let archived = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/archive"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);

    let task_project_id: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM tasks WHERE id = $1")
            .bind(Uuid::parse_str(task["id"].as_str().unwrap()).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    let document_project_id: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM documents WHERE id = $1")
            .bind(Uuid::parse_str(document["id"].as_str().unwrap()).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(task_project_id, Some(Uuid::parse_str(project_id).unwrap()));
    assert_eq!(
        document_project_id,
        Some(Uuid::parse_str(project_id).unwrap())
    );
    assert!(project_directory.exists());

    for (token, expected) in [
        (&owner_token, 1usize),
        (&member_token, 1usize),
        (&guest_token, 0usize),
    ] {
        let response = app
            .clone()
            .oneshot(empty_request(
                "GET",
                &format!("/api/workspaces/{workspace_id}/projects/archived"),
                token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await.as_array().unwrap().len(),
            expected
        );
    }

    let restored = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/restore"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::NO_CONTENT);

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(empty_request(
                "POST",
                &format!("/api/workspaces/{workspace_id}/projects/{project_id}/archive"),
                &owner_token,
            ))
            .await
            .unwrap();
        if response.status() == StatusCode::NO_CONTENT {
            break;
        }
    }
    let deleted = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/delete"),
            json!({"identifier": "lifecycle"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    for table in ["projects", "documents"] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE workspace_id = $1"
        ))
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "{table} still has Project-owned rows");
    }
    let outside_task_state: (Option<Uuid>, i64, i64) = sqlx::query_as(
        "SELECT parent_id, metadata_version, projected_metadata_version FROM tasks WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(outside_task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(outside_task_state.0, None);
    assert_eq!(outside_task_state.1, outside_task_state.2);
    let project_task_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1 AND id = $2")
            .bind(workspace_id)
            .bind(Uuid::parse_str(task["id"].as_str().unwrap()).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(project_task_count, 0);
    assert!(!project_directory.exists());

    let reused = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({"name": "Lifecycle again", "identifier": "lifecycle"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(reused.status(), StatusCode::CREATED);
    let reused = response_json(reused).await;
    let next_task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Do not reuse numbers", "project_id": reused["id"]}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(next_task.status(), StatusCode::CREATED);
    assert!(
        response_json(next_task).await["task_number"]
            .as_i64()
            .unwrap()
            > task["task_number"].as_i64().unwrap()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn effective_roles_keep_private_projects_hidden_and_public_projects_joinable(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (guest_token, guest_id, _) = register(&app, "guest@example.com").await;
    let (discoverer_token, discoverer_id, _) = register(&app, "discoverer@example.com").await;
    let (admin_token, admin_id, _) = register(&app, "admin@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;
    add_workspace_member(&pool, workspace_id, guest_id, "guest").await;
    add_workspace_member(&pool, workspace_id, discoverer_id, "member").await;
    add_workspace_member(&pool, workspace_id, admin_id, "admin").await;

    let project = create_project(&app, &owner_token, workspace_id, "Private Roadmap").await;
    let project_id = project["id"].as_str().unwrap();
    let parsed_project_id = Uuid::parse_str(project_id).unwrap();
    assert_eq!(
        project["storage_name"],
        VaultStorageName::from_initial_name("Private Roadmap", parsed_project_id).as_str()
    );
    assert_eq!(project["effective_role"], "admin");

    for token in [&member_token, &guest_token, &discoverer_token] {
        let hidden = app
            .clone()
            .oneshot(empty_request(
                "GET",
                &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
                token,
            ))
            .await
            .unwrap();
        assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    }
    let admin_project = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            &admin_token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(admin_project).await["effective_role"],
        "admin"
    );

    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            member_id,
            "contributor",
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            guest_id,
            "admin",
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            guest_id,
            "viewer",
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            admin_id,
            "admin",
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Visible to contributors", "project_id": project_id}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task_id = response_json(task).await["id"].as_str().unwrap().to_owned();
    let viewer_edit = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            json!({"title": "Forbidden edit"}),
            Some(&guest_token),
        ))
        .await
        .unwrap();
    assert_eq!(viewer_edit.status(), StatusCode::FORBIDDEN);
    let viewer_read = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            &guest_token,
        ))
        .await
        .unwrap();
    assert_eq!(viewer_read.status(), StatusCode::OK);

    let opened = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"visibility": "public"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(opened.status(), StatusCode::OK);
    let discoveries = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects"),
            &discoverer_token,
        ))
        .await
        .unwrap();
    let discoveries = response_json(discoveries).await;
    assert_eq!(discoveries.as_array().unwrap().len(), 1);
    assert_eq!(discoveries[0]["can_join"], true);
    assert_eq!(discoveries[0]["effective_role"], Value::Null);

    let joined = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/join"),
            &discoverer_token,
        ))
        .await
        .unwrap();
    assert_eq!(joined.status(), StatusCode::NO_CONTENT);
    let joined_project = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            &discoverer_token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(joined_project).await["effective_role"],
        "contributor"
    );
    let guest_join = app
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/join"),
            &guest_token,
        ))
        .await
        .unwrap();
    assert_eq!(guest_join.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn project_settings_validate_lead_defaults_features_and_confirmed_delete(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, owner_id, workspace_id) = register(&app, "owner@example.com").await;
    let (_, _, other_workspace) = register(&app, "other@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;

    let project = create_project(&app, &owner_token, workspace_id, "Kanleaf Core").await;
    let project_id = project["id"].as_str().unwrap();
    let configuration = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            &owner_token,
        ))
        .await
        .unwrap();
    let configuration = response_json(configuration).await;
    let default_state = configuration["default_state_id"].as_str().unwrap();
    let default_type = configuration["default_task_type_id"].as_str().unwrap();

    let changed = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({
                "name": "Kanleaf Desktop",
                "description": "Desktop-first project management",
                "visibility": "public",
                "lead_user_id": owner_id,
                "default_assignee_id": owner_id,
                "default_state_id": default_state,
                "default_task_type_id": default_type,
                "enabled_task_type_ids": [default_type],
                "cycles_enabled": false,
                "modules_enabled": false,
                "pages_enabled": true,
                "views_enabled": false
            }),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::OK);
    let changed = response_json(changed).await;
    assert_eq!(changed["identifier"], "kanleaf-core");
    assert_eq!(changed["lead_user_id"], owner_id.to_string());
    assert_eq!(changed["cycles_enabled"], false);
    assert_eq!(changed["pages_enabled"], true);

    let other_state: Uuid =
        sqlx::query_scalar("SELECT default_inbox_state_id FROM workspaces WHERE id = $1")
            .bind(other_workspace)
            .fetch_one(&pool)
            .await
            .unwrap();
    let cross_workspace = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"default_state_id": other_state}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(cross_workspace.status(), StatusCode::UNPROCESSABLE_ENTITY);

    assert_eq!(
        add_project_member(
            &app,
            &owner_token,
            workspace_id,
            project_id,
            member_id,
            "contributor",
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    let invalid_lead = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"lead_user_id": member_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(invalid_lead.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let promote = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members/{member_id}"),
            json!({"role": "admin"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(promote.status(), StatusCode::OK);
    let lead = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"lead_user_id": member_id, "default_assignee_id": member_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(lead.status(), StatusCode::OK);
    let remove_lead = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members/{member_id}"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(remove_lead.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let clear_lead = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"lead_user_id": null}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(clear_lead.status(), StatusCode::OK);
    let removed = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members/{member_id}"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);

    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Keep after delete", "project_id": project_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let wrong_confirmation = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/delete"),
            json!({"identifier": "WRONG"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(
        wrong_confirmation.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let deleted = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/delete"),
            json!({"identifier": "kanleaf-core"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let inbox = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?inbox=true"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert!(response_json(inbox).await.as_array().unwrap().is_empty());

    let former_admin = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(former_admin.status(), StatusCode::OK);
}
