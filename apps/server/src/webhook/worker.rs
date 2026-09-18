use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::{Acquire, FromRow};
use tokio::task::JoinHandle;
use tracing::warn;
use uuid::Uuid;

use super::transport;
use crate::{AppState, error::AppError};

const RETRY_SECONDS: [i64; 5] = [30, 120, 600, 3600, 21600];

#[derive(FromRow)]
struct OutboxEvent {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    event_type: String,
    occurred_at: DateTime<Utc>,
}

pub async fn dispatch_events(state: &AppState) -> Result<usize, AppError> {
    let mut tx = state.pool.begin().await?;
    let workspace: Option<Uuid> = sqlx::query_scalar(
        "SELECT w.id FROM workspaces w JOIN LATERAL (SELECT e.occurred_at FROM domain_events e JOIN domain_event_outbox o ON o.event_id=e.id WHERE e.workspace_id=w.id AND o.consumer='webhooks' AND o.processed_at IS NULL ORDER BY e.occurred_at,e.id LIMIT 1) oldest ON true ORDER BY oldest.occurred_at,w.id LIMIT 1 FOR KEY SHARE OF w SKIP LOCKED"
    ).fetch_optional(&mut *tx).await?;
    let Some(workspace) = workspace else {
        tx.commit().await?;
        return Ok(0);
    };
    let events: Vec<OutboxEvent>=sqlx::query_as(
        "SELECT e.id,e.workspace_id,e.project_id,e.event_type,e.occurred_at FROM domain_event_outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.workspace_id=$1 AND o.consumer='webhooks' AND o.processed_at IS NULL ORDER BY e.occurred_at,e.id LIMIT 50 FOR UPDATE OF o SKIP LOCKED"
    ).bind(workspace).fetch_all(&mut *tx).await?;
    for event in &events {
        let hooks: Vec<Uuid>=sqlx::query_scalar(
            "SELECT w.id FROM webhooks w JOIN webhook_event_subscriptions s ON s.webhook_id=w.id AND s.event_type=$1 WHERE w.workspace_id=$2 AND w.enabled AND w.created_at<=$3 AND w.enabled_since<=$3 AND (w.project_scope='all' OR EXISTS(SELECT 1 FROM webhook_projects p WHERE p.webhook_id=w.id AND p.workspace_id=$2 AND p.project_id=$4)) ORDER BY w.id FOR SHARE OF w"
        ).bind(&event.event_type).bind(event.workspace_id).bind(event.occurred_at).bind(event.project_id).fetch_all(&mut *tx).await?;
        for hook in hooks {
            sqlx::query("INSERT INTO webhook_deliveries(id,workspace_id,webhook_id,event_id,event_type) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(webhook_id,event_id) DO NOTHING")
                .bind(Uuid::new_v4()).bind(event.workspace_id).bind(hook).bind(event.id).bind(&event.event_type).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE domain_event_outbox SET processed_at=now() WHERE event_id=$1 AND consumer='webhooks'").bind(event.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(events.len())
}

#[derive(FromRow)]
struct PendingDelivery {
    id: Uuid,
    workspace_id: Uuid,
    webhook_id: Uuid,
    event_type: String,
    is_test: bool,
    attempt_count: i32,
}

pub async fn process_delivery(state: &AppState) -> Result<bool, AppError> {
    let Some(key) = state.webhook_key.as_ref() else {
        return Ok(false);
    };
    let mut tx = state.pool.begin().await?;
    // A slow endpoint cannot occupy every worker with its queued attempts.
    let mut excluded = Vec::<Uuid>::new();
    let mut delivery = None;
    for _ in 0..50 {
        let mut claim = tx.begin().await?;
        let candidate = sqlx::query_as::<_, PendingDelivery>(
            "SELECT id,workspace_id,webhook_id,event_type,is_test,attempt_count FROM webhook_deliveries WHERE status='pending' AND next_attempt_at<=now() AND NOT(webhook_id=ANY($1)) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED"
        ).bind(&excluded).fetch_optional(&mut *claim).await?;
        let Some(candidate) = candidate else {
            claim.rollback().await?;
            break;
        };
        let available: bool =
            sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(1463899714,hashtext($1))")
                .bind(candidate.webhook_id.to_string())
                .fetch_one(&mut *claim)
                .await?;
        if available {
            claim.commit().await?;
            delivery = Some(candidate);
            break;
        }
        excluded.push(candidate.webhook_id);
        claim.rollback().await?;
    }
    let Some(delivery) = delivery else {
        tx.commit().await?;
        return Ok(false);
    };
    let (enabled,endpoint,nonce,key_id): (bool,String,Vec<u8>,String)=sqlx::query_as("SELECT enabled,endpoint_url,secret_nonce,signing_key_id FROM webhooks WHERE workspace_id=$1 AND id=$2")
        .bind(delivery.workspace_id).bind(delivery.webhook_id).fetch_one(&mut *tx).await?;
    if !enabled && !delivery.is_test {
        sqlx::query("UPDATE webhook_deliveries SET status='canceled',last_error='Webhook disabled' WHERE id=$1").bind(delivery.id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(true);
    }
    if key.id() != key_id {
        return Err(AppError::WebhooksUnavailable);
    }
    let body: String=sqlx::query_scalar("SELECT e.raw_body FROM domain_events e JOIN webhook_deliveries d ON d.event_id=e.id AND d.workspace_id=e.workspace_id WHERE d.id=$1").bind(delivery.id).fetch_one(&mut *tx).await?;
    let secret = key.derive(delivery.workspace_id, delivery.webhook_id, &nonce);
    let result = transport::send(
        &state.webhook_policy,
        &endpoint,
        &secret,
        &delivery.event_type,
        delivery.id,
        &body,
    )
    .await;
    let attempts = delivery.attempt_count + 1;
    let status = if result.success {
        "succeeded"
    } else if delivery.is_test || attempts >= 6 {
        "failed"
    } else {
        "pending"
    };
    let delay = RETRY_SECONDS
        .get((attempts - 1) as usize)
        .copied()
        .unwrap_or(0);
    sqlx::query("UPDATE webhook_deliveries SET status=$1,attempt_count=$2,http_status=$3,duration_ms=$4,last_error=$5,next_attempt_at=clock_timestamp()+make_interval(secs=>$6),delivered_at=CASE WHEN $1='succeeded' THEN clock_timestamp() ELSE NULL END WHERE id=$7")
        .bind(status).bind(attempts).bind(result.http_status.map(i32::from)).bind(result.duration_ms).bind(result.error).bind(delay as f64).bind(delivery.id).execute(&mut *tx).await?;
    tx.commit().await?;
    if !result.success {
        warn!(delivery_id=%delivery.id,webhook_id=%delivery.webhook_id,workspace_id=%delivery.workspace_id,attempt=attempts,error=result.error,"webhook delivery attempt failed");
    }
    Ok(true)
}

pub fn spawn_webhook_workers(state: AppState) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::with_capacity(5);
    let dispatcher = state.clone();
    handles.push(tokio::spawn(async move {
        let mut ticks = 0u32;
        loop {
            if let Err(error) = dispatch_events(&dispatcher).await {
                warn!(?error, "domain event dispatch failed");
            }
            ticks = ticks.wrapping_add(1);
            if ticks.is_multiple_of(2400)
                && let Err(error) = prune_history(&dispatcher).await
            {
                warn!(?error, "domain event retention failed");
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }));
    for _ in 0..4 {
        let state = state.clone();
        handles.push(tokio::spawn(async move {
            loop {
                match process_delivery(&state).await {
                    Ok(true) => {}
                    Ok(false) => tokio::time::sleep(Duration::from_millis(250)).await,
                    Err(error) => {
                        warn!(?error, "webhook worker failed");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        }));
    }
    handles
}

async fn prune_history(state: &AppState) -> Result<(), AppError> {
    sqlx::query("DELETE FROM domain_events WHERE id IN (SELECT e.id FROM domain_events e WHERE e.occurred_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM domain_event_outbox o WHERE o.event_id=e.id AND o.processed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.event_id=e.id AND d.status='pending') ORDER BY e.occurred_at LIMIT 500)").execute(&state.pool).await?;
    Ok(())
}
