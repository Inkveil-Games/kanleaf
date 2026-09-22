#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn request(method: &str, uri: &str, body: Option<Value>, token: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    request
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"email": email, "password": "correct horse battery"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(request(
            "PATCH",
            "/api/account/setup",
            Some(json!({"display_name": email.split('@').next().unwrap()})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace =
        create_resource(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn configuration(app: &axum::Router, token: &str, workspace_id: Uuid) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            None,
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await
}

async fn create_resource(app: &axum::Router, token: &str, uri: &str, body: Value) -> Value {
    let response = app
        .clone()
        .oneshot(request("POST", uri, Some(body), token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn defaults_are_installed_and_configuration_is_tenant_and_role_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, owner_workspace) = register(&app, "owner@example.com").await;
    let (member_token, member_id, member_workspace) = register(&app, "member@example.com").await;

    let owner_configuration = configuration(&app, &owner_token, owner_workspace).await;
    assert_eq!(
        owner_configuration["states"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| json!({
                "name": state["name"],
                "icon": state["icon"],
                "system_role": state["system_role"],
            }))
            .collect::<Vec<_>>(),
        [
            json!({"name": "Todo", "icon": "circle", "system_role": "todo"}),
            json!({
                "name": "In Progress",
                "icon": "loader-circle",
                "system_role": "in_progress"
            }),
            json!({"name": "Done", "icon": "circle-check", "system_role": "done"}),
        ]
    );
    assert_eq!(
        owner_configuration["state_property_description"],
        "The current step of work."
    );
    assert_eq!(
        owner_configuration["label_property_description"],
        "Shared tags used to organize work."
    );
    assert!(owner_configuration.get("task_types").is_none());
    assert!(owner_configuration.get("default_task_type_id").is_none());
    assert_eq!(
        owner_configuration["default_state_id"],
        owner_configuration["states"][0]["id"]
    );

    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(owner_workspace)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    configuration(&app, &member_token, owner_workspace).await;

    let denied = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{owner_workspace}/states"),
            Some(json!({
                "name": "Review",
                "icon": "eye",
                "color": "#F59E0B",
                "description": "Awaiting review"
            })),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_settings = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{owner_workspace}/task-configuration"),
            Some(json!({"state_property_description": "No access"})),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(denied_settings.status(), StatusCode::FORBIDDEN);

    let isolated = app
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{member_workspace}/task-configuration"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(isolated.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn core_states_lock_identity_but_allow_description_order_and_property_settings(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "core-states@example.com").await;
    let config = configuration(&app, &token, workspace_id).await;
    let todo_id = config["states"][0]["id"].as_str().unwrap();
    let todo_uri = format!("/api/workspaces/{workspace_id}/states/{todo_id}");

    for body in [
        json!({"name": "Ready"}),
        json!({"icon": "circle-dot"}),
        json!({"color": "#F59E0B"}),
        json!({"archived": true}),
    ] {
        let rejected = app
            .clone()
            .oneshot(request("PATCH", &todo_uri, Some(body), &token))
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let deleted = app
        .clone()
        .oneshot(request("DELETE", &todo_uri, None, &token))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let described = app
        .clone()
        .oneshot(request(
            "PATCH",
            &todo_uri,
            Some(json!({"description": "Ready to be picked up"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(described.status(), StatusCode::OK);
    assert_eq!(
        response_json(described).await["description"],
        "Ready to be picked up"
    );

    let reversed_ids = config["states"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .map(|state| state["id"].clone())
        .collect::<Vec<_>>();
    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/states/reorder"),
            Some(json!({"ids": reversed_ids})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        configuration(&app, &token, workspace_id).await["states"][0]["id"],
        config["states"][2]["id"]
    );

    let settings = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            Some(json!({
                "state_id": todo_id,
                "state_property_description": "Where the work is now.",
                "label_property_description": "Shared vocabulary for organizing work."
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(settings.status(), StatusCode::OK);
    let settings = response_json(settings).await;
    assert_eq!(settings["default_state_id"], todo_id);
    assert_eq!(
        settings["state_property_description"],
        "Where the work is now."
    );
    assert_eq!(
        settings["label_property_description"],
        "Shared vocabulary for organizing work."
    );

    let empty = app
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            Some(json!({})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn custom_states_and_labels_share_edit_reorder_archive_and_replacement_behavior(
    pool: PgPool,
) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "custom-values@example.com").await;
    let state_uri = format!("/api/workspaces/{workspace_id}/states");
    let ready = create_resource(
        &app,
        &token,
        &state_uri,
        json!({
            "name": "Ready",
            "icon": "circle-dot",
            "color": "#0EA5E9",
            "description": "Ready for work"
        }),
    )
    .await;
    let queued = create_resource(
        &app,
        &token,
        &state_uri,
        json!({
            "name": "Queued",
            "icon": null,
            "color": "#0284C7",
            "description": "Waiting"
        }),
    )
    .await;
    assert_eq!(ready["icon"], "circle-dot");
    assert_eq!(ready["description"], "Ready for work");
    assert!(ready["system_role"].is_null());
    assert!(queued["icon"].is_null());
    let ready_id = ready["id"].as_str().unwrap();
    let done_id = configuration(&app, &token, workspace_id).await["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["system_role"] == "done")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let duplicate = app
        .clone()
        .oneshot(request(
            "POST",
            &state_uri,
            Some(json!({
                "name": "ready",
                "icon": null,
                "color": "#F59E0B",
                "description": "Duplicate"
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let label_uri = format!("/api/workspaces/{workspace_id}/labels");
    let backend = create_resource(
        &app,
        &token,
        &label_uri,
        json!({
            "name": "Backend",
            "icon": "database",
            "color": "#22A06B",
            "description": "Server work"
        }),
    )
    .await;
    let design = create_resource(
        &app,
        &token,
        &label_uri,
        json!({
            "name": "Design",
            "icon": null,
            "color": "#A855F7",
            "description": "Visual work"
        }),
    )
    .await;
    assert_eq!(backend["icon"], "database");
    assert_eq!(backend["position"], 0);
    assert_eq!(design["position"], 1);
    let backend_id = backend["id"].as_str().unwrap();
    let design_id = design["id"].as_str().unwrap();

    let task = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({
            "title": "Move freely",
            "state_id": ready_id,
            "label_ids": [backend_id]
        }),
    )
    .await;
    let task_id = task["id"].as_str().unwrap();
    let missing_replacement = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("{state_uri}/{ready_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(missing_replacement.status(), StatusCode::CONFLICT);
    let replaced = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("{state_uri}/{ready_id}?replacement_id={done_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(replaced.status(), StatusCode::NO_CONTENT);
    let moved_task = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(moved_task).await["state"]["id"], done_id);

    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("{label_uri}/reorder"),
            Some(json!({"ids": [design_id, backend_id]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        configuration(&app, &token, workspace_id).await["labels"][0]["id"],
        design_id
    );

    let updated = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({
                "name": "Server",
                "icon": "terminal",
                "description": "Backend systems"
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = response_json(updated).await;
    assert_eq!(updated["icon"], "terminal");
    assert_eq!(updated["description"], "Backend systems");

    let archived = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    let restored = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({"archived": false})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    assert_eq!(response_json(restored).await["position"], 1);

    let task_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    let source = fs::read_to_string(task_path).unwrap();
    assert!(source.contains("State:\n  - Done\n"));
    assert!(source.contains("Labels:\n  - Server\n"));
}
