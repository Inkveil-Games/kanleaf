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
    let workspace = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/workspaces",
            Some(json!({"name": "Properties Lab"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace = response_json(workspace).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn create_property(
    app: &axum::Router,
    token: &str,
    workspace_id: Uuid,
    name: &str,
    property_type: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({
                "name": name,
                "type": property_type,
                "description": "Custom task metadata"
            })),
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn definitions_support_all_types_lifecycle_and_name_reuse(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;

    let mut created = Vec::new();
    for (index, property_type) in [
        "text",
        "number",
        "date",
        "single_select",
        "multi_select",
        "checkbox",
        "url",
    ]
    .into_iter()
    .enumerate()
    {
        let property = create_property(
            &app,
            &token,
            workspace_id,
            &format!("Property {index}"),
            property_type,
        )
        .await;
        assert_eq!(property["type"], property_type);
        assert_eq!(property["position"], index);
        created.push(property);
    }

    let duplicate = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({"name": "property 0", "type": "text"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let reserved = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({"name": "State", "type": "text"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reserved.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let definitions = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/properties"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(definitions.status(), StatusCode::OK);
    assert_eq!(
        response_json(definitions).await.as_array().unwrap().len(),
        7
    );

    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Property lifecycle"})),
            &token,
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    let text_id = created[0]["id"].as_str().unwrap();
    let set = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{}/properties/{text_id}",
                task["id"].as_str().unwrap()
            ),
            Some(json!({"value": "Keep until cleared"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);
    let definitions = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/properties"),
            None,
            &token,
        ))
        .await
        .unwrap();
    let definitions = response_json(definitions).await;
    assert_eq!(definitions[0]["usage_count"], 1);
    let archived = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{text_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    let blocked = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{}/properties/{text_id}",
                task["id"].as_str().unwrap()
            ),
            Some(json!({"value": "Blocked"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let cleared = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{}/properties/{text_id}",
                task["id"].as_str().unwrap()
            ),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(cleared.status(), StatusCode::NO_CONTENT);
    let deleted = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/properties/{text_id}"),
            Some(json!({"name": "Property 0"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let reused = create_property(&app, &token, workspace_id, "Property 0", "text").await;
    assert_ne!(reused["id"], created[0]["id"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn task_values_support_every_property_type(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "typed-values@example.com").await;
    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "All property values"})),
            &token,
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    let task_id = task["id"].as_str().unwrap();

    for (name, property_type, value) in [
        ("Text value", "text", json!("Readable")),
        ("Number value", "number", json!(3.5)),
        ("Date value", "date", json!("2026-09-03")),
        ("Approved", "checkbox", json!(false)),
        (
            "Reference URL",
            "url",
            json!("https://kanleaf.example.com/task"),
        ),
    ] {
        let property = create_property(&app, &token, workspace_id, name, property_type).await;
        let response = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!(
                    "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
                    property["id"].as_str().unwrap()
                ),
                Some(json!({"value": value})),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{property_type}");
    }

    let task = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    assert_eq!(task["custom_properties"].as_array().unwrap().len(), 5);
    assert!(
        task["custom_properties"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value["value"] == false)
    );

    let empty_text = create_property(&app, &token, workspace_id, "Empty text", "text").await;
    let rejected = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
                empty_text["id"].as_str().unwrap()
            ),
            Some(json!({"value": ""})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn select_options_and_task_values_are_typed_and_workspace_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (other_token, _, other_workspace_id) = register(&app, "other@example.com").await;
    let property =
        create_property(&app, &owner_token, workspace_id, "Impact", "single_select").await;
    let property_id = property["id"].as_str().unwrap();

    let option = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options"),
            Some(json!({"name": "High", "color": "#EF4444"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(option.status(), StatusCode::CREATED);
    let option = response_json(option).await;

    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Validate custom metadata"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task = response_json(task).await;
    let task_id = task["id"].as_str().unwrap();

    let updated = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}"),
            Some(json!({"value": option["id"]})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["value"], option["id"]);

    let fetched = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    let fetched = response_json(fetched).await;
    assert_eq!(fetched["custom_properties"][0]["property_id"], property_id);
    assert_eq!(fetched["custom_properties"][0]["value"], option["id"]);

    let task_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    let markdown = fs::read_to_string(task_path).unwrap();
    assert!(markdown.contains("Impact: High\n"));
    assert!(!markdown.contains("Properties:"));
    let markdown = markdown.replacen(
        "\n---\n\n",
        "\nExternal score: 9\nContext:\n  source: Obsidian\n---\n\n",
        1,
    );
    let task_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    fs::write(&task_path, markdown).unwrap();

    let undefined = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/undefined"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(undefined.status(), StatusCode::OK);
    let undefined = response_json(undefined).await;
    assert_eq!(undefined[0], json!({"name": "External score", "value": 9}));
    assert_eq!(undefined[1]["name"], "Context");

    let inventory = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/properties/undefined"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(inventory.status(), StatusCode::OK);
    assert_eq!(response_json(inventory).await[0]["task_count"], 1);

    let collision = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({"name": "external SCORE", "type": "number"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(collision.status(), StatusCode::CONFLICT);

    let defined = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/define"),
            Some(json!({
                "name": "External score",
                "type": "number",
                "description": "Imported from Markdown"
            })),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(defined.status(), StatusCode::CREATED);
    let defined = response_json(defined).await;

    let fetched = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    assert!(
        response_json(fetched).await["custom_properties"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value["property_id"] == defined["id"] && value["value"] == 9)
    );

    let undefined_after_define = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/undefined"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    let undefined_after_define = response_json(undefined_after_define).await;
    assert_eq!(undefined_after_define.as_array().unwrap().len(), 1);
    assert_eq!(undefined_after_define[0]["name"], "Context");

    let defined_context = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/define"),
            Some(json!({
                "name": "Context",
                "type": "text",
                "description": "Keep the imported structure as text"
            })),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(defined_context.status(), StatusCode::CREATED);
    let defined_context = response_json(defined_context).await;
    let fetched = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    let fetched = response_json(fetched).await;
    assert!(
        fetched["custom_properties"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| {
                value["property_id"] == defined_context["id"]
                    && value["value"] == "{\"source\":\"Obsidian\"}"
            })
    );

    let malformed = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}"),
            Some(json!({"value": [option["id"].clone()]})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(malformed.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let platforms = create_property(
        &app,
        &owner_token,
        workspace_id,
        "Platforms",
        "multi_select",
    )
    .await;
    let platforms_id = platforms["id"].as_str().unwrap();
    let web = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/{platforms_id}/options"),
            Some(json!({"name": "Web", "color": "#3B82F6"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(web.status(), StatusCode::CREATED);
    let web = response_json(web).await;
    let desktop = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/{platforms_id}/options"),
            Some(json!({"name": "Desktop", "color": "#8B5CF6"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(desktop.status(), StatusCode::CREATED);
    let desktop = response_json(desktop).await;

    let foreign_option = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{platforms_id}"),
            Some(json!({"value": [web["id"].clone(), option["id"].clone()]})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(foreign_option.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let set_platforms = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{platforms_id}"),
            Some(json!({"value": [web["id"].clone(), desktop["id"].clone()]})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(set_platforms.status(), StatusCode::OK);

    let delete_web = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/properties/{platforms_id}/options/{}",
                web["id"].as_str().unwrap()
            ),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(delete_web.status(), StatusCode::NO_CONTENT);
    let task_after_first_delete = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    let task_after_first_delete = response_json(task_after_first_delete).await;
    let platforms_value = task_after_first_delete["custom_properties"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["property_id"] == platforms["id"])
        .unwrap();
    assert_eq!(platforms_value["value"], json!([desktop["id"].clone()]));

    let delete_desktop = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/properties/{platforms_id}/options/{}",
                desktop["id"].as_str().unwrap()
            ),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(delete_desktop.status(), StatusCode::NO_CONTENT);
    let task_after_last_delete = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    let task_after_last_delete = response_json(task_after_last_delete).await;
    assert!(
        task_after_last_delete["custom_properties"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value["property_id"] != platforms["id"])
    );

    let reused_option = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/{platforms_id}/options"),
            Some(json!({"name": "Web", "color": "#0EA5E9"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(reused_option.status(), StatusCode::CREATED);

    let isolated = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/properties"),
            None,
            &other_token,
        ))
        .await
        .unwrap();
    assert_eq!(isolated.status(), StatusCode::FORBIDDEN);

    let foreign_property =
        create_property(&app, &other_token, other_workspace_id, "Foreign", "text").await;
    let foreign_update = app
        .oneshot(request(
            "PUT",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
                foreign_property["id"].as_str().unwrap()
            ),
            Some(json!({"value": "hidden"})),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(foreign_update.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn property_editor_saves_option_lifecycle_atomically(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "atomic-options@example.com").await;
    let property = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({
                "name": "Platforms",
                "type": "multi_select",
                "options": [
                    {"name": "Web", "color": "#3B82F6"},
                    {"name": "Desktop", "color": "#8B5CF6"}
                ]
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(property.status(), StatusCode::CREATED);
    let property = response_json(property).await;
    let property_id = property["id"].as_str().unwrap();
    let web_id = property["options"][0]["id"].as_str().unwrap();
    let desktop_id = property["options"][1]["id"].as_str().unwrap();
    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Atomic option edit"})),
            &token,
        ))
        .await
        .unwrap();
    let task_id = response_json(task).await["id"].as_str().unwrap().to_owned();
    let set = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}"),
            Some(json!({"value": [web_id, desktop_id]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);

    let saved = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}"),
            Some(json!({
                "name": "Supported platforms",
                "options": [
                    {
                        "id": desktop_id,
                        "name": "Desktop app",
                        "color": "#A855F7"
                    },
                    {"name": "Mobile", "color": "#14B8A6"}
                ]
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = response_json(saved).await;
    assert_eq!(saved["name"], "Supported platforms");
    assert_eq!(saved["options"].as_array().unwrap().len(), 2);
    assert_eq!(saved["options"][0]["id"], desktop_id);
    assert_eq!(saved["options"][0]["position"], 0);
    let mobile_id = saved["options"][1]["id"].as_str().unwrap().to_owned();
    let fetched_task = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(fetched_task).await["custom_properties"][0]["value"],
        json!([desktop_id])
    );

    let archived = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}"),
            Some(json!({
                "options": [
                    {
                        "id": mobile_id,
                        "name": "Mobile",
                        "color": "#14B8A6"
                    },
                    {
                        "id": desktop_id,
                        "name": "Desktop app",
                        "color": "#A855F7",
                        "archived": true
                    }
                ]
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    let archived = response_json(archived).await;
    assert!(
        archived["options"]
            .as_array()
            .unwrap()
            .iter()
            .find(|option| option["id"] == desktop_id)
            .unwrap()["archived_at"]
            .is_string()
    );
    let preserved_task = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(preserved_task).await["custom_properties"][0]["value"],
        json!([desktop_id])
    );

    let rejected = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}"),
            Some(json!({
                "name": "This must roll back",
                "options": [
                    {"id": mobile_id, "name": "Same", "color": "#3B82F6"},
                    {"id": desktop_id, "name": "same", "color": "#14B8A6", "archived": true}
                ]
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let fetched = app
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/properties"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(fetched).await[0]["name"],
        "Supported platforms"
    );
}
