#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};
use http::HeaderValue;
use kanleaf_server::{AppState, router, task::spawn_next_repeated_task};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    state: AppState,
    app: axum::Router,
    _data_dir: TempDir,
}

impl Harness {
    fn new(pool: PgPool) -> Self {
        let data_dir = tempfile::tempdir().unwrap();
        let state = AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600));
        let app = router(
            state.clone(),
            vec![HeaderValue::from_static("http://127.0.0.1:1420")],
        );
        Self {
            state,
            app,
            _data_dir: data_dir,
        }
    }

    async fn send(
        &self,
        method: &str,
        uri: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
        let response = self
            .app
            .clone()
            .oneshot(request.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, value)
    }

    async fn register(&self, email: &str, create_workspace: bool) -> (String, Uuid, Option<Uuid>) {
        let (status, payload) = self
            .send(
                "POST",
                "/api/auth/register",
                Some(json!({"email": email, "password": "correct horse battery"})),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        let token = payload["token"].as_str().unwrap().to_owned();
        let user_id = payload["user"]["id"].as_str().unwrap().parse().unwrap();
        let (status, _) = self
            .send(
                "PATCH",
                "/api/account/setup",
                Some(json!({"display_name": email.split('@').next().unwrap()})),
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        if !create_workspace {
            return (token, user_id, None);
        }
        let (status, workspace) = self
            .send(
                "POST",
                "/api/workspaces",
                Some(json!({"name": "Personal"})),
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
        (token, user_id, Some(workspace_id))
    }

    async fn task(&self, token: &str, workspace_id: Uuid, task_id: &str) -> Value {
        let (status, task) = self
            .send(
                "GET",
                &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
                None,
                Some(token),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        task
    }

    async fn document(&self, token: &str, workspace_id: Uuid, task_id: &str) -> Value {
        let (status, document) = self
            .send(
                "GET",
                &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
                None,
                Some(token),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        document
    }

    async fn patch_task(
        &self,
        token: &str,
        workspace_id: Uuid,
        task_id: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        self.send(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            Some(body),
            Some(token),
        )
        .await
    }
}

fn weekly_monday(mode: &str) -> Value {
    json!({"frequency": "weekly", "weekdays": [1], "time": "07:00", "mode": mode})
}

fn date(value: &Value) -> NaiveDate {
    value.as_str().unwrap().parse().unwrap()
}

fn timestamp(value: &Value) -> DateTime<Utc> {
    value.as_str().unwrap().parse().unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn weekly_repeat_spawns_a_copy_with_unchecked_body_and_moves_the_rule(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (status, project) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            Some(json!({"name": "Fitness"})),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, label) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/labels"),
            Some(json!({"name": "Health", "color": "#22A06B", "description": ""})),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, property) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/properties"),
            Some(json!({"name": "Coach", "type": "text"})),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let start = Utc::now().date_naive();
    let due = start + chrono::Days::new(2);
    let (status, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({
                "title": "Workout",
                "project_id": project["id"],
                "priority": "high",
                "label_ids": [label["id"]],
                "start_date": start,
                "due_date": due,
                "estimate": 2
            })),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let task_id = task["id"].as_str().unwrap().to_owned();
    let (status, _) = harness
        .send(
            "PUT",
            &format!(
                "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
                property["id"].as_str().unwrap()
            ),
            Some(json!({"value": "Sam"})),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let document = harness.document(&token, workspace_id, &task_id).await;
    let (status, _) = harness
        .send(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            Some(json!({
                "content": "1. [x] Squat\n2. [ ] Bench\n\n```\n- [x] code\n```\n",
                "base_revision": document["revision"],
            })),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, repeated) = harness
        .patch_task(
            &token,
            workspace_id,
            &task_id,
            json!({"recurrence": {"frequency": "weekly", "weekdays": [1, 1], "time": "07:00", "mode": "schedule"}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let recurrence = &repeated["recurrence"];
    assert_eq!(recurrence["frequency"], "weekly");
    assert_eq!(recurrence["weekdays"], json!([1]));
    assert_eq!(recurrence["time"], "07:00");
    assert_eq!(recurrence["timezone"], "UTC");
    assert!(recurrence["paused_at"].is_null());
    let next_run_at = timestamp(&recurrence["next_run_at"]);
    assert_eq!(next_run_at.weekday(), Weekday::Mon);
    assert!(next_run_at.date_naive() > start);

    let not_yet = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        next_run_at - chrono::Duration::minutes(1),
    )
    .await
    .unwrap();
    assert!(not_yet.is_none());

    let spawned_id = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        next_run_at + chrono::Duration::hours(1),
    )
    .await
    .unwrap()
    .expect("a due repeat creates the next Task");
    let spawned_id = spawned_id.to_string();

    let original = harness.task(&token, workspace_id, &task_id).await;
    assert!(original["recurrence"].is_null());
    let spawned = harness.task(&token, workspace_id, &spawned_id).await;
    assert_ne!(spawned["task_number"], original["task_number"]);
    assert_eq!(spawned["title"], "Workout");
    assert_eq!(spawned["project_id"], project["id"]);
    assert_eq!(spawned["priority"], "high");
    assert_eq!(spawned["estimate"], 2);
    assert_eq!(spawned["labels"][0]["id"], label["id"]);
    assert_eq!(spawned["state"]["system_role"], "todo");
    assert_eq!(spawned["custom_properties"][0]["value"], "Sam");
    let shift = next_run_at.date_naive() - start;
    assert_eq!(date(&spawned["start_date"]), start + shift);
    assert_eq!(date(&spawned["due_date"]), due + shift);
    assert_eq!(spawned["recurrence"]["frequency"], "weekly");
    let following = timestamp(&spawned["recurrence"]["next_run_at"]);
    assert_eq!(following, next_run_at + chrono::Duration::days(7));

    let body = harness.document(&token, workspace_id, &spawned_id).await;
    assert_eq!(
        body["content"],
        "1. [ ] Squat\n2. [ ] Bench\n\n```\n- [x] code\n```\n"
    );
    let original_body = harness.document(&token, workspace_id, &task_id).await;
    assert!(
        original_body["content"]
            .as_str()
            .unwrap()
            .starts_with("1. [x] Squat")
    );

    let again = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        following + chrono::Duration::hours(1),
    )
    .await
    .unwrap();
    assert!(again.is_none(), "the rule moved to the newest Task");

    let (status, cleared) = harness
        .patch_task(
            &token,
            workspace_id,
            &spawned_id,
            json!({"recurrence": null}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared["recurrence"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn missed_occurrences_collapse_into_one_task(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (_, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Water plants", "start_date": null, "due_date": null})),
            Some(&token),
        )
        .await;
    let task_id = task["id"].as_str().unwrap().to_owned();
    let (status, repeated) = harness
        .patch_task(
            &token,
            workspace_id,
            &task_id,
            json!({"recurrence": weekly_monday("schedule")}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let next_run_at = timestamp(&repeated["recurrence"]["next_run_at"]);
    let three_weeks_late = next_run_at + chrono::Duration::days(15);
    let spawned = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        three_weeks_late,
    )
    .await
    .unwrap()
    .unwrap();
    let spawned = harness
        .task(&token, workspace_id, &spawned.to_string())
        .await;
    assert_eq!(
        timestamp(&spawned["recurrence"]["next_run_at"]),
        next_run_at + chrono::Duration::days(21)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1")
        .bind(workspace_id)
        .fetch_one(&harness.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn after_completion_repeat_waits_for_a_terminal_state(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (_, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Pay rent"})),
            Some(&token),
        )
        .await;
    let task_id = task["id"].as_str().unwrap().to_owned();
    let (status, _) = harness
        .patch_task(
            &token,
            workspace_id,
            &task_id,
            json!({"recurrence": {"frequency": "monthly", "month_day": 31, "time": "09:00", "mode": "after_completion"}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let later = Utc::now() + chrono::Duration::days(90);
    let open = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        later,
    )
    .await
    .unwrap();
    assert!(open.is_none(), "an open Task does not repeat yet");

    let (_, configuration) = harness
        .send(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            None,
            Some(&token),
        )
        .await;
    let done_id = configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["system_role"] == "done")
        .unwrap()["id"]
        .clone();
    let (status, _) = harness
        .patch_task(&token, workspace_id, &task_id, json!({"state_id": done_id}))
        .await;
    assert_eq!(status, StatusCode::OK);
    let spawned = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        Utc::now(),
    )
    .await
    .unwrap()
    .expect("completion creates the next Task");
    let spawned = harness
        .task(&token, workspace_id, &spawned.to_string())
        .await;
    assert_eq!(spawned["state"]["system_role"], "todo");
    assert_eq!(spawned["recurrence"]["mode"], "after_completion");
}

#[sqlx::test(migrations = "./migrations")]
async fn repeat_rules_are_validated_and_require_task_edit_access(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (outsider_token, _, _) = harness.register("outsider@example.com", true).await;
    let (_, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Stretch"})),
            Some(&token),
        )
        .await;
    let task_id = task["id"].as_str().unwrap().to_owned();
    for rule in [
        json!({"frequency": "weekly", "weekdays": [], "time": "07:00", "mode": "schedule"}),
        json!({"frequency": "weekly", "weekdays": [8], "time": "07:00", "mode": "schedule"}),
        json!({"frequency": "daily", "weekdays": [1], "time": "07:00", "mode": "schedule"}),
        json!({"frequency": "monthly", "time": "07:00", "mode": "schedule"}),
        json!({"frequency": "daily", "time": "7am", "mode": "schedule"}),
        json!({"frequency": "yearly", "time": "07:00", "mode": "schedule"}),
    ] {
        let (status, _) = harness
            .patch_task(&token, workspace_id, &task_id, json!({"recurrence": rule}))
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{rule}");
    }
    let (status, _) = harness
        .patch_task(
            &outsider_token,
            workspace_id,
            &task_id,
            json!({"recurrence": weekly_monday("schedule")}),
        )
        .await;
    assert!(
        matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "{status}"
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_recurrences")
        .fetch_one(&harness.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn repeat_pauses_when_its_owner_loses_access(pool: PgPool) {
    let harness = Harness::new(pool);
    let (owner_token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (member_token, member_id, _) = harness.register("member@example.com", false).await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&harness.state.pool)
    .await
    .unwrap();
    let (status, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({"title": "Inbox review"})),
            Some(&member_token),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let task_id = task["id"].as_str().unwrap().to_owned();
    let (status, repeated) = harness
        .patch_task(
            &member_token,
            workspace_id,
            &task_id,
            json!({"recurrence": weekly_monday("schedule")}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let next_run_at = timestamp(&repeated["recurrence"]["next_run_at"]);
    sqlx::query("DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2")
        .bind(workspace_id)
        .bind(member_id)
        .execute(&harness.state.pool)
        .await
        .unwrap();

    let spawned = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        next_run_at + chrono::Duration::hours(1),
    )
    .await
    .unwrap();
    assert!(spawned.is_none());
    let paused = harness.task(&owner_token, workspace_id, &task_id).await;
    assert!(!paused["recurrence"]["paused_at"].is_null());

    let (status, resumed) = harness
        .patch_task(
            &owner_token,
            workspace_id,
            &task_id,
            json!({"recurrence": weekly_monday("schedule")}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(resumed["recurrence"]["paused_at"].is_null());
}

async fn state_id(harness: &Harness, token: &str, workspace_id: Uuid, role: &str) -> Value {
    let (_, configuration) = harness
        .send(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            None,
            Some(token),
        )
        .await;
    configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["system_role"] == role)
        .unwrap()["id"]
        .clone()
}

#[sqlx::test(migrations = "./migrations")]
async fn reset_repeat_reopens_the_same_task_for_each_occurrence(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let start = Utc::now().date_naive();
    let due = start + chrono::Days::new(6);
    let done_id = state_id(&harness, &token, workspace_id, "done").await;
    let (_, task) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            Some(json!({
                "title": "Workout",
                "state_id": done_id,
                "start_date": start,
                "due_date": due
            })),
            Some(&token),
        )
        .await;
    let task_id = task["id"].as_str().unwrap().to_owned();
    let document = harness.document(&token, workspace_id, &task_id).await;
    let (status, _) = harness
        .send(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            Some(json!({
                "content": "- [x] Squat\n- [X] Bench\n",
                "base_revision": document["revision"],
            })),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let mut rule = weekly_monday("schedule");
    rule["action"] = json!("reset");
    let (status, repeated) = harness
        .patch_task(&token, workspace_id, &task_id, json!({"recurrence": rule}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(repeated["recurrence"]["action"], "reset");
    let next_run_at = timestamp(&repeated["recurrence"]["next_run_at"]);

    let reset = spawn_next_repeated_task(
        &harness.state,
        workspace_id,
        task_id.parse().unwrap(),
        next_run_at + chrono::Duration::hours(1),
    )
    .await
    .unwrap();
    assert_eq!(reset.map(|id| id.to_string()), Some(task_id.clone()));

    let task = harness.task(&token, workspace_id, &task_id).await;
    assert_eq!(task["state"]["system_role"], "todo");
    let shift = next_run_at.date_naive() - start;
    assert_eq!(date(&task["start_date"]), start + shift);
    assert_eq!(date(&task["due_date"]), due + shift);
    assert_eq!(
        timestamp(&task["recurrence"]["next_run_at"]),
        next_run_at + chrono::Duration::days(7)
    );
    let body = harness.document(&token, workspace_id, &task_id).await;
    assert_eq!(body["content"], "- [ ] Squat\n- [ ] Bench\n");
    let (status, feed) = harness
        .send(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/activity"),
            None,
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        feed["activity"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["event_type"] == "task_repeat_reset")
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1")
        .bind(workspace_id)
        .fetch_one(&harness.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "a reset never creates another Task");
}

#[sqlx::test(migrations = "./migrations")]
async fn after_completion_repeats_never_reopen_into_a_terminal_default(pool: PgPool) {
    let harness = Harness::new(pool);
    let (token, _, workspace_id) = harness.register("owner@example.com", true).await;
    let workspace_id = workspace_id.unwrap();
    let (_, project) = harness
        .send(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            Some(json!({"name": "Chores"})),
            Some(&token),
        )
        .await;
    let done_id = state_id(&harness, &token, workspace_id, "done").await;
    let (status, _) = harness
        .send(
            "PATCH",
            &format!(
                "/api/workspaces/{workspace_id}/projects/{}",
                project["id"].as_str().unwrap()
            ),
            Some(json!({"default_state_id": done_id})),
            Some(&token),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    for action in ["duplicate", "reset"] {
        let (_, task) = harness
            .send(
                "POST",
                &format!("/api/workspaces/{workspace_id}/tasks"),
                Some(json!({"title": format!("Laundry {action}"), "project_id": project["id"]})),
                Some(&token),
            )
            .await;
        assert_eq!(task["state"]["system_role"], "done");
        let task_id = task["id"].as_str().unwrap().to_owned();
        let mut rule = json!({"frequency": "daily", "time": "08:00", "mode": "after_completion"});
        rule["action"] = json!(action);
        let (status, _) = harness
            .patch_task(&token, workspace_id, &task_id, json!({"recurrence": rule}))
            .await;
        assert_eq!(status, StatusCode::OK);
        let current = spawn_next_repeated_task(
            &harness.state,
            workspace_id,
            task_id.parse().unwrap(),
            Utc::now(),
        )
        .await
        .unwrap()
        .unwrap();
        let current = harness
            .task(&token, workspace_id, &current.to_string())
            .await;
        assert_eq!(current["state"]["system_role"], "todo", "{action}");
        let again = spawn_next_repeated_task(
            &harness.state,
            workspace_id,
            current["id"].as_str().unwrap().parse().unwrap(),
            Utc::now(),
        )
        .await
        .unwrap();
        assert!(
            again.is_none(),
            "{action} must wait for the next completion"
        );
    }
}
