use kanleaf_server::domain::events::{Event, EventType, Identity};
use serde_json::Value;
use uuid::Uuid;

#[test]
fn published_preview_fixtures_use_the_actual_v2_serializer() {
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/webhook-payloads.json")).unwrap();
    for kind in EventType::CATALOG {
        let event = Event::example(
            kind,
            Identity {
                id: Uuid::from_u128(8),
                identifier: "example-workspace".to_owned(),
            },
            Identity {
                id: Uuid::from_u128(7),
                identifier: "example-project".to_owned(),
            },
        );
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            fixtures[kind.as_str()],
            "{} fixture/preview contract drift",
            kind.as_str()
        );
    }
    assert!(
        include_str!("../../../docs/webhooks.md")
            .contains("apps/server/tests/fixtures/webhook-payloads.json")
    );
}
