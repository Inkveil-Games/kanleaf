use std::{
    collections::HashMap,
    future::pending,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    extract::{State, WebSocketUpgrade, ws::Message, ws::WebSocket},
    response::Response,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::broadcast,
    time::{Instant, interval_at, timeout},
};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{authenticate_token, session_is_active},
    collaboration::authorize_task,
    error::AppError,
    workspace::workspace_role,
};

const PROTOCOL_VERSION: u8 = 1;
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(75);
const MAX_MESSAGE_SIZE: usize = 8 * 1024;
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
const WORKSPACE_CHANNEL_CAPACITY: usize = 128;

#[derive(Clone)]
pub(crate) struct RealtimeHub {
    channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<RealtimeEvent>>>>,
}

impl RealtimeHub {
    pub(crate) fn new() -> Self {
        Self {
            channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn subscribe(&self, workspace_id: Uuid) -> broadcast::Receiver<RealtimeEvent> {
        let mut channels = self
            .channels
            .lock()
            .unwrap_or_else(|lock| lock.into_inner());
        channels
            .entry(workspace_id)
            .or_insert_with(|| broadcast::channel(WORKSPACE_CHANNEL_CAPACITY).0)
            .subscribe()
    }

    pub(crate) fn publish(&self, event: RealtimeEvent) {
        let sender = self
            .channels
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .get(&event.workspace_id)
            .cloned();
        if let Some(sender) = sender {
            let _ = sender.send(event);
        }
    }

    fn remove_workspace_if_idle(&self, workspace_id: Uuid) {
        let mut channels = self
            .channels
            .lock()
            .unwrap_or_else(|lock| lock.into_inner());
        if channels
            .get(&workspace_id)
            .is_some_and(|sender| sender.receiver_count() == 0)
        {
            channels.remove(&workspace_id);
        }
    }

    #[cfg(test)]
    fn workspace_count(&self) -> usize {
        self.channels
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .len()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct RealtimeEvent {
    version: u8,
    id: Uuid,
    #[serde(rename = "type")]
    kind: RealtimeEventKind,
    workspace_id: Uuid,
    task_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    entity_id: Option<Uuid>,
    occurred_at: DateTime<Utc>,
}

impl RealtimeEvent {
    pub(crate) fn comment_created(workspace_id: Uuid, task_id: Uuid, comment_id: Uuid) -> Self {
        Self::new(
            RealtimeEventKind::CommentCreated,
            workspace_id,
            task_id,
            Some(comment_id),
        )
    }

    pub(crate) fn comment_edited(workspace_id: Uuid, task_id: Uuid, comment_id: Uuid) -> Self {
        Self::new(
            RealtimeEventKind::CommentEdited,
            workspace_id,
            task_id,
            Some(comment_id),
        )
    }

    pub(crate) fn comment_deleted(workspace_id: Uuid, task_id: Uuid, comment_id: Uuid) -> Self {
        Self::new(
            RealtimeEventKind::CommentDeleted,
            workspace_id,
            task_id,
            Some(comment_id),
        )
    }

    pub(crate) fn task_activity_changed(workspace_id: Uuid, task_id: Uuid) -> Self {
        Self::new(
            RealtimeEventKind::ActivityChanged,
            workspace_id,
            task_id,
            None,
        )
    }

    fn new(
        kind: RealtimeEventKind,
        workspace_id: Uuid,
        task_id: Uuid,
        entity_id: Option<Uuid>,
    ) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id: Uuid::new_v4(),
            kind,
            workspace_id,
            task_id,
            entity_id,
            occurred_at: Utc::now(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
enum RealtimeEventKind {
    #[serde(rename = "task.comment.created")]
    CommentCreated,
    #[serde(rename = "task.comment.edited")]
    CommentEdited,
    #[serde(rename = "task.comment.deleted")]
    CommentDeleted,
    #[serde(rename = "task.activity.changed")]
    ActivityChanged,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Authenticate { version: u8, token: String },
    Subscribe { version: u8, workspace_id: Uuid },
    Unsubscribe { version: u8 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Authenticated {
        version: u8,
    },
    Subscribed {
        version: u8,
        workspace_id: Uuid,
    },
    SyncRequired {
        version: u8,
        workspace_id: Uuid,
    },
    Error {
        version: u8,
        code: RealtimeErrorCode,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum RealtimeErrorCode {
    Unauthorized,
    Forbidden,
    InvalidMessage,
}

struct WorkspaceSubscription {
    workspace_id: Uuid,
    receiver: broadcast::Receiver<RealtimeEvent>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route("/api/realtime", get(upgrade))
}

async fn upgrade(State(state): State<AppState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_MESSAGE_SIZE)
        .max_frame_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: AppState, mut socket: WebSocket) {
    let Some(auth) = receive_authentication(&state, &mut socket).await else {
        return;
    };
    if send_server_message(
        &mut socket,
        &ServerMessage::Authenticated {
            version: PROTOCOL_VERSION,
        },
    )
    .await
    .is_err()
    {
        return;
    }

    let mut subscription: Option<WorkspaceSubscription> = None;
    let mut last_pong = Instant::now();
    let mut heartbeat = interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break };
                match message {
                    Message::Text(text) => {
                        let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else {
                            if send_error(&mut socket, RealtimeErrorCode::InvalidMessage).await.is_err() {
                                break;
                            }
                            continue;
                        };
                        match message {
                            ClientMessage::Subscribe { version, workspace_id } if version == PROTOCOL_VERSION => {
                                clear_subscription(&state.realtime, &mut subscription);
                                match authorize_workspace_subscription(&state, auth.session_id, auth.user.id, workspace_id).await {
                                    Ok(true) => {
                                        subscription = Some(WorkspaceSubscription {
                                            workspace_id,
                                            receiver: state.realtime.subscribe(workspace_id),
                                        });
                                        if send_server_message(
                                            &mut socket,
                                            &ServerMessage::Subscribed { version: PROTOCOL_VERSION, workspace_id },
                                        )
                                        .await
                                        .is_err()
                                        {
                                            break;
                                        }
                                    }
                                    Ok(false) => {
                                        if send_error(&mut socket, RealtimeErrorCode::Forbidden).await.is_err() {
                                            break;
                                        }
                                    }
                                    Err(error) => {
                                        warn!(?error, "failed to authorize realtime Workspace subscription");
                                        break;
                                    }
                                }
                            }
                            ClientMessage::Unsubscribe { version } if version == PROTOCOL_VERSION => {
                                clear_subscription(&state.realtime, &mut subscription);
                            }
                            ClientMessage::Authenticate { .. }
                            | ClientMessage::Subscribe { .. }
                            | ClientMessage::Unsubscribe { .. } => {
                                if send_error(&mut socket, RealtimeErrorCode::InvalidMessage).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Message::Pong(_) => last_pong = Instant::now(),
                    Message::Ping(payload) => {
                        if send_socket_message(&mut socket, Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    Message::Binary(_) => {
                        if send_error(&mut socket, RealtimeErrorCode::InvalidMessage).await.is_err() {
                            break;
                        }
                    }
                }
            }
            event = receive_event(&mut subscription) => {
                match event {
                    Ok(event) => {
                        match session_is_active(&state, auth.session_id, auth.user.id).await {
                            Ok(true) => {}
                            Ok(false) => {
                                let _ = send_error(&mut socket, RealtimeErrorCode::Unauthorized).await;
                                break;
                            }
                            Err(error) => {
                                warn!(?error, "failed to validate realtime session before Task event");
                                break;
                            }
                        }
                        match authorize_task(&state.pool, auth.user.id, event.workspace_id, event.task_id, false).await {
                            Ok(_) => {
                                if send_json(&mut socket, &event).await.is_err() {
                                    break;
                                }
                            }
                            Err(AppError::Internal(error)) => {
                                warn!(?error, "failed to authorize realtime Task event");
                                break;
                            }
                            Err(_) => {}
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let Some(workspace_id) = subscription.as_ref().map(|value| value.workspace_id) else {
                            continue;
                        };
                        match authorize_workspace_subscription(&state, auth.session_id, auth.user.id, workspace_id).await {
                            Ok(true) => {
                                if send_server_message(
                                    &mut socket,
                                    &ServerMessage::SyncRequired { version: PROTOCOL_VERSION, workspace_id },
                                )
                                .await
                                .is_err()
                                {
                                    break;
                                }
                            }
                            Ok(false) => break,
                            Err(error) => {
                                warn!(?error, "failed to reconcile lagged realtime client");
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                if last_pong.elapsed() > HEARTBEAT_TIMEOUT {
                    break;
                }
                match session_is_active(&state, auth.session_id, auth.user.id).await {
                    Ok(true) => {}
                    Ok(false) => {
                        let _ = send_error(&mut socket, RealtimeErrorCode::Unauthorized).await;
                        break;
                    }
                    Err(error) => {
                        warn!(?error, "failed to validate realtime session heartbeat");
                        break;
                    }
                }
                if send_socket_message(&mut socket, Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }

    clear_subscription(&state.realtime, &mut subscription);
    let _ = send_socket_message(&mut socket, Message::Close(None)).await;
}

async fn receive_authentication(
    state: &AppState,
    socket: &mut WebSocket,
) -> Option<crate::auth::AuthenticatedUser> {
    let message = match timeout(AUTH_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(message))) => message,
        _ => return None,
    };
    let Message::Text(text) = message else {
        let _ = send_error(socket, RealtimeErrorCode::Unauthorized).await;
        let _ = send_socket_message(socket, Message::Close(None)).await;
        return None;
    };
    let Ok(ClientMessage::Authenticate { version, token }) = serde_json::from_str(&text) else {
        let _ = send_error(socket, RealtimeErrorCode::Unauthorized).await;
        let _ = send_socket_message(socket, Message::Close(None)).await;
        return None;
    };
    if version != PROTOCOL_VERSION {
        let _ = send_error(socket, RealtimeErrorCode::Unauthorized).await;
        let _ = send_socket_message(socket, Message::Close(None)).await;
        return None;
    }
    match authenticate_token(state, &token).await {
        Ok(auth) => Some(auth),
        Err(_) => {
            let _ = send_error(socket, RealtimeErrorCode::Unauthorized).await;
            let _ = send_socket_message(socket, Message::Close(None)).await;
            None
        }
    }
}

async fn authorize_workspace_subscription(
    state: &AppState,
    session_id: Uuid,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<bool, AppError> {
    if !session_is_active(state, session_id, user_id).await? {
        return Ok(false);
    }
    match workspace_role(&state.pool, user_id, workspace_id).await {
        Ok(_) => Ok(true),
        Err(AppError::Internal(error)) => Err(AppError::Internal(error)),
        Err(_) => Ok(false),
    }
}

async fn receive_event(
    subscription: &mut Option<WorkspaceSubscription>,
) -> Result<RealtimeEvent, broadcast::error::RecvError> {
    match subscription {
        Some(subscription) => subscription.receiver.recv().await,
        None => pending().await,
    }
}

fn clear_subscription(hub: &RealtimeHub, subscription: &mut Option<WorkspaceSubscription>) {
    if let Some(previous) = subscription.take() {
        let workspace_id = previous.workspace_id;
        drop(previous);
        hub.remove_workspace_if_idle(workspace_id);
    }
}

async fn send_error(socket: &mut WebSocket, code: RealtimeErrorCode) -> Result<(), ()> {
    send_server_message(
        socket,
        &ServerMessage::Error {
            version: PROTOCOL_VERSION,
            code,
        },
    )
    .await
}

async fn send_server_message(socket: &mut WebSocket, message: &ServerMessage) -> Result<(), ()> {
    send_json(socket, message).await
}

async fn send_json(socket: &mut WebSocket, value: &impl Serialize) -> Result<(), ()> {
    let payload = serde_json::to_string(value).expect("realtime server messages must serialize");
    send_socket_message(socket, Message::Text(payload.into())).await
}

async fn send_socket_message(socket: &mut WebSocket, message: Message) -> Result<(), ()> {
    match timeout(SEND_TIMEOUT, socket.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) | Err(_) => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{RealtimeEvent, RealtimeHub, WORKSPACE_CHANNEL_CAPACITY};
    use tokio::sync::broadcast;
    use uuid::Uuid;

    #[tokio::test]
    async fn drops_idle_workspace_channels_without_affecting_other_subscribers() {
        let hub = RealtimeHub::new();
        let workspace_id = Uuid::new_v4();
        let mut first = hub.subscribe(workspace_id);
        let mut second = hub.subscribe(workspace_id);
        assert_eq!(hub.workspace_count(), 1);

        hub.publish(RealtimeEvent::task_activity_changed(
            workspace_id,
            Uuid::new_v4(),
        ));
        assert!(first.recv().await.is_ok());
        assert!(second.recv().await.is_ok());

        drop(first);
        hub.remove_workspace_if_idle(workspace_id);
        assert_eq!(hub.workspace_count(), 1);
        drop(second);
        hub.remove_workspace_if_idle(workspace_id);
        assert_eq!(hub.workspace_count(), 0);
    }

    #[tokio::test]
    async fn bounds_slow_subscribers_and_reports_lag_without_panicking() {
        let hub = RealtimeHub::new();
        let workspace_id = Uuid::new_v4();
        let mut receiver = hub.subscribe(workspace_id);
        for _ in 0..=WORKSPACE_CHANNEL_CAPACITY {
            hub.publish(RealtimeEvent::task_activity_changed(
                workspace_id,
                Uuid::new_v4(),
            ));
        }

        assert!(matches!(
            receiver.recv().await,
            Err(broadcast::error::RecvError::Lagged(_))
        ));
    }
}
