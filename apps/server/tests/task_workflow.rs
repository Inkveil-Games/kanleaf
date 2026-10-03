#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
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

fn request(method: &str, uri: &str, body: Option<Value>, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/auth/register",
            Some(json!({"email": email, "password": "correct horse battery"})),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(request(
            "PATCH",
            "/api/account/setup",
            Some(json!({"display_name": email.split('@').next().unwrap()})),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = create(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn create(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = app
        .clone()
        .oneshot(request("POST", uri, Some(body), Some(token)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

async fn patch(app: &Router, token: &str, uri: &str, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(request("PATCH", uri, Some(body), Some(token)))
        .await
        .unwrap()
}

async fn get(app: &Router, token: &str, uri: &str) -> Value {
    let response = app
        .clone()
        .oneshot(request("GET", uri, None, Some(token)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

async fn create_project(app: &Router, token: &str, workspace_id: Uuid, name: &str) -> Value {
    create(
        app,
        token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": name}),
    )
    .await
}

async fn create_task(app: &Router, token: &str, workspace_id: Uuid, body: Value) -> Value {
    create(
        app,
        token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        body,
    )
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn dependency_hydration_and_mutations_respect_project_access(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner, _, workspace_id) = register(&app, "graph-owner@example.com").await;
    let (reader, reader_id, _) = register(&app, "graph-reader@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(reader_id)
    .execute(&pool)
    .await
    .unwrap();
    let project = create_project(&app, &owner, workspace_id, "Private prerequisites").await;
    let project_id = project["id"].as_str().unwrap();
    let prerequisite = create_task(
        &app,
        &owner,
        workspace_id,
        json!({"title":"Private blocker", "project_id":project_id}),
    )
    .await;
    let target = create_task(&app, &owner, workspace_id, json!({"title":"Visible work"})).await;
    let target_id = target["id"].as_str().unwrap();
    let relation_url = format!("/api/workspaces/{workspace_id}/tasks/{target_id}/relations");
    create(
        &app,
        &owner,
        &relation_url,
        json!({"task_id":prerequisite["id"],"relation_type":"blocked_by"}),
    )
    .await;
    let detail_url = format!("/api/workspaces/{workspace_id}/tasks/{target_id}");
    let detail = get(&app, &reader, &detail_url).await;
    assert_eq!(detail["relations"], json!([]));
    let list = get(
        &app,
        &reader,
        &format!("/api/workspaces/{workspace_id}/tasks"),
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["relations"], json!([]));
    assert_eq!(
        get(&app, &owner, &detail_url).await["relations"][0]["task_system_role"],
        "todo"
    );
    create(
        &app,
        &owner,
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members"),
        json!({"user_id":reader_id,"role":"viewer"}),
    )
    .await;
    assert_eq!(
        get(&app, &reader, &detail_url).await["relations"][0]["task_system_role"],
        "todo"
    );
    let denied = app
        .clone()
        .oneshot(request(
            "POST",
            &relation_url,
            Some(json!({"task_id":prerequisite["id"],"relation_type":"blocking"})),
            Some(&reader),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let denied = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("{relation_url}/{}", prerequisite["id"].as_str().unwrap()),
            None,
            Some(&reader),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM task_relations WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    sqlx::query("UPDATE projects SET archived_at = now() WHERE id = $1")
        .bind(project_id.parse::<Uuid>().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get(&app, &reader, &detail_url).await["relations"],
        json!([])
    );
    let list = get(
        &app,
        &reader,
        &format!("/api/workspaces/{workspace_id}/tasks"),
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["relations"], json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn blocking_dependencies_are_a_transactional_dag(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "graph@example.com").await;
    let mut ids = Vec::new();
    for title in ["A", "B", "C", "D", "E"] {
        let task = create_task(&app, &token, workspace_id, json!({"title": title})).await;
        ids.push(task["id"].as_str().unwrap().to_owned());
    }
    for (source, target, kind) in [
        (0, 1, "blocking"),
        (2, 1, "blocked_by"),
        (0, 3, "blocking"),
        (4, 3, "blocking"),
    ] {
        create(
            &app,
            &token,
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{}/relations",
                ids[source]
            ),
            json!({"task_id": ids[target], "relation_type": kind}),
        )
        .await;
    }
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM task_activity")
        .fetch_one(&pool)
        .await
        .unwrap();
    for (source, target, status) in [
        (2, 0, StatusCode::UNPROCESSABLE_ENTITY),
        (0, 0, StatusCode::UNPROCESSABLE_ENTITY),
        (0, 1, StatusCode::CONFLICT),
        (1, 0, StatusCode::CONFLICT),
    ] {
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                &format!(
                    "/api/workspaces/{workspace_id}/tasks/{}/relations",
                    ids[source]
                ),
                Some(json!({"task_id": ids[target], "relation_type": "blocking"})),
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        if source == 2 {
            assert!(
                json_body(response).await["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("cycle")
            );
        }
    }
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM task_activity")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_relations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 4);
    let target = get(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks/{}", ids[1]),
    )
    .await;
    assert_eq!(target["relations"][0]["task_system_role"], "todo");
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_dependency_writes_cannot_close_a_cycle(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "concurrent-graph@example.com").await;
    let first = create_task(&app, &token, workspace_id, json!({"title":"First"})).await;
    let second = create_task(&app, &token, workspace_id, json!({"title":"Second"})).await;
    let third = create_task(&app, &token, workspace_id, json!({"title":"Third"})).await;
    let first = first["id"].as_str().unwrap();
    let second = second["id"].as_str().unwrap();
    let third = third["id"].as_str().unwrap();
    create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks/{first}/relations"),
        json!({"task_id":second,"relation_type":"blocking"}),
    )
    .await;
    let mut pending = Vec::new();
    for (source, target) in [(second, third), (third, first)] {
        let app = app.clone();
        let input = request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{source}/relations"),
            Some(json!({"task_id":target,"relation_type":"blocking"})),
            Some(&token),
        );
        pending.push(tokio::spawn(async move {
            app.oneshot(input).await.unwrap().status()
        }));
    }
    let mut statuses = Vec::new();
    for pending in pending {
        statuses.push(
            tokio::time::timeout(Duration::from_secs(10), pending)
                .await
                .unwrap()
                .unwrap(),
        );
    }
    assert!(statuses.contains(&StatusCode::CREATED));
    assert!(statuses.contains(&StatusCode::UNPROCESSABLE_ENTITY));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_relations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn task_numbers_are_unique_and_monotonic_under_concurrent_creation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "numbering@example.com").await;

    let mut creates = Vec::new();
    for index in 0..12 {
        let app = app.clone();
        let token = token.clone();
        creates.push(tokio::spawn(async move {
            create_task(
                &app,
                &token,
                workspace_id,
                json!({"title": format!("Concurrent {index}")}),
            )
            .await
        }));
    }
    let mut numbers = Vec::new();
    for create in creates {
        let task = create.await.unwrap();
        numbers.push(task["task_number"].as_i64().unwrap());
        assert!(task["reference"].as_str().unwrap().starts_with('#'));
    }
    numbers.sort_unstable();
    assert_eq!(numbers, (1..=12).collect::<Vec<_>>());
}

#[sqlx::test(migrations = "./migrations")]
async fn task_responses_include_terminal_subtask_progress_and_visible_comment_count(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "metrics@example.com").await;
    let configuration = get(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/task-configuration"),
    )
    .await;
    let state_id = |role: &str| {
        configuration["states"]
            .as_array()
            .unwrap()
            .iter()
            .find(|state| state["system_role"] == role)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };

    let parent = create_task(&app, &token, workspace_id, json!({"title": "Parent task"})).await;
    let parent_id = parent["id"].as_str().unwrap().to_owned();
    for (title, state_id) in [
        ("Todo child", state_id("todo")),
        ("Done child", state_id("done")),
        ("Cancelled child", state_id("cancelled")),
    ] {
        create_task(
            &app,
            &token,
            workspace_id,
            json!({"title": title, "parent_id": parent_id, "state_id": state_id}),
        )
        .await;
    }

    let comments_uri = format!("/api/workspaces/{workspace_id}/tasks/{parent_id}/comments");
    create(
        &app,
        &token,
        &comments_uri,
        json!({"body": "Visible comment"}),
    )
    .await;
    let deleted_comment = create(
        &app,
        &token,
        &comments_uri,
        json!({"body": "Deleted comment"}),
    )
    .await;
    let delete_response = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("{comments_uri}/{}", deleted_comment["id"].as_str().unwrap()),
            None,
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

    let parent = get(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}"),
    )
    .await;
    assert_eq!(parent["subtask_progress"]["completed"], 2);
    assert_eq!(parent["subtask_progress"]["total"], 3);
    assert_eq!(parent["comment_count"], 1);

    let empty = create_task(&app, &token, workspace_id, json!({"title": "No metrics"})).await;
    assert_eq!(empty["subtask_progress"]["completed"], 0);
    assert_eq!(empty["subtask_progress"]["total"], 0);
    assert_eq!(empty["comment_count"], 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn metadata_hierarchy_relations_and_my_work_are_tenant_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (outsider_token, _, outsider_workspace) = register(&app, "outsider@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();

    let project = create_project(&app, &owner_token, workspace_id, "Kanleaf").await;
    let project_id = project["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members"),
        json!({"user_id": member_id, "role": "contributor"}),
    )
    .await;
    let label = create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/labels"),
        json!({"name": "Backend", "color": "#22A06B", "description": "Server work"}),
    )
    .await;
    let label_id = label["id"].as_str().unwrap();

    let parent = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({
            "title": "Ship task workflow",
            "project_id": project_id,
            "priority": "high",
            "assignee_ids": [member_id],
            "label_ids": [label_id],
            "start_date": "2026-08-28",
            "due_date": "2026-09-04",
            "estimate": 8
        }),
    )
    .await;
    let parent_id = parent["id"].as_str().unwrap();
    assert_eq!(parent["reference"], "#1");
    assert_eq!(parent["assignees"][0]["user_id"], member_id.to_string());
    assert_eq!(parent["labels"][0]["id"], label_id);

    let child = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Cover hierarchy", "project_id": project_id, "parent_id": parent_id}),
    )
    .await;
    let child_id = child["id"].as_str().unwrap();
    let related = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Document API", "project_id": project_id}),
    )
    .await;
    let related_id = related["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}/relations"),
        json!({"task_id": related_id, "relation_type": "blocking"}),
    )
    .await;

    let parent = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}"),
    )
    .await;
    assert_eq!(parent["subtasks"][0]["id"], child_id);
    assert_eq!(parent["relations"][0]["relation_type"], "blocking");
    let related = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{related_id}"),
    )
    .await;
    assert_eq!(related["relations"][0]["relation_type"], "blocked_by");

    let my_work = get(
        &app,
        &member_token,
        &format!("/api/workspaces/{workspace_id}/tasks?my_work=true&label_id={label_id}"),
    )
    .await;
    assert_eq!(my_work.as_array().unwrap().len(), 1);
    assert_eq!(my_work[0]["id"], parent_id);

    let cycle = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}"),
        json!({"parent_id": child_id}),
    )
    .await;
    assert_eq!(cycle.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let outsider_task = create_task(
        &app,
        &outsider_token,
        outsider_workspace,
        json!({"title": "Other tenant"}),
    )
    .await;
    let cross_tenant = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}/relations"),
            Some(json!({
                "task_id": outsider_task["id"],
                "relation_type": "relates_to"
            })),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(cross_tenant.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn moves_bulk_updates_order_and_permanent_deletion_preserve_invariants(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (_member_token, member_id, _) = register(&app, "member@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    let first_project = create_project(&app, &owner_token, workspace_id, "First").await;
    let second_project = create_project(&app, &owner_token, workspace_id, "Second").await;
    let first_id = first_project["id"].as_str().unwrap();
    let second_id = second_project["id"].as_str().unwrap();
    assert!(first_project.get("default_task_type_id").is_none());
    assert!(first_project.get("enabled_task_type_ids").is_none());
    assert!(second_project.get("default_task_type_id").is_none());
    assert!(second_project.get("enabled_task_type_ids").is_none());
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{first_id}/members"),
        json!({"user_id": member_id, "role": "contributor"}),
    )
    .await;

    let parent = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Parent", "project_id": first_id}),
    )
    .await;
    let parent_id = parent["id"].as_str().unwrap();
    let child = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({
            "title": "Move me",
            "project_id": first_id,
            "parent_id": parent_id,
            "assignee_ids": [member_id]
        }),
    )
    .await;
    let child_id = child["id"].as_str().unwrap();
    let rejected = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{child_id}"),
        json!({"project_id": second_id}),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let cleaned = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{child_id}"),
        json!({"project_id": second_id, "cleanup_invalid": true}),
    )
    .await;
    assert_eq!(cleaned.status(), StatusCode::OK);
    let cleaned = json_body(cleaned).await;
    assert_eq!(cleaned["project_id"], second_id);
    assert!(cleaned.get("task_type").is_none());
    assert!(cleaned["assignees"].as_array().unwrap().is_empty());
    assert_eq!(cleaned["parent"], Value::Null);

    let third = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Third", "project_id": second_id}),
    )
    .await;
    let third_id = third["id"].as_str().unwrap();
    let failed_bulk = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/bulk"),
        json!({
            "task_ids": [child_id, Uuid::new_v4()],
            "priority": "critical"
        }),
    )
    .await;
    assert_eq!(failed_bulk.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        get(
            &app,
            &owner_token,
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}")
        )
        .await["priority"],
        "none"
    );

    let bulk = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/bulk"),
        json!({"task_ids": [child_id, third_id], "priority": "critical"}),
    )
    .await;
    assert_eq!(bulk.status(), StatusCode::OK);
    assert_eq!(json_body(bulk).await.as_array().unwrap().len(), 2);

    let partial_reorder = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/reorder"),
            Some(json!({"task_ids": [third_id]})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(partial_reorder.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/reorder"),
            Some(json!({"task_ids": [third_id, child_id]})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    let tasks = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks?project_id={second_id}"),
    )
    .await;
    assert_eq!(tasks[0]["id"], third_id);
    assert_eq!(tasks[1]["id"], child_id);

    let wrong_confirmation = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}/delete"),
            Some(json!({"reference": "wrong"})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(
        wrong_confirmation.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let reference = cleaned["reference"].as_str().unwrap();
    let deleted = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}/delete"),
            Some(json!({"reference": reference})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let document_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Tasks")
        .join(format!("{child_id}.md"));
    assert!(!document_path.exists());
}
