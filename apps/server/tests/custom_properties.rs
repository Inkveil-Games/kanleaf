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

    let type_property = create_property(&app, &token, workspace_id, "Type", "single_select").await;
    assert_eq!(type_property["name"], "Type");

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
        8
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

#[sqlx::test(migrations = "./migrations")]
async fn select_option_metadata_and_single_select_defaults_round_trip(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "select-defaults@example.com").await;
    let property = create_property(&app, &token, workspace_id, "Impact", "single_select").await;
    let property_id = property["id"].as_str().unwrap();
    assert!(property["default_option_id"].is_null());

    let option = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options"),
            Some(json!({
                "name": "High",
                "color": "#EF4444",
                "description": "Needs prompt attention"
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(option.status(), StatusCode::CREATED);
    let option = response_json(option).await;
    assert!(option.get("icon").is_none());
    assert_eq!(option["description"], "Needs prompt attention");
    let option_id = option["id"].as_str().unwrap();

    let defaulted = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}"),
            Some(json!({"default_option_id": option_id})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(defaulted.status(), StatusCode::OK);
    assert_eq!(
        response_json(defaulted).await["default_option_id"],
        option_id
    );

    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Uses the Workspace property default"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task = response_json(task).await;
    assert!(
        task["custom_properties"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| { value["property_id"] == property_id && value["value"] == option_id })
    );
    let stored_value: serde_json::Value = sqlx::query_scalar(
        "SELECT value FROM task_custom_property_values WHERE workspace_id = $1 AND task_id = $2 AND property_id = $3",
    )
    .bind(workspace_id)
    .bind(task["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .bind(property_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_value, json!(option_id));

    let updated_option = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options/{option_id}"),
            Some(json!({
                "description": "Escalate immediately"
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(updated_option.status(), StatusCode::OK);
    let updated_option = response_json(updated_option).await;
    assert!(updated_option.get("icon").is_none());
    assert_eq!(updated_option["description"], "Escalate immediately");

    let archived = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options/{option_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
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
    assert!(response_json(definitions).await[0]["default_option_id"].is_null());

    let restored = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options/{option_id}"),
            Some(json!({"archived": false})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    let defaulted_again = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}"),
            Some(json!({"default_option_id": option_id})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(defaulted_again.status(), StatusCode::OK);
    let deleted = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/properties/{property_id}/options/{option_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
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
    assert!(response_json(definitions).await[0]["default_option_id"].is_null());

    let seeded_option_id = Uuid::new_v4();
    let seeded = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({
                "name": "Urgency",
                "type": "single_select",
                "default_option_id": seeded_option_id,
                "options": [{
                    "id": seeded_option_id,
                    "name": "Normal",
                    "color": "#64748B",
                    "description": "The standard urgency"
                }]
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(seeded.status(), StatusCode::CREATED);
    let seeded = response_json(seeded).await;
    assert_eq!(seeded["default_option_id"], seeded_option_id.to_string());
    assert_eq!(seeded["options"][0]["id"], seeded_option_id.to_string());

    let text = create_property(&app, &token, workspace_id, "Summary", "text").await;
    let invalid_default = app
        .oneshot(request(
            "PATCH",
            &format!(
                "/api/workspaces/{workspace_id}/properties/{}",
                text["id"].as_str().unwrap()
            ),
            Some(json!({"default_option_id": Uuid::new_v4()})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(invalid_default.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn multi_select_defaults_apply_only_to_new_tasks_and_validate_atomically(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "multi-defaults@example.com").await;
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let response = app.clone().oneshot(request("POST", &format!("/api/workspaces/{workspace_id}/properties"), Some(json!({
        "name": "Platforms", "type": "multi_select",
        "options": [{"id": first, "name": "Web", "color": "#EF4444"}, {"id": second, "name": "Desktop", "color": "#EF4444"}],
        "default_option_ids": [second, first]
    })), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let property = response_json(response).await;
    assert_eq!(property["default_option_ids"], json!([first, second]));
    assert!(property["default_option_id"].is_null());
    let property_id = property["id"].as_str().unwrap();
    let property_uri = format!("/api/workspaces/{workspace_id}/properties/{property_id}");
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Defaulted task"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let task = response_json(response).await;
    assert_eq!(
        task["custom_properties"][0]["value"],
        json!([first, second])
    );
    let task_id = task["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    let source = fs::read_to_string(data_dir.path().join(format!(
        "vaults/{workspace_id}/Todo/{}.md",
        task["storage_name"].as_str().unwrap()
    )))
    .unwrap();
    assert!(source.contains("Web") && source.contains("Desktop"));

    for invalid in [json!([first, first]), json!([Uuid::new_v4()])] {
        let response = app
            .clone()
            .oneshot(request(
                "PATCH",
                &property_uri,
                Some(json!({"name": "Must roll back", "default_option_ids": invalid})),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"description": "Preserve defaults"})),
            &token,
        ))
        .await
        .unwrap();
    let unchanged = response_json(response).await;
    assert_eq!(unchanged["name"], "Platforms");
    assert_eq!(unchanged["default_option_ids"], json!([first, second]));
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{property_uri}/options/{first}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"default_option_ids": [first]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"description": "Archive clears only its default"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_option_ids"],
        json!([second])
    );
    let existing: Value = sqlx::query_scalar(
        "SELECT value FROM task_custom_property_values WHERE task_id = $1 AND property_id = $2",
    )
    .bind(task_id)
    .bind(property_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(existing, json!([first, second]));
    let third = Uuid::new_v4();
    let response = app.clone().oneshot(request("PATCH", &property_uri, Some(json!({
        "options": [{"id": third, "name": "Mobile", "color": "#EF4444"}], "default_option_ids": [third]
    })), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["default_option_ids"],
        json!([third])
    );
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"default_option_ids": []})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_option_ids"],
        json!([])
    );
    let text = create_property(&app, &token, workspace_id, "Summary", "text").await;
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!(
                "/api/workspaces/{workspace_id}/properties/{}",
                text["id"].as_str().unwrap()
            ),
            Some(json!({"default_option_ids": [third]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn label_defaults_distinguish_omitted_empty_and_explicit_labels(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "label-defaults@example.com").await;
    let mut labels = Vec::new();
    for name in ["Bug", "Review"] {
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                &format!("/api/workspaces/{workspace_id}/labels"),
                Some(json!({"name": name, "color": "#EF4444"})),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        labels.push(response_json(response).await["id"].clone());
    }
    let config_uri = format!("/api/workspaces/{workspace_id}/task-configuration");
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({"default_label_ids": labels})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["default_label_ids"],
        json!(labels)
    );
    for (body, expected) in [
        (json!({"title": "Omitted"}), 2),
        (json!({"title": "Empty", "label_ids": []}), 0),
        (json!({"title": "Explicit", "label_ids": [labels[1]]}), 1),
    ] {
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                &format!("/api/workspaces/{workspace_id}/tasks"),
                Some(body),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(
            response_json(response).await["labels"]
                .as_array()
                .unwrap()
                .len(),
            expected
        );
    }
    let (foreign_token, _, foreign_workspace) =
        register(&app, "foreign-label-defaults@example.com").await;
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{foreign_workspace}/labels"),
            Some(json!({"name": "Foreign", "color": "#EF4444"})),
            &foreign_token,
        ))
        .await
        .unwrap();
    let foreign_label = response_json(response).await["id"].clone();
    for invalid in [
        json!([labels[0], labels[0]]),
        json!([Uuid::new_v4()]),
        json!([foreign_label]),
    ] {
        let response = app
            .clone()
            .oneshot(request(
                "PATCH",
                &config_uri,
                Some(json!({"default_label_ids": invalid})),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!(
                "/api/workspaces/{workspace_id}/labels/{}",
                labels[0].as_str().unwrap()
            ),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({"default_label_ids": [labels[0]]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request("GET", &config_uri, None, &token))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_label_ids"],
        json!([labels[1]])
    );
    let assignments: i64 =
        sqlx::query_scalar("SELECT count(*) FROM task_label_assignments WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(assignments, 3);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({"label_property_description": "Keep default selection"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_label_ids"],
        json!([labels[1]])
    );
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({"default_label_ids": []})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_label_ids"],
        json!([])
    );
    let assignments_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM task_label_assignments WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(assignments_after, assignments);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({"default_label_ids": [labels[1]]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/labels/{}",
                labels[1].as_str().unwrap()
            ),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = app
        .clone()
        .oneshot(request("GET", &config_uri, None, &token))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["default_label_ids"],
        json!([])
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn multi_defaults_define_preserves_imported_values_and_rejects_foreign_options(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "multi-define@example.com").await;
    let (other_token, _, other_workspace) = register(&app, "multi-foreign@example.com").await;
    let web = Uuid::new_v4();
    let desktop = Uuid::new_v4();
    let task = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Imported value"})),
            &token,
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    let task_id = task["id"].as_str().unwrap();
    let path = data_dir.path().join(format!(
        "vaults/{workspace_id}/Todo/{}.md",
        task["storage_name"].as_str().unwrap()
    ));
    let markdown =
        fs::read_to_string(&path)
            .unwrap()
            .replacen("\n---\n", "\nPlatforms:\n  - Web\n---\n", 1);
    fs::write(&path, markdown).unwrap();
    let response = app.clone().oneshot(request("POST", &format!("/api/workspaces/{workspace_id}/properties/define"), Some(json!({
        "name": "Platforms", "type": "multi_select", "default_option_ids": [desktop],
        "options": [{"id": web, "name": "Web", "color": "#EF4444"}, {"id": desktop, "name": "Desktop", "color": "#EF4444"}]
    })), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let property = response_json(response).await;
    assert_eq!(property["default_option_ids"], json!([desktop]));
    let property_id = property["id"].as_str().unwrap();
    let property_uri = format!("/api/workspaces/{workspace_id}/properties/{property_id}");
    let stored: Value = sqlx::query_scalar(
        "SELECT value FROM task_custom_property_values WHERE task_id = $1 AND property_id = $2",
    )
    .bind(task_id.parse::<Uuid>().unwrap())
    .bind(property_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, json!([web]));
    let response = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"default_option_ids": [web, desktop]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert!(
        response_json(response).await["custom_properties"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let foreign_id = Uuid::new_v4();
    let response = app.clone().oneshot(request("POST", &format!("/api/workspaces/{other_workspace}/properties"), Some(json!({"name": "Foreign", "type": "multi_select", "options": [{"id": foreign_id, "name": "Foreign", "color": "#EF4444"}]})), &other_token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    for body in [
        json!({"default_option_ids": [foreign_id]}),
        json!({"options": [{"id": foreign_id, "name": "Hijack", "color": "#EF4444"}], "default_option_ids": [foreign_id]}),
    ] {
        let response = app
            .clone()
            .oneshot(request("PATCH", &property_uri, Some(body), &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"default_option_ids": []})),
            &other_token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    // Composite keys enforce the same tenant and property even outside the HTTP boundary.
    let result = sqlx::query("INSERT INTO custom_property_default_options (workspace_id, property_id, option_id) VALUES ($1, $2, $3)").bind(workspace_id).bind(property_id.parse::<Uuid>().unwrap()).bind(foreign_id).execute(&pool).await;
    assert_eq!(
        result
            .unwrap_err()
            .as_database_error()
            .unwrap()
            .code()
            .as_deref(),
        Some("23503")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn date_and_builtin_defaults_resolve_only_on_creation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, user_id, workspace_id) = register(&app, "dates@example.com").await;
    sqlx::query("UPDATE users SET timezone = 'Pacific/Kiritimati' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let property_uri = format!("/api/workspaces/{workspace_id}/properties");
    let config_uri = format!("/api/workspaces/{workspace_id}/task-configuration");
    let task_uri = format!("/api/workspaces/{workspace_id}/tasks");
    let dynamic = json!({"mode":"dynamic","amount":0,"unit":"day","direction":"after"});
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &property_uri,
            Some(json!({
                "name":"Review day","type":"date","default_date":dynamic
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let property = response_json(response).await;
    assert_eq!(property["default_date"], dynamic);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config_uri,
            Some(json!({
                "default_priority":"high", "default_start_date":dynamic,
                "default_due_date":{"mode":"fixed","date":"2099-12-31"}
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await["default_priority"], "high");
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &task_uri,
            Some(json!({"title":"Inherited"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let task = response_json(response).await;
    let path = data_dir.path().join(format!(
        "vaults/{workspace_id}/Todo/{}.md",
        task["storage_name"].as_str().unwrap()
    ));
    let markdown = fs::read_to_string(path).unwrap();
    assert!(markdown.contains("2099-12-31"));
    assert!(!markdown.contains("default_start_date"));
    let local = jiff::Timestamp::now()
        .in_tz("Pacific/Kiritimati")
        .unwrap()
        .date()
        .to_string();
    assert_eq!(task["priority"], "high");
    assert_eq!(task["start_date"], local);
    assert_eq!(task["due_date"], "2099-12-31");
    let custom: Value = sqlx::query_scalar(
        "SELECT value FROM task_custom_property_values WHERE task_id = $1 AND property_id = $2",
    )
    .bind(task["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .bind(property["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(custom, local);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &task_uri,
            Some(json!({"title":"Explicit", "priority":"none", "start_date":null,"due_date":null})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let explicit = response_json(response).await;
    assert_eq!(explicit["priority"], "none");
    assert!(explicit["start_date"].is_null());
    assert!(explicit["due_date"].is_null());
    let response = app.clone().oneshot(request("PATCH", &config_uri, Some(json!({"default_start_date":null,"default_due_date":null,"default_priority":"none"})), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("{task_uri}/{}", task["id"].as_str().unwrap()),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(response).await["start_date"], local);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{property_uri}/{}", property["id"].as_str().unwrap()),
            Some(json!({"default_date":null})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response_json(response).await["default_date"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn date_defaults_validate_types_schedules_permissions_and_archive_state(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "date-owner@example.com").await;
    let (member, member_id, foreign_workspace) = register(&app, "date-member@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    let properties = format!("/api/workspaces/{workspace_id}/properties");
    let config = format!("/api/workspaces/{workspace_id}/task-configuration");
    let tasks = format!("/api/workspaces/{workspace_id}/tasks");
    let fixed = json!({"mode":"fixed","date":"2026-02-28"});
    for settings in [
        json!({"mode":"fixed","date":"2026-02-29"}),
        json!({"mode":"dynamic","amount":-1,"unit":"day","direction":"after"}),
        json!({"mode":"dynamic","amount":1.5,"unit":"month","direction":"before"}),
        json!({"mode":"dynamic","amount":4294967295_u64,"unit":"year","direction":"after"}),
        json!({"mode":"dynamic","amount":9000,"unit":"year","direction":"after"}),
    ] {
        for (method, uri, body) in [
            (
                "POST",
                &properties,
                json!({"name":"Invalid","type":"date","default_date":settings}),
            ),
            ("PATCH", &config, json!({"default_due_date":settings})),
        ] {
            let response = app
                .clone()
                .oneshot(request(method, uri, Some(body), &token))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &properties,
            Some(json!({"name":"Wrong type","type":"text","default_date":fixed})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    for (method, uri, body) in [
        (
            "POST",
            &properties,
            json!({"name":"Denied","type":"date","default_date":fixed}),
        ),
        (
            "PATCH",
            &config,
            json!({"default_priority":"high","default_due_date":fixed}),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(request(method, uri, Some(body), &member))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let foreign_state: Uuid =
        sqlx::query_scalar("SELECT default_inbox_state_id FROM workspaces WHERE id = $1")
            .bind(foreign_workspace)
            .fetch_one(&pool)
            .await
            .unwrap();
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config,
            Some(json!({"state_id":foreign_state})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &properties,
            Some(json!({"name":"Review day","type":"date","default_date":fixed})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let property = response_json(response).await;
    let property_uri = format!("{properties}/{}", property["id"].as_str().unwrap());
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"description":"Preserve default"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(response).await["default_date"], fixed);
    let response = app.clone().oneshot(request("PATCH", &property_uri, Some(json!({"default_date":{"mode":"dynamic","amount":9000,"unit":"year","direction":"after"}})), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"description":"Still unchanged"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(response).await["default_date"], fixed);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &property_uri,
            Some(json!({"archived":true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &tasks,
            Some(json!({"title":"No archived default"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        response_json(response).await["custom_properties"],
        json!([])
    );
    let response = app.clone().oneshot(request("PATCH", &config, Some(json!({"default_start_date":{"mode":"fixed","date":"2026-03-01"}, "default_due_date":fixed})), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app.clone().oneshot(request("PATCH", &config, Some(json!({"default_start_date":{"mode":"fixed","date":"2026-02-01"}, "default_due_date":fixed})), &token)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(request(
            "PATCH",
            &config,
            Some(json!({"default_start_date":{"mode":"fixed","date":"2026-03-01"}})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request("GET", &config, None, &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let saved = response_json(response).await;
    assert_eq!(
        saved["default_start_date"],
        json!({"mode":"fixed","date":"2026-02-01"})
    );
    assert_eq!(saved["default_due_date"], fixed);
    for fields in [
        json!({"title":"Invalid explicit due", "due_date":"2026-01-01"}),
        json!({"title":"Invalid explicit start", "start_date":"2026-04-01"}),
    ] {
        let response = app
            .clone()
            .oneshot(request("POST", &tasks, Some(fields), &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1")
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    sqlx::query("UPDATE workspaces SET default_start_date = $1 WHERE id = $2")
        .bind(json!({"mode":"fixed","date":"2026-03-01"}))
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &tasks,
            Some(json!({"title":"Invalid effective defaults"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &tasks,
            Some(json!({"title":"Invalid explicit priority", "priority":null})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &tasks,
            Some(json!({"title":"Explicit valid override", "start_date":null})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let task = response_json(response).await;
    assert!(task["start_date"].is_null());
    assert_eq!(task["due_date"], "2026-02-28");
}

#[sqlx::test(migrations = "./migrations")]
async fn defining_date_default_preserves_explicit_markdown_values(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "define-date@example.com").await;
    let base = format!("/api/workspaces/{workspace_id}");
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("{base}/tasks"),
            Some(json!({"title":"Existing Markdown date"})),
            &token,
        ))
        .await
        .unwrap();
    let task = response_json(response).await;
    let path = data_dir.path().join(format!(
        "vaults/{workspace_id}/Todo/{}.md",
        task["storage_name"].as_str().unwrap()
    ));
    let markdown = fs::read_to_string(&path).unwrap().replacen(
        "\n---\n",
        "\nReview day: '2024-02-29'\n---\n",
        1,
    );
    fs::write(&path, markdown).unwrap();
    let fixed = json!({"mode":"fixed","date":"2026-02-28"});
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("{base}/properties/define"),
            Some(json!({"name":"Review day","type":"date","default_date":fixed})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let property = response_json(response).await;
    assert_eq!(property["default_date"], fixed);
    let stored: Value = sqlx::query_scalar(
        "SELECT value FROM task_custom_property_values WHERE task_id = $1 AND property_id = $2",
    )
    .bind(task["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .bind(property["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, "2024-02-29");
    assert!(fs::read_to_string(&path).unwrap().contains("2024-02-29"));
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("{base}/tasks"),
            Some(json!({"title":"New date default"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let new_task = response_json(response).await;
    assert_eq!(new_task["custom_properties"][0]["value"], "2026-02-28");
    let new_path = data_dir.path().join(format!(
        "vaults/{workspace_id}/Todo/{}.md",
        new_task["storage_name"].as_str().unwrap()
    ));
    let markdown = fs::read_to_string(&new_path).unwrap();
    assert!(markdown.contains("Review day:"));
    assert!(markdown.contains("2026-02-28"));
    assert!(!markdown.contains("default_date"));
}
