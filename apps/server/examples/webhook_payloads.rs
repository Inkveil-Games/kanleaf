use kanleaf_server::domain::events::{Event, EventType, Identity};
use std::collections::BTreeMap;
use uuid::Uuid;

fn main() {
    let examples: BTreeMap<_, _> = EventType::CATALOG
        .into_iter()
        .map(|kind| {
            (
                kind.as_str(),
                Event::example(
                    kind,
                    Identity {
                        id: Uuid::from_u128(8),
                        identifier: "example-workspace".to_owned(),
                    },
                    Identity {
                        id: Uuid::from_u128(7),
                        identifier: "example-project".to_owned(),
                    },
                ),
            )
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&examples).unwrap());
}
