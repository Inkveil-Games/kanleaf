use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
pub enum EventType {
    #[serde(rename = "task.created")]
    TaskCreated,
    #[serde(rename = "task.updated")]
    TaskUpdated,
    #[serde(rename = "task.deleted")]
    TaskDeleted,
    #[serde(rename = "comment.created")]
    CommentCreated,
    #[serde(rename = "comment.updated")]
    CommentUpdated,
    #[serde(rename = "comment.deleted")]
    CommentDeleted,
    #[serde(rename = "webhook.test")]
    WebhookTest,
}

impl EventType {
    pub const CATALOG: [Self; 6] = [
        Self::TaskCreated,
        Self::TaskUpdated,
        Self::TaskDeleted,
        Self::CommentCreated,
        Self::CommentUpdated,
        Self::CommentDeleted,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TaskCreated => "task.created",
            Self::TaskUpdated => "task.updated",
            Self::TaskDeleted => "task.deleted",
            Self::CommentCreated => "comment.created",
            Self::CommentUpdated => "comment.updated",
            Self::CommentDeleted => "comment.deleted",
            Self::WebhookTest => "webhook.test",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub id: Uuid,
    pub identifier: String,
}
#[derive(Deserialize, Serialize)]
pub struct Actor {
    pub id: Uuid,
}

#[derive(Deserialize, Serialize)]
pub struct TaskSnapshot {
    pub id: Uuid,
    pub task_number: i64,
    pub reference: String,
    pub title: String,
    pub state_id: Uuid,
    pub priority: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
pub struct CommentSnapshot {
    pub id: Uuid,
    pub task_id: Uuid,
    pub parent_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum EventData {
    Task {
        task: TaskSnapshot,
        changed_fields: Vec<String>,
    },
    Comment {
        comment: CommentSnapshot,
    },
    Test {
        message: String,
    },
}

#[derive(Deserialize, Serialize)]
pub struct Event {
    pub version: u8,
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: EventType,
    pub occurred_at: DateTime<Utc>,
    pub workspace: Identity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<Identity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    pub data: EventData,
}

impl Event {
    pub fn new(
        kind: EventType,
        workspace: Identity,
        project: Option<Identity>,
        actor: Option<Uuid>,
        data: EventData,
    ) -> Self {
        Self {
            version: 2,
            id: Uuid::new_v4(),
            kind,
            occurred_at: Utc::now(),
            workspace,
            project,
            actor: actor.map(|id| Actor { id }),
            data,
        }
    }

    pub fn example(kind: EventType, workspace: Identity, project: Identity) -> Self {
        let occurred_at = DateTime::parse_from_rfc3339("2026-01-01T12:00:00Z")
            .expect("valid fixture timestamp")
            .with_timezone(&Utc);
        let data = match kind {
            EventType::TaskCreated | EventType::TaskUpdated | EventType::TaskDeleted => {
                EventData::Task {
                    task: TaskSnapshot {
                        id: Uuid::from_u128(2),
                        task_number: 42,
                        reference: "#42".to_owned(),
                        title: "Example task (preview only)".to_owned(),
                        state_id: Uuid::from_u128(3),
                        priority: "medium".to_owned(),
                        archived_at: None,
                        updated_at: occurred_at,
                    },
                    changed_fields: if kind == EventType::TaskUpdated {
                        vec!["title".to_owned(), "priority".to_owned()]
                    } else {
                        vec![]
                    },
                }
            }
            EventType::CommentCreated | EventType::CommentUpdated | EventType::CommentDeleted => {
                EventData::Comment {
                    comment: CommentSnapshot {
                        id: Uuid::from_u128(5),
                        task_id: Uuid::from_u128(2),
                        parent_id: None,
                        body: (kind != EventType::CommentDeleted)
                            .then(|| "Example comment (preview only)".to_owned()),
                        updated_at: occurred_at,
                    },
                }
            }
            EventType::WebhookTest => EventData::Test {
                message: "Kanleaf webhook test".to_owned(),
            },
        };
        let mut event = Self::new(
            kind,
            workspace,
            (kind != EventType::WebhookTest).then_some(project),
            Some(Uuid::from_u128(6)),
            data,
        );
        event.id = Uuid::from_u128(1);
        event.occurred_at = occurred_at;
        event
    }
}
