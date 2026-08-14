#![allow(non_snake_case)]

use dioxus::prelude::*;

use crate::auth::{AuthFlow, logout};

static CSS: Asset = asset!("/assets/styles.css");

pub fn App() -> Element {
    let mut session_token = use_signal(|| None::<String>);

    if let Some(token) = session_token.read().clone() {
        return rsx! {
            document::Link { rel: "stylesheet", href: CSS }
            main {
                class: "workspace",
                button {
                    class: "logout-button",
                    r#type: "button",
                    onclick: move |_| {
                        let token = token.clone();
                        async move {
                            let _ = logout(&token).await;
                            session_token.set(None);
                        }
                    },
                    "Log out"
                }
            }
        };
    }

    rsx! {
        document::Link { rel: "stylesheet", href: CSS }
        AuthFlow {
            on_authenticated: move |token| session_token.set(Some(token)),
        }
    }
}
